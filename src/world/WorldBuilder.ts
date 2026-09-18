import { Group, Object3D, Vector3, type Scene, type Mesh, type Material } from 'three';
import { Terrain } from './Terrain';
import { Sky } from './Sky';
import { buildMountains, Water, buildStreamBank } from './Landscape';
import { buildChalet, buildBarn, buildCoop, type BuildingResult } from './Buildings';
import { AmbientLife } from './AmbientLife';
import { CollisionWorld } from './Collision';
import { NavGrid } from './NavGrid';
import { LAYOUT } from './Layout';
import { DOOR_HALF_WIDTH, HOUSE_HALF_X, HOUSE_HALF_Z } from './HouseNav';
import {
  buildFence,
  buildWell,
  buildHayStack,
  buildTrough,
  buildGarden,
  buildBridge,
  buildGrassRings,
  buildScatterProps,
  buildGroundClutter,
  buildRocks,
  plantTrees,
  buildAppleTree,
  type GrassRing,
} from './Props';
import { M } from '../art/Materials';
import { Mesh as ThreeMesh } from 'three';
import type { Rng } from '../core/Rng';
import type { QualitySettings } from '../core/DeviceProfile';
import type { Season } from '../save/SaveSchema';

/**
 * Assembles the valley and publishes the anchors gameplay needs.
 *
 * ANCHORS are the contract between content and world: `Activities.ts` names a
 * place like `"nestbox"` and this file decides where that is. Adding a new
 * location to the game means adding one anchor here and referencing it from a
 * content definition — no gameplay code changes.
 */

export interface Anchor {
  id: string;
  /** Where the child stands to use it. */
  position: Vector3;
  /** Where a floating prompt bubble sits. */
  bubbleHeight: number;
  /** Which area it belongs to (used for premium gating and ambience). */
  area: string;
  /** Indoor anchors trigger the house cutaway. */
  indoor: boolean;
}

export interface BuiltWorld {
  root: Group;
  terrain: Terrain;
  sky: Sky;
  water: Water;
  anchors: Map<string, Anchor>;
  /**
   * Buildings whose shells fade when the child is inside.
   *
   * `openTheta` is the orbit angle that puts the camera on the building's open
   * face. A doll's-house interior keeps its back and side walls so the room
   * reads as a room; only one face is left open, and a camera anywhere else is
   * looking at the back of a solid wall however far the shell has faded.
   */
  cutaways: {
    result: BuildingResult;
    centre: Vector3;
    radius: number;
    openTheta: number;
  }[];
  /** Everything that should be re-scattered when the season changes. */
  seasonal: Group;
  /** Butterflies, birds and chimney smoke. Decorative, updated every frame. */
  ambient: AmbientLife;
  /** Everything solid. Populated here as the world is built. */
  collision: CollisionWorld;
  /** Routes around it. Built once the obstacles are all registered. */
  nav: NavGrid;
}

/**
 * Grass level-of-detail rings, centred on the farmyard.
 *
 * The near ring is where the child actually stands, so it gets curved
 * multi-segment blades at high density. Beyond 30m nobody can resolve a blade,
 * so those rings get flat cards scaled up to cover the same ground for a
 * fraction of the vertices.
 */
const GRASS_RINGS: GrassRing[] = [
  { inner: 0, outer: 26, blades: 5, curve: true, density: 1.0, wind: 1.0 },
  { inner: 26, outer: 52, blades: 4, curve: false, density: 0.42, wind: 0.85 },
  { inner: 52, outer: 88, blades: 3, curve: false, density: 0.16, wind: 0.7 },
];

export { LAYOUT } from './Layout';


/**
 * A fence you can see and a fence you can walk through are two different
 * fences. Registering the same polyline that draws it is what keeps them the
 * same object.
 */
function fenceWithCollision(
  root: Group,
  collision: CollisionWorld,
  points: [number, number][],
  terrain: Terrain,
  rng: Rng,
): void {
  root.add(buildFence(points, terrain, rng));
  collision.addPolyline(points, 0.22, 'fence');
}

