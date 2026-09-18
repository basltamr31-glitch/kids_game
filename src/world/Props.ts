import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  Matrix4,
  Quaternion,
  Vector3,
  Euler,
  StaticDrawUsage,
  LOD,
} from 'three';
import { PartBuilder, geoPetal, geoQuad, mergeGeometries, paint, setNormalsUp } from '../art/MeshKit';
import { M } from '../art/Materials';
import { color } from '../art/Palette';
import { clamp01, type Rng } from '../core/Rng';
import type { QualitySettings } from '../core/DeviceProfile';
import type { Terrain } from './Terrain';
import type { Season } from '../save/SaveSchema';

/**
 * Vegetation and farm props.
 *
 * Two rules govern everything here:
 *
 *   1. Anything appearing more than ~20 times is an InstancedMesh, so the whole
 *      meadow costs a handful of draw calls regardless of density.
 *   2. Grass is LOD'd by concentric ring. The tufts under the child's feet get
 *      five curved blades; the ones 60m away get two flat ones. Three rings,
 *      three draw calls, and the near field can be four times denser than a
 *      single uniform field would allow at the same cost.
 *
 * INSTANCING GOTCHA, learned the hard way: an InstancedMesh multiplies the
 * geometry's vertex colour by the per-instance colour. Baking green into both
 * squares it and the meadow fills with near-black tufts. Instanced geometry is
 * painted white and tinted only per instance.
 */

const _matrix = new Matrix4();
const _pos = new Vector3();
const _quat = new Quaternion();
const _euler = new Euler();
const _scale = new Vector3();
const _color = new Color();

/* ------------------------------------------------------------------ */
/* Trees                                                               */
/* ------------------------------------------------------------------ */

/**
 * Alpine spruce: a tapering stack of drooping branch tiers on a flared trunk.
 *
 * The droop is what makes it read as a spruce rather than a party hat — real
 * conifer branches sweep downward, and the cone tiers are rotated and scaled
 * per level so the silhouette is irregular.
 */
export function buildConifer(rng: Rng, detail: 0 | 1 | 2, season: Season): BufferGeometry {
  const b = new PartBuilder();
  const height = rng.range(6.5, 11.5);
  const radius = height * rng.range(0.17, 0.23);
  const segments = detail === 0 ? 6 : detail === 1 ? 8 : 10;

  // Flared trunk: two stacked cones so the base widens into the ground.
  b.cylinder(0.14, 0.26, height * 0.5, 'trunk', { pos: [0, height * 0.25, 0] }, 7);
  b.cylinder(0.26, 0.46, height * 0.1, 'trunkDark', { pos: [0, height * 0.05, 0] }, 7);

  const tiers = detail === 0 ? 4 : detail === 1 ? 6 : 8;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = height * (0.2 + t * 0.74);
    // Tiers shrink toward the top, with a little randomness so no two trees
    // have the same taper.
    const r = radius * (1 - t * 0.78) * rng.range(0.9, 1.12);
    const h = height * 0.2 * (1 - t * 0.35);
    const tint = i % 2 === 0 ? 'coniferDark' : 'coniferLight';

    b.cone(r, h, tint, {
      pos: [rng.range(-0.06, 0.06), y, rng.range(-0.06, 0.06)],
      rot: [rng.range(-0.05, 0.05), rng.range(0, 1.4), rng.range(-0.05, 0.05)],
    }, segments);

    // A slightly wider, flatter skirt just below each tier reads as the
    // branches drooping under their own weight.
    if (detail > 0 && i < tiers - 1) {
      b.cone(r * 1.12, h * 0.42, 'coniferDark', {
        pos: [0, y - h * 0.1, 0],
        rot: [0, rng.range(0, 1.4), 0],
        scale: [1, -1, 1],
      }, segments);
    }
  }

  // Leader spike at the very top.
  b.cone(radius * 0.16, height * 0.12, 'coniferDark', { pos: [0, height * 0.96, 0] }, 5);

  if (season === 'winter') {
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const y = height * (0.2 + t * 0.74);
      const r = radius * (1 - t * 0.78) * 0.78;
      b.cone(r, height * 0.07, 'snow', { pos: [0, y + height * 0.12, 0] }, segments);
    }
  }

  return b.build({ smooth: true, smoothAngle: 0.9, groundY: 0, aoStrength: 0.4 });
}

/**
 * Broadleaf: flared trunk, real boughs, and a canopy built from many small
 * overlapping masses rather than three big spheres.
 *
 * The small-mass approach is the whole trick. A canopy made of 12 blobs of
 * varied size and tint reads as foliage; one made of 3 reads as a balloon.
 */
