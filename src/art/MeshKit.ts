import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import { color } from './Palette';
import { M } from './Materials';

/**
 * Procedural model construction.
 *
 * ART STRATEGY (see docs/ASSETS.md)
 * Every model in this game is generated from primitives at runtime. That choice
 * buys three things a downloaded asset pack cannot:
 *   - a guaranteed-coherent style, because one palette drives every surface
 *   - a tiny install (no mesh or texture files at all)
 *   - zero licensing risk; everything here is original work
 *
 * The important trick is `PartBuilder`: it accumulates dozens of coloured
 * primitives, bakes their colour into vertex attributes, and merges them into a
 * SINGLE geometry. A whole chalet — walls, roof, balcony, shutters, flower
 * boxes, chimney — ends up as one mesh, one material, one draw call.
 */

const _matrix = new Matrix4();
const _quat = new Quaternion();
const _euler = new Euler();
const _scale = new Vector3();
const _pos = new Vector3();

export interface PartTransform {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number] | number;
}

/**
 * Accumulates coloured primitives and merges them into one vertex-painted
 * geometry.
 */
export class PartBuilder {
  private parts: BufferGeometry[] = [];

  add(geometry: BufferGeometry, tint: string, transform: PartTransform = {}): this {
    const geo = geometry.clone();
    applyTransform(geo, transform);
    paint(geo, tint);
    this.parts.push(geo);
    // The source geometry is owned by the caller / cache; only dispose clones.
    return this;
  }

  /** Axis-aligned box centred on `pos`. */
  box(
    w: number,
    h: number,
    d: number,
    tint: string,
    transform: PartTransform = {},
  ): this {
    return this.add(geoBox(w, h, d), tint, transform);
  }

  cylinder(
    radiusTop: number,
    radiusBottom: number,
    height: number,
    tint: string,
    transform: PartTransform = {},
    segments = 10,
  ): this {
    return this.add(geoCylinder(radiusTop, radiusBottom, height, segments), tint, transform);
  }

  cone(radius: number, height: number, tint: string, transform: PartTransform = {}, segments = 10): this {
    return this.add(geoCone(radius, height, segments), tint, transform);
  }

  sphere(radius: number, tint: string, transform: PartTransform = {}, segments = 10): this {
    return this.add(geoSphere(radius, segments), tint, transform);
  }

  capsule(radius: number, length: number, tint: string, transform: PartTransform = {}): this {
    return this.add(geoCapsule(radius, length), tint, transform);
  }

  /**
   * Triangular prism, used for every pitched roof and gable in the game.
   * Length runs along X, the ridge along X at the top.
   */
  prism(
    width: number,
    height: number,
    length: number,
    tint: string,
    transform: PartTransform = {},
  ): this {
    return this.add(geoPrism(width, height, length), tint, transform);
  }

  /** Merge everything added so far into one geometry. Clears the builder. */
  build(): BufferGeometry {
    if (this.parts.length === 0) return new BufferGeometry();
    const merged = mergeGeometries(this.parts);
    for (const part of this.parts) part.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }

  /** Build and wrap in a Mesh using the shared vertex-painted material. */
  toMesh(name = '', material?: Material): Mesh {
    const mesh = new Mesh(this.build(), material ?? M.vertexPainted());
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }
}

/* ------------------------------------------------------------------ */
/* Cached primitive geometries — created once, cloned per use.         */
/* ------------------------------------------------------------------ */

const geoCache = new Map<string, BufferGeometry>();

function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let hit = geoCache.get(key);
  if (!hit) {
    hit = make();
    geoCache.set(key, hit);
  }
  return hit;
}

export function geoBox(w: number, h: number, d: number): BufferGeometry {
  return cached(`b${w},${h},${d}`, () => new BoxGeometry(w, h, d));
}

export function geoCylinder(rt: number, rb: number, h: number, seg = 10): BufferGeometry {
  return cached(`c${rt},${rb},${h},${seg}`, () => new CylinderGeometry(rt, rb, h, seg));
}

export function geoCone(r: number, h: number, seg = 10): BufferGeometry {
  return cached(`k${r},${h},${seg}`, () => new ConeGeometry(r, h, seg));
}

export function geoSphere(r: number, seg = 10): BufferGeometry {
  return cached(`s${r},${seg}`, () => new SphereGeometry(r, seg, Math.max(6, seg >> 1)));
}

