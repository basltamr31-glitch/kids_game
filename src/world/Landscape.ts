import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  type Material,
} from 'three';
import { PartBuilder, mergeGeometries } from '../art/MeshKit';
import { M, surface } from '../art/Materials';
import { color } from '../art/Palette';
import { clamp01, smoothstep, type Rng } from '../core/Rng';
import type { QualitySettings } from '../core/DeviceProfile';

/**
 * Distant mountains and water.
 *
 * The mountain ring is the game's strongest single image — it is what makes a
 * store screenshot read as "Alpine" in a quarter of a second. It is built as
 * three concentric bands of peaks at different distances and desaturations,
 * which gives real aerial perspective for the price of three meshes.
 */

export function buildMountains(rng: Rng, quality: QualitySettings): Group {
  const group = new Group();
  group.name = 'mountains';
  group.renderOrder = -900;

  const bands = [
    { distance: 150, height: 52, count: 16, near: 'mountainNear', far: 'mountainShadow', snow: 0.62 },
    { distance: 230, height: 78, count: 18, near: 'mountainFar', far: 'mountainNear', snow: 0.5 },
    { distance: 320, height: 104, count: 20, near: 'mountainFar', far: 'mountainFar', snow: 0.42 },
  ];

  for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
    const band = bands[bandIndex];
    const parts: BufferGeometry[] = [];
    const ridgeDetail = quality.detailedMountains ? 1 : 0;

    for (let i = 0; i < band.count; i++) {
      const angle = (i / band.count) * Math.PI * 2 + rng.range(-0.08, 0.08);
      // Peaks are pushed further away to the south so the valley opens up
      // behind the camera's usual resting position.
      const southBias = 1 + Math.max(0, Math.cos(angle)) * 0.25;
      const distance = band.distance * southBias * rng.range(0.9, 1.12);
      const height = band.height * rng.range(0.72, 1.28);
      const width = height * rng.range(0.95, 1.5);

      const peak = buildPeak(rng, width, height, band.snow, ridgeDetail);
      const cx = Math.sin(angle) * distance;
      const cz = Math.cos(angle) * distance;
      peak.rotateY(rng.range(0, Math.PI * 2));
      peak.translate(cx, -8, cz);
      parts.push(peak);
    }

    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();

    // Fade each band toward the far tint to fake atmospheric scattering.
    const haze = bandIndex / (bands.length - 1);
    fadeToward(merged, color('mountainFar'), haze * 0.55);

    const material = surface({ vertexColors: true, fog: false, unique: true });
    const mesh = new Mesh(merged, material);
    mesh.name = `mountain-band-${bandIndex}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    // Render back-to-front so nearer bands overlap correctly with fog disabled.
    mesh.renderOrder = -900 + bandIndex;
    group.add(mesh);
  }

  return group;
}

/**
 * One peak: an irregular pyramid with a snow cap and, at higher detail, a
 * secondary shoulder so the silhouette is not a plain triangle.
 */
function buildPeak(
  rng: Rng,
  width: number,
  height: number,
  snowLine: number,
  detail: number,
): BufferGeometry {
  const sides = detail > 0 ? 7 : 5;
  const positions: number[] = [];

  const apex: [number, number, number] = [
    rng.range(-width * 0.1, width * 0.1),
    height,
    rng.range(-width * 0.1, width * 0.1),
  ];

  const rim: [number, number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const r = (width / 2) * rng.range(0.75, 1.25);
    rim.push([Math.cos(a) * r, rng.range(-2, 4), Math.sin(a) * r]);
  }

  // Optional shoulder peak, offset and lower.
  const shoulder: [number, number, number] | null = detail > 0 && rng.bool(0.55)
    ? [
        Math.cos(rng.range(0, 6.28)) * width * 0.34,
        height * rng.range(0.55, 0.78),
        Math.sin(rng.range(0, 6.28)) * width * 0.34,
      ]
    : null;

  for (let i = 0; i < sides; i++) {
    const a = rim[i];
    const b = rim[(i + 1) % sides];
    pushTri(positions, apex, b, a);
    if (shoulder) pushTri(positions, shoulder, a, b);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.computeVertexNormals();

  // Vertex-paint by height: rock below the snow line, snow above.
  const rock = color('mountainNear');
  const rockDark = color('mountainShadow');
  const snow = color('mountainSnow');
  const pos = geo.attributes.position as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new Color();
  const snowStart = height * snowLine;

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = clamp01(y / height);
    tmp.copy(rockDark).lerp(rock, smoothstep(0, 0.55, t));
    tmp.lerp(snow, smoothstep(snowStart, snowStart + height * 0.16, y));
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

function pushTri(
  out: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): void {
  out.push(...a, ...b, ...c);
}

function fadeToward(geo: BufferGeometry, target: Color, amount: number): void {
  if (amount <= 0) return;
  const attribute = geo.attributes.color as BufferAttribute;
  const array = attribute.array as Float32Array;
  for (let i = 0; i < array.length; i += 3) {
    array[i] += (target.r - array[i]) * amount;
    array[i + 1] += (target.g - array[i + 1]) * amount;
    array[i + 2] += (target.b - array[i + 2]) * amount;
  }
  attribute.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* Water                                                               */
/* ------------------------------------------------------------------ */

/**
 * The stream: a gently displaced plane with a scrolling highlight. Cheap enough
 * that it stays on even at the low quality tier, because moving water is a big
 * part of why the valley feels alive.
 */
export class Water {
  readonly mesh: Mesh;
  private shader: { uniforms: Record<string, { value: number }> } | null = null;
  private time = 0;

  constructor(width: number, length: number) {
    const geometry = new PlaneGeometry(width, length, 24, 12);
    geometry.rotateX(-Math.PI / 2);

    const material = surface({
      tint: 'water',
      transparent: true,
      opacity: 0.86,
      unique: true,
    }) as Material & {
      onBeforeCompile: (shader: {
        uniforms: Record<string, { value: number }>;
        vertexShader: string;
        fragmentShader: string;
      }) => void;
    };

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           transformed.y += sin(transformed.x * 0.4 + uTime * 1.3) * 0.07
                          + sin(transformed.z * 0.55 + uTime * 1.9) * 0.05;`,
        );
      this.shader = shader;
    };
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'water';
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 10;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.shader?.uniforms.uTime) this.shader.uniforms.uTime.value = this.time;
  }
}

/** Pebbly bank geometry that hides the seam where water meets terrain. */
export function buildStreamBank(rng: Rng, length: number): Mesh {
  const b = new PartBuilder();
  for (let i = 0; i < 90; i++) {
    const x = rng.range(-length / 2, length / 2);
    const side = rng.bool() ? 1 : -1;
    const z = side * rng.range(3.2, 6.0);
    b.sphere(
      rng.range(0.18, 0.5),
      rng.bool(0.6) ? 'rock' : 'rockDark',
      { pos: [x, rng.range(-0.15, 0.1), z], scale: [1.2, 0.6, 1.0] },
      5,
    );
  }
  const mesh = new Mesh(b.build(), M.vertexPainted());
  mesh.name = 'stream-bank';
  mesh.receiveShadow = true;
  return mesh;
}
