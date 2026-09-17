import { Object3D, Vector3, Quaternion } from 'three';
import type { GameContext } from '../../core/GameContext';
import type { Player } from '../Player';
import type { InteractStep, Prop, Seat, Socket } from './Interactable';
import { reparentKeepingWorld } from './Interactable';
import { makeProp, PROP_ITEM, type PropKind } from './PropFactory';
import type { Expression } from '../../characters/Face';
import type { ClipName } from '../../characters/CharacterRig';
import { clamp01 } from '../../core/Rng';

/**
 * Plays a sequence of physical interaction steps.
 *
 * This is what makes "have breakfast" a thing the player watches happen rather
 * than a button that fires a reward. Each step is a visible operation: walk
 * there, reach, the plate leaves the counter and arrives in the hand, the child
 * carries it, sets it down on the table, sits, eats.
 *
 * Props move between parents with a short tween rather than snapping, because
 * the whole point is that the object is seen travelling.
 */

const WALK_TIMEOUT = 16;

interface PropTween {
  prop: Prop;
  targetParent: Object3D;
  /** Local transform to arrive at. */
  toPos: Vector3;
  toQuat: Quaternion;
  fromPos: Vector3;
  fromQuat: Quaternion;
  /** Lifts the prop in an arc so it does not slide through the table. */
  arc: number;
  elapsed: number;
  duration: number;
  onDone?: () => void;
}

export class InteractionRunner {
  private steps: InteractStep[] = [];
  private index = 0;
  private timer = 0;
  private started = false;
  private running = false;

  private tween: PropTween | null = null;
  private seated: Seat | null = null;
  private carried: Prop | null = null;

  private onComplete: (() => void) | null = null;

