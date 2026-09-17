import { Vector3 } from 'three';
import type { ActivityDefinition, ActivityStep } from '../content/Types';
import { ACTIVITIES_BY_ID, ITEMS_BY_ID } from '../content';
import type { GameContext } from '../core/GameContext';
import type { Player } from './Player';
import type { AnimalAgent } from '../animals/AnimalAgent';
import type { FamilyAgent } from '../characters/FamilyAgent';
import type { BuiltWorld } from '../world/WorldBuilder';
import type { CameraRig } from './CameraRig';
import type { ClipName } from '../characters/CharacterRig';
import type { InteractionRunner } from './interact/InteractionRunner';
import type { InteractStep } from './interact/Interactable';

/**
 * Plays an ActivityDefinition's steps.
 *
 * This is a tiny interpreter, not a hardcoded routine per chore. Because of
 * that, "feed the goats" is a data entry, and a designer can reorder, extend or
 * add steps without opening this file.
 *
 * FAILURE POLICY: an activity can never fail. If a prerequisite is missing, the
 * system collects the missing item itself as part of the walk, and if that is
 * impossible it ends the activity gently with a friendly toast. There is no
 * "you can't do that" state a child can get stuck in.
 */

export interface ActivityWorldRefs {
  player: Player;
  animals: Map<string, AnimalAgent>;
  parents: Map<string, FamilyAgent>;
  world: BuiltWorld;
  camera: CameraRig;
}

type StepState = 'starting' | 'running' | 'done';

/**
 * How long a scripted walk may take before we give up and move on. Generous,
 * because the child may be strolling; but finite, because a stuck task list is
 * the one way this game could genuinely frustrate someone.
 */
const WALK_TIMEOUT_SECONDS = 18;

export class ActivitySystem {
  private current: ActivityDefinition | null = null;
  private steps: ActivityStep[] = [];
  private index = 0;
  private stepState: StepState = 'done';
  private stepTimer = 0;
  private refs: ActivityWorldRefs;
  private ctx: GameContext;
  private speechVariant = 0;
  /** Plays physical routines; supplied once the world is built. */
  private runner: InteractionRunner | null = null;
  /** Named physical chains the world registers, e.g. "breakfast". */
  private routines = new Map<string, () => InteractStep[]>();
  private onComplete: ((activityId: string) => void) | null = null;

  constructor(ctx: GameContext, refs: ActivityWorldRefs) {
    this.ctx = ctx;
    this.refs = refs;
  }

  get isRunning(): boolean {
    return this.current !== null;
  }

  /**
   * Connects the physical layer.
   *
   * Kept as a setter rather than a constructor argument because the world (and
   * therefore its routines) is built after the activity system exists.
   */
  attachRunner(runner: InteractionRunner, routines: Record<string, () => InteractStep[]>): void {
    this.runner = runner;
    for (const [name, fn] of Object.entries(routines)) this.routines.set(name, fn);
  }

  get currentActivityId(): string | null {
    return this.current?.id ?? null;
  }

  /**
   * Checks whether an activity can start right now.
   * @returns null when it can, or a localization key explaining why not.
   */
  blockedReason(activity: ActivityDefinition, completedToday: string[]): string | null {
    if (activity.oncePerDay && completedToday.includes(activity.id)) return 'toast.locked';
    for (const required of activity.requiresActivities ?? []) {
      if (!completedToday.includes(required)) {
        // Not an error — just not this one yet. The task list already orders
        // these, so this only guards a stray tap.
        return 'hud.notasks';
      }
    }
    if (activity.requiresPremium && !this.ctx.entitlements.isPremium) return 'locked.title';
    return null;
  }

  start(activityId: string, onComplete?: (id: string) => void): boolean {
    if (this.current) return false;
    const activity = ACTIVITIES_BY_ID.get(activityId);
    if (!activity) {
      console.warn(`[Activity] unknown id "${activityId}"`);
      return false;
    }

    this.current = activity;
    this.steps = activity.steps;
    this.index = 0;
    this.stepState = 'starting';
    this.stepTimer = 0;
    this.speechVariant = Math.floor(Math.random() * 8);
    this.onComplete = onComplete ?? null;

    this.refs.player.setScripted(true);
    this.ctx.bus.emit('activity:started', { activityId });
    return true;
  }

  /** Aborts cleanly — used when the app is backgrounded mid-activity. */
  cancel(): void {
    if (!this.current) return;
    const activityId = this.current.id;
    this.finish(false);
    this.ctx.bus.emit('activity:cancelled', { activityId });
  }