export function buildDeciduous(rng: Rng, detail: 0 | 1 | 2, season: Season): BufferGeometry {
  const b = new PartBuilder();
  const height = rng.range(5.5, 8.5);
  const segments = detail === 0 ? 6 : detail === 1 ? 8 : 9;

  // Trunk with a root flare.
  b.cylinder(0.18, 0.34, height * 0.52, 'trunk', { pos: [0, height * 0.26, 0] }, 8);
  b.cylinder(0.34, 0.62, height * 0.09, 'trunkDark', { pos: [0, height * 0.045, 0] }, 8);

  // Boughs. Even at low detail two of these transform the silhouette.
  const boughs = detail === 0 ? 2 : 4;
  for (let i = 0; i < boughs; i++) {
    const a = (i / boughs) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const lean = rng.range(0.45, 0.75);
    b.cylinder(0.07, 0.15, height * 0.34, 'trunk', {
      pos: [Math.cos(a) * 0.42, height * 0.56, Math.sin(a) * 0.42],
      rot: [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
    }, 5);
  }

  const light = season === 'autumn' ? 'deciduousAutumn' : 'deciduousLight';
  const dark = season === 'autumn' ? 'deciduousAutumnDeep' : 'deciduousDark';
  const mid = season === 'autumn' ? 'grassAutumn' : 'coniferLight';

  if (season === 'winter') {
    // Bare: fan out twigs instead of a canopy.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const lean = rng.range(0.5, 0.9);
      b.cylinder(0.035, 0.08, height * 0.4, 'trunkDark', {
        pos: [Math.cos(a) * 0.7, height * 0.76, Math.sin(a) * 0.7],
        rot: [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
      }, 4);
    }
    return b.build({ smooth: true, groundY: 0 });
  }

  // Canopy: many small masses on a squashed dome, tinted in three bands so the
  // top catches light and the underside stays in shade.
  const blobs = detail === 0 ? 6 : detail === 1 ? 11 : 16;
  for (let i = 0; i < blobs; i++) {
    const a = rng.range(0, Math.PI * 2);
    const ring = Math.sqrt(rng.next());
    const spread = height * 0.34 * ring;
    const lift = rng.range(0.66, 0.96);
    const r = height * rng.range(0.15, 0.24) * (1.15 - ring * 0.35);

    // Higher blobs get the light tint, lower ones the dark.
    const tint = lift > 0.86 ? light : lift > 0.74 ? mid : dark;

    b.sphere(r, tint, {
      pos: [Math.cos(a) * spread, height * lift, Math.sin(a) * spread],
      scale: [1, rng.range(0.72, 0.9), 1],
    }, segments);
  }

  return b.build({ smooth: true, smoothAngle: 1.1, groundY: 0, aoStrength: 0.45 });
}

/** Apple tree: the deciduous canopy plus fruit when the season allows. */
export function buildAppleTree(rng: Rng, detail: 0 | 1 | 2, season: Season): BufferGeometry {
  const canopy = buildDeciduous(rng, detail, season);
  if (season === 'winter' || season === 'spring') return canopy;

  const b = new PartBuilder();
  const count = detail === 0 ? 6 : 14;
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(1.0, 2.2);
    b.sphere(0.17, season === 'autumn' ? 'flowerBoxRed' : 'uiRed', {
      pos: [Math.cos(a) * r, rng.range(3.6, 5.6), Math.sin(a) * r],
      scale: [1, 0.92, 1],
    }, 6);
  }
  const fruit = b.build({ ao: false });
  const merged = mergeGeometries([canopy, fruit]);
  canopy.dispose();
  fruit.dispose();
  return merged;
}

/* ------------------------------------------------------------------ */
/* Grass                                                               */
/* ------------------------------------------------------------------ */

export interface ScatterSpec {
  count: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  accept?: (x: number, z: number) => boolean;
}

/**
 * One grass tuft.
 *
 * Blades are built as three stacked quads with a forward lean, which gives the
 * blade a curve instead of a flat card. Vertex colour runs dark at the root to
 * light at the tip, so even a single tuft has internal depth.
 */
function buildTuft(blades: number, curve: boolean, rng: Rng): BufferGeometry {
  const b = new PartBuilder();

  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const lean = rng.range(0.14, 0.42);
    // Blade height is measured against the child, who is about 1.1m. Anything
    // over ~0.3 stops reading as a meadow and starts reading as a field of
    // sticks the child is wading through.
    const h = rng.range(0.15, 0.27);
    const w = rng.range(0.05, 0.075);

    if (!curve) {
      // Far LOD: one straight quad per blade. 2 triangles.
      b.add(geoQuad(w, h), 'grassMid', {
        pos: [Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02],
        rot: [0, a, lean * 0.5],
      });
      continue;
    }

    // Near LOD: three tapering segments, each leaning a little further over.
    const segs = 3;
    let y = 0;
    let tilt = 0;
    for (let s = 0; s < segs; s++) {
      const segH = h / segs;
      const segW = w * (1 - s * 0.24);
      tilt += lean / segs;
      const offset = Math.sin(tilt) * segH * s * 0.5;
      b.add(geoQuad(segW, segH), 'grassMid', {
        pos: [
          Math.cos(a) * (0.02 + offset),
          y,
          Math.sin(a) * (0.02 + offset),
        ],
        rot: [0, a, tilt],
      });
      y += segH * 0.92;
    }
  }

  const geometry = b.build({ ao: false });
  setNormalsUp(geometry);

  // Root-to-tip gradient. The tip must not exceed 1: values above it blow the
  // blade out past its own instance colour, which is what made the meadow look
  // like bleached straw rather than grass.
  applyHeightShade(geometry, 0.72, 1.0);
  return geometry;
}

