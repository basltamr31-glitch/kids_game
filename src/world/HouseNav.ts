import { Vector3 } from 'three';
import { LAYOUT } from './WorldBuilder';

/**
 * Getting in and out of the chalet.
 *
 * The house has solid walls and the game has no navmesh. Anyone told to walk to
 * the kitchen from the farmyard would otherwise slide along the outside wall
 * and stop. Routing through two waypoints either side of the front door is all
 * the navigation this world actually needs: there is exactly one building you
 * can enter, it has exactly one door, and everything else is open ground.
 *
 * This lives here rather than inside `Player` because the parents need it too.
 * Now that the cutaway works and interiors are genuinely on screen, an adult
 * gliding through a wall is something the player can see.
 */

/** Walls of the house; the doorway gap is handled explicitly. */
export const HOUSE_HALF_X = 7.2;
export const HOUSE_HALF_Z = 5.7;
export const DOOR_HALF_WIDTH = 1.5;

export const DOOR_OUTSIDE = new Vector3(
  LAYOUT.house.x,
  0,
  LAYOUT.house.z + HOUSE_HALF_Z + 1.4,
);
export const DOOR_INSIDE = new Vector3(
  LAYOUT.house.x,
  0,
  LAYOUT.house.z + HOUSE_HALF_Z - 1.5,
);

export function isInsideHouse(x: number, z: number): boolean {
  return (
    Math.abs(x - LAYOUT.house.x) < HOUSE_HALF_X &&
    Math.abs(z - LAYOUT.house.z) < HOUSE_HALF_Z
  );
}

/**
 * Waypoints from `from` to `destination`.
 *
 * Returns the destination alone when both ends are on the same side of the
 * front wall, so the common case costs nothing.
 */
export function routeThroughDoor(from: Vector3, destination: Vector3): Vector3[] {
  const fromInside = isInsideHouse(from.x, from.z);
  const toInside = isInsideHouse(destination.x, destination.z);
  if (fromInside === toInside) return [destination];

  const a = fromInside ? DOOR_INSIDE : DOOR_OUTSIDE;
  const b = fromInside ? DOOR_OUTSIDE : DOOR_INSIDE;
  return [a.clone(), b.clone(), destination];
}
