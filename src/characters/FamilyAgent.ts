import { Group, Object3D, Vector3 } from 'three';
import { CharacterRig, type ClipName } from './CharacterRig';
import { PALETTE } from '../art/Palette';
import type { Terrain } from '../world/Terrain';
import { damp, type Rng } from '../core/Rng';
import type { DayPhase, Weather } from '../save/SaveSchema';
import { LAYOUT } from '../world/WorldBuilder';
import { routeThroughDoor } from '../world/HouseNav';
import { makeProp, type PropKind } from '../gameplay/interact/PropFactory';

/**
 * Mum and Dad.
 *
 * They are NOT quest-givers standing on a marker. Each part of the day gives
 * them a short round of chores to walk between and repeat: Mum cooks, carries
 * plates through to the table, picks and waters in the garden and brings the
 * basket back to the kitchen; Dad mucks out, hauls hay to the barn, scatters
 * grain at the coop, mends fences and fills the trough from the well.
 *
 * Two things matter more than the list itself. Work has a LENGTH — when a
 * chore's time is up they move on to the next — which is the difference
 * between a routine and a pose. And they hold the thing they are working
 * with, because `sweep` played with empty hands is mime, not work.
 *
 * They use the front door like everyone else, wave when the child comes near,
 * and look up from what they are doing.
 *
 * This is the single cheapest thing that makes the farm feel like a home.
 */

export type ParentRole = 'mother' | 'father';

interface Chore {
  /** Where the work happens. */
  at: Vector3;
  clip: ClipName;
  /** Where they turn to face while working. */
  facing?: Vector3;
  /** Seconds spent on it before moving to the next one. */
  dwell: number;
  /** Held in the right hand on the way there and while working. */
  carry?: PropKind;
}

/**
 * A parent's work for one part of the day.
 *
 * A single stop per phase left them rooted to one marker for hours of game
 * time, playing one animation — the thing that reads as a shop-window dummy
 * rather than as someone getting through a day's work. A phase is now a short
 * round of chores they walk between and then repeat, with something in their
 * hands for the ones that would look daft empty-handed.
 */
interface PhaseWork {
  phase: DayPhase;
  chores: Chore[];
  /** Used instead when it is raining or snowing. */
  indoor: Chore[];
}

const h = LAYOUT.house;
const v = (x: number, z: number): Vector3 => new Vector3(x, 0, z);

/** Points inside the chalet, by the room the child knows them as. */
const KITCHEN = v(h.x - 3.0, h.z - 3.0);
const STOVE_FACE = v(h.x - 4.0, h.z - 4.6);
const TABLE = v(h.x - 0.4, h.z - 1.2);
const HEARTH = v(h.x - 5.2, h.z + 1.0);
const PARLOUR = v(h.x - 4.2, h.z + 2.2);