/**
 * Multiplies vertex colour by a root-to-tip brightness ramp, then leaves the
 * geometry white-ish so per-instance tinting still controls the hue.
 */
function applyHeightShade(geo: BufferGeometry, atBase: number, atTip: number): void {
  const position = geo.attributes.position as BufferAttribute;
  const count = position.count;
  let maxY = 0.001;
  for (let i = 0; i < count; i++) maxY = Math.max(maxY, position.getY(i));

  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = clamp01(position.getY(i) / maxY);
    const shade = atBase + (atTip - atBase) * t;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

export interface GrassRing {
  /** Inner and outer radius from the ring centre. */
  inner: number;
  outer: number;
  blades: number;
  curve: boolean;
  /** Instances per square metre. */
  density: number;
  wind: number;
}

/**
 * Grass, LOD'd into concentric rings around the farm.
 *
 * Near tufts are dense and curved; far ones are sparse and flat. Each ring is
 * a single InstancedMesh, so the whole meadow is three draw calls and the near
 * field can afford four times the density it could as one uniform field.
 */
export function buildGrassRings(
  rng: Rng,
  terrain: Terrain,
  centre: { x: number; z: number },
  rings: GrassRing[],
  bounds: ScatterSpec['bounds'],
  accept: (x: number, z: number) => boolean,
  season: Season,
  budget: number,
): Group {
  const group = new Group();
  group.name = 'grass';

  const light = color('grassLight');
  const deep = color('grassDeep');
  const dry = color(season === 'autumn' ? 'grassAutumn' : 'grassDry');
  const snow = color('snow');

  // Share the budget across rings by area-weighted density.
  const weights = rings.map((r) => (r.outer ** 2 - r.inner ** 2) * r.density);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  rings.forEach((ring, index) => {
    const target = Math.max(32, Math.floor((budget * weights[index]) / totalWeight));
    const geometry = buildTuft(ring.blades, ring.curve, rng.fork(`tuft-${index}`));
    paint(geometry, '#FFFFFF');

    const mesh = new InstancedMesh(geometry, M.foliage(ring.wind), target);
    mesh.name = `grass-ring-${index}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(StaticDrawUsage);

    let placed = 0;
    let attempts = 0;
    const maxAttempts = target * 14;

    while (placed < target && attempts < maxAttempts) {
      attempts++;
      // Sample directly in the annulus rather than rejecting from a rectangle.
      const angle = rng.range(0, Math.PI * 2);
      const radius = Math.sqrt(
        rng.range(ring.inner * ring.inner, ring.outer * ring.outer),
      );
      const x = centre.x + Math.cos(angle) * radius;
      const z = centre.z + Math.sin(angle) * radius;

      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
      if (!accept(x, z)) continue;
      if (terrain.slopeAt(x, z) > 0.45) continue;

      // Clump with the ground. Uniformly scattered tufts read as a texture
      // applied to a plane; grass that thickens where the ground is green and
      // thins where it is worn reads as grass growing out of it. Rejecting
      // against lushness is what ties the two together.
      const lush = terrain.lushness(x, z);
      // Thins over worn ground without thinning the meadow as a whole: the
      // average acceptance here is close to one, so this redistributes the
      // tufts rather than removing them.
      if (rng.next() > 0.55 + lush * 0.75) continue;

      _pos.set(x, terrain.heightAt(x, z) - 0.04, z);
      _euler.set(0, rng.range(0, Math.PI * 2), 0);
      _quat.setFromEuler(_euler);
      // Far tufts are scaled up so a sparse ring still covers the ground.
      const base = ring.curve ? 1 : 1.45;
      const s = base * rng.range(0.85, 1.2);
      _scale.set(s, s * rng.range(0.9, 1.15), s);
      _matrix.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(placed, _matrix);

      // Weight toward the deeper greens, and let only a few tufts pick up any
      // dry straw at all, so the field reads as one meadow rather than as
      // scattered pale stalks.
      _color.copy(light).lerp(deep, 0.25 + rng.next() * 0.65);
      // Dry ground grows dry grass. Tying the tint to the same field is most
      // of why the patches read as patches rather than as noise.
      _color.lerp(dry, clamp01(1 - lush) * 0.55 * (0.4 + rng.next() * 0.6));
      if (season === 'winter') _color.lerp(snow, 0.55 + rng.next() * 0.3);
      mesh.setColorAt(placed, _color);
      placed++;
    }

    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  return group;
}

/** Wildflowers: a proper stem, leaves and a ring of petals around a centre. */
/**
 * Meadow flowers.
 *
 * Two instanced meshes over one set of transforms, not one. An InstancedMesh
 * multiplies its geometry's vertex colour by the per-instance colour, so a
 * single mesh can only ever be one colour per flower — which turned the stem,
 * the leaves and the golden centre pink along with the petals. Splitting the
 * tinted petals from the fixed green-and-gold plant costs one extra draw call
 * and is the only way to get a pink flower with a green stem.
 */
export function buildScatterProps(
  rng: Rng,
  terrain: Terrain,
  spec: ScatterSpec,
  season: Season,
): Group {
  const group = new Group();
  group.name = 'flowers';

  // --- the plant: stem, leaves and centre, in their authored colours ---
  const plant = new PartBuilder();
  plant.cylinder(0.013, 0.019, 0.26, 'grassDeep', { pos: [0, 0.13, 0] }, 4);
  for (const side of [-1, 1]) {
    plant.add(geoQuad(0.075, 0.045), 'grassDeep', {
      pos: [side * 0.04, 0.07, 0],
      rot: [1.35, 0, side * 0.5],
    });
  }
  plant.sphere(0.03, 'sunGold', { pos: [0, 0.275, 0] }, 6);
  const plantGeometry = plant.build({ ao: false });
  setNormalsUp(plantGeometry);

  // --- the petals: white, so the per-instance colour is the flower colour ---
  const head = new PartBuilder();
  const petals = 8;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    // An open cup. Laid flat, a ring of petals reads from a child's eye height
    // as a horizontal bar on a stick rather than as a flower; stood upright it
    // reads as a tube. Just past halfway is what looks like a flower.
    head.add(geoPetal(0.042, 0.075), 'meadowFlowerA', {
      pos: [Math.cos(a) * 0.026, 0.25, Math.sin(a) * 0.026],
      rot: [0.78, -a, 0],
      rotOrder: 'YXZ',
    });
  }
  const headGeometry = head.build({ ao: false });
  setNormalsUp(headGeometry);
  paint(headGeometry, '#FFFFFF');

  const stems = new InstancedMesh(plantGeometry, M.foliage(0.55), spec.count);
  stems.name = 'flower-stems';
  const heads = new InstancedMesh(headGeometry, M.foliage(0.55), spec.count);
  heads.name = 'flower-heads';
  for (const mesh of [stems, heads]) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(StaticDrawUsage);
  }

  const variants = [
    color('meadowFlowerA'),
    color('meadowFlowerB'),
    color('meadowFlowerC'),
    color('wallPlaster'),
    color('flowerBoxPink'),
  ];

  let placed = 0;
  let attempts = 0;
  const density = season === 'winter' ? 0.12 : season === 'autumn' ? 0.55 : 1;
  const target = Math.floor(spec.count * density);

  while (placed < target && attempts < spec.count * 10) {
    attempts++;
    const x = rng.range(spec.bounds.minX, spec.bounds.maxX);
    const z = rng.range(spec.bounds.minZ, spec.bounds.maxZ);
    if (spec.accept && !spec.accept(x, z)) continue;
    if (terrain.slopeAt(x, z) > 0.4) continue;

    _pos.set(x, terrain.heightAt(x, z), z);
    _euler.set(rng.range(-0.1, 0.1), rng.range(0, Math.PI * 2), rng.range(-0.1, 0.1));
    _quat.setFromEuler(_euler);
    // A meadow flower beside a four-year-old reaches the ankle or the knee,
    // not the waist.
    _scale.setScalar(rng.range(0.75, 1.25));
    _matrix.compose(_pos, _quat, _scale);
    stems.setMatrixAt(placed, _matrix);
    heads.setMatrixAt(placed, _matrix);
    heads.setColorAt(placed, rng.pick(variants));
    placed++;
  }

  for (const mesh of [stems, heads]) {
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

/** Ground clutter: pebbles, twigs and clover. Sells "this ground is real". */
export function buildGroundClutter(
  rng: Rng,
  terrain: Terrain,
  spec: ScatterSpec,
): InstancedMesh {
  const b = new PartBuilder();
  b.sphere(0.07, 'rock', { pos: [0.05, 0.02, 0], scale: [1.4, 0.55, 1.1] }, 5);
  b.sphere(0.045, 'rockDark', { pos: [-0.07, 0.015, 0.05], scale: [1.2, 0.5, 1] }, 5);
  b.box(0.16, 0.018, 0.02, 'trunkDark', { pos: [0, 0.01, -0.07], rot: [0, 0.7, 0] });
  const geometry = b.build({ ao: false });
  paint(geometry, '#FFFFFF');

  const mesh = new InstancedMesh(geometry, M.painted(), spec.count);
  mesh.name = 'clutter';
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const tints = [color('rock'), color('rockDark'), color('grassDeep'), color('trunk')];

  let placed = 0;
  let attempts = 0;
  while (placed < spec.count && attempts < spec.count * 10) {
    attempts++;
    const x = rng.range(spec.bounds.minX, spec.bounds.maxX);
    const z = rng.range(spec.bounds.minZ, spec.bounds.maxZ);
    if (spec.accept && !spec.accept(x, z)) continue;

    _pos.set(x, terrain.heightAt(x, z), z);
    _euler.set(0, rng.range(0, Math.PI * 2), 0);
    _quat.setFromEuler(_euler);
    _scale.setScalar(rng.range(0.6, 1.5));
    _matrix.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(placed, _matrix);
    mesh.setColorAt(placed, rng.pick(tints));
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Boulders on the slopes and along the stream. */
export function buildRocks(rng: Rng, terrain: Terrain, spec: ScatterSpec): InstancedMesh {
  const b = new PartBuilder();
  // Irregular mass: one big lump plus chips, so the silhouette is not an egg.
  b.sphere(0.5, 'rock', { scale: [1.35, 0.72, 1.0] }, 7);
  b.sphere(0.32, 'rock', { pos: [0.3, 0.08, 0.18], scale: [1.1, 0.8, 1.0] }, 6);
  b.sphere(0.24, 'rockDark', { pos: [-0.28, 0.02, -0.16], scale: [1.2, 0.65, 1.0] }, 6);
  b.sphere(0.16, 'rockDark', { pos: [0.1, 0.3, -0.24], scale: [1.0, 0.7, 1.1] }, 5);
  const geometry = b.build({ smooth: true, smoothAngle: 0.7, ao: false });
  paint(geometry, '#FFFFFF');

  const mesh = new InstancedMesh(geometry, M.rock(), spec.count);
  mesh.name = 'rocks';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const tints = [color('rock'), color('rockDark'), color('mountainNear')];

  let placed = 0;
  let attempts = 0;
  while (placed < spec.count && attempts < spec.count * 10) {
    attempts++;
    const x = rng.range(spec.bounds.minX, spec.bounds.maxX);
    const z = rng.range(spec.bounds.minZ, spec.bounds.maxZ);
    if (spec.accept && !spec.accept(x, z)) continue;

    _pos.set(x, terrain.heightAt(x, z) - 0.2, z);
    _euler.set(rng.range(-0.25, 0.25), rng.range(0, Math.PI * 2), rng.range(-0.25, 0.25));
    _quat.setFromEuler(_euler);
    _scale.setScalar(rng.range(0.45, 2.3));
    _matrix.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(placed, _matrix);
    _color.copy(rng.pick(tints)).multiplyScalar(rng.range(0.85, 1.12));
    mesh.setColorAt(placed, _color);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Plants trees as individual meshes sharing a small pool of geometries, so
 * variety is nearly free. Each pool entry is its own random tree.
 */
/**
 * Plants trees, each as a two-level LOD.
 *
 * Trees are the single largest triangle consumer in the world: a detailed
 * canopy is ~1.5k triangles and the valley holds a few hundred of them. Beyond
 * about 45m nobody can resolve an individual bough, so the far level drops to
 * a coarse silhouette built at detail 0. three's LOD handles the switch, and
 * because the geometries are shared across a small pool the extra variants are
 * nearly free in memory.
 */
export function plantTrees(
  rng: Rng,
  terrain: Terrain,
  spec: ScatterSpec,
  quality: QualitySettings,
  season: Season,
  kind: 'conifer' | 'deciduous' | 'mixed',
): Group {
  const group = new Group();
  group.name = 'trees';

  // Each pool entry is one tree with a near and a far geometry. Both are built
  // from the same seeded stream so the silhouettes match across the switch.
  const pool: { near: BufferGeometry; far: BufferGeometry }[] = [];
  const poolSize = quality.treeDetail === 0 ? 4 : 6;
  for (let i = 0; i < poolSize; i++) {
    const useConifer = kind === 'conifer' || (kind === 'mixed' && rng.bool(0.6));
    const seed = rng.fork(`tree-${i}`);
    const nearSeed = seed.fork('near');
    const farSeed = seed.fork('near'); // same label: same shape, lower detail
    pool.push({
      near: useConifer
        ? buildConifer(nearSeed, quality.treeDetail, season)
        : buildDeciduous(nearSeed, quality.treeDetail, season),
      far: useConifer
        ? buildConifer(farSeed, 0, season)
        : buildDeciduous(farSeed, 0, season),
    });
  }

  const material = M.foliage(0.45);
  const nearDistance = quality.treeDetail === 0 ? 24 : 45;

  let placed = 0;
  let attempts = 0;
  while (placed < spec.count && attempts < spec.count * 12) {
    attempts++;
    const x = rng.range(spec.bounds.minX, spec.bounds.maxX);
    const z = rng.range(spec.bounds.minZ, spec.bounds.maxZ);
    if (spec.accept && !spec.accept(x, z)) continue;
    if (terrain.slopeAt(x, z) > 0.55) continue;

    const variant = rng.pick(pool);
    const lod = new LOD();

    const near = new Mesh(variant.near, material);
    near.castShadow = true;
    near.receiveShadow = true;
    lod.addLevel(near, 0);

    const far = new Mesh(variant.far, material);
    // Distant trees do not cast shadows: the shadow frustum only covers the
    // farmyard anyway, so the cost would buy nothing.
    far.castShadow = false;
    far.receiveShadow = true;
    lod.addLevel(far, nearDistance);

    lod.position.set(x, terrain.heightAt(x, z) - 0.25, z);
    lod.rotation.y = rng.range(0, Math.PI * 2);
    // A slight lean downhill reads as a tree that grew where it stands.
    const normal = terrain.normalAt(x, z);
    lod.rotation.x = normal.z * 0.18;
    lod.rotation.z = -normal.x * 0.18;
    lod.scale.setScalar(rng.range(0.72, 1.3));
    group.add(lod);
    placed++;
  }
  return group;
}

/* ------------------------------------------------------------------ */
/* Farm props                                                          */
/* ------------------------------------------------------------------ */

/** Post-and-rail fence following a path, with sag, lean and weathering. */
export function buildFence(points: [number, number][], terrain: Terrain, rng: Rng): Mesh {
  const b = new PartBuilder();

  for (let i = 0; i < points.length - 1; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[i + 1];
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz);
    const posts = Math.max(2, Math.round(length / 2.4));

    for (let p = 0; p <= posts; p++) {
      const t = p / posts;
      const x = x1 + dx * t;
      const z = z1 + dz * t;
      const y = terrain.heightAt(x, z);
      // Every post leans a little differently. Perfectly plumb reads as CG.
      const lean = rng.range(-0.045, 0.045);
      b.bevelBox(0.15, 1.5, 0.15, 0.03, 'fenceDark', {
        pos: [x, y + 0.7, z],
        rot: [lean, angle, rng.range(-0.045, 0.045)],
      });
      b.cone(0.12, 0.18, 'fence', { pos: [x, y + 1.5, z] }, 4);
    }

    for (const railY of [0.52, 1.04]) {
      for (let p = 0; p < posts; p++) {
        const t0 = p / posts;
        const t1 = (p + 1) / posts;
        const ax = x1 + dx * t0;
        const az = z1 + dz * t0;
        const bx = x1 + dx * t1;
        const bz = z1 + dz * t1;
        // Rails sag between posts, which is the single detail that stops a
        // fence looking like it was extruded by a computer.
        const sag = rng.range(0.02, 0.06);
        const ay = terrain.heightAt(ax, az) + railY;
        const by = terrain.heightAt(bx, bz) + railY;
        const segLength = Math.hypot(bx - ax, bz - az);
        const pitch = Math.atan2(by - ay, segLength);
        b.bevelBox(0.085, 0.13, segLength, 0.02, 'fence', {
          pos: [(ax + bx) / 2, (ay + by) / 2 - sag, (az + bz) / 2],
          rot: [pitch, angle, 0],
        });
      }
    }
  }
  const mesh = new Mesh(b.build({ groundY: 0, aoStrength: 0.4 }), M.built('wood', 2.2));
  mesh.name = 'fence';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Stone well with a shingled roof, a winding drum and a bucket on a rope. */
export function buildWell(): Group {
  const group = new Group();
  const b = new PartBuilder();

  // Coursed stone: a ring of individual blocks reads far better than a cylinder.
  const blocks = 14;
  for (let course = 0; course < 3; course++) {
    for (let i = 0; i < blocks; i++) {
      const a = (i / blocks) * Math.PI * 2 + course * 0.22;
      const r = 1.08;
      b.bevelBox(0.34, 0.3, 0.26, 0.04, course % 2 ? 'rock' : 'rockDark', {
        pos: [Math.cos(a) * r, 0.18 + course * 0.31, Math.sin(a) * r],
        rot: [0, -a, 0],
      });
    }
  }
  b.cylinder(1.2, 1.2, 0.14, 'stoneFoundation', { pos: [0, 1.12, 0] }, 14);
  b.cylinder(0.92, 0.92, 0.08, 'waterDeep', { pos: [0, 1.06, 0] }, 14);

  for (const side of [-1, 1]) {
    b.bevelBox(0.16, 2.1, 0.16, 0.03, 'woodDark', { pos: [side * 0.95, 2.1, 0] });
  }
  b.prism(2.1, 0.85, 2.9, 'roofShingle', { pos: [0, 3.1, 0], rot: [0, Math.PI / 2, 0] });
  // Shingle courses on the little roof.
  for (let i = 0; i < 4; i++) {
    b.box(2.85, 0.05, 0.3, 'roofTileDark', {
      pos: [0, 3.2 + i * 0.18, 0.5 - i * 0.18],
      rot: [0.55, 0, 0],
    });
    b.box(2.85, 0.05, 0.3, 'roofTileDark', {
      pos: [0, 3.2 + i * 0.18, -0.5 + i * 0.18],
      rot: [-0.55, 0, 0],
    });
  }
  b.cylinder(0.12, 0.12, 2.0, 'trunk', { pos: [0, 2.9, 0], rot: [0, 0, Math.PI / 2] }, 8);
  b.torus(0.16, 0.035, 'metalDark', { pos: [0.55, 2.9, 0], rot: [0, Math.PI / 2, 0] }, 8);
  b.box(0.05, 0.95, 0.05, 'woodDark', { pos: [0, 2.42, 0] });
  b.lathe(
    [
      [0, 0],
      [0.3, 0.02],
      [0.31, 0.38],
      [0.26, 0.42],
      [0, 0.42],
    ],
    'bucket',
    { pos: [0, 1.72, 0] },
    12,
  );
  b.torus(0.3, 0.025, 'bucketRim', { pos: [0, 2.12, 0], rot: [Math.PI / 2, 0, 0] }, 12);

  const mesh = new Mesh(b.build({ groundY: 0, aoStrength: 0.5 }), M.built('stone', 1.6));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/** Stacked hay bales with loose straw and a pitchfork leaning on them. */
export function buildHayStack(rng: Rng): Group {
  const group = new Group();
  const b = new PartBuilder();
  const layout: [number, number, number][] = [
    [-0.9, 0, 0],
    [0.9, 0, 0],
    [0, 0, 1.4],
    [0, 1.05, 0.7],
  ];
  for (const [x, y, z] of layout) {
    const rot = rng.range(-0.1, 0.1);
    b.bevelBox(1.6, 1.0, 1.2, 0.08, 'hay', { pos: [x, 0.5 + y, z], rot: [0, rot, 0] });
    // Binding twine.
    for (const tz of [-0.3, 0.3]) {
      b.box(1.66, 0.06, 0.05, 'hayDark', { pos: [x, 0.5 + y, z + tz], rot: [0, rot, 0] });
    }
    // Straw ends poking out of the cut faces.
    for (let i = 0; i < 10; i++) {
      b.box(0.04, 0.03, 0.22, 'hayDark', {
        pos: [x + rng.range(-0.7, 0.7), 0.5 + y + rng.range(-0.4, 0.4), z + 0.62],
        rot: [rng.range(-0.4, 0.4), rot, rng.range(-0.4, 0.4)],
      });
    }
  }
  for (let i = 0; i < 18; i++) {
    b.box(rng.range(0.2, 0.5), 0.03, 0.04, 'hay', {
      pos: [rng.range(-2.1, 2.1), 0.02, rng.range(-1.1, 2.5)],
      rot: [0, rng.range(0, Math.PI), 0],
    });
  }
  // Pitchfork.
  b.cylinder(0.035, 0.04, 1.9, 'trunk', { pos: [1.85, 0.95, 0.6], rot: [0, 0, 0.22] }, 6);
  for (const tx of [-0.09, 0, 0.09]) {
    b.box(0.03, 0.34, 0.03, 'metal', { pos: [1.63 + tx, 0.17, 0.6] });
  }

  const mesh = new Mesh(b.build({ groundY: 0 }), M.built('organic', 2.4));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/** Wooden water trough on stone feet, with a visible waterline. */
export function buildTrough(): Group {
  const group = new Group();
  const b = new PartBuilder();

  // Staves rather than a solid box.
  const staves = 9;
  for (let i = 0; i < staves; i++) {
    const x = -1.35 + (i / (staves - 1)) * 2.7;
    b.bevelBox(0.3, 0.68, 1.06, 0.03, i % 2 ? 'woodMid' : 'woodWarm', { pos: [x, 0.34, 0] });
  }
  b.box(2.66, 0.46, 0.82, 'trunkDark', { pos: [0, 0.44, 0] });
  b.box(2.6, 0.06, 0.76, 'water', { pos: [0, 0.6, 0] });
  // Iron bands.
  for (const bx of [-0.95, 0.95]) {
    b.box(0.1, 0.72, 1.12, 'metalDark', { pos: [bx, 0.34, 0] });
  }
  for (const sx of [-1, 1]) {
    b.bevelBox(0.22, 0.5, 1.16, 0.03, 'woodDark', { pos: [sx * 1.42, 0.25, 0] });
    b.box(0.5, 0.18, 0.9, 'rock', { pos: [sx * 1.1, 0.09, 0] });
  }

  const mesh = new Mesh(b.build({ groundY: 0 }), M.built('wood', 2.0));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/** Raised vegetable beds with rows of real plants and a few tools. */
export function buildGarden(rng: Rng, season: Season): Group {
  const group = new Group();
  const b = new PartBuilder();

  for (let bed = 0; bed < 3; bed++) {
    const z = -2.6 + bed * 2.6;
    b.box(6.4, 0.3, 2.0, 'dirtDark', { pos: [0, 0.15, z] });
    b.box(6.0, 0.14, 1.7, 'dirt', { pos: [0, 0.3, z] });
    // Plank sides with visible corner posts.
    for (const sx of [-1, 1]) {
      b.bevelBox(0.12, 0.42, 2.1, 0.02, 'woodMid', { pos: [sx * 3.2, 0.21, z] });
    }
    for (const sz of [-1, 1]) {
      b.bevelBox(6.5, 0.42, 0.12, 0.02, 'woodMid', { pos: [0, 0.21, z + sz * 1.0] });
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box(0.16, 0.5, 0.16, 'woodDark', { pos: [sx * 3.2, 0.25, z + sz * 1.0] });
      }
    }

    if (season === 'winter') continue;

    const plants = 9;
    for (let i = 0; i < plants; i++) {
      const x = -2.7 + (i / (plants - 1)) * 5.4;
      const leafTint = bed === 0 ? 'deciduousLight' : bed === 1 ? 'grassDeep' : 'coniferLight';
      // Leaves fan out from a central crown at varied heights.
      const leaves = 6;
      for (let leaf = 0; leaf < leaves; leaf++) {
        const a = (leaf / leaves) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const droop = rng.range(0.4, 0.8);
        b.add(geoQuad(0.18, 0.34), leafTint, {
          pos: [x + Math.cos(a) * 0.12, 0.38, z + Math.sin(a) * 0.12],
          rot: [Math.sin(a) * droop, -a, Math.cos(a) * droop],
        });
      }
      if (season === 'summer' || season === 'autumn') {
        const produce = bed === 0 ? 'uiRed' : bed === 1 ? 'chickenBeak' : 'meadowFlowerA';
        b.sphere(0.13, produce, { pos: [x, 0.62, z], scale: [1, 0.9, 1] }, 7);
      }
    }
  }

  // Tools and a watering can, leaning where someone left them.
  b.cylinder(0.045, 0.05, 1.8, 'trunk', { pos: [3.4, 0.9, 2.2], rot: [0, 0, 0.22] }, 6);
  b.box(0.46, 0.28, 0.05, 'metal', { pos: [3.62, 0.06, 2.2] });
  b.lathe(
    [
      [0, 0],
      [0.26, 0.02],
      [0.27, 0.4],
      [0.21, 0.46],
      [0, 0.46],
    ],
    'uiGreen',
    { pos: [-3.5, 0, 2.4] },
    10,
  );
  b.cylinder(0.04, 0.05, 0.34, 'uiGreen', { pos: [-3.2, 0.3, 2.62], rot: [0.6, 0, -0.8] }, 6);
  b.torus(0.12, 0.025, 'uiGreenDeep', { pos: [-3.68, 0.44, 2.4], rot: [0, 0, 0.3] }, 8);

  const mesh = new Mesh(b.build({ groundY: 0 }), M.built('wood', 1.8));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/** Plank bridge with handrails and worn treads. */
export function buildBridge(): Group {
  const group = new Group();
  const b = new PartBuilder();
  for (let i = 0; i < 12; i++) {
    b.bevelBox(3.4, 0.12, 0.6, 0.02, i % 2 === 0 ? 'woodMid' : 'woodWarm', {
      pos: [0, 0.4, -3.4 + i * 0.66],
      rot: [0, 0, 0],
    });
  }
  for (const sx of [-1, 1]) {
    b.bevelBox(0.2, 0.32, 8.0, 0.03, 'woodDark', { pos: [sx * 1.5, 0.2, 0] });
    for (let i = 0; i < 5; i++) {
      b.bevelBox(0.13, 1.0, 0.13, 0.02, 'fenceDark', { pos: [sx * 1.55, 0.95, -3.2 + i * 1.6] });
    }
    b.bevelBox(0.09, 0.13, 7.0, 0.02, 'fence', { pos: [sx * 1.55, 1.45, 0] });
  }
  const mesh = new Mesh(b.build({ groundY: 0 }), M.built('wood', 2.0));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
