import { Vector3 } from 'three';
import type { Hinge } from '../gameplay/interact/Interactable';
import type { CollisionWorld } from './Collision';
import type { NavGrid } from './NavGrid';

/**
 * A door that is actually a door.
 *
 * Shut, it is a wall: solid to walk into and closed to the pathfinder. Open, it
 * is a gap. It is the same object in both states, which is the whole point —
 * a door you can see swinging but walk through regardless is scenery, and a
 * door that is permanently a hole in the wall is not a door either.
 *
 * Opening one is something the child does. They stand in front of it, reach
 * out, and it swings; it does not fly open because they came near. The one
 * exception is a child already walking through a doorway, who opens it on the
 * way, because that is what people do and because every routine in the game
 * would otherwise have to remember to.
 */

/** How long the leaf takes to swing, and how long the child spends opening it. */
export const DOOR_SWING_SECONDS = 0.85;

export class Door {
  readonly hinge: Hinge;
  /** Centre of the doorway in world space. */
  readonly centre = new Vector3();
  /** Half-width of the opening, along the wall. */
  readonly halfWidth: number;

  private collision: CollisionWorld;
  private nav: NavGrid | null = null;
  private handle: number;
  private open = false;

  constructor(options: {
    hinge: Hinge;
    collision: CollisionWorld;
    centre: Vector3;
    halfWidth: number;
    /** Thickness of the wall the door sits in. */
    halfDepth: number;
    /** Rotation of the wall about Y. */
    rot: number;
  }) {
    this.hinge = options.hinge;
    this.collision = options.collision;
    this.centre.copy(options.centre);
    this.halfWidth = options.halfWidth;

    this.handle = options.collision.addBox(
      options.centre.x,
      options.centre.z,
      options.halfWidth,
      options.halfDepth,
      options.rot,
      'building',
    );
  }

  /**
   * Moves the doorway to where the building actually stands.
   *
   * The house is built at the origin and placed afterwards, so the door cannot
   * know its world position when it is constructed. Rather than guess, it
   * registers a collider and is told where it ended up.
   */
  placeAt(x: number, z: number, collision: CollisionWorld, nav: NavGrid): void {
    this.centre.set(x, 0, z);
    collision.moveBox(this.handle, x, z);
    this.nav = nav;
    const pad = this.halfWidth + 1.5;
    nav.refreshArea(x - pad, z - pad, x + pad, z + pad);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** How close the child has to be to reach the handle. */
  get reach(): number {
    return this.halfWidth + 1.4;
  }

  /** True when this point is close enough to the doorway to be going through it. */
  nearDoorway(x: number, z: number, margin = 1.6): boolean {
    return Math.hypot(x - this.centre.x, z - this.centre.z) < this.halfWidth + margin;
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.hinge.set(open);
    // Solid when shut, a gap when open — and the pathfinder has to agree, or
    // the child routes around a door that is standing wide open.
    this.collision.setEnabled(this.handle, !open);
    if (this.nav) {
      const pad = this.halfWidth + 1.5;
      this.nav.refreshArea(
        this.centre.x - pad,
        this.centre.z - pad,
        this.centre.x + pad,
        this.centre.z + pad,
      );
    }
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  update(dt: number): void {
    this.hinge.update(dt);
  }
}
