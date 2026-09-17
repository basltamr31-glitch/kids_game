import { Group, Vector3 } from 'three';
import { CharacterRig, type ClipName } from './CharacterRig';
import { PALETTE } from '../art/Palette';
import type { Terrain } from '../world/Terrain';
import { damp, type Rng } from '../core/Rng';
import type { DayPhase, Weather } from '../save/SaveSchema';
import { LAYOUT } from '../world/WorldBuilder';

/**
 * Mum and Dad.
 *
 * They are NOT quest-givers standing on a marker. They have their own daily
 * routine: Mum is in the kitchen in the morning, in the garden by midday, on
 * the porch in the evening. Dad is out at the fence, then with the animals,
 * then indoors. They wave when the child comes near, they look up from what
 * they are doing, and they occasionally drift over to each other.
 *
 * This is the single cheapest thing that makes the farm feel like a home.
 */

export type ParentRole = 'mother' | 'father';

interface RoutineStop {
  phase: DayPhase;
  /** World position. */
  at: Vector3;
  clip: ClipName;
  /** Where they turn to face while working. */
  facing?: Vector3;
  /** Prefer indoors when the weather is bad. */
  indoorAlternative?: { at: Vector3; clip: ClipName };
}

const h = LAYOUT.house;

const ROUTINES: Record<ParentRole, RoutineStop[]> = {
  mother: [
    {
      phase: 'morning',
      at: new Vector3(h.x - 3.0, 0, h.z - 3.0),
      clip: 'stir',
      facing: new Vector3(h.x - 4.0, 0, h.z - 4.6),
    },
    {
      phase: 'midday',
      at: new Vector3(LAYOUT.garden.x + 2.5, 0, LAYOUT.garden.z + 1.0),
      clip: 'crouchPick',
      indoorAlternative: { at: new Vector3(h.x - 3.0, 0, h.z - 3.0), clip: 'stir' },
    },
    {
      phase: 'afternoon',
      at: new Vector3(LAYOUT.garden.x - 1.5, 0, LAYOUT.garden.z - 2.0),
      clip: 'pour',
      indoorAlternative: { at: new Vector3(h.x - 4.2, 0, h.z + 2.2), clip: 'idle' },
    },
    {
      phase: 'evening',
      at: new Vector3(h.x - 1.8, 0, h.z - 1.0),
      clip: 'stir',
      facing: new Vector3(h.x - 1.4, 0, h.z - 1.4),
    },
    { phase: 'night', at: new Vector3(h.x - 4.2, 0, h.z + 2.0), clip: 'idle' },
  ],
  father: [
    {
      phase: 'morning',
      at: new Vector3(LAYOUT.haystack.x + 2.4, 0, LAYOUT.haystack.z + 1.5),
      clip: 'sweep',
      indoorAlternative: { at: new Vector3(h.x + 1.0, 0, h.z + 3.0), clip: 'idle' },
    },
    {
      phase: 'midday',
      at: new Vector3(12.5, 0, 18),
      clip: 'hammer',
      facing: new Vector3(11, 0, 18),
      indoorAlternative: { at: new Vector3(LAYOUT.barn.x, 0, LAYOUT.barn.z + 4), clip: 'sweep' },
    },
    {
      phase: 'afternoon',
      at: new Vector3(LAYOUT.trough.x - 2.0, 0, LAYOUT.trough.z - 2.0),
      clip: 'pour',
      indoorAlternative: { at: new Vector3(LAYOUT.barn.x + 2, 0, LAYOUT.barn.z + 3), clip: 'idle' },
    },
    {
      phase: 'evening',
      at: new Vector3(h.x + 2.2, 0, h.z - 0.6),
      clip: 'idle',
      facing: new Vector3(h.x - 1.4, 0, h.z - 1.4),
    },
    { phase: 'night', at: new Vector3(h.x - 2.6, 0, h.z + 2.6), clip: 'idle' },
  ],
};

export class FamilyAgent {
  readonly group = new Group();
  readonly rig: CharacterRig;
  readonly role: ParentRole;
  readonly position = new Vector3();

  private terrain: Terrain;
  private rng: Rng;
  private target: Vector3;
  private facingTarget: Vector3 | null = null;
  private workClip: ClipName = 'idle';
  private speed = 0;
  private facing = 0;
  private phase: DayPhase = 'morning';
  private weather: Weather = 'sunny';

  private greetCooldown = 0;
  private isGreeting = false;
  private greetTimer = 0;
  private idleShuffle = 0;

  constructor(role: ParentRole, terrain: Terrain, rng: Rng) {
    this.role = role;
    this.terrain = terrain;
    this.rng = rng;

    this.rig = new CharacterRig(
      role === 'mother'
        ? {
            skin: PALETTE.skinTones[1],
            hair: PALETTE.motherHair,
            hairStyle: 1,
            primary: PALETTE.motherDress,
            secondary: PALETTE.motherApron,
            adult: true,
            skirt: true,
            apron: PALETTE.motherApron,
          }
        : {
            skin: PALETTE.skinTones[1],
            hair: PALETTE.fatherHair,
            hairStyle: 0,
            primary: PALETTE.fatherShirt,
            secondary: PALETTE.fatherTrousers,
            adult: true,
            skirt: false,
          },
    );
    this.group.add(this.rig.group);

    const first = ROUTINES[role][0];
    this.target = first.at.clone();
    this.position.copy(first.at);
    this.position.y = terrain.heightAt(first.at.x, first.at.z);
    this.group.position.copy(this.position);
    this.workClip = first.clip;
    this.facingTarget = first.facing ?? null;
  }

