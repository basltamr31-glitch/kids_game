import { Vector3, type InstancedMesh, type Object3D } from 'three';
import type { Player } from './Player';
import type { AnimalAgent } from '../animals/AnimalAgent';
import type { Rng } from '../core/Rng';

/**
 * The child noticing things.
 *
 * A character who only ever reacts to being tapped is a puppet. This watches
 * for a few specific, legible things near the child and makes them turn their
 * head and change expression: a butterfly drifting past, an animal that has
 * come to stand beside them, and — when they have been still a while — the
 * mountains.
 *
 * Deliberately narrow. Three cues the player can actually learn to recognise
 * beat a dozen they read as random twitching. Nothing here touches gameplay
 * state; it is head rotation and a face, and anything scripted overrides it.
 */

const _world = new Vector3();
const _toTarget = new Vector3();

/** How long a notice holds the child's attention. */
const NOTICE_DURATION = 2.6;

interface Notice {
  point: Vector3;
  expression: 'happy' | 'curious' | 'delighted';
  timeLeft: number;
}

export class ChildNotices {
  private player: Player;
  private animals: Map<string, AnimalAgent>;
  private butterflyWings: InstancedMesh | null = null;
  private rng: Rng;

  private current: Notice | null = null;
  /** Seconds before another look is allowed, so they are not constantly gawping. */
  private cooldown = 2;
  /** How long the child has been standing still. */
  private stillFor = 0;

  private mountainLook = new Vector3();

  constructor(
    player: Player,
    animals: Map<string, AnimalAgent>,
    rng: Rng,
    ambientRoot: Object3D,
  ) {
    this.player = player;
    this.animals = animals;
    this.rng = rng;
    const wings = ambientRoot.getObjectByName('butterfly-wing-0');
    this.butterflyWings = (wings as InstancedMesh) ?? null;
    // Up the valley, where the peaks are highest.
    this.mountainLook.set(0, 60, -220);
  }

  update(dt: number, scripted: boolean): void {
    // A routine is in charge of the head while it runs; never fight it.
    if (scripted || this.player.isSeated) {
      this.current = null;
      this.player.rig.clearLook();
      return;
    }

    this.stillFor = this.player.isMoving ? 0 : this.stillFor + dt;

    if (this.current) {
      this.current.timeLeft -= dt;
      if (this.current.timeLeft <= 0) {
        this.current = null;
        this.player.rig.clearLook();
        this.player.setExpression('neutral');
        this.cooldown = this.rng.range(3.5, 7);
      } else {
        this.aimAt(this.current.point);
      }
      return;
    }

    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    const found = this.findButterfly() ?? this.findAnimal() ?? this.findView();
    if (!found) {
      // Try again shortly rather than every frame.
      this.cooldown = 0.6;
      return;
    }
    this.current = found;
    this.player.setExpression(found.expression);
  }

  /** Turns the head toward a world point, as an additive offset from facing. */
  private aimAt(point: Vector3): void {
    const head = this.player.position;
    _toTarget.subVectors(point, head);
    const distance = Math.hypot(_toTarget.x, _toTarget.z);
    const yaw = Math.atan2(_toTarget.x, _toTarget.z) - this.player.facingAngle;
    const pitch = Math.atan2(_toTarget.y - 1.15, Math.max(0.2, distance));

    // Wrap into [-PI, PI] so the head takes the short way round.
    let wrapped = yaw;
    while (wrapped > Math.PI) wrapped -= Math.PI * 2;
    while (wrapped < -Math.PI) wrapped += Math.PI * 2;

    // Beyond about 100 degrees a child turns their body, not just their neck,
    // and forcing the head round looks broken. Drop the notice instead.
    if (Math.abs(wrapped) > 1.75) {
      this.current = null;
      this.player.rig.clearLook();
      this.player.setExpression('neutral');
      this.cooldown = 2;
      return;
    }
    this.player.rig.lookTowards(wrapped, pitch, 0.85);
  }

  private findButterfly(): Notice | null {
    const mesh = this.butterflyWings;
    if (!mesh) return null;
    const array = mesh.instanceMatrix.array;
    let best = -1;
    let bestDistance = 3.2;
    for (let i = 0; i < mesh.count; i++) {
      const o = i * 16;
      const dx = array[o + 12] - this.player.position.x;
      const dz = array[o + 14] - this.player.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best < 0) return null;
    const o = best * 16;
    return {
      point: _world.set(array[o + 12], array[o + 13], array[o + 14]).clone(),
      expression: 'delighted',
      timeLeft: NOTICE_DURATION,
    };
  }

  private findAnimal(): Notice | null {
    let best: AnimalAgent | null = null;
    let bestDistance = 2.6;
    for (const animal of this.animals.values()) {
      const distance = animal.position.distanceTo(this.player.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = animal;
      }
    }
    if (!best) return null;
    return {
      point: best.position.clone().setY(best.position.y + 0.5),
      expression: 'happy',
      timeLeft: NOTICE_DURATION,
    };
  }

  /** Standing still long enough, the child looks up at the mountains. */
  private findView(): Notice | null {
    if (this.stillFor < 6) return null;
    this.stillFor = 0;
    return {
      point: this.mountainLook.clone(),
      expression: 'curious',
      timeLeft: NOTICE_DURATION * 1.4,
    };
  }
}