export function buildWorld(
  scene: Scene,
  rng: Rng,
  quality: QualitySettings,
  season: Season,
): BuiltWorld {
  const root = new Group();
  root.name = 'world';
  scene.add(root);

  const anchors = new Map<string, Anchor>();
  const cutaways: BuiltWorld['cutaways'] = [];
  const collision = new CollisionWorld();
  const seasonal = new Group();
  seasonal.name = 'seasonal';

  /* ---------------- ground & sky ---------------- */
  const terrain = new Terrain(rng.fork('terrain'));
  terrain.setSeason(season, season === 'winter' ? 0.85 : 0);
  root.add(terrain.mesh);

  const sky = new Sky(rng.fork('sky'));
  root.add(sky.group);

  const mountains = buildMountains(rng.fork('mountains'), quality);
  root.add(mountains);

  /* ---------------- stream ---------------- */
  const water = new Water(120, 11);
  water.mesh.position.set(0, -1.15, LAYOUT.streamZ);
  root.add(water.mesh);

  const bank = buildStreamBank(rng.fork('bank'), 120);
  bank.position.set(0, -0.6, LAYOUT.streamZ);
  root.add(bank);

  const bridge = buildBridge();
  bridge.position.copy(LAYOUT.bridge);
  bridge.position.y = -0.4;
  root.add(bridge);

  /* ---------------- buildings ---------------- */
  const chalet = buildChalet(rng.fork('chalet'));
  chalet.group.position.copy(LAYOUT.house);
  chalet.group.position.y = terrain.heightAt(LAYOUT.house.x, LAYOUT.house.z);
  chalet.group.rotation.y = LAYOUT.houseRotation;
  root.add(chalet.group);
  // The chalet's open face is +z (the door side), turned by its own rotation.
  cutaways.push({
    result: chalet,
    centre: chalet.group.position.clone(),
    radius: 10,
    openTheta: LAYOUT.houseRotation,
  });

  const barn = buildBarn(rng.fork('barn'));
  barn.group.position.copy(LAYOUT.barn);
  barn.group.position.y = terrain.heightAt(LAYOUT.barn.x, LAYOUT.barn.z);
  barn.group.rotation.y = LAYOUT.barnRotation;
  root.add(barn.group);
  cutaways.push({
    result: barn,
    centre: barn.group.position.clone(),
    radius: 9,
    openTheta: LAYOUT.barnRotation,
  });

  const coop = buildCoop();
  coop.position.copy(LAYOUT.coop);
  coop.position.y = terrain.heightAt(LAYOUT.coop.x, LAYOUT.coop.z);
  coop.rotation.y = 0.5;
  root.add(coop);

  /* ---------------- farm props ---------------- */
  const well = buildWell();
  well.position.copy(LAYOUT.well);
  well.position.y = terrain.heightAt(LAYOUT.well.x, LAYOUT.well.z);
  root.add(well);

  const haystack = buildHayStack(rng.fork('hay'));
  haystack.position.copy(LAYOUT.haystack);
  haystack.position.y = terrain.heightAt(LAYOUT.haystack.x, LAYOUT.haystack.z);
  root.add(haystack);

  const trough = buildTrough();
  trough.position.copy(LAYOUT.trough);
  trough.position.y = terrain.heightAt(LAYOUT.trough.x, LAYOUT.trough.z);
  trough.rotation.y = 0.3;
  root.add(trough);

  const garden = buildGarden(rng.fork('garden'), season);
  garden.position.copy(LAYOUT.garden);
  garden.position.y = terrain.heightAt(LAYOUT.garden.x, LAYOUT.garden.z);
  seasonal.add(garden);

  /* ---------------- fences ---------------- */
  // Pasture enclosure, with a gap on the farmyard side so the child can walk in.
  const fenceRng = rng.fork('fences');
  fenceWithCollision(root, collision, [
        [11, 6],
        [40, 6],
        [40, 34],
        [11, 34],
        [11, 20],
      ], terrain, fenceRng);
  // Chicken run.
  fenceWithCollision(root, collision, [
        [-9, 15],
        [4, 15],
        [4, 26],
        [-9, 26],
        [-9, 18],
      ], terrain, fenceRng);
  // Garden edging.
  fenceWithCollision(root, collision, [
        [-26, 9],
        [-12, 9],
        [-12, 23],
        [-26, 23],
        [-26, 11],
      ], terrain, fenceRng);

  /* ---------------- vegetation ---------------- */
  const insideBuildings = (x: number, z: number): boolean => {
    // Keep grass out of buildings, beds, and off the main paths.
    if (near(x, z, LAYOUT.house, 10)) return false;
    if (near(x, z, LAYOUT.barn, 10)) return false;
    if (near(x, z, LAYOUT.coop, 4)) return false;
    if (near(x, z, LAYOUT.garden, 8)) return false;
    if (Math.abs(Math.hypot(x * 0.9, (z - 6) * 0.95) - 15) < 1.6) return false;
    return true;
  };

  const meadowBounds = { minX: -70, maxX: 70, minZ: -40, maxZ: 78 };

  seasonal.add(
    buildGrassRings(
      rng.fork('grass'),
      terrain,
      { x: LAYOUT.yardCentre.x, z: LAYOUT.yardCentre.z },
      GRASS_RINGS,
      meadowBounds,
      insideBuildings,
      season,
      quality.grassCount,
    ),
  );
  seasonal.add(
    buildGroundClutter(rng.fork('clutter'), terrain, {
      count: Math.floor(quality.scatterCount * 0.6),
      bounds: { minX: -34, maxX: 44, minZ: -22, maxZ: 46 },
      accept: insideBuildings,
    }),
  );
  seasonal.add(
    buildScatterProps(
      rng.fork('flowers'),
      terrain,
      { count: quality.scatterCount, bounds: meadowBounds, accept: insideBuildings },
      season,
    ),
  );
  root.add(
    buildRocks(
      rng.fork('rocks'),
      terrain,
      {
        count: Math.floor(quality.scatterCount * 0.3),
        bounds: meadowBounds,
        // Rocks belong on the slopes and by the water, not in the farmyard.
        accept: (x, z) =>
          insideBuildings(x, z) &&
          (terrain.slopeAt(x, z) > 0.18 || Math.abs(z - LAYOUT.streamZ) < 9),
      },
    ),
  );

  // Woodland closing off the valley sides, plus the orchard. Kept out of the
  // corridor the doll's-house camera looks down when the child is indoors.
  const blocksView = makeViewCorridorTest(cutaways);
  plantAllTrees(seasonal, rng, terrain, quality, season, insideBuildings, blocksView, collision);

  root.add(seasonal);

  /* ---------------- anchors ---------------- */
  const add = (
    id: string,
    x: number,
    z: number,
    area: string,
    bubbleHeight = 1.7,
    indoor = false,
  ): void => {
    anchors.set(id, {
      id,
      position: new Vector3(x, terrain.heightAt(x, z), z),
      bubbleHeight,
      area,
      indoor,
    });
  };

  // Indoor anchors: house local coords offset by the house origin.
  const h = LAYOUT.house;
  add('bed', h.x + 4.6, h.z - 1.6, 'house', 1.4, true);
  add('wardrobe', h.x + 2.5, h.z - 3.0, 'house', 1.9, true);
  add('dinnertable', h.x - 1.4, h.z + 0.2, 'house', 1.5, true);
  add('kitchen', h.x - 3.6, h.z - 3.2, 'house', 1.8, true);
  add('livingroom', h.x - 4.2, h.z + 1.8, 'house', 1.4, true);
  add('bathroom', h.x + 5.2, h.z + 1.6, 'house', 1.7, true);
  add('bedroomwindow', h.x + 5.8, h.z - 3.2, 'house', 2.2, true);
  add('porch', h.x, h.z + 7.2, 'farmyard', 1.9);

  // Outdoor anchors.
  add('haybale', LAYOUT.haystack.x - 2.2, LAYOUT.haystack.z, 'farmyard', 2.0);
  add('well', LAYOUT.well.x, LAYOUT.well.z + 1.8, 'farmyard', 2.4);
  add('trough', LAYOUT.trough.x, LAYOUT.trough.z - 1.6, 'pasture', 1.4);
  add('grainsack', LAYOUT.coop.x - 2.6, LAYOUT.coop.z + 1.6, 'coop', 1.2);
  add('nestbox', LAYOUT.coop.x + 3.2, LAYOUT.coop.z, 'coop', 2.0);
  add('gardenbeds', LAYOUT.garden.x + 0.5, LAYOUT.garden.z - 3.4, 'garden', 1.3);
  add('appletree', LAYOUT.appleTree.x + 5.5, LAYOUT.appleTree.z + 3.0, 'orchard', 2.6);
  add('yardcenter', LAYOUT.yardCentre.x, LAYOUT.yardCentre.z, 'farmyard', 1.7);
  add('meadowview', LAYOUT.meadowView.x, LAYOUT.meadowView.z, 'meadow', 1.7);
  add('streambank', 0, LAYOUT.streamZ - 6.5, 'stream', 1.5);
  add('barn', LAYOUT.barn.x, LAYOUT.barn.z + 7, 'barn', 2.0);
  // Camera-focus targets: not walkable, just look-at points.
  add('mountains', 0, 120, 'meadow', 40);

  // Barn's hay is also reachable inside the barn, which is where a child looks.
  add('barnhay', LAYOUT.barn.x - 4.5, LAYOUT.barn.z - 2.5, 'barn', 2.0, true);

  /* ---------------- collision ---------------- */
  // Registered from the same LAYOUT the meshes are placed from, so a building
  // that moves takes its footprint with it.
  collision.addBox(LAYOUT.barn.x, LAYOUT.barn.z, 7.0, 5.6, LAYOUT.barnRotation, 'building');
  collision.addBox(LAYOUT.coop.x, LAYOUT.coop.z, 2.2, 1.8, 0.5, 'building');
  collision.addCircle(LAYOUT.well.x, LAYOUT.well.z, 1.35, 'prop');
  collision.addCircle(LAYOUT.haystack.x, LAYOUT.haystack.z, 2.2, 'prop');
  collision.addBox(LAYOUT.trough.x, LAYOUT.trough.z, 1.7, 0.8, 0, 'prop');

  // The chalet is a box with a doorway punched through the front, so it is
  // registered as three walls rather than one block: the child has to be able
  // to walk in through the gap.
  {
    const hx = HOUSE_HALF_X;
    const hz = HOUSE_HALF_Z;
    const h = LAYOUT.house;
    const door = DOOR_HALF_WIDTH + 0.25;
    collision.addBox(h.x, h.z - hz, hx, 0.3, 0, 'building');          // back
    collision.addBox(h.x - hx, h.z, 0.3, hz, 0, 'building');          // left
    collision.addBox(h.x + hx, h.z, 0.3, hz, 0, 'building');          // right
    // Front wall either side of the doorway.
    const sideWidth = (hx - door) / 2;
    collision.addBox(h.x - door - sideWidth, h.z + hz, sideWidth, 0.3, 0, 'building');
    collision.addBox(h.x + door + sideWidth, h.z + hz, sideWidth, 0.3, 0, 'building');
  }

  // Ambient life last, so it can read the finished buildings' chimneys.
  const chimneys: Vector3[] = [];
  for (const cutaway of cutaways) {
    const local = cutaway.result.chimneyTop;
    if (local) chimneys.push(cutaway.result.group.localToWorld(local.clone()));
  }
  const ambient = new AmbientLife(rng.fork('ambient'), terrain, quality, {
    chimneys,
    meadowCentre: new Vector3(0, 0, 6),
    meadowRadius: 24,
  });
  root.add(ambient.group);

  // Last of all, once every obstacle above has registered itself.
  const nav = new NavGrid(collision, terrain);

  return { root, terrain, sky, water, anchors, cutaways, seasonal, ambient, collision, nav };
}

