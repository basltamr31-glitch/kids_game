import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  PlaneGeometry,
  Vector3,
  Color,
} from 'three';
import { M } from '../art/Materials';
import { color } from '../art/Palette';
import { fbm2D, clamp01, smoothstep, type Rng } from '../core/Rng';
import type { Season } from '../save/SaveSchema';

/**
 * The valley floor.
 *
 * A single displaced, vertex-painted plane. The height function is shared with
 * gameplay (`heightAt`) so the child, the animals and every scattered prop all
 * sit exactly on the ground without a physics engine or raycasts.
 *
 * The shape is authored, not random: a flat farm shelf in the middle, meadows
 * rolling away to the north, and ground rising steeply at the edges so the
 * playable area has natural walls instead of an invisible barrier.
 */

export const TERRAIN_SIZE = 200;
const TERRAIN_SEGMENTS = 128; // ~1.56 m per quad — plenty for gentle hills

export class Terrain {
  readonly mesh: Mesh;
  private seed: number;
  private season: Season = 'summer';
  private snowBlend = 0;
  private geometry: BufferGeometry;
  private baseColors: Float32Array;

  constructor(rng: Rng) {
    this.seed = Math.floor(rng.next() * 100000);

    const plane = new PlaneGeometry(
      TERRAIN_SIZE,
      TERRAIN_SIZE,
      TERRAIN_SEGMENTS,
      TERRAIN_SEGMENTS,
    );
    plane.rotateX(-Math.PI / 2);

    const pos = plane.attributes.position as BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.sampleHeight(x, z));
    }
    plane.computeVertexNormals();

    this.geometry = plane;
    this.baseColors = new Float32Array(pos.count * 3);
    this.paint();

    this.mesh = new Mesh(plane, M.ground());
    this.mesh.name = 'terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    // Terrain fills the view; skipping its frustum test saves a little CPU.
    this.mesh.frustumCulled = false;
  }

  /**
   * Ground height at a world position. Pure function of (x, z) and the seed —
   * cheap enough to call every frame for every agent.
   */
  heightAt(x: number, z: number): number {
    return this.sampleHeight(x, z);
  }

  /** Surface normal, used to tilt props so they sit naturally on slopes. */
  normalAt(x: number, z: number, out = new Vector3()): Vector3 {
    const e = 0.6;
    const hL = this.sampleHeight(x - e, z);
    const hR = this.sampleHeight(x + e, z);
    const hD = this.sampleHeight(x, z - e);
    const hU = this.sampleHeight(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /** How steep the ground is here, 0 (flat) .. 1 (cliff). Gates walkability. */
  slopeAt(x: number, z: number): number {
    const n = this.normalAt(x, z);
    return clamp01(1 - n.y);
  }

  private sampleHeight(x: number, z: number): number {
    // 1. The farm shelf: a flat, generous pad the buildings sit on.
    const shelf = smoothstep(46, 20, Math.hypot(x * 0.85, (z - 8) * 0.9));

    // 2. Rolling meadow relief, gentle enough that a 4-year-old never
    //    "loses" the child behind a hill.
    const rolling = fbm2D(x * 0.011, z * 0.011, 3, this.seed) * 3.4;
    const detail = fbm2D(x * 0.045, z * 0.045, 2, this.seed + 17) * 0.55;

    // 3. Valley walls: ground climbs hard beyond the play area, which reads as
    //    "the mountains start here" rather than an invisible wall.
    const distance = Math.max(Math.abs(x), Math.abs(z * 0.8));
    const walls = Math.pow(smoothstep(58, 96, distance), 2) * 46;

    // 4. The stream bed, carved as a shallow trough across the north meadow.
    const streamZ = 68 + Math.sin(x * 0.045) * 5;
    const streamCut = smoothstep(7, 0, Math.abs(z - streamZ)) * 2.2;

    const base = rolling + detail;
    // On the shelf, flatten almost completely toward y = 0.
    const height = base * (1 - shelf * 0.94) + walls - streamCut;
    return height;
  }

  /** True where the child is allowed to walk. */
  isWalkable(x: number, z: number): boolean {
    if (Math.abs(x) > 74 || Math.abs(z) > 80) return false;
    if (this.slopeAt(x, z) > 0.42) return false;
    return true;
  }

  private paint(): void {
    const pos = this.geometry.attributes.position as BufferAttribute;
    const colors = this.baseColors;

    const light = color('grassLight');
    const mid = color('grassMid');
    const deep = color('grassDeep');
    const rock = color('rock');
    const dirt = color('path');
    const sand = color('waterFoam');

    const tmp = new Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = pos.getY(i);

      // Break up the green with large, soft noise so the meadow is never flat.
      const variation = clamp01(fbm2D(x * 0.03, z * 0.03, 2, this.seed + 91) * 0.5 + 0.5);
      tmp.copy(mid).lerp(light, variation);
      tmp.lerp(deep, clamp01(fbm2D(x * 0.08, z * 0.08, 2, this.seed + 5) * 0.4 + 0.3) * 0.5);

      // Rock appears on the steep valley walls.
      const slope = clamp01(1 - this.normalAt(x, z).y);
      tmp.lerp(rock, smoothstep(0.24, 0.5, slope));

      // A worn path ring around the farmyard where everyone actually walks.
      const pathRing = Math.abs(Math.hypot(x * 0.9, (z - 6) * 0.95) - 15);
      tmp.lerp(dirt, smoothstep(3.2, 0.6, pathRing) * 0.75);

      // Pale gravel along the stream bank.
      const streamZ = 68 + Math.sin(x * 0.045) * 5;
      tmp.lerp(sand, smoothstep(7.5, 4.0, Math.abs(z - streamZ)) * 0.5);

      // Snow line high on the walls, always present.
      tmp.lerp(color('snow'), smoothstep(22, 34, y));

      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }

    this.geometry.setAttribute('color', new BufferAttribute(colors.slice(), 3));
  }

  /**
   * Re-tints the ground for the season. Winter blends toward snow, autumn
   * toward straw-gold. This rewrites one attribute rather than rebuilding the
   * mesh, so it is cheap enough to run on a day transition.
   */
  setSeason(season: Season, snowAmount = 0): void {
    if (this.season === season && Math.abs(this.snowBlend - snowAmount) < 0.01) return;
    this.season = season;
    this.snowBlend = snowAmount;

    const attribute = this.geometry.attributes.color as BufferAttribute;
    const out = attribute.array as Float32Array;
    const base = this.baseColors;
    const pos = this.geometry.attributes.position as BufferAttribute;

    const seasonTint =
      season === 'autumn'
        ? color('grassAutumn')
        : season === 'winter'
          ? color('snow')
          : season === 'spring'
            ? color('grassLight')
            : null;

    const seasonStrength =
      season === 'autumn' ? 0.45 : season === 'winter' ? 0.2 : season === 'spring' ? 0.25 : 0;

    const snow = color('snow');
    const tmp = new Color();

    for (let i = 0; i < pos.count; i++) {
      tmp.setRGB(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
      if (seasonTint) tmp.lerp(seasonTint, seasonStrength);
      if (snowAmount > 0) {
        // Snow settles more on flat ground than on steep faces.
        const flatness = clamp01(this.normalAt(pos.getX(i), pos.getZ(i)).y);
        tmp.lerp(snow, clamp01(snowAmount * flatness * 1.1));
      }
      out[i * 3] = tmp.r;
      out[i * 3 + 1] = tmp.g;
      out[i * 3 + 2] = tmp.b;
    }
    attribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