  setPhase(phase: DayPhase, weather: Weather): void {
    this.phase = phase;
    this.weather = weather;
    this.applyRoutine();
  }

  setWeather(weather: Weather): void {
    if (this.weather === weather) return;
    this.weather = weather;
    this.applyRoutine();
  }

  private applyRoutine(): void {
    const stops = ROUTINES[this.role];
    const stop = stops.find((s) => s.phase === this.phase) ?? stops[0];
    const badWeather = this.weather === 'rain' || this.weather === 'snow';

    if (badWeather && stop.indoorAlternative) {
      this.target = stop.indoorAlternative.at.clone();
      this.workClip = stop.indoorAlternative.clip;
      this.facingTarget = null;
    } else {
      this.target = stop.at.clone();
      this.workClip = stop.clip;
      this.facingTarget = stop.facing ?? null;
    }
    // A small random offset so they never stand in the exact same spot twice.
    this.target.x += this.rng.range(-0.6, 0.6);
    this.target.z += this.rng.range(-0.6, 0.6);
  }

  /** Waves and smiles at the child. Called by the interaction system. */
  greet(): void {
    if (this.greetCooldown > 0 || this.isGreeting) return;
    this.isGreeting = true;
    this.greetTimer = 2.2;
    this.greetCooldown = 22;
    this.rig.play('wave', true);
    this.rig.setExpression('happy');
  }

  get isBusy(): boolean {
    return this.isGreeting;
  }

  /** Plays a one-off clip (used by activity scripts). */
  act(clip: ClipName, expression: 'happy' | 'neutral' | 'surprised' = 'happy'): void {
    this.rig.play(clip, true);
    this.rig.setExpression(expression);
    this.isGreeting = true;
    this.greetTimer = 2.4;
  }

  update(dt: number, childPosition: Vector3): void {
    this.greetCooldown = Math.max(0, this.greetCooldown - dt);

    if (this.isGreeting) {
      this.greetTimer -= dt;
      this.faceToward(childPosition);
      this.speed = damp(this.speed, 0, 10, dt);
      if (this.greetTimer <= 0) {
        this.isGreeting = false;
        this.rig.setExpression('neutral');
      }
    } else {
      this.moveTowardTarget(dt);
    }

    // Wave when the child first comes close, without being asked.
    const distance = this.position.distanceTo(childPosition);
    if (distance < 4.5 && this.greetCooldown <= 0 && !this.isGreeting) {
      this.greet();
    }

    // Look up from work when the child is nearby — the "alive" tell.
    if (distance < 9 && !this.isGreeting) {
      const dx = childPosition.x - this.position.x;
      const dz = childPosition.z - this.position.z;
      const relative = Math.atan2(dx, dz) - this.group.rotation.y;
      this.rig.lookTowards(wrapAngle(relative), 0.05, 1);
    } else {
      this.rig.clearLook();
    }

    const groundY = this.terrain.heightAt(this.position.x, this.position.z);
    this.position.y = damp(this.position.y, groundY, 14, dt);
    this.group.position.copy(this.position);
    this.group.rotation.y = dampAngleTo(this.group.rotation.y, this.facing, 7, dt);

    this.rig.update(dt, this.speed);
  }

  private moveTowardTarget(dt: number): void {
    const dx = this.target.x - this.position.x;
    const dz = this.target.z - this.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < 0.4) {
      this.speed = damp(this.speed, 0, 10, dt);
      // At the workstation: do the job, facing the right way.
      if (this.rig.currentClip !== this.workClip) this.rig.play(this.workClip);
      if (this.facingTarget) this.faceToward(this.facingTarget);

      // Occasionally shift a step; standing perfectly still reads as a statue.
      this.idleShuffle -= dt;
      if (this.idleShuffle <= 0) {
        this.idleShuffle = this.rng.range(8, 20);
        this.target.x += this.rng.range(-1.0, 1.0);
        this.target.z += this.rng.range(-1.0, 1.0);
      }
      return;
    }

    this.speed = damp(this.speed, 1.5, 4, dt);
    const step = Math.min(distance, this.speed * dt);
    this.position.x += (dx / distance) * step;
    this.position.z += (dz / distance) * step;
    this.facing = Math.atan2(dx, dz);
    if (this.rig.currentClip !== 'walk') this.rig.play('walk');
  }

  private faceToward(point: Vector3): void {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    if (dx * dx + dz * dz < 1e-4) return;
    this.facing = Math.atan2(dx, dz);
  }

  dispose(): void {
    this.rig.dispose();
  }
}

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function dampAngleTo(current: number, target: number, lambda: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}
