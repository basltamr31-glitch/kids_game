import type { Vector3 } from 'three';

/**
 * What the child cannot walk through.
 *
 * Collision used to be a hand-written list of five axis-aligned boxes inside
 * `Player`, which meant every fence, tree and table built anywhere else in the
 * world was invisible to it — the child walked straight through all of them,
 * and anything new had to be remembered twice. Here the world registers its own
 * obstacles as it builds them, so a thing that exists is a thing you bump into.
 *
 * Three primitives cover everything on this farm:
 *
 *   circle   trees, posts, the well, an animal
 *   box      buildings and furniture, rotated if they are
 *   segment  fence runs, which are long, thin and diagonal
 *
 * A uniform grid keeps the broad phase cheap: with a few hundred colliders a
 * query touches the handful in one cell rather than all of them.
 */

export type ColliderTag = 'building' | 'fence' | 'tree' | 'furniture' | 'prop' | 'animal';

interface CircleCollider {
  kind: 'circle';
  /** Switched off while a door stands open. */
  off?: boolean;
  x: number;
  z: number;
  r: number;
  tag: ColliderTag;
}

interface BoxCollider {
  kind: 'box';
  off?: boolean;
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  /** Rotation about Y, radians. */
  rot: number;
  tag: ColliderTag;
}

interface SegmentCollider {
  kind: 'segment';
  off?: boolean;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  half: number;
  tag: ColliderTag;
}

type Collider = CircleCollider | BoxCollider | SegmentCollider;

/** Grid cell size in metres. Roughly the size of the things being stored. */
const CELL = 4;

function key(cx: number, cz: number): number {
  // Pack two signed cell indices into one number; cheaper than a string key
  // and this is called for every collider in every movement query.
  return (cx + 4096) * 8192 + (cz + 4096);
}

export class CollisionWorld {
  private colliders: Collider[] = [];
  private grid = new Map<number, number[]>();

  /**
   * Movers that change every frame, kept out of the grid.
   *
   * There are under a dozen animals and they never stop moving, so rebuilding
   * their grid cells each frame would cost more than testing them directly.
   */
  private dynamic: CircleCollider[] = [];

  /* ---------------- building ---------------- */

  addCircle(x: number, z: number, r: number, tag: ColliderTag): void {
    this.insert({ kind: 'circle', x, z, r, tag });
  }

  /**
   * Adds a box and returns a handle.
   *
   * The handle exists for things that stop being solid: a door is a wall when
   * it is shut and a gap when it is open, and it is the same object either way.
   */
  addBox(
    x: number,
    z: number,
    halfX: number,
    halfZ: number,
    rot: number,
    tag: ColliderTag,
  ): number {
    return this.insert({ kind: 'box', x, z, halfX, halfZ, rot, tag });
  }

  /**
   * Moves a box collider, re-indexing it.
   *
   * Buildings are constructed at the origin and positioned afterwards, so the
   * parts of them that register colliders need a way to catch up.
   */
  moveBox(handle: number, x: number, z: number): void {
    const c = this.colliders[handle];
    if (!c || c.kind !== 'box') return;
    c.x = x;
    c.z = z;
    // The grid holds indices by cell, so a move means a rebuild. This happens
    // once per door at start-up.
    const all = this.colliders.slice();
    this.colliders = [];
    this.grid.clear();
    for (const collider of all) this.insert(collider);
  }

  /** Turns one collider on or off without rebuilding the index. */
  setEnabled(handle: number, enabled: boolean): void {
    const c = this.colliders[handle];
    if (c) c.off = !enabled;
  }

  addSegment(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    half: number,
    tag: ColliderTag,
  ): void {
    this.insert({ kind: 'segment', x1, z1, x2, z2, half, tag });
  }

