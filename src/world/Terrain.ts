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

const _up = new Vector3(0, 1, 0);

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
    this.softenWallNormals(plane);

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
  /**
   * Tilts the steep outer valley walls' normals back toward vertical.
   *
   * The walls face inward, away from the sun's southerly arc, so lit honestly
   * they come out as one dark slab across the whole horizon — the largest and
   * flattest block of colour in the frame, and the thing that most made the
   * valley read as a painted backdrop rather than as ground that keeps going.
   * Leaning their normals toward up lets them catch the same light as the
   * meadow, so they read as ground rising away into the distance. The trees
   * and rocks standing on them keep their own normals, which is what preserves
   * the sense of a slope.
   */
  private softenWallNormals(plane: PlaneGeometry): void {
    const pos = plane.attributes.position as BufferAttribute;
    const nor = plane.attributes.normal as BufferAttribute;
    const n = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      const distance = Math.hypot(pos.getX(i), pos.getZ(i));
      // Only out where the walls climb; the playable bowl is untouched.
      const wall = smoothstep(52, 92, distance);
      if (wall <= 0) continue;
      n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
      n.lerp(_up, wall * 0.78).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    nor.needsUpdate = true;
  }

  /**
   * How lush the meadow is here, 0 (worn and dry) .. 1 (deep and green).
   *
   * Exported because the grass has to agree with it. A meadow that is evenly
   * green everywhere and evenly tufted everywhere reads as a billiard table
   * with objects standing on it; what makes it read as ground is that the
   * colour and the density vary TOGETHER, thinning out over the same patches.
   *
   * Two octaves at deliberately different scales: a broad one at roughly forty
   * metres, which is the scale the player actually perceives as "over there it
   * is greener", and a finer one for patchiness within that.
   */
  lushness(x: number, z: number): number {
    const broad = fbm2D(x * 0.024, z * 0.024, 2, this.seed + 91) * 0.5 + 0.5;
    const fine = fbm2D(x * 0.085, z * 0.085, 2, this.seed + 5) * 0.5 + 0.5;
    const raw = broad * 0.72 + fine * 0.28;
    // Stretched about the midpoint. Summed noise piles up around 0.5, so
    // without this the field almost never reaches either end and the patches
    // it is supposed to produce stay invisible.
    return clamp01((raw - 0.5) * 2.1 + 0.5);
  }

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
    // The walls hide the map edge and read as "the mountains start here". They
    // used to climb to 46m, which put a solid curtain of near ground across the
    // whole horizon and hid the mountain bands entirely. A lower ridge does the
    // same job of closing the bowl while letting the peaks behind it be the
    // backdrop they were built to be.
    // A perfectly even ring of ground draws a razor-straight line across the
    // sky, which is the one silhouette nothing in nature makes. Two octaves of
    // noise on the wall height turn it into a ridge with saddles and shoulders.
    const ridgeShape = 0.66 + fbm2D(x * 0.011, z * 0.011, 2, this.seed + 401) * 0.62;
    const walls = Math.pow(smoothstep(54, 98, distance), 2) * 21 * clamp01(ridgeShape);

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
    const dry = color('grassDry');
    const haze = color('valleyHaze');

    const tmp = new Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = pos.getY(i);

      // Break up the green. The previous version varied between three greens
      // that sit within a few percent of each other in value, which at a
      // distance is no variation at all. This runs the full range from worn
      // straw through to deep shade, which is what a real meadow does.
      const lush = this.lushness(x, z);
      if (lush < 0.5) {
        // Drier, more worn ground.
        tmp.copy(dry).lerp(mid, lush * 2);
      } else {
        tmp.copy(mid).lerp(light, (lush - 0.5) * 1.3);
      }
      // Shaded hollows, keyed off a different octave so it does not simply
      // track the same patches.
      tmp.lerp(deep, clamp01(fbm2D(x * 0.055, z * 0.055, 2, this.seed + 37) * 0.5 + 0.5) * 0.42);

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
      tmp.lerp(color('snow'), smoothstep(13, 19, y));

      // Aerial perspective up the valley walls.
      //
      // The walls face inward, away from the sun, so shading alone leaves them
      // a dead slab across the horizon — the single largest block of colour in
      // the frame and the flattest. Real valley sides pick up more and more of
      // the sky as they rise and recede; baking that into the vertex colour
      // costs nothing per frame and is what separates the far wall from the
      // meadow the child is standing in.
      const distance = Math.hypot(x, z);
      const aerial = clamp01(smoothstep(4, 17, y) * 0.7 + smoothstep(50, 96, distance) * 0.5);
      tmp.lerp(haze, clamp01(aerial) * 0.6);

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
