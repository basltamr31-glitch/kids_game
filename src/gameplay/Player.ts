import { Group, Object3D, Vector3 } from 'three';
import { CharacterRig, type CharacterLook, type ClipName } from '../characters/CharacterRig';
import type { Expression } from '../characters/Face';
import type { Terrain } from '../world/Terrain';
import { damp, clamp } from '../core/Rng';
import { PartBuilder } from '../art/MeshKit';
import { SKIN_TONES, HAIR_COLORS, OUTFIT_PRIMARY, OUTFIT_SECONDARY } from '../art/Palette';
import type { CharacterAppearance } from '../save/SaveSchema';
import { LAYOUT } from '../world/WorldBuilder';
import type { Seat } from './interact/Interactable';

/**
 * The child.
 *
 * Movement is "walk to a point": the player taps, the child walks there and
 * stops. There is no failure state, no falling, and no obstacle the child can
 * get stuck on — walkability is a simple slope-and-bounds test plus a short
 * list of building footprints they step around.
 */

export type Surface = 'grass' | 'dirt' | 'wood' | 'snow';

/** Building footprints the child walks around rather than through. */
const BLOCKERS: { centre: Vector3; radiusX: number; radiusZ: number }[] = [
  { centre: LAYOUT.barn.clone(), radiusX: 7.6, radiusZ: 6.2 },
  { centre: LAYOUT.coop.clone(), radiusX: 2.4, radiusZ: 2.0 },
  { centre: LAYOUT.well.clone(), radiusX: 1.6, radiusZ: 1.6 },
  { centre: LAYOUT.haystack.clone(), radiusX: 2.4, radiusZ: 2.4 },
  { centre: LAYOUT.trough.clone(), radiusX: 1.9, radiusZ: 1.0 },
];

/** Walls of the house; the doorway gap is handled explicitly. */
const HOUSE_HALF_X = 7.2;
const HOUSE_HALF_Z = 5.7;
const DOOR_HALF_WIDTH = 1.5;

/**
 * Waypoints either side of the front door.
 *
 * The house has solid walls and the game has no navmesh, so a child told to
 * walk to the kitchen from the farmyard would slide along the outside wall and
 * stop. Routing through these two points is all the navigation this world
 * actually needs: there is exactly one building you can enter, with exactly one
 * door, and everything else is open ground.
 */
const DOOR_OUTSIDE = new Vector3(LAYOUT.house.x, 0, LAYOUT.house.z + HOUSE_HALF_Z + 1.4);
const DOOR_INSIDE = new Vector3(LAYOUT.house.x, 0, LAYOUT.house.z + HOUSE_HALF_Z - 1.5);

export class Player {
  readonly group = new Group();
  readonly rig: CharacterRig;
  readonly position = new Vector3();

  /** Item currently held in the right hand, if any. */
  private carried: Object3D | null = null;
  private carriedItemId: string | null = null;

  private velocity = new Vector3();
  private moveTarget: Vector3 | null = null;
  private speed = 0;
  private facing = 0;
  private terrain: Terrain;
  private scripted = false;

  /** True while a prop is in the hand, so idle holds the carry pose. */
  private carrying = false;
  /** Seat the child is currently on, or null when standing. */
  private seat: Seat | null = null;
  private seatBlend = 0;

  /** Set by the interaction system when a walk is part of an activity. */
  onArrive: (() => void) | null = null;
  onFootstep: ((surface: Surface) => void) | null = null;

  constructor(appearance: CharacterAppearance, terrain: Terrain, spawn: Vector3) {
    this.terrain = terrain;
    this.rig = new CharacterRig(lookFromAppearance(appearance));
    this.group.add(this.rig.group);

    this.position.copy(spawn);
    this.position.y = terrain.heightAt(spawn.x, spawn.z);
    this.group.position.copy(this.position);
    this.bindFootsteps();
  }

  get isMoving(): boolean {
    return this.speed > 0.08;
  }

  get height(): number {
    return this.rig.height;
  }

  get heldItem(): string | null {
    return this.carriedItemId;
  }

  /** Rebuilds the body after a customization change. */
  static lookFor(appearance: CharacterAppearance): CharacterLook {
    return lookFromAppearance(appearance);
  }

