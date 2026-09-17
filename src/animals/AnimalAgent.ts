import { Object3D, Vector3 } from 'three';
import { AnimalRig, type AnimalClip } from './AnimalRig';
import type { AnimalDefinition } from '../content/Types';
import type { AnimalSaveState } from '../save/SaveSchema';
import { AREAS_BY_ID } from '../content/Items';
import { damp, type Rng } from '../core/Rng';
import type { Terrain } from '../world/Terrain';

/**
 * Animal behaviour.
 *
 * Animals must never look like they are waiting for the player. Each one runs a
 * small state machine whose transition probabilities come from its
 * `temperament`, so Luna really does come and look at you, Wooly really does
 * keep her distance, and Rosie really does sleep a lot.
 *
 * This is cheap on purpose: no pathfinding, no steering behaviours, just a
 * target point on a walkable patch and a timer.
 */

type State =
  | 'idle' | 'wander' | 'graze' | 'rest' | 'approach' | 'watch' | 'react'
  /** Walking to a specific spot for a routine or a dropped pile of food. */
  | 'travel'
  /** Head down at a dropped pile of food. */
  | 'feeding'
  | 'drinking';

/**
 * Where an animal wants to be during each part of the day.
 *
 * This is the difference between livestock and scenery. A cow that drifts to
 * the feeding corner in the morning, spends the day out in the pasture, comes
 * to the trough in the afternoon and walks back toward the barn in the evening
 * reads as an animal with a life, and it costs one table and a target point.
 */
interface RoutineStop {
  /** Offset from the animal's home area centre, in metres. */
  offset: [number, number];
  /** How tightly it holds that spot. 0 wanders freely, 1 stays put. */
  focus: number;
}

interface TemperamentTuning {
  /** Relative weights for picking the next state. */
  weights: Record<'idle' | 'wander' | 'graze' | 'rest' | 'watch', number>;
  /** Chance per decision to walk toward the child when they are close. */
  approachChance: number;
  /** Preferred distance to keep from the child. */
  comfortDistance: number;
  /** Multiplier on how long each state lasts. */
  pace: number;
}

const TUNING: Record<string, TemperamentTuning> = {
  gentle: {
    weights: { idle: 2, wander: 2, graze: 4, rest: 1, watch: 2 },
    approachChance: 0.25,
    comfortDistance: 1.6,
    pace: 1.0,
  },
  playful: {
    weights: { idle: 1, wander: 5, graze: 2, rest: 0.4, watch: 1.5 },
    approachChance: 0.35,
    comfortDistance: 1.4,
    pace: 0.65,
  },
  curious: {
    weights: { idle: 1.5, wander: 3, graze: 2, rest: 0.5, watch: 3 },
    approachChance: 0.7,
    comfortDistance: 1.1,
    pace: 0.8,
  },
  shy: {
    weights: { idle: 2, wander: 3, graze: 3, rest: 1, watch: 1 },
    approachChance: 0.04,
    comfortDistance: 3.4,
    pace: 1.1,
  },
  sleepy: {
    weights: { idle: 3, wander: 1, graze: 2, rest: 5, watch: 1 },
    approachChance: 0.08,
    comfortDistance: 2.0,
    pace: 1.6,
  },
};

const ROUTINE: Record<string, Record<string, RoutineStop>> = {
  cow: {
    morning:   { offset: [-9, -8], focus: 0.7 },   // feeding corner
    midday:    { offset: [4, 6], focus: 0.15 },    // out in the pasture
    afternoon: { offset: [-2, -6], focus: 0.6 },   // near the trough
    evening:   { offset: [-10, -10], focus: 0.75 },// drifting back to the barn
    night:     { offset: [-11, -11], focus: 0.9 },
  },
  sheep: {
    morning:   { offset: [-6, -4], focus: 0.5 },
    midday:    { offset: [7, 8], focus: 0.1 },
    afternoon: { offset: [2, 2], focus: 0.2 },
    evening:   { offset: [-8, -8], focus: 0.7 },
    night:     { offset: [-9, -9], focus: 0.9 },
  },
  chicken: {
    // Chickens stay near the coop all day and simply bustle about.
    morning:   { offset: [2, -2], focus: 0.3 },
    midday:    { offset: [-2, 2], focus: 0.2 },
    afternoon: { offset: [1, 3], focus: 0.2 },
    evening:   { offset: [3, -1], focus: 0.6 },
    night:     { offset: [3, -1], focus: 0.95 },
  },
};

