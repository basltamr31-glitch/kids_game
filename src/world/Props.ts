import {
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  Matrix4,
  Quaternion,
  Vector3,
  Euler,
  DynamicDrawUsage,
} from 'three';
import { PartBuilder, geoBox, mergeGeometries, paint, setNormalsUp } from '../art/MeshKit';
import { M, surface } from '../art/Materials';
import { color } from '../art/Palette';
import type { Rng } from '../core/Rng';
import type { QualitySettings } from '../core/DeviceProfile';
import type { Terrain } from './Terrain';
import type { Season } from '../save/SaveSchema';

/**
 * Farm props and vegetation.
 *
 * Anything that appears more than ~20 times (grass, flowers, rocks, fence
 * posts) goes through an InstancedMesh, so the entire meadow costs one draw
 * call regardless of density. Everything else is merged into shared geometry by
 * PartBuilder. This is the main reason the farm holds 60fps on a budget phone.
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

/** Stylized conifer: a stack of tapering cones. Detail scales with quality. */
export function buildConifer(rng: Rng, detail: 0 | 1 | 2, season: Season): BufferGeometry {
  const b = new PartBuilder();
  const height = rng.range(5.5, 9.5);
  const radius = height * rng.range(0.19, 0.26);
  const segments = detail === 0 ? 5 : detail === 1 ? 7 : 9;

  b.cylinder(0.16, 0.3, height * 0.42, 'trunk', { pos: [0, height * 0.21, 0] }, 6);

  const tiers = detail === 0 ? 3 : detail === 1 ? 4 : 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const y = height * (0.3 + t * 0.62);
    const r = radius * (1 - t * 0.72);
    const h = height * 0.34 * (1 - t * 0.28);
    b.cone(
      r,
      h,
      i % 2 === 0 ? 'coniferDark' : 'coniferLight',
      { pos: [0, y + h * 0.3, 0], rot: [0, rng.range(0, 1.2), 0] },
      segments,
    );
  }

  if (season === 'winter') {
    // Snow caps sitting on each tier.
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const y = height * (0.3 + t * 0.62);
      const r = radius * (1 - t * 0.72) * 0.72;
      b.cone(r, height * 0.1, 'snow', { pos: [0, y + height * 0.28, 0] }, segments);
    }
  }

  return b.build();
}

/** Stylized broadleaf: a trunk with 3-5 overlapping canopy spheres. */
export function buildDeciduous(rng: Rng, detail: 0 | 1 | 2, season: Season): BufferGeometry {
  const b = new PartBuilder();
  const height = rng.range(4.5, 7.5);
  const segments = detail === 0 ? 6 : detail === 1 ? 8 : 10;

  b.cylinder(0.22, 0.42, height * 0.55, 'trunk', { pos: [0, height * 0.28, 0] }, 6);
  if (detail > 0) {
    // A couple of boughs so the silhouette is not a lollipop.
    for (const side of [-1, 1]) {
      b.cylinder(
        0.1,
        0.16,
        height * 0.3,
        'trunkDark',
        { pos: [side * 0.5, height * 0.5, 0], rot: [0, 0, side * -0.5] },
        5,
      );
    }
  }

  const light = season === 'autumn' ? 'deciduousAutumn' : 'deciduousLight';
  const dark = season === 'autumn' ? 'deciduousAutumnDeep' : 'deciduousDark';

  if (season === 'winter') {
    // Bare branches instead of a canopy.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      b.cylinder(
        0.05,
        0.09,
        height * 0.42,
        'trunkDark',
        {
          pos: [Math.cos(a) * 0.6, height * 0.75, Math.sin(a) * 0.6],
          rot: [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6],
        },
        4,
      );
    }
    return b.build();
  }

  const blobs = detail === 0 ? 3 : detail === 1 ? 4 : 5;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const r = height * rng.range(0.24, 0.33);
    const spread = height * 0.15;
    b.sphere(
      r,
      i % 2 === 0 ? light : dark,
      {
        pos: [
          Math.cos(a) * spread,
          height * rng.range(0.7, 0.88),
          Math.sin(a) * spread,
        ],
        scale: [1, rng.range(0.78, 0.95), 1],
      },
      segments,
    );
  }
  return b.build();
}