  /**
   * Walks to a point, routing through the front door when that crossing is
   * required. The remaining waypoints are queued and consumed on arrival.
   */
  walkTo(point: Vector3): void {
    const destination = this.findWalkablePoint(point);
    this.path = this.routeTo(destination);
    this.moveTarget = this.path.shift() ?? destination;
  }

  /**
   * Builds the waypoint list. Returns the destination alone when start and end
   * are on the same side of the front wall.
   */
  private routeTo(destination: Vector3): Vector3[] {
    const fromInside = this.isInsideHouse(this.position.x, this.position.z);
    const toInside = this.isInsideHouse(destination.x, destination.z);
    if (fromInside === toInside) return [destination];

    const a = fromInside ? DOOR_INSIDE : DOOR_OUTSIDE;
    const b = fromInside ? DOOR_OUTSIDE : DOOR_INSIDE;
    return [a.clone(), b.clone(), destination];
  }

  stop(): void {
    this.moveTarget = null;
    this.path.length = 0;
  }

  private path: Vector3[] = [];

  /** Freezes player-driven movement while a scripted activity plays. */
  setScripted(scripted: boolean): void {
    this.scripted = scripted;
    if (scripted) this.moveTarget = null;
  }

  faceToward(point: Vector3): void {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    if (dx * dx + dz * dz < 1e-4) return;
    this.facing = Math.atan2(dx, dz);
  }

  /** True while a prop is in hand. Changes the idle and walk poses. */
  setCarrying(carrying: boolean): void {
    this.carrying = carrying;
  }

  get isCarrying(): boolean {
    return this.carrying;
  }

  /** Which way the body is turned, in radians. Head tracking is relative to it. */
  get facingAngle(): number {
    return this.facing;
  }

  get isSeated(): boolean {
    return this.seat !== null;
  }

  /**
   * Sits the child on a seat.
   *
   * The body is moved to the seat's world transform rather than parented to it,
   * so the walk-away is a normal walk from wherever the chair happens to be,
   * and a chair that never moves does not need to own the character.
   */
  sitOn(seat: Seat): void {
    this.seat = seat;
    this.seatBlend = 0;
    seat.node.updateWorldMatrix(true, false);
    const world = seat.offset.clone().applyMatrix4(seat.node.matrixWorld);
    this.position.x = world.x;
    this.position.z = world.z;
    this.seatHeight = world.y;
    this.facing = seat.yaw;
    this.moveTarget = null;
    this.scripted = true;
    this.rig.play('sitDown', true);
  }

  standUp(): void {
    if (!this.seat) return;
    this.seat = null;
    this.rig.play('standUp', true);
    // Step clear of the chair so the child is not standing inside it.
    const away = new Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(0.55);
    this.position.x += away.x;
    this.position.z += away.z;
  }

  private seatHeight = 0;

  playClip(clip: ClipName): void {
    this.rig.play(clip, true);
  }

  setExpression(expression: Expression): void {
    this.rig.setExpression(expression);
  }

  /** Attaches a small prop to the child's hand. */
  carry(itemId: string | null): void {
    if (this.carried) {
      this.rig.joints.holdR.remove(this.carried);
      disposeObject(this.carried);
      this.carried = null;
    }
    this.carriedItemId = itemId;
    if (!itemId) return;

    const prop = buildCarriedProp(itemId);
    if (prop) {
      this.carried = prop;
      this.rig.joints.holdR.add(prop);
    }
  }

  update(dt: number): void {
    if (!this.scripted && this.moveTarget) {
      this.stepTowardTarget(dt);
    } else {
      this.speed = damp(this.speed, 0, 12, dt);
    }

    // Height comes from the seat while sitting and from the terrain otherwise.
    // Blending between them means sitting down and standing up both settle
    // rather than snapping the character to a new height.
    const groundY = this.terrain.heightAt(this.position.x, this.position.z);
    if (this.seat) {
      this.seatBlend = Math.min(1, this.seatBlend + dt * 3);
      this.position.y = damp(this.position.y, this.seatHeight, 8, dt);
    } else {
      this.seatBlend = Math.max(0, this.seatBlend - dt * 3);
      this.position.y = damp(this.position.y, groundY, 16, dt);
    }
    this.group.position.copy(this.position);
    this.group.rotation.y = dampAngle(this.group.rotation.y, this.facing, 11, dt);

    // Choose the clip unless a scripted sequence has taken control.
    if (this.seat) {
      // sitDown is a one-shot; hold the seated idle once it has played out.
      if (this.rig.currentClip === 'sitDown' && this.rig.clipProgress >= 1) {
        this.rig.play('sitIdle');
      }
    } else if (!this.scripted) {
      if (this.speed > 2.6) this.rig.play('run');
      else if (this.speed > 0.15) this.rig.play('walk');
      else if (this.carrying || this.carriedItemId) this.rig.play('carry');
      else this.rig.play('idle');
    }

    this.rig.update(dt, this.speed);
  }

