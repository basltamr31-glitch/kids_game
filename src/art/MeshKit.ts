import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  LatheGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { color } from './Palette';
import { M, bakeContactAO, ensureAO } from './Materials';

/**
 * Procedural model construction.
 *
 * ART STRATEGY (see docs/ASSETS.md)
 * Every model in this game is generated from primitives at runtime: no mesh or
 * texture files, a guaranteed-coherent style, and zero licensing risk.
 *
 * `PartBuilder` accumulates coloured primitives, bakes colour AND ambient
 * occlusion into vertex attributes, and merges them into a SINGLE geometry. A
 * whole chalet ends up as one mesh, one material, one draw call.
 *
 * The AO bake is what makes this approach hold up visually. Without contact
 * darkening at the seams, an assembly of primitives reads as a pile of shapes;
 * with it, it reads as a carved object.
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

export interface BuildOptions {
  /** Bake contact AO from part overlaps. Default true. */
  ao?: boolean;
  aoStrength?: number;
  /** Extra darkening below this Y. Pass the object's footprint height. */
  groundY?: number;
  /**
   * Recompute normals after merging so the result shades smoothly. Use for
   * organic forms (animals, foliage); leave off for architecture, where flat
   * facets are the point.
   */
  smooth?: boolean;
  /** Angle in radians below which smooth shading merges normals. */
  smoothAngle?: number;
}

/** Accumulates coloured primitives and merges them into one geometry. */
export class PartBuilder {
  private parts: BufferGeometry[] = [];
  private boxes: { min: Vector3; max: Vector3 }[] = [];

  add(geometry: BufferGeometry, tint: string, transform: PartTransform = {}): this {
    const geo = geometry.clone();
    applyTransform(geo, transform);
    paint(geo, tint);

    geo.computeBoundingBox();
    if (geo.boundingBox) {
      this.boxes.push({
        min: geo.boundingBox.min.clone(),
        max: geo.boundingBox.max.clone(),
      });
    }

    this.parts.push(geo);
    return this;
  }

  box(w: number, h: number, d: number, tint: string, transform: PartTransform = {}): this {
    return this.add(geoBox(w, h, d), tint, transform);
  }