  constructor(
    private ctx: GameContext,
    private player: Player,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  get isSeated(): boolean {
    return this.seated !== null;
  }

  get carriedProp(): Prop | null {
    return this.carried;
  }

  /** Begins a sequence. Any sequence already running is abandoned cleanly. */
  play(steps: InteractStep[], onComplete?: () => void): void {
    if (this.running) this.abort();
    this.steps = steps;
    this.index = 0;
    this.started = false;
    this.timer = 0;
    this.running = steps.length > 0;
    this.onComplete = onComplete ?? null;
    if (this.running) this.player.setScripted(true);
  }

  /** Stops immediately, leaving the world in a valid state. */
  abort(): void {
    this.finishTween(true);
    this.running = false;
    this.steps = [];
    this.index = 0;
    this.onComplete = null;
    this.player.setScripted(false);
    this.player.onArrive = null;
  }

  update(dt: number): void {
    this.updateTween(dt);
    if (!this.running) return;

    if (this.index >= this.steps.length) {
      this.complete();
      return;
    }

    const step = this.steps[this.index];

    if (!this.started) {
      this.started = true;
      this.timer = this.defaultDuration(step);
      this.begin(step);
      return;
    }

    this.timer -= dt;
    if (this.timer <= 0) {
      // A walk that times out advances anyway — a child must never be stranded.
      if (step.kind === 'walkTo') {
        this.player.stop();
        this.player.onArrive = null;
        this.player.setScripted(true);
      }
      this.advance();
    }
  }

  private advance(): void {
    this.index++;
    this.started = false;
    if (this.index >= this.steps.length) this.complete();
  }

  private complete(): void {
    this.running = false;
    this.steps = [];
    this.index = 0;
    const callback = this.onComplete;
    this.onComplete = null;
    // Stay seated if the sequence left us sitting; otherwise hand control back.
    if (!this.seated) this.player.setScripted(false);
    callback?.();
  }

  private defaultDuration(step: InteractStep): number {
    switch (step.kind) {
      case 'walkTo': return WALK_TIMEOUT;
      case 'animate': return step.duration;
      case 'wait': return step.duration;
      case 'takeProp': return step.duration ?? 0.85;
      case 'placeProp': return step.duration ?? 0.85;
      case 'sit': return 1.1;
      case 'stand': return 1.0;
      case 'swing': return step.duration ?? 0.8;
      case 'expression': return step.duration ?? 0.2;
      case 'emote': return step.duration ?? 1.2;
      case 'speech': return step.duration ?? 2.4;
      case 'face': return 0.3;
      default: return 0.05;
    }
  }

  private begin(step: InteractStep): void {
    const player = this.player;

    switch (step.kind) {
      case 'walkTo': {
        player.setScripted(false);
        player.walkTo(step.point);
        player.onArrive = () => {
          player.setScripted(true);
          if (step.face) player.faceToward(step.face);
          this.advance();
        };
        break;
      }

      case 'face':
        player.faceToward(step.point);
        break;

      case 'animate':
        player.playClip(step.clip);
        if (step.sound) this.ctx.audio.play(step.sound as never);
        break;

      case 'takeProp': {
        // The child reaches, and the prop flies to the hand on an arc.
        const low = step.prop.worldPosition.y < player.position.y + 0.55;
        player.playClip(low ? 'pickUpLow' : 'reach');
        this.startTween(
          step.prop,
          player.rig.joints.holdR,
          new Vector3(0, 0, 0),
          new Quaternion(),
          step.duration ?? 0.85,
          0.12,
          () => {
            this.carried = step.prop;
            this.ctx.audio.play('pickup');
            // Carrying changes the idle pose for as long as it is held.
            player.setCarrying(true);
          },
        );
        break;
      }

      case 'placeProp': {
        const prop = this.carried;
        if (!prop) break;
        player.playClip('place');
        const socket = step.socket;
        this.startTween(
          prop,
          socket.node,
          new Vector3(0, 0, 0),
          new Quaternion(),
          step.duration ?? 0.85,
          0.1,
          () => {
            socket.put(prop);
            this.carried = null;
            this.ctx.audio.play('drop');
            player.setCarrying(false);
          },
        );
        break;
      }

      case 'spawnProp': {
        const prop = makeProp(step.kind2 as PropKind);
        step.socket.put(prop);
        this.ctx.audio.play('pour');
        break;
      }

      case 'consumeProp': {
        const prop = step.prop;
        if (prop.socket) prop.socket.take();
        prop.object.removeFromParent();
        if (this.carried === prop) {
          this.carried = null;
          player.setCarrying(false);
        }
        break;
      }

      case 'sit': {
        const seat = step.seat;
        seat.occupied = true;
        this.seated = seat;
        player.sitOn(seat);
        break;
      }

      case 'stand': {
        if (this.seated) {
          this.seated.occupied = false;
          this.seated = null;
        }
        player.standUp();
        break;
      }

      case 'swing':
        step.hinge.set(step.open);
        this.ctx.audio.play('door');
        break;

      case 'expression':
        player.setExpression(step.value as Expression);
        break;

      case 'emote':
        this.ctx.bus.emit('emote', { actor: 'child', emote: step.emoji });
        break;

      case 'speech':
        this.ctx.bus.emit('ui:speech', {
          actor: step.actor,
          textKey: this.ctx.loc.tVariant(step.textKey, this.ctx.save.save.day),
          duration: step.duration ?? 2.4,
        });
        this.ctx.audio.playVoice('hello', step.actor !== 'child');
        break;

      case 'sound':
        this.ctx.audio.play(step.name as never);
        break;

      case 'reward': {
        this.ctx.save.update((data) => {
          if (step.hearts) data.hearts += step.hearts;
          if (step.item) {
            data.inventory[step.item] = (data.inventory[step.item] ?? 0) + (step.count ?? 1);
          }
        });
        if (step.hearts) {
          this.ctx.audio.play('heart');
          this.ctx.platform.haptic('success');
        }
        break;
      }

      case 'call':
        step.fn();
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Prop motion                                                         */
  /* ------------------------------------------------------------------ */

  private startTween(
    prop: Prop,
    targetParent: Object3D,
    toPos: Vector3,
    toQuat: Quaternion,
    duration: number,
    arc: number,
    onDone?: () => void,
  ): void {
    this.finishTween(true);

    // Lift out of whatever socket holds it, keeping its current world pose.
    if (prop.socket) prop.socket.take();
    reparentKeepingWorld(prop.object, targetParent);

    this.tween = {
      prop,
      targetParent,
      toPos: toPos.clone(),
      toQuat: toQuat.clone(),
      fromPos: prop.object.position.clone(),
      fromQuat: prop.object.quaternion.clone(),
      arc,
      elapsed: 0,
      duration,
      onDone,
    };
  }

  private updateTween(dt: number): void {
    const tween = this.tween;
    if (!tween) return;

    tween.elapsed += dt;
    const t = clamp01(tween.elapsed / tween.duration);
    // Ease in-out so the prop accelerates off the surface and settles gently.
    const e = t * t * (3 - 2 * t);

    tween.prop.object.position.lerpVectors(tween.fromPos, tween.toPos, e);
    // Arc upward through the middle of the move so it never slides through a
    // table top on its way to the hand.
    tween.prop.object.position.y += Math.sin(t * Math.PI) * tween.arc;
    tween.prop.object.quaternion.slerpQuaternions(tween.fromQuat, tween.toQuat, e);

    if (t >= 1) this.finishTween(false);
  }

  private finishTween(cancelled: boolean): void {
    const tween = this.tween;
    if (!tween) return;
    this.tween = null;
    tween.prop.object.position.copy(tween.toPos);
    tween.prop.object.quaternion.copy(tween.toQuat);
    if (!cancelled) tween.onDone?.();
  }

  /* ------------------------------------------------------------------ */

  /** Item id for whatever is in hand, for the inventory HUD. */
  get carriedItemId(): string | null {
    if (!this.carried) return null;
    return PROP_ITEM[this.carried.kind as PropKind] ?? null;
  }

  /** Used by the interaction system to decide what a socket will accept. */
  canPlaceIn(socket: Socket): boolean {
    return this.carried !== null && socket.canAccept(this.carried);
  }

  /** Forces the child out of a seat, e.g. when a day ends mid-meal. */
  forceStand(): void {
    if (!this.seated) return;
    this.seated.occupied = false;
    this.seated = null;
    this.player.standUp();
  }

  /** Clip the player should hold while idle, given what they are carrying. */
  idleClip(): ClipName {
    if (this.seated) return 'sitIdle';
    if (this.carried) return 'carry';
    return 'idle';
  }
}