export class AnimalAgent {
  readonly rig: AnimalRig;
  readonly definition: AnimalDefinition;
  readonly object: Object3D;

  /** Runtime state persisted into the save. */
  state: AnimalSaveState;

  private behaviour: State = 'idle';
  private timer = 0;
  private target = new Vector3();
  private velocity = 0;
  private tuning: TemperamentTuning;
  private rng: Rng;
  private terrain: Terrain;
  private reactTimer = 0;
  private homeCentre = new Vector3();
  private homeRadius = 8;

  /** Current routine anchor, recomputed when the day phase changes. */
  private routineCentre = new Vector3();
  private routineFocus = 0.2;
  private phase = '';

  /** Set while the animal is walking to, and then eating, a dropped pile. */
  private foodPoint: Vector3 | null = null;
  private onFoodEaten: (() => void) | null = null;
  private feedTimer = 0;

  constructor(
    definition: AnimalDefinition,
    state: AnimalSaveState,
    rng: Rng,
    terrain: Terrain,
  ) {
    this.definition = definition;
    this.state = state;
    this.rng = rng;
    this.terrain = terrain;
    this.tuning = TUNING[definition.temperament] ?? TUNING.gentle;

    this.rig = new AnimalRig(definition, rng);
    this.object = this.rig.group;

    const area = AREAS_BY_ID.get(definition.area);
    if (area) {
      this.homeCentre.set(
        (area.bounds.minX + area.bounds.maxX) / 2,
        0,
        (area.bounds.minZ + area.bounds.maxZ) / 2,
      );
      this.homeRadius =
        Math.min(
          area.bounds.maxX - area.bounds.minX,
          area.bounds.maxZ - area.bounds.minZ,
        ) / 2.4;
    }

    // Spread the herd out on first placement.
    const angle = rng.range(0, Math.PI * 2);
    const radius = rng.range(0, this.homeRadius * 0.8);
    const x = this.homeCentre.x + Math.cos(angle) * radius;
    const z = this.homeCentre.z + Math.sin(angle) * radius;
    this.object.position.set(x, terrain.heightAt(x, z), z);
    this.object.rotation.y = rng.range(0, Math.PI * 2);
    this.target.copy(this.object.position);
    this.routineCentre.copy(this.homeCentre);
    this.pickNextBehaviour(new Vector3(0, 0, 1e6));
  }

  get id(): string {
    return this.definition.id;
  }

  /**
   * Moves the animal onto its routine anchor for a new part of the day.
   * Called by the game whenever the phase changes.
   */
  setPhase(phase: string): void {
    if (phase === this.phase) return;
    this.phase = phase;
    const table = ROUTINE[this.definition.kind] ?? ROUTINE.sheep;
    const stop = table[phase] ?? table.midday;
    this.routineCentre.set(
      this.homeCentre.x + stop.offset[0],
      0,
      this.homeCentre.z + stop.offset[1],
    );
    this.routineFocus = stop.focus;
    // Break whatever it was doing so the change is visible rather than
    // waiting out a long graze.
    if (this.behaviour === 'graze' || this.behaviour === 'idle') this.timer = 0;
  }

  /**
   * Sends the animal to a pile of food the child has put down, to eat it.
   *
   * This is what makes feeding feel like feeding: the child sets the hay down
   * and the animal walks over and puts its head in it, rather than a number
   * changing somewhere.
   */
  beginEating(point: Vector3, onDone: () => void): void {
    this.foodPoint = point.clone();
    this.onFoodEaten = onDone;
    this.behaviour = 'travel';
    this.timer = 14;
    this.setTargetUnclamped(point.x, point.z);
    this.rig.play('walk');
  }

  get position(): Vector3 {
    return this.object.position;
  }

  /** Anchor for a floating reaction bubble. */
  getEmoteWorldPosition(out: Vector3): Vector3 {
    return this.rig.joints.emoteAnchor.getWorldPosition(out);
  }