  /** Registers each leg of a polyline, as fences and walls are built. */
  addPolyline(points: [number, number][], half: number, tag: ColliderTag): void {
    for (let i = 0; i < points.length - 1; i++) {
      this.addSegment(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], half, tag);
    }
  }

  /** Replaces the moving obstacles. Called once a frame with the animals. */
  setDynamic(circles: { x: number; z: number; r: number }[]): void {
    this.dynamic.length = 0;
    for (const c of circles) {
      this.dynamic.push({ kind: 'circle', x: c.x, z: c.z, r: c.r, tag: 'animal' });
    }
  }

  /**
   * Drops every collider of one kind and rebuilds the index.
   *
   * Trees are seasonal content: they are torn down and re-scattered when the
   * season turns, and their colliders have to follow or the child ends up
   * bumping into trees that are no longer there. Rebuilding the grid is only
   * worth avoiding if it happened often, and this happens once a season.
   */
  clearTag(tag: ColliderTag): void {
    const kept = this.colliders.filter((c) => c.tag !== tag);
    this.colliders = [];
    this.grid.clear();
    for (const c of kept) this.insert(c);
  }

  clear(): void {
    this.colliders.length = 0;
    this.grid.clear();
    this.dynamic.length = 0;
  }

  get size(): number {
    return this.colliders.length;
  }

  private insert(c: Collider): number {
    const index = this.colliders.push(c) - 1;
    const [minX, minZ, maxX, maxZ] = bounds(c);
    const cx0 = Math.floor(minX / CELL);
    const cx1 = Math.floor(maxX / CELL);
    const cz0 = Math.floor(minZ / CELL);
    const cz1 = Math.floor(maxZ / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = key(cx, cz);
        let list = this.grid.get(k);
        if (!list) {
          list = [];
          this.grid.set(k, list);
        }
        list.push(index);
      }
    }
    return index;
  }

  /* ---------------- querying ---------------- */

  /**
   * True when a body of `radius` centred here overlaps anything solid.
   *
   * `ignore` lets a query skip a category — walking up to an animal to pet it
   * has to be allowed to get close to that animal.
   */
  blocks(x: number, z: number, radius: number, ignore?: ColliderTag): boolean {
    const cx0 = Math.floor((x - radius) / CELL);
    const cx1 = Math.floor((x + radius) / CELL);
    const cz0 = Math.floor((z - radius) / CELL);
    const cz1 = Math.floor((z + radius) / CELL);

    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.grid.get(key(cx, cz));
        if (!list) continue;
        for (const index of list) {
          const c = this.colliders[index];
          if (c.off || c.tag === ignore) continue;
          if (overlaps(c, x, z, radius)) return true;
        }
      }
    }

    if (ignore !== 'animal') {
      for (const c of this.dynamic) {
        if (overlaps(c, x, z, radius)) return true;
      }
    }
    return false;
  }

  /**
   * Moves as far along a step as the world allows, sliding along what it hits.
   *
   * Axis separation is deliberate: blocked on X while still free on Z means the
   * child slides along the wall instead of stopping dead against it, which is
   * the difference between a character that feels solid and one that feels
   * stuck. Returned through `out` to keep this allocation-free.
   */
  resolve(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
    out: { x: number; z: number },
    ignore?: ColliderTag,
  ): { x: number; z: number } {
    // Already inside something: let them out. A body that has somehow ended up
    // overlapping geometry — spawned on a fence line, nudged by an animal,
    // teleported by a script — must never be permanently frozen, so while it is
    // penetrating, movement is unrestricted. It stops being free the moment it
    // reaches clear ground, which is the behaviour you want: escape, then obey.
    if (this.blocks(fromX, fromZ, radius, ignore)) {
      out.x = toX;
      out.z = toZ;
      return out;
    }

    if (!this.blocks(toX, toZ, radius, ignore)) {
      out.x = toX;
      out.z = toZ;
      return out;
    }
    if (!this.blocks(toX, fromZ, radius, ignore)) {
      out.x = toX;
      out.z = fromZ;
      return out;
    }
    if (!this.blocks(fromX, toZ, radius, ignore)) {
      out.x = fromX;
      out.z = toZ;
      return out;
    }
    out.x = fromX;
    out.z = fromZ;
    return out;
  }

  /**
   * Nearest point outside everything, searched outward in rings.
   *
   * Used when something is asked to stand somewhere impossible: a tap that
   * lands inside a wall should walk the child as close as it can rather than
   * doing nothing, which is far less confusing for a small child.
   */
  nearestFree(x: number, z: number, radius: number, out: Vector3): boolean {
    if (!this.blocks(x, z, radius)) {
      out.x = x;
      out.z = z;
      return true;
    }
    for (let ring = 1; ring <= 10; ring++) {
      const step = ring * 0.6;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const px = x + Math.cos(a) * step;
        const pz = z + Math.sin(a) * step;
        if (!this.blocks(px, pz, radius)) {
          out.x = px;
          out.z = pz;
          return true;
        }
      }
    }
    return false;
  }
}

/* ------------------------------------------------------------------ */

function bounds(c: Collider): [number, number, number, number] {
  if (c.kind === 'circle') return [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
  if (c.kind === 'segment') {
    return [
      Math.min(c.x1, c.x2) - c.half,
      Math.min(c.z1, c.z2) - c.half,
      Math.max(c.x1, c.x2) + c.half,
      Math.max(c.z1, c.z2) + c.half,
    ];
  }
  // A rotated box's extent, via the absolute rotation matrix.
  const cos = Math.abs(Math.cos(c.rot));
  const sin = Math.abs(Math.sin(c.rot));
  const ex = c.halfX * cos + c.halfZ * sin;
  const ez = c.halfX * sin + c.halfZ * cos;
  return [c.x - ex, c.z - ez, c.x + ex, c.z + ez];
}

function overlaps(c: Collider, x: number, z: number, radius: number): boolean {
  if (c.kind === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    const reach = c.r + radius;
    return dx * dx + dz * dz < reach * reach;
  }

  if (c.kind === 'segment') {
    const dx = c.x2 - c.x1;
    const dz = c.z2 - c.z1;
    const lengthSq = dx * dx + dz * dz;
    let t = lengthSq > 1e-6 ? ((x - c.x1) * dx + (z - c.z1) * dz) / lengthSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x - (c.x1 + dx * t);
    const pz = z - (c.z1 + dz * t);
    const reach = c.half + radius;
    return px * px + pz * pz < reach * reach;
  }

  // Box: into the box's own frame, then a clamped nearest-point test, which
  // handles corners correctly rather than treating them as flat edges.
  const cos = Math.cos(-c.rot);
  const sin = Math.sin(-c.rot);
  const rx = (x - c.x) * cos - (z - c.z) * sin;
  const rz = (x - c.x) * sin + (z - c.z) * cos;
  const clampedX = Math.max(-c.halfX, Math.min(c.halfX, rx));
  const clampedZ = Math.max(-c.halfZ, Math.min(c.halfZ, rz));
  const dx = rx - clampedX;
  const dz = rz - clampedZ;
  return dx * dx + dz * dz < radius * radius;
}
