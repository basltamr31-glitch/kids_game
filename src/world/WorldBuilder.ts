import { Group, Object3D, Vector3, type Scene, type Mesh, type Material } from 'three';
import { Terrain } from './Terrain';
import { Sky } from './Sky';
import { buildMountains, Water, buildStreamBank } from './Landscape';
import { buildChalet, buildBarn, buildCoop, type BuildingResult } from './Buildings';
import {
  buildFence,
  buildWell,
  buildHayStack,
  buildTrough,
  buildGarden,
  buildBridge,
  buildGrassField,
  buildScatterProps,
  buildRocks,
  plantTrees,
  buildAppleTree,
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
  /** Buildings whose shells fade when the child is inside. */
  cutaways: { result: BuildingResult; centre: Vector3; radius: number }[];
  /** Everything that should be re-scattered when the season changes. */
  seasonal: Group;
}

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
  cutaways.push({ result: chalet, centre: chalet.group.position.clone(), radius: 10 });

  const barn = buildBarn(rng.fork('barn'));
  barn.group.position.copy(LAYOUT.barn);
  barn.group.position.y = terrain.heightAt(LAYOUT.barn.x, LAYOUT.barn.z);
  barn.group.rotation.y = LAYOUT.barnRotation;
  root.add(barn.group);
  cutaways.push({ result: barn, centre: barn.group.position.clone(), radius: 9 });

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

  /* ---------------- orchard ---------------- */
  const orchard = new Group();
  orchard.name = 'orchard';
  const appleGeo = buildAppleTree(rng.fork('apple'), quality.treeDetail, season);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = LAYOUT.appleTree.x + col * 5.5 + (row % 2) * 1.5;
      const z = LAYOUT.appleTree.z + row * 5.5;
      const tree = new ThreeMesh(appleGeo, M.vertexPainted());
      tree.position.set(x, terrain.heightAt(x, z) - 0.2, z);
      tree.rotation.y = rng.range(0, Math.PI * 2);
      tree.scale.setScalar(rng.range(0.85, 1.1));
      tree.castShadow = true;
      tree.receiveShadow = true;
      orchard.add(tree);
    }
  }
  seasonal.add(orchard);

  /* ---------------- fences ---------------- */
  // Pasture enclosure, with a gap on the farmyard side so the child can walk in.
  root.add(
    buildFence(
      [
        [11, 6],
        [40, 6],
        [40, 34],
        [11, 34],
        [11, 20],
      ],
      terrain,
    ),
  );
  // Chicken run.
  root.add(
    buildFence(
      [
        [-9, 15],
        [4, 15],
        [4, 26],
        [-9, 26],
        [-9, 18],
      ],
      terrain,
    ),
  );
  // Garden edging.
  root.add(
    buildFence(
      [
        [-26, 9],
        [-12, 9],
        [-12, 23],
        [-26, 23],
        [-26, 11],
      ],
      terrain,
    ),
  );

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
    buildGrassField(
      rng.fork('grass'),
      terrain,
      { count: quality.grassCount, bounds: meadowBounds, accept: insideBuildings },
      season,
    ),
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

  // Woodland closing off the valley sides.
  const treeCount = quality.treeDetail === 0 ? 34 : quality.treeDetail === 1 ? 60 : 90;
  seasonal.add(
    plantTrees(
      rng.fork('trees-east'),
      terrain,
      {
        count: treeCount,
        bounds: { minX: 34, maxX: 72, minZ: 20, maxZ: 78 },
        accept: (x, z) => terrain.heightAt(x, z) < 26 && insideBuildings(x, z),
      },
      quality,
      season,
      'mixed',
    ),
  );
  seasonal.add(
    plantTrees(
      rng.fork('trees-west'),
      terrain,
      {
        count: treeCount,
        bounds: { minX: -74, maxX: -38, minZ: -20, maxZ: 70 },
        accept: (x, z) => terrain.heightAt(x, z) < 26,
      },
      quality,
      season,
      'conifer',
    ),
  );
  seasonal.add(
    plantTrees(
      rng.fork('trees-north'),
      terrain,
      {
        count: Math.floor(treeCount * 0.7),
        bounds: { minX: -60, maxX: 60, minZ: 72, maxZ: 92 },
      },
      quality,
      season,
      'conifer',
    ),
  );

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

  return { root, terrain, sky, water, anchors, cutaways, seasonal };
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
export function updateCutaways(
  world: BuiltWorld,
  childPosition: Vector3,
  cameraPosition: Vector3,
  dt: number,
): boolean {
  let anyInside = false;

  for (const cutaway of world.cutaways) {
    const childDistance = childPosition.distanceTo(cutaway.centre);
    // Compare the camera on the ground plane: its height is irrelevant to
    // whether it is looking through a wall.
    const cameraDistance = Math.hypot(
      cameraPosition.x - cutaway.centre.x,
      cameraPosition.z - cutaway.centre.z,
    );
    const inside = childDistance < cutaway.radius || cameraDistance < cutaway.radius * 0.95;
    if (inside) anyInside = true;

    const targetOpacity = inside ? 0.08 : 1;
    const material = cutaway.result.shellMaterial as Material & { opacity: number };
    const next = material.opacity + (targetOpacity - material.opacity) * (1 - Math.exp(-6 * dt));
    material.opacity = next;
    material.transparent = next < 0.99;
    // Stop the near walls writing depth once they are ghosts, or the interior
    // would be z-fought into invisibility.
    (material as unknown as { depthWrite: boolean }).depthWrite = next > 0.9;
    cutaway.result.shell.visible = next > 0.02;
  }

  return anyInside;
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
    buildGrassField(
      rng.fork(`grass-${season}`),
      world.terrain,
      { count: quality.grassCount, bounds: meadowBounds, accept: insideBuildings },
      season,
    ),
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

  const treeCount = quality.treeDetail === 0 ? 34 : quality.treeDetail === 1 ? 60 : 90;
  for (const [label, bounds, kind] of [
    ['east', { minX: 34, maxX: 72, minZ: 20, maxZ: 78 }, 'mixed'],
    ['west', { minX: -74, maxX: -38, minZ: -20, maxZ: 70 }, 'conifer'],
    ['north', { minX: -60, maxX: 60, minZ: 72, maxZ: 92 }, 'conifer'],
  ] as const) {
    world.seasonal.add(
      plantTrees(
        rng.fork(`trees-${label}-${season}`),
        world.terrain,
        {
          count: treeCount,
          bounds,
          accept: (x, z) => world.terrain.heightAt(x, z) < 26,
        },
        quality,
        season,
        kind,
      ),
    );
  }
}

function disposeGroup(group: Object3D): void {
  group.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) mesh.geometry?.dispose();
  });
}