  /** Called when the child feeds / pets / milks this animal. */
  react(kind: 'happy' | 'alert' = 'happy'): void {
    this.behaviour = 'react';
    this.reactTimer = 2.4;
    this.rig.play(kind);
    this.state.bond = Math.min(1, this.state.bond + 0.08);
  }

  /** Turns to face a world position over the next few frames. */
  faceToward(point: Vector3, dt: number): void {
    const dx = point.x - this.object.position.x;
    const dz = point.z - this.object.position.z;
    if (dx * dx + dz * dz < 1e-4) return;
    const desired = Math.atan2(dx, dz);
    this.object.rotation.y = dampAngle(this.object.rotation.y, desired, 6, dt);
  }

  update(dt: number, childPosition: Vector3, isNight: boolean): void {
    const distanceToChild = this.object.position.distanceTo(childPosition);

    if (this.behaviour === 'react') {
      this.reactTimer -= dt;
      this.faceToward(childPosition, dt);
      this.velocity = damp(this.velocity, 0, 8, dt);
      if (this.reactTimer <= 0) this.pickNextBehaviour(childPosition);
      this.finishFrame(dt);
      return;
    }

    // Night overrides everything: animals settle down near their shelter.
    if (isNight && this.behaviour !== 'rest') {
      this.behaviour = 'rest';
      this.timer = 60;
      this.rig.play('sleep');
    }

    this.timer -= dt;
    if (this.timer <= 0) this.pickNextBehaviour(childPosition);

    switch (this.behaviour) {
      case 'travel': {
        if (!this.foodPoint) {
          this.pickNextBehaviour(childPosition);
          break;
        }
        const arrived = !this.moveToward(this.target, dt);
        if (arrived) {
          this.behaviour = 'feeding';
          this.feedTimer = this.rng.range(5, 8);
          this.rig.play('eat');
          this.faceToward(this.foodPoint, dt);
        }
        break;
      }

      case 'feeding': {
        this.velocity = damp(this.velocity, 0, 8, dt);
        this.feedTimer -= dt;
        if (this.feedTimer <= 0) {
          this.onFoodEaten?.();
          this.onFoodEaten = null;
          this.foodPoint = null;
          this.state.fed = 1;
          this.behaviour = 'react';
          this.reactTimer = 1.6;
          this.rig.play('happy');
        }
        break;
      }

      case 'drinking': {
        this.velocity = damp(this.velocity, 0, 8, dt);
        break;
      }

      case 'wander':
      case 'approach': {
        const moved = this.moveToward(this.target, dt);
        if (!moved) this.pickNextBehaviour(childPosition);
        // A shy animal that has been crowded backs off politely.
        if (
          this.behaviour === 'approach' &&
          distanceToChild < this.tuning.comfortDistance
        ) {
          this.behaviour = 'watch';
          this.timer = this.rng.range(1.5, 3.5);
          this.rig.play('alert');
        }
        break;
      }
      case 'graze':
        this.velocity = damp(this.velocity, 0, 8, dt);
        break;
      case 'watch':
        this.velocity = damp(this.velocity, 0, 8, dt);
        this.faceToward(childPosition, dt);
        break;
      case 'rest':
      case 'idle':
      default:
        this.velocity = damp(this.velocity, 0, 8, dt);
        break;
    }

    // Personal space: if the child walks right up, a shy animal steps away.
    if (
      distanceToChild < this.tuning.comfortDistance * 0.6 &&
      this.behaviour !== 'rest' &&
      this.definition.temperament === 'shy'
    ) {
      const away = new Vector3()
        .subVectors(this.object.position, childPosition)
        .setY(0)
        .normalize()
        .multiplyScalar(3.5)
        .add(this.object.position);
      this.setTarget(away.x, away.z);
      this.behaviour = 'wander';
      this.timer = 2.5;
      this.rig.play('walk');
    }

    this.finishFrame(dt);
  }

  private finishFrame(dt: number): void {
    // Stick to the ground.
    const { x, z } = this.object.position;
    this.object.position.y = damp(
      this.object.position.y,
      this.terrain.heightAt(x, z),
      14,
      dt,
    );
    this.rig.update(dt, this.velocity);
  }