const ROUTINES: Record<ParentRole, PhaseWork[]> = {
  mother: [
    {
      phase: 'morning',
      // Breakfast: cook, carry it through, come back for the rest.
      chores: [
        { at: KITCHEN, clip: 'stir', facing: STOVE_FACE, dwell: 26 },
        { at: TABLE, clip: 'place', dwell: 9, carry: 'plate' },
        { at: KITCHEN, clip: 'washHands', facing: STOVE_FACE, dwell: 14 },
        { at: TABLE, clip: 'place', dwell: 8, carry: 'milkJug' },
      ],
      indoor: [],
    },
    {
      phase: 'midday',
      // In the garden: pick, water, carry the basket back to the kitchen.
      chores: [
        { at: v(LAYOUT.garden.x + 2.5, LAYOUT.garden.z + 1.0), clip: 'crouchPick', dwell: 22, carry: 'basket' },
        { at: v(LAYOUT.garden.x - 1.8, LAYOUT.garden.z - 1.4), clip: 'crouchPick', dwell: 18, carry: 'basket' },
        { at: v(LAYOUT.well.x + 1.2, LAYOUT.well.z + 1.0), clip: 'reach', dwell: 10, carry: 'wateringCan' },
        { at: v(LAYOUT.garden.x + 0.5, LAYOUT.garden.z + 2.6), clip: 'pour', dwell: 16, carry: 'wateringCan' },
        { at: KITCHEN, clip: 'place', facing: STOVE_FACE, dwell: 12, carry: 'basket' },
      ],
      indoor: [
        { at: KITCHEN, clip: 'stir', facing: STOVE_FACE, dwell: 30 },
        { at: TABLE, clip: 'place', dwell: 10, carry: 'plate' },
      ],
    },
    {
      phase: 'afternoon',
      chores: [
        { at: v(h.x + 1.2, h.z + 7.4), clip: 'sweep', dwell: 20, carry: 'broom' },
        { at: v(LAYOUT.garden.x - 2.2, LAYOUT.garden.z + 0.4), clip: 'crouchPick', dwell: 18, carry: 'basket' },
        { at: KITCHEN, clip: 'stir', facing: STOVE_FACE, dwell: 24 },
      ],
      indoor: [
        { at: HEARTH, clip: 'reach', dwell: 18 },
        { at: KITCHEN, clip: 'stir', facing: STOVE_FACE, dwell: 26 },
      ],
    },
    {
      phase: 'evening',
      // Dinner, then sitting down.
      chores: [
        { at: KITCHEN, clip: 'stir', facing: STOVE_FACE, dwell: 24 },
        { at: TABLE, clip: 'place', dwell: 10, carry: 'plate' },
        { at: TABLE, clip: 'place', dwell: 9, carry: 'bread' },
        { at: PARLOUR, clip: 'idle', dwell: 20 },
      ],
      indoor: [],
    },
    {
      phase: 'night',
      chores: [
        { at: KITCHEN, clip: 'washHands', facing: STOVE_FACE, dwell: 18 },
        { at: PARLOUR, clip: 'idle', dwell: 40 },
      ],
      indoor: [],
    },
  ],
  father: [
    {
      phase: 'morning',
      // Mucking out and hauling feed.
      chores: [
        { at: v(LAYOUT.haystack.x + 2.4, LAYOUT.haystack.z + 1.5), clip: 'sweep', dwell: 20, carry: 'broom' },
        { at: v(LAYOUT.barn.x - 3.0, LAYOUT.barn.z + 3.2), clip: 'place', dwell: 10, carry: 'hay' },
        { at: v(LAYOUT.haystack.x - 1.0, LAYOUT.haystack.z + 2.6), clip: 'pickUpLow', dwell: 12 },
        { at: v(LAYOUT.coop.x + 2.0, LAYOUT.coop.z - 1.6), clip: 'scatter', dwell: 14, carry: 'grain' },
      ],
      indoor: [
        { at: v(LAYOUT.barn.x, LAYOUT.barn.z + 4), clip: 'sweep', dwell: 30, carry: 'broom' },
        { at: v(LAYOUT.barn.x - 2.5, LAYOUT.barn.z + 2), clip: 'hammer', dwell: 22, carry: 'hammer' },
      ],
    },
    {
      phase: 'midday',
      // Fence repairs, with a trip to the well for water.
      chores: [
        { at: v(12.5, 18), clip: 'hammer', facing: v(11, 18), dwell: 26, carry: 'hammer' },
        { at: v(15.5, 20.5), clip: 'hammer', facing: v(14, 21), dwell: 20, carry: 'hammer' },
        { at: v(LAYOUT.well.x + 1.4, LAYOUT.well.z + 0.8), clip: 'reach', dwell: 10, carry: 'bucket' },
        { at: v(LAYOUT.trough.x - 1.6, LAYOUT.trough.z - 1.4), clip: 'pour', dwell: 14, carry: 'bucketFull' },
      ],
      indoor: [
        { at: v(LAYOUT.barn.x, LAYOUT.barn.z + 4), clip: 'hammer', dwell: 28, carry: 'hammer' },
        { at: v(LAYOUT.barn.x + 2.5, LAYOUT.barn.z + 2.5), clip: 'sweep', dwell: 22, carry: 'broom' },
      ],
    },
    {
      phase: 'afternoon',
      chores: [
        { at: v(LAYOUT.trough.x - 2.0, LAYOUT.trough.z - 2.0), clip: 'pour', dwell: 16, carry: 'bucketFull' },
        { at: v(LAYOUT.well.x + 1.4, LAYOUT.well.z - 0.9), clip: 'reach', dwell: 12, carry: 'bucket' },
        { at: v(LAYOUT.barn.x - 4.0, LAYOUT.barn.z + 5.0), clip: 'hammer', dwell: 22, carry: 'hammer' },
      ],
      indoor: [
        { at: v(LAYOUT.barn.x + 2, LAYOUT.barn.z + 3), clip: 'hammer', dwell: 26, carry: 'hammer' },
      ],
    },
    {
      phase: 'evening',
      // Firewood in, then the porch.
      chores: [
        { at: v(LAYOUT.haystack.x - 2.0, LAYOUT.haystack.z - 1.0), clip: 'pickUpLow', dwell: 12 },
        { at: HEARTH, clip: 'place', dwell: 12, carry: 'hay' },
        { at: v(h.x + 2.2, h.z + 6.6), clip: 'idle', facing: v(h.x, h.z + 12), dwell: 26 },
      ],
      indoor: [
        { at: HEARTH, clip: 'reach', dwell: 20 },
        { at: PARLOUR, clip: 'idle', dwell: 26 },
      ],
    },
    {
      phase: 'night',
      chores: [
        { at: v(h.x - 2.6, h.z + 2.6), clip: 'idle', dwell: 40 },
        { at: HEARTH, clip: 'reach', dwell: 16 },
      ],
      indoor: [],
    },
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

  /**
   * Set while the child is busy with something close by.
   *
   * A parent who carries on hammering while their four-year-old milks a cow
   * two metres away is not paying attention to their child. Watching costs a
   * paused chore and a turned head, and it is the clearest signal in the game
   * that the family notices what the child does.
   */
  private watching = false;
  private idleShuffle = 0;

  /** The round of chores for this phase, and where in it they are. */
  private chores: Chore[] = [];
  private choreIndex = 0;
  /** Seconds left on the current chore once they have arrived. */
  private choreTimer = 0;
  /** Waypoints to the current chore, so they use the door like everyone else. */
  private path: Vector3[] = [];
  /** What is currently in their hand, if anything. */
  private heldKind: PropKind | null = null;
  private held: Object3D | null = null;
  /**
   * One instance per tool, built on first use and kept.
   *
   * A parent swaps props at every chore, and `makeProp` builds fresh geometry
   * each call, so rebuilding on each swap would orphan a geometry every time —
   * hundreds over a session. Each parent only ever handles a handful of kinds,
   * so keeping them and toggling visibility costs a few meshes and allocates
   * nothing after the first round.
   */
  private tools = new Map<PropKind, Object3D>();

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

    const first = ROUTINES[role][0].chores[0];
    this.target = first.at.clone();
    this.position.copy(first.at);
    this.position.y = terrain.heightAt(first.at.x, first.at.z);
    this.group.position.copy(this.position);
    this.workClip = first.clip;
    this.facingTarget = first.facing ?? null;
    this.applyRoutine();
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
    const work =
      ROUTINES[this.role].find((w) => w.phase === this.phase) ?? ROUTINES[this.role][0];
    const badWeather = this.weather === 'rain' || this.weather === 'snow';
    // Fall back to the fair-weather round when a phase has no indoor version,
    // rather than leaving them with nothing to do.
    this.chores = badWeather && work.indoor.length > 0 ? work.indoor : work.chores;
    this.choreIndex = 0;
    this.beginChore();
  }

  /** Walks to the current chore, picking up whatever it needs on the way. */
  private beginChore(): void {
    const chore = this.chores[this.choreIndex];
    if (!chore) return;

    this.target = chore.at.clone();
    // A small random offset so they never stand in exactly the same spot twice.
    this.target.x += this.rng.range(-0.5, 0.5);
    this.target.z += this.rng.range(-0.5, 0.5);

    this.workClip = chore.clip;
    this.facingTarget = chore.facing ?? null;
    this.choreTimer = chore.dwell * this.rng.range(0.85, 1.15);
    this.setHeld(chore.carry ?? null);

    // Use the door rather than the wall. Now that the cutaway works, an adult
    // walking through the front of the house is something the player can see.
    this.path = routeThroughDoor(this.position, this.target);
    this.target = this.path.shift() ?? this.target;
  }

  private nextChore(): void {
    this.choreIndex = (this.choreIndex + 1) % Math.max(1, this.chores.length);
    this.beginChore();
  }

  /**
   * Puts something in, or takes something out of, the parent's right hand.
   *
   * Empty hands are what made the work read as mime: someone playing `pour`
   * with nothing to pour from. The same prop factory the child's interactions
   * use builds these, so a bucket is the same bucket.
   */
  private setHeld(kind: PropKind | null): void {
    if (kind === this.heldKind) return;
    if (this.held) this.held.visible = false;
    this.heldKind = kind;
    if (!kind) {
      this.held = null;
      return;
    }
    let tool = this.tools.get(kind);
    if (!tool) {
      tool = makeProp(kind).object;
      tool.position.set(0, 0, 0);
      tool.quaternion.identity();
      this.rig.joints.holdR.add(tool);
      this.tools.set(kind, tool);
    }
    tool.visible = true;
    this.held = tool;
  }

  /**
   * Stops work to watch the child, or goes back to it.
   *
   * The chore timer is deliberately left alone: they pick up exactly where
   * they left off rather than losing the job they were part-way through.
   */
  setWatching(watching: boolean): void {
    if (this.watching === watching) return;
    this.watching = watching;
    if (watching) {
      this.rig.setExpression('curious');
    } else {
      this.rig.setExpression('neutral');
      // Resume the chore clip on the next frame of movement.
      this.rig.play(this.workClip);
    }
  }

  get isWatching(): boolean {
    return this.watching;
  }

  /**
   * Reacts to the child finishing something.
   *
   * `praise` is the loud one, for a job that helped: they stop, turn, cheer
   * and say so. `interest` is the quiet one, for play and discoveries, where
   * a cheer every time would wear thin fast.
   */
  celebrate(kind: 'praise' | 'interest', textKey: string | null): void {
    this.isGreeting = true;
    this.greetTimer = kind === 'praise' ? 2.8 : 2.0;
    this.greetCooldown = kind === 'praise' ? 14 : 20;
    this.rig.play(kind === 'praise' ? 'cheer' : 'wave', true);
    this.rig.setExpression(kind === 'praise' ? 'delighted' : 'happy');
    this.pendingLine = textKey;
  }

  /** Line to speak, consumed by whoever owns the speech bubble. */
  takeLine(): string | null {
    const line = this.pendingLine;
    this.pendingLine = null;
    return line;
  }

  private pendingLine: string | null = null;

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
        this.rig.setExpression(this.watching ? 'curious' : 'neutral');
      }
    } else if (this.watching) {
      // Downed tools, turned toward the child. The chore timer is untouched.
      this.speed = damp(this.speed, 0, 10, dt);
      this.faceToward(childPosition);
      if (this.rig.currentClip !== 'idle') this.rig.play('idle');
    } else {
      this.moveTowardTarget(dt);
    }

    // Wave when the child first comes close, without being asked.
    const distance = this.position.distanceTo(childPosition);
    if (distance < 4.5 && this.greetCooldown <= 0 && !this.isGreeting && !this.watching) {
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
      // Waypoint reached but not the chore itself: carry on to the next one.
      const next = this.path.shift();
      if (next) {
        this.target = next;
        return;
      }

      this.speed = damp(this.speed, 0, 10, dt);
      // At the workstation: do the job, facing the right way.
      if (this.rig.currentClip !== this.workClip) this.rig.play(this.workClip);
      if (this.facingTarget) this.faceToward(this.facingTarget);

      // Occasionally shift a step; standing perfectly still reads as a statue.
      this.idleShuffle -= dt;
      if (this.idleShuffle <= 0) {
        this.idleShuffle = this.rng.range(6, 14);
        this.target.x += this.rng.range(-0.8, 0.8);
        this.target.z += this.rng.range(-0.8, 0.8);
      }

      // Work has a length. When it is done they move on to the next thing,
      // which is the whole difference between a routine and a pose.
      this.choreTimer -= dt;
      if (this.choreTimer <= 0) this.nextChore();
      return;
    }

    this.speed = damp(this.speed, 1.5, 4, dt);
    const step = Math.min(distance, this.speed * dt);
    this.position.x += (dx / distance) * step;
    this.position.z += (dz / distance) * step;
    this.facing = Math.atan2(dx, dz);
    // Hands full changes how you walk.
    const walkClip: ClipName = this.heldKind ? 'carry' : 'walk';
    if (this.rig.currentClip !== walkClip) this.rig.play(walkClip);
  }

  private faceToward(point: Vector3): void {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    if (dx * dx + dz * dz < 1e-4) return;
    this.facing = Math.atan2(dx, dz);
  }

  dispose(): void {
    for (const tool of this.tools.values()) {
      tool.traverse((node) => {
        const mesh = node as { geometry?: { dispose(): void } };
        mesh.geometry?.dispose();
      });
      tool.removeFromParent();
    }
    this.tools.clear();
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