  /** Box with chamfered edges. Catches light along the bevel — reads as crafted. */
  bevelBox(
    w: number,
    h: number,
    d: number,
    bevel: number,
    tint: string,
    transform: PartTransform = {},
  ): this {
    return this.add(geoBevelBox(w, h, d, bevel), tint, transform);
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

  cone(
    radius: number,
    height: number,
    tint: string,
    transform: PartTransform = {},
    segments = 10,
  ): this {
    return this.add(geoCone(radius, height, segments), tint, transform);
  }

  sphere(radius: number, tint: string, transform: PartTransform = {}, segments = 10): this {
    return this.add(geoSphere(radius, segments), tint, transform);
  }

  capsule(radius: number, length: number, tint: string, transform: PartTransform = {}): this {
    return this.add(geoCapsule(radius, length), tint, transform);
  }

  torus(
    radius: number,
    tube: number,
    tint: string,
    transform: PartTransform = {},
    segments = 10,
  ): this {
    return this.add(geoTorus(radius, tube, segments), tint, transform);
  }

  /** Turned profile, revolved around Y. For bowls, jugs, table legs, posts. */
  lathe(profile: [number, number][], tint: string, transform: PartTransform = {}, segments = 12): this {
    return this.add(geoLathe(profile, segments), tint, transform);
  }

  /** Triangular prism. Every pitched roof and gable in the game. */
  prism(width: number, height: number, length: number, tint: string, transform: PartTransform = {}): this {
    return this.add(geoPrism(width, height, length), tint, transform);
  }

  /** Merge everything added so far into one geometry. Clears the builder. */
  build(options: BuildOptions = {}): BufferGeometry {
    if (this.parts.length === 0) return new BufferGeometry();

    const merged = mergeGeometries(this.parts);
    for (const part of this.parts) part.dispose();

    if (options.smooth) {
      smoothNormals(merged, options.smoothAngle ?? Math.PI / 3);
    }

    if (options.ao !== false) {
      bakeContactAO(merged, this.boxes, {
        strength: options.aoStrength ?? 0.55,
        groundY: options.groundY,
      });
    } else {
      ensureAO(merged);
    }

    this.parts = [];
    this.boxes = [];

    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }

  /** Build and wrap in a Mesh. */
  toMesh(name = '', material?: Material, options: BuildOptions = {}): Mesh {
    const mesh = new Mesh(this.build(options), material ?? M.painted());
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
/* Cached primitive geometries - created once, cloned per use.         */
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
  return cached(`p${r},${len}`, () => new CapsuleGeometry(r, len, 4, 10));
}

/**
 * Two-triangle quad, standing upright in the XY plane.
 *
 * Grass blades and petals are flat cards, and a BoxGeometry spends 12
 * triangles to show 2 of them. At ~5000 tufts that difference is the whole
 * vegetation budget, so foliage uses this and a double-sided material.
 */
export function geoQuad(w: number, h: number): BufferGeometry {
  return cached(`q${w},${h}`, () => {
    const geo = new PlaneGeometry(w, h);
    // Origin at the bottom edge so a blade grows upward from its root.
    geo.translate(0, h / 2, 0);
    return geo;
  });
}

export function geoCircle(r: number, seg = 16): BufferGeometry {
  return cached(`o${r},${seg}`, () => new CircleGeometry(r, seg));
}

export function geoTorus(r: number, tube: number, seg = 10): BufferGeometry {
  return cached(`t${r},${tube},${seg}`, () => new TorusGeometry(r, tube, Math.max(5, seg >> 1), seg));
}

export function geoLathe(profile: [number, number][], seg = 12): BufferGeometry {
  const key = `l${seg}|${profile.map((p) => p.join(',')).join(';')}`;
  return cached(key, () => {
    const points = profile.map(([x, y]) => new Vector2(Math.max(0.0001, x), y));
    return new LatheGeometry(points, seg);
  });
}

/**
 * Chamfered box.
 *
 * Built by scaling three overlapping slabs rather than by true edge geometry:
 * far cheaper, and at this art scale the silhouette and the light catch on the
 * chamfer are all the eye is reading anyway.
 */
export function geoBevelBox(w: number, h: number, d: number, bevel: number): BufferGeometry {
  return cached(`v${w},${h},${d},${bevel}`, () => {
    const b = Math.min(bevel, w / 2.5, h / 2.5, d / 2.5);
    const parts: BufferGeometry[] = [];
    const slab = (sx: number, sy: number, sz: number): void => {
      const g = new BoxGeometry(sx, sy, sz);
      parts.push(g);
    };
    slab(w, h - b * 2, d);
    slab(w - b * 2, h, d);
    slab(w - b * 2, h - b * 2, d + b * 0.9);
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    return merged;
  });
}

/** Triangular prism: width along Z, height along Y, length along X. */
export function geoPrism(width: number, height: number, length: number): BufferGeometry {
  return cached(`r${width},${height},${length}`, () => {
    const hw = width / 2;
    const hl = length / 2;
    const geo = new BufferGeometry();
    const v = [
      -hl, 0, -hw,
      -hl, 0, hw,
      -hl, height, 0,
      hl, 0, -hw,
      hl, 0, hw,
      hl, height, 0,
    ];
    const idx = [
      0, 2, 1,
      3, 4, 5,
      0, 3, 5, 0, 5, 2,
      1, 2, 5, 1, 5, 4,
      0, 1, 4, 0, 4, 3,
    ];
    geo.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo.toNonIndexed();
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
 * The standard foliage trick. Grass blades and petals are vertical planes, so
 * lit normally they catch almost no light from a high sun and read as dark
 * debris scattered on a bright meadow. Shading them with an up normal makes
 * them take the same light as the ground they grow out of.
 */
export function setNormalsUp(geo: BufferGeometry): void {
  const count = geo.attributes.position.count;
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) normals[i * 3 + 1] = 1;
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
}

/**
 * Blends normals between adjacent coplanar-ish faces.
 *
 * Merged primitive assemblies are non-indexed and flat-shaded, which is right
 * for a roof and wrong for a cow. This welds vertices that share a position and
 * whose normals are within `angle`, giving smooth shading over curved regions
 * while keeping hard edges hard.
 */
export function smoothNormals(geo: BufferGeometry, angle = Math.PI / 3): void {
  const position = geo.attributes.position as BufferAttribute;
  const normal = geo.attributes.normal as BufferAttribute;
  const count = position.count;
  const threshold = Math.cos(angle);

  // Bucket vertices by quantised position.
  const buckets = new Map<string, number[]>();
  const q = 1000;
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(position.getX(i) * q)},${Math.round(position.getY(i) * q)},${Math.round(position.getZ(i) * q)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(i);
  }

  const out = new Float32Array(count * 3);
  const n = new Vector3();
  const other = new Vector3();
  const sum = new Vector3();

  for (const list of buckets.values()) {
    if (list.length === 1) {
      const i = list[0];
      out[i * 3] = normal.getX(i);
      out[i * 3 + 1] = normal.getY(i);
      out[i * 3 + 2] = normal.getZ(i);
      continue;
    }
    for (const i of list) {
      n.set(normal.getX(i), normal.getY(i), normal.getZ(i));
      sum.copy(n);
      for (const j of list) {
        if (j === i) continue;
        other.set(normal.getX(j), normal.getY(j), normal.getZ(j));
        if (n.dot(other) >= threshold) sum.add(other);
      }
      sum.normalize();
      out[i * 3] = sum.x;
      out[i * 3 + 1] = sum.y;
      out[i * 3 + 2] = sum.z;
    }
  }

  geo.setAttribute('normal', new BufferAttribute(out, 3));
}

/**
 * Minimal geometry merge.
 *
 * three ships BufferGeometryUtils for this, but it pulls in a large module and
 * handles cases this project never produces. Everything here is non-indexed
 * position/normal/color(/aAO), so a focused merge is smaller and faster.
 */
export function mergeGeometries(geometries: BufferGeometry[]): BufferGeometry {
  const flat = geometries.map((g) => (g.index ? g.toNonIndexed() : g));

  let total = 0;
  for (const g of flat) total += g.attributes.position.count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  let hasAO = false;
  for (const g of flat) if (g.getAttribute('aAO')) hasAO = true;
  const ao = hasAO ? new Float32Array(total) : null;

  let offset = 0;
  for (const g of flat) {
    const p = g.attributes.position as BufferAttribute;
    const n = g.attributes.normal as BufferAttribute | undefined;
    const c = g.attributes.color as BufferAttribute | undefined;
    const a = g.getAttribute('aAO') as BufferAttribute | undefined;
    const count = p.count;

    position.set(p.array as Float32Array, offset * 3);
    if (n) normal.set(n.array as Float32Array, offset * 3);
    if (c) colors.set(c.array as Float32Array, offset * 3);
    else colors.fill(1, offset * 3, (offset + count) * 3);
    if (ao) {
      if (a) ao.set(a.array as Float32Array, offset);
      else ao.fill(1, offset, offset + count);
    }

    offset += count;
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('color', new BufferAttribute(colors, 3));
  if (ao) merged.setAttribute('aAO', new BufferAttribute(ao, 1));

  // toNonIndexed() allocates; release the temporaries we created.
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] !== geometries[i]) flat[i].dispose();
  }

  return merged;
}

export function disposeGeometryCache(): void {
  for (const geo of geoCache.values()) geo.dispose();
  geoCache.clear();
}