  private stepTowardTarget(dt: number): void {
    const target = this.moveTarget!;
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < 0.28) {
      // More waypoints to go: take the next one without stopping or firing
      // the arrival callback, so a route through the door reads as one walk.
      const next = this.path.shift();
      if (next) {
        this.moveTarget = next;
        return;
      }
      this.moveTarget = null;
      this.speed = damp(this.speed, 0, 14, dt);
      const callback = this.onArrive;
      this.onArrive = null;
      callback?.();
      return;
    }

    // Ease in, and ease out over the last metre so the stop is not abrupt.
    const maxSpeed = this.carriedItemId ? 2.6 : 3.4;
    const approach = clamp(distance / 1.4, 0.25, 1);
    this.speed = damp(this.speed, maxSpeed * approach, 6, dt);

    const step = Math.min(distance, this.speed * dt);
    const nx = this.position.x + (dx / distance) * step;
    const nz = this.position.z + (dz / distance) * step;

    // Slide along blockers rather than stopping dead against them.
    const resolved = this.resolveCollision(this.position.x, this.position.z, nx, nz);
    this.position.x = resolved.x;
    this.position.z = resolved.z;

    this.facing = Math.atan2(dx, dz);
    this.velocity.set(dx, 0, dz).normalize().multiplyScalar(this.speed);
  }

  /**
   * Footsteps are driven by the animation rather than a parallel timer, so the
   * sound lands on the frame the foot actually plants. The rig raises
   * `onFootPlant` at each stride crossing.
   */
  private bindFootsteps(): void {
    this.rig.onFootPlant = () => {
      this.onFootstep?.(this.surfaceUnderfoot());
    };
  }

  surfaceUnderfoot(): Surface {
    const { x, z } = this.position;
    // Inside a building: wooden floor.
    if (this.isInsideHouse(x, z)) return 'wood';
    if (Math.hypot(x - LAYOUT.barn.x, z - LAYOUT.barn.z) < 7) return 'dirt';
    // The worn path ring around the farmyard.
    if (Math.abs(Math.hypot(x * 0.9, (z - 6) * 0.95) - 15) < 2.2) return 'dirt';
    return 'grass';
  }

  isInsideHouse(x = this.position.x, z = this.position.z): boolean {
    return (
      Math.abs(x - LAYOUT.house.x) < HOUSE_HALF_X && Math.abs(z - LAYOUT.house.z) < HOUSE_HALF_Z
    );
  }

  /**
   * Finds the nearest point the child is allowed to stand on.
   * A tap that lands somewhere impossible walks them as close as it can rather
   * than doing nothing, which is much less confusing for a small child.
   */
  findWalkablePoint(point: Vector3): Vector3 {
    const out = point.clone();
    out.y = this.terrain.heightAt(out.x, out.z);

    if (this.terrain.isWalkable(out.x, out.z) && !this.isBlocked(out.x, out.z)) return out;

    // Spiral outward for a nearby legal spot.
    for (let radius = 1; radius <= 10; radius += 1) {
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const x = point.x + Math.cos(angle) * radius;
        const z = point.z + Math.sin(angle) * radius;
        if (this.terrain.isWalkable(x, z) && !this.isBlocked(x, z)) {
          return new Vector3(x, this.terrain.heightAt(x, z), z);
        }
      }
    }
    return this.position.clone();
  }

  private isBlocked(x: number, z: number): boolean {
    for (const blocker of BLOCKERS) {
      const dx = Math.abs(x - blocker.centre.x);
      const dz = Math.abs(z - blocker.centre.z);
      if (dx < blocker.radiusX && dz < blocker.radiusZ) return true;
    }
    // The house: solid walls, except the doorway on the +Z face.
    const hx = x - LAYOUT.house.x;
    const hz = z - LAYOUT.house.z;
    const inX = Math.abs(hx) < HOUSE_HALF_X + 0.5;
    const inZ = Math.abs(hz) < HOUSE_HALF_Z + 0.5;
    if (inX && inZ) {
      const insideCore =
        Math.abs(hx) < HOUSE_HALF_X - 0.5 && Math.abs(hz) < HOUSE_HALF_Z - 0.5;
      if (insideCore) return false; // free to walk around inside
      // On the wall band: only the doorway is passable.
      const atDoor = hz > HOUSE_HALF_Z - 1.2 && Math.abs(hx) < DOOR_HALF_WIDTH;
      return !atDoor;
    }
    return false;
  }

  /** Axis-separated resolution: blocked on X still allows sliding on Z. */
  private resolveCollision(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
  ): { x: number; z: number } {
    if (!this.isBlocked(toX, toZ) && this.terrain.isWalkable(toX, toZ)) {
      return { x: toX, z: toZ };
    }
    if (!this.isBlocked(toX, fromZ) && this.terrain.isWalkable(toX, fromZ)) {
      return { x: toX, z: fromZ };
    }
    if (!this.isBlocked(fromX, toZ) && this.terrain.isWalkable(fromX, toZ)) {
      return { x: fromX, z: toZ };
    }
    return { x: fromX, z: fromZ };
  }

  dispose(): void {
    this.rig.dispose();
    if (this.carried) disposeObject(this.carried);
  }
}