function near(x: number, z: number, point: Vector3, radius: number): boolean {
  return (x - point.x) ** 2 + (z - point.z) ** 2 < radius * radius;
}

/**
 * Doll's-house cutaway.
 *
 * Fades a building's shell out as the child gets close to its centre, which
 * reveals the interior without any camera trickery or scene switching.
 */

/**
 * True where a tree would stand between the doll's-house camera and a
 * building's open face.
 *
 * Indoors the camera parks itself off the building's open side at a known
 * distance and looks straight in (see `CameraRig.setIndoor`). That sight line
 * is fixed and known at build time, so the honest fix for a tree growing
 * through the middle of the interior shot is not to fade it at runtime but to
 * not plant it there. The corridor stops just past where the camera stands;
 * anything further out is behind the lens.
 */
function makeViewCorridorTest(
  cutaways: BuiltWorld['cutaways'],
): (x: number, z: number) => boolean {
  const lanes = cutaways.map((cutaway) => ({
    centre: cutaway.centre,
    dirX: Math.sin(cutaway.openTheta),
    dirZ: Math.cos(cutaway.openTheta),
    depth: cutaway.radius + 3,
  }));
  return (x, z) => {
    for (const lane of lanes) {
      const dx = x - lane.centre.x;
      const dz = z - lane.centre.z;
      const along = dx * lane.dirX + dz * lane.dirZ;
      if (along < 1 || along > lane.depth) continue;
      // Perpendicular distance from the centre line of the shot.
      const lateral = Math.abs(dx * lane.dirZ - dz * lane.dirX);
      if (lateral < 6) return true;
    }
    return false;
  };
}