/** Apple tree — same canopy, plus fruit when the season allows. */
export function buildAppleTree(rng: Rng, detail: 0 | 1 | 2, season: Season): BufferGeometry {
  const canopy = buildDeciduous(rng, detail, season);
  if (season === 'winter' || season === 'spring') return canopy;

  const b = new PartBuilder();
  const count = detail === 0 ? 5 : 11;
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(1.0, 2.1);
    b.sphere(
      0.19,
      season === 'autumn' ? 'flowerBoxRed' : 'roofTile',
      { pos: [Math.cos(a) * r, rng.range(3.4, 5.2), Math.sin(a) * r] },
      6,
    );
  }
  const fruit = b.build();
  const merged = mergeGeometries([canopy, fruit]);
  canopy.dispose();
  fruit.dispose();
  return merged;
}

/* ------------------------------------------------------------------ */
/* Instanced scatter (grass, flowers, rocks)                           */
/* ------------------------------------------------------------------ */

export interface ScatterSpec {
  count: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Rejects positions (e.g. inside buildings). */
  accept?: (x: number, z: number) => boolean;
}

/**
 * Grass tufts as a single InstancedMesh with per-instance colour variation and
 * a cheap vertex-shader wind sway injected via onBeforeCompile.
 */
export function buildGrassField(
  rng: Rng,
  terrain: Terrain,
  spec: ScatterSpec,
  season: Season,
): InstancedMesh {
  // One tuft = three crossed blades. Tiny geometry, enormous instance count.
  const blade = new PartBuilder();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    // Short and broad. Tall thin blades read as twigs at gameplay distance;
    // a squat tuft reads as meadow.
    blade.add(geoBox(0.13, 0.46, 0.012), 'grassMid', {
      pos: [0, 0.23, 0],
      rot: [0, a, 0],
    });
  }
  const geometry = blade.build();
  setNormalsUp(geometry);
  // IMPORTANT: an InstancedMesh multiplies the geometry's vertex colour by the
  // per-instance colour. Leaving green in both squares it and the meadow fills
  // with near-black tufts. The base must be white so the instance colour is the
  // only tint applied.
  paint(geometry, '#FFFFFF');

  const material = surface({ vertexColors: true, doubleSided: true, unique: true });
  attachWind(material, 1.0);

  const mesh = new InstancedMesh(geometry, material, spec.count);
  mesh.name = 'grass';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);

  const light = color('grassLight');
  const deep = color('grassDeep');
  const dry = color(season === 'autumn' ? 'grassAutumn' : 'grassDry');

  let placed = 0;
  let attempts = 0;
  while (placed < spec.count && attempts < spec.count * 8) {
    attempts++;
    const x = rng.range(spec.bounds.minX, spec.bounds.maxX);
    const z = rng.range(spec.bounds.minZ, spec.bounds.maxZ);
    if (spec.accept && !spec.accept(x, z)) continue;
    if (terrain.slopeAt(x, z) > 0.45) continue;

    _pos.set(x, terrain.heightAt(x, z) - 0.05, z);
    _euler.set(0, rng.range(0, Math.PI * 2), 0);
    _quat.setFromEuler(_euler);
    const s = rng.range(0.8, 1.35);
    _scale.set(s, s * rng.range(0.85, 1.25), s);
    _matrix.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(placed, _matrix);

    // Bias toward the light end: grass darker than the ground it sits on looks
    // like debris, not growth.
    _color.copy(light).lerp(deep, rng.next() * 0.55);
    _color.lerp(dry, rng.next() * 0.28);
    mesh.setColorAt(placed, _color);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Wildflowers, mushrooms and pebbles — small, cheap, everywhere. */
export function buildScatterProps(
  rng: Rng,
  terrain: Terrain,
  spec: ScatterSpec,
  season: Season,
): InstancedMesh {
  const b = new PartBuilder();
  b.cylinder(0.02, 0.02, 0.34, 'grassDeep', { pos: [0, 0.17, 0] }, 4);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.box(0.12, 0.03, 0.07, 'meadowFlowerA', {
      pos: [Math.cos(a) * 0.07, 0.35, Math.sin(a) * 0.07],
      rot: [0, -a, 0],
    });
  }
  b.sphere(0.045, 'sunGold', { pos: [0, 0.36, 0] }, 5);
  const geometry = b.build();
  setNormalsUp(geometry);
  // Same instancing rule as the grass: the per-instance colour is the tint.
  paint(geometry, '#FFFFFF');

  const material = surface({ vertexColors: true, doubleSided: true, unique: true });
  attachWind(material, 0.6);

  const mesh = new InstancedMesh(geometry, material, spec.count);
  mesh.name = 'scatter';
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const a = color('meadowFlowerA');
  const bb = color('meadowFlowerB');
  const c = color('meadowFlowerC');
  const white = color('wallPlaster');
  const variants = [a, bb, c, white];

  let placed = 0;
  let attempts = 0;
  const density = season === 'winter' ? 0.25 : season === 'autumn' ? 0.6 : 1;
  const target = Math.floor(spec.count * density);

  while (placed < target && attempts < spec.count * 8) {
    attempts++;
    const x = rng.range(spec.bounds.minX, spec.bounds.maxX);
    const z = rng.range(spec.bounds.minZ, spec.bounds.maxZ);
    if (spec.accept && !spec.accept(x, z)) continue;
    if (terrain.slopeAt(x, z) > 0.4) continue;

    _pos.set(x, terrain.heightAt(x, z), z);
    _euler.set(0, rng.range(0, Math.PI * 2), 0);
    _quat.setFromEuler(_euler);
    const s = rng.range(0.7, 1.3);
    _scale.setScalar(s);
    _matrix.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(placed, _matrix);
    mesh.setColorAt(placed, rng.pick(variants));
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Rocks scattered on the valley walls and along the stream. */
export function buildRocks(rng: Rng, terrain: Terrain, spec: ScatterSpec): InstancedMesh {
  const b = new PartBuilder();
  b.sphere(0.5, 'rock', { scale: [1.3, 0.75, 1.0] }, 6);
  b.sphere(0.3, 'rockDark', { pos: [0.3, 0.1, 0.2], scale: [1.1, 0.7, 1.0] }, 5);
  const geometry = b.build();

  const mesh = new InstancedMesh(geometry, M.vertexPainted(), spec.count);
  mesh.name = 'rocks';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  let placed = 0;
  let attempts = 0;
  while (placed < spec.count && attempts < spec.count * 10) {
    attempts++;
    const x = rng.range(spec.bounds.minX, spec.bounds.maxX);
    const z = rng.range(spec.bounds.minZ, spec.bounds.maxZ);
    if (spec.accept && !spec.accept(x, z)) continue;

    _pos.set(x, terrain.heightAt(x, z) - 0.15, z);
    _euler.set(rng.range(-0.2, 0.2), rng.range(0, Math.PI * 2), rng.range(-0.2, 0.2));
    _quat.setFromEuler(_euler);
    _scale.setScalar(rng.range(0.5, 2.1));
    _matrix.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(placed, _matrix);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Injects a wind sway into any material's vertex shader.
 *
 * Doing this on the GPU keeps thousands of grass tufts animating for free; the
 * alternative (rewriting instance matrices on the CPU) would cost several
 * milliseconds a frame on a budget device.
 */
const windMaterials: { uniforms: { uTime: { value: number }; uWind: { value: number } } }[] = [];

function attachWind(material: unknown, strength: number): void {
  const mat = material as {
    onBeforeCompile: (shader: {
      uniforms: Record<string, { value: number }>;
      vertexShader: string;
    }) => void;
    userData: Record<string, unknown>;
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uWind;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         // Sway more the higher up the blade we are, anchored at the root.
         float swayMask = max(transformed.y, 0.0);
         #ifdef USE_INSTANCING
           float phase = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.9;
         #else
           float phase = 0.0;
         #endif
         float sway = sin(uTime * 1.6 + phase) * 0.06
                    + sin(uTime * 3.1 + phase * 1.7) * 0.025;
         transformed.x += sway * swayMask * uWind;
         transformed.z += sway * 0.55 * swayMask * uWind;`,
      );
    mat.userData.shader = shader;
    windMaterials.push(shader as never);
  };
}

/** Advances every wind shader. Called once per frame by the world. */
export function updateWind(time: number, gust: number): void {
  for (const shader of windMaterials) {
    if (!shader.uniforms.uTime) continue;
    shader.uniforms.uTime.value = time;
    shader.uniforms.uWind.value = shader.uniforms.uWind.value * 0.9 + gust * 0.1;
  }
}

export function resetWind(): void {
  windMaterials.length = 0;
}

/* ------------------------------------------------------------------ */
/* Static farm props                                                   */
/* ------------------------------------------------------------------ */

/** A run of alpine post-and-rail fence following a path of points. */
export function buildFence(points: [number, number][], terrain: Terrain): Mesh {
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
      b.box(0.16, 1.5, 0.16, 'fenceDark', { pos: [x, y + 0.7, z], rot: [0, angle, 0] });
      b.cone(0.13, 0.2, 'fence', { pos: [x, y + 1.52, z] }, 4);
    }
    // Two rails per span, following the ground.
    for (const railY of [0.55, 1.05]) {
      for (let p = 0; p < posts; p++) {
        const t0 = p / posts;
        const t1 = (p + 1) / posts;
        const ax = x1 + dx * t0;
        const az = z1 + dz * t0;
        const bx = x1 + dx * t1;
        const bz = z1 + dz * t1;
        const ay = terrain.heightAt(ax, az) + railY;
        const by = terrain.heightAt(bx, bz) + railY;
        const segLength = Math.hypot(bx - ax, bz - az);
        const pitch = Math.atan2(by - ay, segLength);
        b.box(0.1, 0.14, segLength, 'fence', {
          pos: [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2],
          rot: [pitch, angle, 0],
        });
      }
    }
  }
  const mesh = new Mesh(b.build(), M.vertexPainted());
  mesh.name = 'fence';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Stone well with a shingled roof and a bucket on a rope. */
export function buildWell(): Group {
  const group = new Group();
  const b = new PartBuilder();

  b.cylinder(1.1, 1.2, 1.1, 'rock', { pos: [0, 0.55, 0] }, 12);
  b.cylinder(1.15, 1.15, 0.16, 'rockDark', { pos: [0, 1.12, 0] }, 12);
  b.cylinder(0.95, 0.95, 0.1, 'waterDeep', { pos: [0, 1.06, 0] }, 12);
  for (const side of [-1, 1]) {
    b.box(0.16, 2.1, 0.16, 'woodDark', { pos: [side * 0.95, 2.1, 0] });
  }
  b.prism(2.0, 0.8, 2.8, 'roofShingle', { pos: [0, 3.1, 0], rot: [0, Math.PI / 2, 0] });
  b.cylinder(0.12, 0.12, 2.0, 'trunk', { pos: [0, 2.9, 0], rot: [0, 0, Math.PI / 2] }, 8);
  b.box(0.06, 0.9, 0.06, 'woodDark', { pos: [0, 2.4, 0] });
  b.cylinder(0.3, 0.26, 0.42, 'bucket', { pos: [0, 1.75, 0] }, 10);
  b.cylinder(0.32, 0.32, 0.06, 'bucketRim', { pos: [0, 1.96, 0] }, 10);

  const mesh = new Mesh(b.build(), M.vertexPainted());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/** Stacked hay bales the child takes food from. */
export function buildHayStack(rng: Rng): Group {
  const group = new Group();
  const b = new PartBuilder();
  const layout = [
    [-0.9, 0, 0],
    [0.9, 0, 0],
    [0, 0, 1.4],
    [0, 1.05, 0.7],
  ];
  for (const [x, y, z] of layout) {
    b.box(1.6, 1.0, 1.2, 'hay', { pos: [x, 0.5 + y, z], rot: [0, rng.range(-0.1, 0.1), 0] });
    for (let i = 0; i < 3; i++) {
      b.box(1.66, 0.08, 1.26, 'hayDark', { pos: [x, 0.25 + y + i * 0.28, z] });
    }
  }
  // Loose straw around the base.
  for (let i = 0; i < 14; i++) {
    b.box(rng.range(0.2, 0.5), 0.04, 0.05, 'hay', {
      pos: [rng.range(-2, 2), 0.03, rng.range(-1, 2.4)],
      rot: [0, rng.range(0, Math.PI), 0],
    });
  }
  const mesh = new Mesh(b.build(), M.vertexPainted());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/** Wooden water trough. */
export function buildTrough(): Group {
  const group = new Group();
  const b = new PartBuilder();
  b.box(3.0, 0.7, 1.1, 'woodMid', { pos: [0, 0.35, 0] });
  b.box(2.7, 0.5, 0.85, 'trunkDark', { pos: [0, 0.48, 0] });
  b.box(2.6, 0.08, 0.78, 'water', { pos: [0, 0.6, 0] });
  for (const sx of [-1, 1]) {
    b.box(0.2, 0.5, 1.2, 'woodDark', { pos: [sx * 1.4, 0.25, 0] });
  }
  const mesh = new Mesh(b.build(), M.vertexPainted());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/** Vegetable garden: raised beds with rows of growing plants. */
export function buildGarden(rng: Rng, season: Season): Group {
  const group = new Group();
  const b = new PartBuilder();

  const beds = 3;
  for (let bed = 0; bed < beds; bed++) {
    const z = -2.6 + bed * 2.6;
    // Bed frame.
    b.box(6.4, 0.34, 2.0, 'dirtDark', { pos: [0, 0.17, z] });
    b.box(6.0, 0.16, 1.7, 'dirt', { pos: [0, 0.3, z] });
    for (const sx of [-1, 1]) {
      b.box(0.14, 0.4, 2.1, 'woodMid', { pos: [sx * 3.2, 0.2, z] });
    }
    for (const sz of [-1, 1]) {
      b.box(6.5, 0.4, 0.14, 'woodMid', { pos: [0, 0.2, z + sz * 1.0] });
    }

    if (season === 'winter') continue;

    // Rows of plants, with visible produce in the growing seasons.
    const plants = 9;
    for (let i = 0; i < plants; i++) {
      const x = -2.7 + (i / (plants - 1)) * 5.4;
      const leafTint = bed === 0 ? 'deciduousLight' : 'grassDeep';
      for (let leaf = 0; leaf < 4; leaf++) {
        const a = (leaf / 4) * Math.PI * 2 + rng.range(-0.3, 0.3);
        b.box(0.1, 0.42, 0.26, leafTint, {
          pos: [x + Math.cos(a) * 0.1, 0.55, z + Math.sin(a) * 0.1],
          rot: [Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5],
        });
      }
      if (season === 'summer' || season === 'autumn') {
        const produce = bed === 0 ? 'uiRed' : bed === 1 ? 'chickenBeak' : 'meadowFlowerA';
        b.sphere(0.14, produce, { pos: [x, 0.62, z] }, 6);
      }
    }
  }

  // A few garden tools leaning on the frame.
  b.cylinder(0.05, 0.05, 1.8, 'trunk', { pos: [3.4, 0.9, 2.2], rot: [0, 0, 0.22] }, 6);
  b.box(0.5, 0.3, 0.06, 'metal', { pos: [3.62, 0.06, 2.2] });
  b.cylinder(0.24, 0.3, 0.44, 'uiGreen', { pos: [-3.5, 0.22, 2.4] }, 10);

  const mesh = new Mesh(b.build(), M.vertexPainted());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/** Simple plank bridge over the stream. */
export function buildBridge(): Group {
  const group = new Group();
  const b = new PartBuilder();
  for (let i = 0; i < 12; i++) {
    b.box(3.4, 0.14, 0.62, i % 2 === 0 ? 'woodMid' : 'woodWarm', {
      pos: [0, 0.4, -3.4 + i * 0.66],
    });
  }
  for (const sx of [-1, 1]) {
    b.box(0.18, 0.3, 8.0, 'woodDark', { pos: [sx * 1.5, 0.2, 0] });
    for (let i = 0; i < 5; i++) {
      b.box(0.14, 1.0, 0.14, 'fenceDark', { pos: [sx * 1.55, 0.95, -3.2 + i * 1.6] });
    }
    b.box(0.1, 0.14, 7.0, 'fence', { pos: [sx * 1.55, 1.45, 0] });
  }
  const mesh = new Mesh(b.build(), M.vertexPainted());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/**
 * Places trees across an area as individual meshes sharing a handful of
 * geometries, so variety costs almost nothing.
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

  // Build a small pool of variants and reuse them.
  const variants: BufferGeometry[] = [];
  const poolSize = quality.treeDetail === 0 ? 3 : 5;
  for (let i = 0; i < poolSize; i++) {
    const useConifer =
      kind === 'conifer' || (kind === 'mixed' && rng.bool(0.6));
    variants.push(
      useConifer
        ? buildConifer(rng, quality.treeDetail, season)
        : buildDeciduous(rng, quality.treeDetail, season),
    );
  }

  const material = M.vertexPainted();
  let placed = 0;
  let attempts = 0;
  while (placed < spec.count && attempts < spec.count * 12) {
    attempts++;
    const x = rng.range(spec.bounds.minX, spec.bounds.maxX);
    const z = rng.range(spec.bounds.minZ, spec.bounds.maxZ);
    if (spec.accept && !spec.accept(x, z)) continue;
    if (terrain.slopeAt(x, z) > 0.55) continue;

    const mesh = new Mesh(rng.pick(variants), material);
    mesh.position.set(x, terrain.heightAt(x, z) - 0.2, z);
    mesh.rotation.y = rng.range(0, Math.PI * 2);
    const s = rng.range(0.78, 1.25);
    mesh.scale.setScalar(s);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    placed++;
  }
  return group;
}

/** Marks a geometry's colours as autumn/winter without rebuilding it. */
export function retintGeometry(geometry: BufferGeometry, tint: string): void {
  paint(geometry, tint);
}