export function lookFromAppearance(appearance: CharacterAppearance): CharacterLook {
  return {
    skin: SKIN_TONES[appearance.skinTone % SKIN_TONES.length],
    hair: HAIR_COLORS[appearance.hairColor % HAIR_COLORS.length],
    hairStyle: appearance.hairStyle,
    primary: OUTFIT_PRIMARY[appearance.outfit % OUTFIT_PRIMARY.length],
    secondary: OUTFIT_SECONDARY[appearance.outfit % OUTFIT_SECONDARY.length],
    adult: false,
    skirt: appearance.preset === 'girl' && appearance.outfit % 2 === 0,
  };
}

/** Small hand-held props, built the same way as everything else. */
function buildCarriedProp(itemId: string): Object3D | null {
  const b = new PartBuilder();
  switch (itemId) {
    case 'hay':
      b.box(0.34, 0.24, 0.26, 'hay', { pos: [0, -0.06, 0.1] });
      for (let i = 0; i < 8; i++) {
        b.box(0.05, 0.03, 0.3, 'hayDark', {
          pos: [-0.14 + i * 0.04, 0.06, 0.12],
          rot: [0.2, i * 0.4, 0],
        });
      }
      break;
    case 'grain':
      b.cylinder(0.14, 0.16, 0.24, 'hayDark', { pos: [0, -0.08, 0.1] }, 8);
      b.cylinder(0.15, 0.15, 0.04, 'hay', { pos: [0, 0.04, 0.1] }, 8);
      break;
    case 'bucket':
      b.cylinder(0.15, 0.12, 0.26, 'bucket', { pos: [0, -0.16, 0.06] }, 10);
      b.cylinder(0.16, 0.16, 0.04, 'bucketRim', { pos: [0, -0.03, 0.06] }, 10);
      break;
    case 'milk':
      b.cylinder(0.15, 0.12, 0.26, 'bucket', { pos: [0, -0.16, 0.06] }, 10);
      b.cylinder(0.13, 0.13, 0.04, 'wallPlaster', { pos: [0, -0.05, 0.06] }, 10);
      b.cylinder(0.16, 0.16, 0.04, 'bucketRim', { pos: [0, -0.02, 0.06] }, 10);
      break;
    case 'wateringcan':
      b.cylinder(0.14, 0.14, 0.24, 'uiGreen', { pos: [0, -0.14, 0.06] }, 10);
      b.cylinder(0.04, 0.05, 0.3, 'uiGreen', { pos: [0.16, -0.08, 0.16], rot: [0.5, 0, -0.7] }, 6);
      b.cylinder(0.07, 0.07, 0.04, 'uiGreenDeep', { pos: [0.28, 0.02, 0.24] }, 8);
      break;
    default:
      return null;
  }
  const mesh = b.toMesh(`carried-${itemId}`);
  mesh.castShadow = true;
  return mesh;
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    const mesh = child as { geometry?: { dispose(): void } };
    mesh.geometry?.dispose();
  });
  object.removeFromParent();
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}