/**
 * Every tree in the valley, in one place.
 *
 * The initial build and the season rebuild both need exactly this, and when
 * they each had their own copy they drifted: the orchard and the south rim
 * existed only on first build and vanished at the first change of season.
 */
function plantAllTrees(
  target: Group,
  rng: Rng,
  terrain: Terrain,
  quality: QualitySettings,
  season: Season,
  insideBuildings: (x: number, z: number) => boolean,
  blocksView: (x: number, z: number) => boolean,
  collision: CollisionWorld,
): void {
  // Trees are seasonal, so their colliders are too.
  collision.clearTag('tree');
  const treeCount = quality.treeDetail === 0 ? 34 : quality.treeDetail === 1 ? 60 : 90;
  const open = (x: number, z: number): boolean => !blocksView(x, z);

  const bands = [
    {
      label: 'east',
      count: treeCount,
      bounds: { minX: 34, maxX: 72, minZ: -56, maxZ: 78 },
      kind: 'mixed' as const,
      accept: (x: number, z: number) =>
        terrain.heightAt(x, z) < 26 && insideBuildings(x, z) && open(x, z),
    },
    {
      label: 'west',
      count: treeCount,
      bounds: { minX: -74, maxX: -38, minZ: -56, maxZ: 70 },
      kind: 'conifer' as const,
      accept: (x: number, z: number) => terrain.heightAt(x, z) < 26 && open(x, z),
    },
    {
      label: 'north',
      count: Math.floor(treeCount * 0.7),
      bounds: { minX: -60, maxX: 60, minZ: 72, maxZ: 92 },
      kind: 'conifer' as const,
      accept: open,
    },
    // The south rim closes the ring. Without it the ridge behind the farmyard
    // is bare ground with a hard edge against the sky, which is the first thing
    // the camera sees when it swings round behind the child.
    {
      label: 'south',
      count: Math.floor(treeCount * 0.7),
      bounds: { minX: -64, maxX: 64, minZ: -92, maxZ: -54 },
      kind: 'conifer' as const,
      accept: open,
    },
  ];

  for (const band of bands) {
    const planted = plantTrees(
      rng.fork(`trees-${band.label}-${season}`),
      terrain,
      { count: band.count, bounds: band.bounds, accept: band.accept },
      quality,
      season,
      band.kind,
    );
    // Trunks only: a child should be able to walk under a canopy, just not
    // through the thing holding it up.
    for (const tree of planted.children) {
      collision.addCircle(tree.position.x, tree.position.z, 0.42, 'tree');
    }
    target.add(planted);
  }

  /* ---------------- orchard ---------------- */
  const orchard = new Group();
  orchard.name = 'orchard';
  const appleGeo = buildAppleTree(rng.fork(`apple-${season}`), quality.treeDetail, season);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = LAYOUT.appleTree.x + col * 5.5 + (row % 2) * 1.5;
      const z = LAYOUT.appleTree.z + row * 5.5;
      // A gap in a row of fruit trees reads as a tree that died; a tree growing
      // through the middle of the kitchen does not.
      if (blocksView(x, z)) continue;
      collision.addCircle(x, z, 0.4, 'tree');
      const tree = new ThreeMesh(appleGeo, M.foliage(0.55));
      tree.position.set(x, terrain.heightAt(x, z) - 0.2, z);
      tree.rotation.y = rng.range(0, Math.PI * 2);
      tree.scale.setScalar(rng.range(0.85, 1.1));
      tree.castShadow = true;
      tree.receiveShadow = true;
      orchard.add(tree);
    }
  }
  target.add(orchard);
}