export function geoCapsule(r: number, len: number): BufferGeometry {
  return cached(`p${r},${len}`, () => new CapsuleGeometry(r, len, 3, 8));
}

export function geoCircle(r: number, seg = 16): BufferGeometry {
  return cached(`o${r},${seg}`, () => new CircleGeometry(r, seg));
}

/** Triangular prism: width along Z, height along Y, length along X. */
export function geoPrism(width: number, height: number, length: number): BufferGeometry {
  return cached(`r${width},${height},${length}`, () => {
    const hw = width / 2;
    const hl = length / 2;
    const geo = new BufferGeometry();
    // 6 vertices: two triangles (the gable ends) joined by three quads.
    const v = [
      // left gable (x = -hl)
      -hl, 0, -hw, // 0
      -hl, 0, hw, // 1
      -hl, height, 0, // 2
      // right gable (x = +hl)
      hl, 0, -hw, // 3
      hl, 0, hw, // 4
      hl, height, 0, // 5
    ];
    const idx = [
      // gable ends
      0, 2, 1,
      3, 4, 5,
      // back slope
      0, 3, 5, 0, 5, 2,
      // front slope
      1, 2, 5, 1, 5, 4,
      // underside
      0, 1, 4, 0, 4, 3,
    ];
    geo.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo.toNonIndexed(); // flat shading suits the stylized look
  });
}

/* ------------------------------------------------------------------ */

function applyTransform(geo: BufferGeometry, t: PartTransform): void {
  const s = t.scale ?? 1;
  _pos.set(...(t.pos ?? [0, 0, 0]));
  _euler.set(...(t.rot ?? [0, 0, 0]));
  _quat.setFromEuler(_euler);
  if (typeof s === 'number') _scale.set(s, s, s);
  else _scale.set(...s);
  _matrix.compose(_pos, _quat, _scale);
  geo.applyMatrix4(_matrix);
}

/** Bakes a flat colour into a `color` vertex attribute. */
export function paint(geo: BufferGeometry, tint: string): void {
  const c = color(tint);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

/**
 * Forces every normal to point straight up.
 *
 * The standard foliage trick. Grass blades and flower petals are vertical
 * planes, so lit normally they catch almost no light from a high sun and read
 * as dark debris scattered on a bright meadow. Shading them with an up normal
 * makes them take the same light as the ground they grow out of, which is both
 * what the eye expects and what every stylized game does.
 */
export function setNormalsUp(geo: BufferGeometry): void {
  const count = geo.attributes.position.count;
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) normals[i * 3 + 1] = 1;
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
}

/** Paints each vertex by a callback of its local position — for gradients. */
export function paintByHeight(
  geo: BufferGeometry,
  lowTint: string,
  highTint: string,
  minY: number,
  maxY: number,
): void {
  const low = color(lowTint);
  const high = color(highTint);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const span = Math.max(1e-5, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - minY) / span));
    colors[i * 3] = low.r + (high.r - low.r) * t;
    colors[i * 3 + 1] = low.g + (high.g - low.g) * t;
    colors[i * 3 + 2] = low.b + (high.b - low.b) * t;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

/**
 * Minimal geometry merge.
 *
 * three ships BufferGeometryUtils for this, but it pulls in a large module and
 * handles cases (morph targets, groups, interleaved buffers) this project never
 * produces. Everything here is non-indexed position/normal/color, so a focused
 * 30-line merge is both smaller and faster.
 */
export function mergeGeometries(geometries: BufferGeometry[]): BufferGeometry {
  const flat = geometries.map((g) => (g.index ? g.toNonIndexed() : g));

  let total = 0;
  for (const g of flat) total += g.attributes.position.count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);

  let offset = 0;
  for (const g of flat) {
    const p = g.attributes.position as BufferAttribute;
    const n = g.attributes.normal as BufferAttribute | undefined;
    const c = g.attributes.color as BufferAttribute | undefined;
    const count = p.count;

    position.set(p.array as Float32Array, offset * 3);
    if (n) normal.set(n.array as Float32Array, offset * 3);
    if (c) colors.set(c.array as Float32Array, offset * 3);
    else colors.fill(1, offset * 3, (offset + count) * 3);

    offset += count;
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('color', new BufferAttribute(colors, 3));
  return merged;
}

/** Releases the primitive cache. Called on teardown only. */
export function disposeGeometryCache(): void {
  for (const geo of geoCache.values()) geo.dispose();
  geoCache.clear();
}
