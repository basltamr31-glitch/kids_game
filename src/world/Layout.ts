import { Vector3 } from 'three';

/**
 * Where everything on the farm stands.
 *
 * Its own module because it is pure data that half the codebase needs, and
 * living inside WorldBuilder meant importing the entire world builder to ask
 * where the barn is — which produced a genuine import cycle the moment the
 * navigation helpers needed the house position.
 */
/** Layout constants — one place to move a whole building. */
export const LAYOUT = {
  house: new Vector3(-19, 0, -2),
  houseRotation: 0,
  barn: new Vector3(20, 0, -4),
  barnRotation: -0.25,
  coop: new Vector3(-3, 0, 20),
  garden: new Vector3(-19, 0, 16),
  well: new Vector3(-9, 0, 4),
  haystack: new Vector3(9, 0, 3),
  trough: new Vector3(16, 0, 13),
  yardCentre: new Vector3(0, 0, 9),
  meadowView: new Vector3(3, 0, 44),
  streamZ: 68,
  bridge: new Vector3(0, 0, 68),
  appleTree: new Vector3(-34, 0, 7),
};