export function updateCutaways(
  world: BuiltWorld,
  childPosition: Vector3,
  cameraPosition: Vector3,
  dt: number,
): BuiltWorld['cutaways'][number] | null {
  let active: BuiltWorld['cutaways'][number] | null = null;

  for (const cutaway of world.cutaways) {
    const childDistance = childPosition.distanceTo(cutaway.centre);
    // Compare the camera on the ground plane: its height is irrelevant to
    // whether it is looking through a wall.
    const cameraDistance = Math.hypot(
      cameraPosition.x - cutaway.centre.x,
      cameraPosition.z - cutaway.centre.z,
    );
    const inside = childDistance < cutaway.radius || cameraDistance < cutaway.radius * 0.95;
    // The child's own building wins; the camera merely clipping a wall does not
    // get to drag the view round to that building's open face.
    if (inside && (!active || childDistance < cutaway.radius)) active = cutaway;

    const targetOpacity = inside ? 0.08 : 1;
    const material = cutaway.result.shellMaterial as Material & {
      opacity: number;
      depthWrite: boolean;
      needsUpdate: boolean;
    };
    let next = material.opacity + (targetOpacity - material.opacity) * (1 - Math.exp(-6 * dt));
    // Settle exactly, so the material stops changing once the fade is over.
    if (Math.abs(next - targetOpacity) < 0.004) next = targetOpacity;

    if (next !== material.opacity) {
      material.opacity = next;
      material.transparent = next < 0.99;
      // Stop the near walls writing depth once they are ghosts, or the interior
      // would be z-fought into invisibility.
      material.depthWrite = next > 0.9;
      // three only re-uploads a material's uniforms when its version changes,
      // so assigning `opacity` alone does nothing on the GPU: the walls stayed
      // solid however far the number fell. Bumping the version is what actually
      // applies it, and because the fade settles above, this runs only during
      // the second or so it is moving rather than every frame forever.
      material.needsUpdate = true;
    }
    cutaway.result.shell.visible = next > 0.02;
  }

  return active;
}

