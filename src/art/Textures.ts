import {
  CanvasTexture,
  RepeatWrapping,
  LinearMipmapLinearFilter,
  LinearFilter,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Procedural detail textures.
 *
 * The single biggest thing separating "flat vertex-coloured prototype" from
 * "material you believe in" is surface grain. A plank needs wood fibre, plaster
 * needs a fine speckle, wool needs fuzz, and a meadow needs breakup.
 *
 * These are generated once into a small atlas at boot. They are deliberately
 * LUMINANCE-ONLY and low contrast: the palette still owns every hue, the
 * texture only modulates brightness. That keeps the world colour-coherent
 * while giving every surface something for the eye to land on.
 *
 * Total cost: four 256px canvases, generated in ~15ms, ~260 KB of VRAM.
 */

export type DetailKind = 'wood' | 'plaster' | 'fabric' | 'organic' | 'stone';

const cache = new Map<DetailKind, Texture>();

/** Deterministic hash noise so textures are identical on every launch. */
function noise2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = noise2(xi, yi, seed);
  const b = noise2(xi + 1, yi, seed);
  const c = noise2(xi, yi + 1, seed);
  const d = noise2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(x * freq, y * freq, seed + i * 37) * amp;
    norm += amp;
    amp *= 0.55;
    freq *= 2.07;
  }
  return sum / norm;
}

const SIZE = 256;

function makeCanvas(): { canvas: HTMLCanvasElement; data: ImageData } {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(SIZE, SIZE);
  return { canvas, data };
}

function finish(canvas: HTMLCanvasElement, data: ImageData): Texture {
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Writes a greyscale value, keeping everything near mid-grey (no hue shift). */
function put(data: ImageData, i: number, value: number): void {
  const v = Math.max(0, Math.min(255, Math.round(value * 255)));
  data.data[i] = v;
  data.data[i + 1] = v;
  data.data[i + 2] = v;
  data.data[i + 3] = 255;
}

function buildWood(): Texture {
  const { canvas, data } = makeCanvas();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      // Grain runs along X: stretch the noise hard on one axis, then band it
      // into rings so it reads as sawn timber rather than marble.
      const warp = fbm(x * 0.012, y * 0.09, 3, 11) * 2.2;
      const rings = Math.sin((y * 0.42 + warp * 6) * 1.0);
      const fibre = fbm(x * 0.5, y * 0.06, 2, 23) - 0.5;
      // Occasional knot.
      const kx = x - 180;
      const ky = y - 70;
      const knot = Math.exp(-(kx * kx + ky * ky) / 420) * 0.35;
      put(data, i, 0.5 + rings * 0.055 + fibre * 0.1 - knot);
    }
  }
  return finish(canvas, data);
}

function buildPlaster(): Texture {
  const { canvas, data } = makeCanvas();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      // Fine tight speckle plus a very broad mottle, like hand-applied render.
      const fine = fbm(x * 0.9, y * 0.9, 2, 5) - 0.5;
      const broad = fbm(x * 0.035, y * 0.035, 3, 61) - 0.5;
      put(data, i, 0.5 + fine * 0.075 + broad * 0.085);
    }
  }
  return finish(canvas, data);
}

function buildFabric(): Texture {
  const { canvas, data } = makeCanvas();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      // A woven over/under check at thread scale, softened by fuzz.
      const weave = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.5;
      const fuzz = fbm(x * 0.7, y * 0.7, 2, 91) - 0.5;
      const slub = fbm(x * 0.05, y * 0.05, 2, 7) - 0.5;
      put(data, i, 0.5 + weave * 0.05 + fuzz * 0.07 + slub * 0.05);
    }
  }
  return finish(canvas, data);
}

function buildOrganic(): Texture {
  const { canvas, data } = makeCanvas();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      // Soft blotches for foliage, hide and ground cover.
      const blobs = fbm(x * 0.045, y * 0.045, 4, 3) - 0.5;
      const detail = fbm(x * 0.25, y * 0.25, 2, 47) - 0.5;
      put(data, i, 0.5 + blobs * 0.14 + detail * 0.06);
    }
  }
  return finish(canvas, data);
}

function buildStone(): Texture {
  const { canvas, data } = makeCanvas();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      // Cellular-ish: high-frequency ridges give chipped, granular rock.
      const n = fbm(x * 0.09, y * 0.09, 4, 71);
      const ridge = 1 - Math.abs(n - 0.5) * 2;
      const grit = fbm(x * 1.1, y * 1.1, 2, 13) - 0.5;
      put(data, i, 0.5 + (ridge - 0.5) * 0.13 + grit * 0.08);
    }
  }
  return finish(canvas, data);
}

const BUILDERS: Record<DetailKind, () => Texture> = {
  wood: buildWood,
  plaster: buildPlaster,
  fabric: buildFabric,
  organic: buildOrganic,
  stone: buildStone,
};

export function detailTexture(kind: DetailKind): Texture {
  let texture = cache.get(kind);
  if (!texture) {
    texture = BUILDERS[kind]();
    texture.name = `detail-${kind}`;
    cache.set(kind, texture);
  }
  return texture;
}

/** Generates every detail texture up front so nothing hitches mid-play. */
export function warmDetailTextures(): void {
  for (const kind of Object.keys(BUILDERS) as DetailKind[]) detailTexture(kind);
}

export function disposeDetailTextures(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
