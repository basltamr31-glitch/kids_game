import {
  DataTexture,
  RedFormat,
  LinearFilter,
  MeshToonMaterial,
  MeshBasicMaterial,
  DoubleSide,
  FrontSide,
  type Texture,
  type Material,
} from 'three';
import { color } from './Palette';
import { clamp01, smoothstep } from '../core/Rng';

/**
 * Stylized shading.
 *
 * The whole game uses one lighting model: a soft, wide-stepped toon ramp. It is
 * cheap (no per-pixel PBR), reads beautifully on low-end GPUs, and gives the
 * "premium children's animation" feel the brief asks for — light wraps warmly
 * around a cow's flank instead of falling off physically.
 *
 * Materials are cached and shared aggressively; a whole 60-object farmyard
 * typically runs on ~20 material instances, which keeps draw-call state changes
 * low on mobile tilers.
 */

let toonRamp: Texture | null = null;

/**
 * Builds the toon gradient. Five bands with softened edges: enough stepping to
 * read as stylized, not so hard that a hillside shows ugly contour lines.
 */
export function getToonRamp(): Texture {
  if (toonRamp) return toonRamp;

  const size = 64;
  const data = new Uint8Array(size);
  const bands = 5;
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    const band = Math.floor(t * bands) / (bands - 1);
    // Blend each step slightly into the next so edges are soft, not aliased.
    const local = (t * bands) % 1;
    const soft = smoothstep(0.35, 0.65, local) / (bands - 1);
    const value = clamp01(band + soft * 0.9);
    // Lift the shadow end hard. In a stylized children's game a shadow should
    // read as "a cooler shade of the same colour", never as darkness — 0.45 is
    // where the meadow stops looking like dusk in the middle of the morning.
    data[i] = Math.round((0.45 + value * 0.55) * 255);
  }

  toonRamp = new DataTexture(data, size, 1, RedFormat);
  toonRamp.minFilter = LinearFilter;
  toonRamp.magFilter = LinearFilter;
  toonRamp.generateMipmaps = false;
  toonRamp.needsUpdate = true;
  return toonRamp;
}

export interface SurfaceOptions {
  /** Palette key or hex string. */
  tint?: string;
  /** Use per-vertex colours instead of a flat tint. */
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  doubleSided?: boolean;
  /** Unlit — for the sky dome, water sparkle, emissive windows. */
  unlit?: boolean;
  /** Cutout foliage / grass cards. */
  alphaTest?: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** Do not share this instance (needed when the caller animates its colour). */
  unique?: boolean;
  fog?: boolean;
}

const cache = new Map<string, Material>();

/**
 * The one material factory. Everything visible in the game is created here, so
 * a global look change (say, warming every shadow) is a single edit.
 */
export function surface(options: SurfaceOptions = {}): Material {
  const key = JSON.stringify(options);
  if (!options.unique) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  const side = options.doubleSided ? DoubleSide : FrontSide;
  const tint = options.vertexColors ? 0xffffff : undefined;

  let material: Material;
  if (options.unlit) {
    const basic = new MeshBasicMaterial({
      color: tint ?? color(options.tint ?? 'grassMid'),
      vertexColors: options.vertexColors ?? false,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      side,
      fog: options.fog ?? true,
      depthWrite: options.transparent ? (options.opacity ?? 1) > 0.95 : true,
    });
    if (options.alphaTest) basic.alphaTest = options.alphaTest;
    material = basic;
  } else {
    const toon = new MeshToonMaterial({
      color: tint ?? color(options.tint ?? 'grassMid'),
      gradientMap: getToonRamp(),
      vertexColors: options.vertexColors ?? false,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      side,
      fog: options.fog ?? true,
      depthWrite: options.transparent ? (options.opacity ?? 1) > 0.95 : true,
    });
    if (options.alphaTest) toon.alphaTest = options.alphaTest;
    if (options.emissive) {
      toon.emissive = color(options.emissive);
      toon.emissiveIntensity = options.emissiveIntensity ?? 1;
    }
    material = toon;
  }

  if (!options.unique) cache.set(key, material);
  return material;
}

/** Convenience wrappers so call sites read like art direction, not GL config. */
export const M = {
  solid: (tint: string) => surface({ tint }),
  vertexPainted: () => surface({ vertexColors: true }),
  foliage: (tint: string) => surface({ tint, doubleSided: true }),
  cutout: (tint: string) => surface({ tint, doubleSided: true, alphaTest: 0.45 }),
  glass: (tint: string, opacity = 0.75) =>
    surface({ tint, transparent: true, opacity, unlit: false }),
  glow: (tint: string) => surface({ tint, unlit: true }),
  water: () => surface({ tint: 'water', transparent: true, opacity: 0.82, unique: true }),
};

/** Frees every cached material. Only used when tearing the game down. */
export function disposeMaterials(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
  toonRamp?.dispose();
  toonRamp = null;
}