/** Re-scatters everything season-dependent. Used on a season rollover. */
export function rebuildSeasonalContent(
  world: BuiltWorld,
  rng: Rng,
  quality: QualitySettings,
  season: Season,
): void {
  disposeGroup(world.seasonal);
  world.seasonal.clear();

  world.terrain.setSeason(season, season === 'winter' ? 0.85 : 0);

  const insideBuildings = (x: number, z: number): boolean =>
    !near(x, z, LAYOUT.house, 10) &&
    !near(x, z, LAYOUT.barn, 10) &&
    !near(x, z, LAYOUT.coop, 4) &&
    !near(x, z, LAYOUT.garden, 8);

  const meadowBounds = { minX: -70, maxX: 70, minZ: -40, maxZ: 78 };

  world.seasonal.add(
    buildGrassRings(
      rng.fork(`grass-${season}`),
      world.terrain,
      { x: LAYOUT.yardCentre.x, z: LAYOUT.yardCentre.z },
      GRASS_RINGS,
      meadowBounds,
      insideBuildings,
      season,
      quality.grassCount,
    ),
  );
  world.seasonal.add(
    buildGroundClutter(rng.fork(`clutter-${season}`), world.terrain, {
      count: Math.floor(quality.scatterCount * 0.6),
      bounds: { minX: -34, maxX: 44, minZ: -22, maxZ: 46 },
      accept: insideBuildings,
    }),
  );
  world.seasonal.add(
    buildScatterProps(
      rng.fork(`flowers-${season}`),
      world.terrain,
      { count: quality.scatterCount, bounds: meadowBounds, accept: insideBuildings },
      season,
    ),
  );

  const garden = buildGarden(rng.fork(`garden-${season}`), season);
  garden.position.copy(LAYOUT.garden);
  garden.position.y = world.terrain.heightAt(LAYOUT.garden.x, LAYOUT.garden.z);
  world.seasonal.add(garden);

  plantAllTrees(
    world.seasonal,
    rng,
    world.terrain,
    quality,
    season,
    insideBuildings,
    makeViewCorridorTest(world.cutaways),
    world.collision,
  );
  // The trees just moved, so the routes around them have to be recomputed.
  world.nav.rebuild();
}

function disposeGroup(group: Object3D): void {
  group.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) mesh.geometry?.dispose();
  });
}