  private pickNextBehaviour(childPosition: Vector3): void {
    const distance = this.object.position.distanceTo(childPosition);
    const t = this.tuning;

    // Curious animals will break off and come over to say hello.
    if (distance < 12 && distance > t.comfortDistance && this.rng.bool(t.approachChance)) {
      this.behaviour = 'approach';
      this.timer = this.rng.range(3, 6) * t.pace;
      const toChild = new Vector3().subVectors(childPosition, this.object.position).setY(0);
      const stopShort = Math.max(0, toChild.length() - t.comfortDistance);
      toChild.normalize().multiplyScalar(stopShort).add(this.object.position);
      this.setTarget(toChild.x, toChild.z);
      this.rig.play('walk');
      return;
    }

    const options = ['idle', 'wander', 'graze', 'rest', 'watch'] as const;
    const weights = options.map((option) => {
      let w = t.weights[option];
      // Watching only makes sense if the child is actually nearby.
      if (option === 'watch' && distance > 14) w *= 0.05;
      return w;
    });

    const choice = this.rng.pickWeighted(options, weights);
    this.behaviour = choice;

    switch (choice) {
      case 'wander': {
        this.timer = this.rng.range(3, 7) * t.pace;
        // Wander around the ROUTINE anchor rather than the area centre, and
        // the tighter the focus the smaller the circle. That is what makes a
        // herd drift toward the barn as evening comes on.
        const angle = this.rng.range(0, Math.PI * 2);
        const spread = this.homeRadius * (1 - this.routineFocus * 0.8);
        const radius = this.rng.range(1, Math.max(1.5, spread));
        this.setTarget(
          this.routineCentre.x + Math.cos(angle) * radius,
          this.routineCentre.z + Math.sin(angle) * radius,
        );
        this.rig.play('walk');
        break;
      }
      case 'graze':
        this.timer = this.rng.range(4, 10) * t.pace;
        this.rig.play('eat');
        break;
      case 'rest':
        this.timer = this.rng.range(8, 18) * t.pace;
        this.rig.play('sleep');
        break;
      case 'watch':
        this.timer = this.rng.range(2, 5);
        this.rig.play('alert');
        break;
      default:
        this.timer = this.rng.range(2, 6) * t.pace;
        this.rig.play('idle');
        break;
    }
  }

  /** Sets a target without clamping to the home area, for dropped food. */
  private setTargetUnclamped(x: number, z: number): void {
    this.target.set(x, this.terrain.heightAt(x, z), z);
  }

  private setTarget(x: number, z: number): void {
    // Keep animals inside their area and off steep ground.
    const clampedX = Math.max(
      this.homeCentre.x - this.homeRadius,
      Math.min(this.homeCentre.x + this.homeRadius, x),
    );
    const clampedZ = Math.max(
      this.homeCentre.z - this.homeRadius,
      Math.min(this.homeCentre.z + this.homeRadius, z),
    );
    this.target.set(clampedX, this.terrain.heightAt(clampedX, clampedZ), clampedZ);
  }

  /** @returns false when the target has been reached. */
  private moveToward(target: Vector3, dt: number): boolean {
    const dx = target.x - this.object.position.x;
    const dz = target.z - this.object.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.35) {
      this.velocity = damp(this.velocity, 0, 8, dt);
      return false;
    }

    const speed = this.definition.moveSpeed;
    this.velocity = damp(this.velocity, speed, 4, dt);

    const step = Math.min(distance, this.velocity * dt);
    this.object.position.x += (dx / distance) * step;
    this.object.position.z += (dz / distance) * step;

    const desired = Math.atan2(dx, dz);
    this.object.rotation.y = dampAngle(this.object.rotation.y, desired, 5, dt);
    return true;
  }

  /** Overnight: hunger drifts, milk refills, a new egg may appear. */
  advanceDay(rng: Rng): void {
    this.state.fed = Math.max(0.25, this.state.fed - rng.range(0.3, 0.5));
    this.state.watered = Math.max(0.25, this.state.watered - rng.range(0.3, 0.5));
    this.state.petToday = false;
    if (this.definition.kind === 'cow') this.state.milkReady = true;
    if (this.definition.kind === 'chicken') {
      this.state.eggsAvailable = Math.min(3, this.state.eggsAvailable + rng.int(1, 2));
    }
  }

  setClip(clip: AnimalClip): void {
    this.rig.play(clip);
  }
}

/** Shortest-path angle damping, so a turn never takes the long way round. */
function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}