  update(dt: number): void {
    if (!this.current) return;

    if (this.index >= this.steps.length) {
      this.complete();
      return;
    }

    const step = this.steps[this.index];

    if (this.stepState === 'starting') {
      this.stepState = 'running';
      this.stepTimer = step.duration ?? 0;
      this.beginStep(step);
      this.ctx.bus.emit('activity:step', {
        activityId: this.current.id,
        step: this.index,
        total: this.steps.length,
      });
      return;
    }

    if (this.stepState === 'running') {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        // For a walk, the timer is a safety valve rather than the normal exit:
        // arrival advances first. If we get here the destination was somehow
        // unreachable, so we move on instead of leaving the child stranded.
        if (step.kind === 'walkTo' || step.kind === 'takeItem') {
          this.refs.player.stop();
          this.refs.player.onArrive = null;
          this.refs.player.setScripted(true);
        }
        this.advance();
      }
    }
  }

  private advance(): void {
    this.index++;
    this.stepState = this.index >= this.steps.length ? 'done' : 'starting';
    if (this.stepState === 'done') this.complete();
  }

  private beginStep(step: ActivityStep): void {
    const { player, animals, parents, camera } = this.refs;

    switch (step.kind) {
      case 'walkTo': {
        const destination = this.resolvePosition(step.target);
        if (!destination) {
          this.advance();
          return;
        }
        player.setScripted(false);
        player.walkTo(destination);
        player.onArrive = () => {
          player.setScripted(true);
          player.faceToward(destination);
          this.advance();
        };
        this.stepTimer = WALK_TIMEOUT_SECONDS;
        break;
      }

      case 'face': {
        const point = this.resolvePosition(step.target);
        if (point) player.faceToward(point);
        this.stepTimer = step.duration ?? 0.3;
        break;
      }

      case 'animate': {
        player.playClip((step.clip ?? 'idle') as ClipName);
        this.stepTimer = step.duration ?? 1.5;
        this.playClipSound(step.clip);
        break;
      }

      case 'wait':
        this.stepTimer = step.duration ?? 0.5;
        break;

      case 'speech': {
        const actor = step.target ?? 'mother';
        const parent = parents.get(actor);
        if (parent) {
          parent.act('wave');
          parent.update(0, player.position);
        }
        if (step.textKey) {
          this.ctx.bus.emit('ui:speech', {
            actor,
            textKey: this.ctx.loc.tVariant(step.textKey, this.speechVariant),
            duration: step.duration ?? 2.4,
          });
          this.ctx.audio.playVoice('hello', true);
        }
        this.stepTimer = step.duration ?? 2.4;
        break;
      }

      case 'emote': {
        this.ctx.bus.emit('emote', { actor: step.target ?? 'child', emote: step.emote ?? '😊' });
        player.setExpression(expressionForEmote(step.emote));
        this.ctx.audio.playVoice('happy', false);
        this.stepTimer = step.duration ?? 1.2;
        break;
      }

      case 'animalReact': {
        const animal = step.target ? animals.get(step.target) : undefined;
        if (animal) {
          animal.react('happy');
          this.ctx.audio.playAnimal(animal.definition.voice.kind, animal.definition.voice.base);
          this.ctx.bus.emit('emote', { actor: animal.id, emote: step.emote ?? '💛' });
          animal.state.fed = 1;
          if (this.current?.verb === 'water') animal.state.watered = 1;
          if (this.current?.verb === 'pet') animal.state.petToday = true;
        }
        this.stepTimer = step.duration ?? 1.4;
        break;
      }

      case 'takeItem': {
        // Fetch the tool: walk to where it lives, then put it in the hand.
        const source = this.resolvePosition(step.target);
        const itemId = step.item ?? '';
        if (player.heldItem === itemId) {
          this.advance();
          return;
        }
        if (!source) {
          player.carry(itemId);
          this.advance();
          return;
        }
        player.setScripted(false);
        player.walkTo(source);
        player.onArrive = () => {
          player.setScripted(true);
          player.faceToward(source);
          player.playClip('reach');
          player.carry(itemId);
          this.ctx.audio.play('pickup');
          const item = ITEMS_BY_ID.get(itemId);
          if (item) {
            this.ctx.bus.emit('ui:toast', {
              textKey: 'toast.carrying',
              icon: item.icon,
              params: { item: this.ctx.loc.t(item.nameKey) },
            });
          }
          // Let the reach animation read before moving on.
          this.stepTimer = Math.min(this.stepTimer, 0.7);
        };
        this.stepTimer = WALK_TIMEOUT_SECONDS;
        break;
      }

      case 'giveItem': {
        // Hands the carried item over and empties the hand.
        player.carry(null);
        this.ctx.audio.play('drop');
        this.stepTimer = step.duration ?? 0.5;
        break;
      }

      case 'cameraFocus': {
        const point = this.resolvePosition(step.target);
        if (point) camera.focusOn(point, step.duration ?? 3);
        player.setExpression('surprised');
        this.ctx.audio.playVoice('wow', false);
        this.stepTimer = step.duration ?? 3;
        break;
      }

      case 'fadeTo':
        this.ctx.bus.emit('ui:open', { screen: 'fade' });
        this.stepTimer = step.duration ?? 2;
        break;

      case 'routine': {
        const make = step.flag ? this.routines.get(step.flag) : undefined;
        if (!make || !this.runner) {
          // No routine registered: skip rather than stall the day.
          console.warn(`[Activity] no routine registered for "${step.flag}"`);
          this.stepTimer = 0;
          break;
        }
        // The runner drives the player for as long as the chain lasts; we
        // simply wait for it to report back.
        this.stepTimer = Number.POSITIVE_INFINITY;
        this.runner.play(make(), () => {
          this.stepTimer = 0;
        });
        break;
      }

      case 'setFlag':
        if (step.flag) {
          this.ctx.save.update((data) => {
            if (!data.seenStoryBeats.includes(step.flag!)) data.seenStoryBeats.push(step.flag!);
          });
        }
        this.stepTimer = 0;
        break;

      default:
        this.stepTimer = step.duration ?? 0.4;
        break;
    }
  }

  private playClipSound(clip?: string): void {
    switch (clip) {
      case 'pour':
        this.ctx.audio.play('pour');
        break;
      case 'milk':
        this.ctx.audio.play('milk');
        break;
      case 'crouchPick':
      case 'pickUpLow':
      case 'pickUpHigh':
        this.ctx.audio.play('rustle');
        break;
      case 'scatter':
        this.ctx.audio.play('rustle');
        break;
      case 'brushTeeth':
      case 'washHands':
        this.ctx.audio.play('water');
        break;
      case 'sleep':
        this.ctx.audio.play('sleep');
        break;
      case 'stretch':
        this.ctx.audio.play('wake');
        break;
      case 'hammer':
      case 'sweep':
      case 'stir':
        this.ctx.audio.play('tap', 0.7);
        break;
      default:
        break;
    }
  }

  /** Resolves an anchor id, animal id or actor id to a world position. */
  private resolvePosition(target?: string): Vector3 | null {
    if (!target) return null;
    const { animals, parents, world } = this.refs;

    const animal = animals.get(target);
    if (animal) {
      // Stand just in front of the animal, not inside it.
      const offset = new Vector3()
        .subVectors(this.refs.player.position, animal.position)
        .setY(0);
      if (offset.lengthSq() < 1e-4) offset.set(0, 0, 1);
      offset.normalize().multiplyScalar(1.5);
      return new Vector3().addVectors(animal.position, offset);
    }

    const parent = parents.get(target);
    if (parent) {
      const offset = new Vector3()
        .subVectors(this.refs.player.position, parent.position)
        .setY(0);
      if (offset.lengthSq() < 1e-4) offset.set(0, 0, 1);
      offset.normalize().multiplyScalar(1.4);
      return new Vector3().addVectors(parent.position, offset);
    }

    const anchor = world.anchors.get(target);
    if (anchor) return anchor.position.clone();

    console.warn(`[Activity] unresolved target "${target}"`);
    return null;
  }

  private complete(): void {
    const activity = this.current;
    if (!activity) return;

    const rewards = activity.rewards;

    this.ctx.save.update((data) => {
      if (!data.completedToday.includes(activity.id)) data.completedToday.push(activity.id);
      data.completionCounts[activity.id] = (data.completionCounts[activity.id] ?? 0) + 1;
      data.hearts += rewards.hearts;

      for (const item of rewards.items ?? []) {
        const definition = ITEMS_BY_ID.get(item.id);
        const max = definition?.max ?? 99;
        data.inventory[item.id] = Math.min(max, (data.inventory[item.id] ?? 0) + item.count);
      }
      if (rewards.stickerId && !data.stickers.includes(rewards.stickerId)) {
        data.stickers.push(rewards.stickerId);
      }
      if (rewards.discoveryId && !data.discoveries.includes(rewards.discoveryId)) {
        data.discoveries.push(rewards.discoveryId);
      }
      data.hour = Math.min(24, data.hour + activity.hoursCost);
    });

    this.ctx.audio.play('reward');
    this.ctx.platform.haptic('success');

    if (rewards.discoveryId) {
      this.ctx.bus.emit('discovery:found', {
        id: rewards.discoveryId,
        category: 'place',
      });
    }
    if (rewards.stickerId) {
      this.ctx.bus.emit('ui:toast', { textKey: 'toast.sticker', icon: '⭐' });
    }

    const completedId = activity.id;
    const callback = this.onComplete;
    this.finish(true);
    this.ctx.bus.emit('activity:completed', { activityId: completedId, rewards });
    callback?.(completedId);
  }

  private finish(successful: boolean): void {
    this.refs.player.setScripted(false);
    this.refs.player.onArrive = null;
    this.refs.player.setExpression(successful ? 'happy' : 'neutral');
    this.refs.camera.clearFocus();
    this.current = null;
    this.steps = [];
    this.index = 0;
    this.stepState = 'done';
    this.onComplete = null;
    // Drop anything still in hand so the child never gets stuck carrying a tool.
    if (this.refs.player.heldItem) this.refs.player.carry(null);
  }
}

function expressionForEmote(emote?: string): 'happy' | 'laugh' | 'surprised' | 'neutral' {
  switch (emote) {
    case '😄':
    case '😋':
      return 'laugh';
    case '😮':
      return 'surprised';
    case '😊':
    case '💛':
    case '💗':
      return 'happy';
    default:
      return 'happy';
  }
}
