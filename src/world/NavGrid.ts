import { Vector3 } from 'three';
import type { CollisionWorld } from './Collision';
import type { Terrain } from './Terrain';

/**
 * Finding a way round things.
 *
 * Collision on its own only stops the child walking through a fence; it does
 * nothing to help them get past it. Walking in a straight line at a target and
 * sliding along whatever you hit works against a long wall and fails against
 * anything convex — the child wedges on the corner of the well and stays there
 * until the activity times out.
 *
 * So: a coarse occupancy grid over the farm, and A* across it. Paths are only
 * computed when the child is told to go somewhere, which is a few times a
 * minute, so the cost is irrelevant and the robustness is worth a great deal.
 *
 * The grid also replaces the hand-placed waypoints either side of the front
 * door. The house is registered as walls with a gap, so a route through the
 * doorway is something the search finds on its own rather than something the
 * code has to know about.
 */

/** Half-width of the area the child can reach, in metres. */
const EXTENT = 72;
/** Cell size. Small enough to resolve a doorway, large enough to stay cheap. */
const CELL = 0.6;
const DIM = Math.ceil((EXTENT * 2) / CELL);

/** Clearance the grid is built for: the child's body plus a little room. */
const CLEARANCE = 0.3;

export class NavGrid {
  private blocked: Uint8Array;
  private collision: CollisionWorld;
  private terrain: Terrain;

  /* A* working set, allocated once and reused. */
  private cameFrom: Int32Array;
  private gScore: Float32Array;
  private closed: Uint8Array;
  private openHeap: Int32Array;
  private openScore: Float32Array;
  private openCount = 0;
  private stamp: Int32Array;
  private generation = 0;

  constructor(collision: CollisionWorld, terrain: Terrain) {
    this.collision = collision;
    this.terrain = terrain;
    const size = DIM * DIM;
    this.blocked = new Uint8Array(size);
    this.cameFrom = new Int32Array(size);
    this.gScore = new Float32Array(size);
    this.closed = new Uint8Array(size);
    this.stamp = new Int32Array(size);
    this.openHeap = new Int32Array(size);
    this.openScore = new Float32Array(size);
    this.rebuild();
  }

  /**
   * Re-tests every cell. Called at start-up and whenever the world's static
   * obstacles change, which in practice means a change of season re-scattering
   * the trees.
   */
  rebuild(): void {
    for (let iz = 0; iz < DIM; iz++) {
      for (let ix = 0; ix < DIM; ix++) {
        const x = this.worldX(ix);
        const z = this.worldZ(iz);
        const solid =
          !this.terrain.isWalkable(x, z) || this.collision.blocks(x, z, CLEARANCE, 'animal');
        this.blocked[iz * DIM + ix] = solid ? 1 : 0;
      }
    }
  }

  /**
   * Re-tests one rectangle of cells.
   *
   * A door opening changes a few square metres, and rebuilding the whole grid
   * for that would be silly. Bounds are in world metres.
   */
  refreshArea(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const ix0 = Math.max(0, this.cellX(minX));
    const ix1 = Math.min(DIM - 1, this.cellX(maxX));
    const iz0 = Math.max(0, this.cellZ(minZ));
    const iz1 = Math.min(DIM - 1, this.cellZ(maxZ));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = this.worldX(ix);
        const z = this.worldZ(iz);
        const solid =
          !this.terrain.isWalkable(x, z) || this.collision.blocks(x, z, CLEARANCE, 'animal');
        this.blocked[iz * DIM + ix] = solid ? 1 : 0;
      }
    }
  }

  private worldX(ix: number): number {
    return ix * CELL - EXTENT + CELL * 0.5;
  }

  private worldZ(iz: number): number {
    return iz * CELL - EXTENT + CELL * 0.5;
  }

  private cellX(x: number): number {
    return Math.floor((x + EXTENT) / CELL);
  }

  private cellZ(z: number): number {
    return Math.floor((z + EXTENT) / CELL);
  }

  private inside(ix: number, iz: number): boolean {
    return ix >= 0 && iz >= 0 && ix < DIM && iz < DIM;
  }

  isBlockedCell(x: number, z: number): boolean {
    const ix = this.cellX(x);
    const iz = this.cellZ(z);
    if (!this.inside(ix, iz)) return true;
    return this.blocked[iz * DIM + ix] === 1;
  }

  /**
   * Nearest open cell to a point, searched in rings.
   *
   * Both ends of a request routinely land inside something: a tap on a wall, or
   * a stand-point computed a little too close to the object it belongs to.
   * Snapping beats refusing.
   */
  private nearestOpen(x: number, z: number): number {
    const ix = this.cellX(x);
    const iz = this.cellZ(z);
    if (this.inside(ix, iz) && this.blocked[iz * DIM + ix] === 0) return iz * DIM + ix;
    for (let ring = 1; ring <= 20; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const nx = ix + dx;
          const nz = iz + dz;
          if (!this.inside(nx, nz)) continue;
          if (this.blocked[nz * DIM + nx] === 0) return nz * DIM + nx;
        }
      }
    }
    return -1;
  }

  /**
   * A route from `from` to `to`, written into `out` as world-space waypoints.
   *
   * Returns false when there is no route at all, in which case the caller
   * should fall back to walking straight at the target: refusing to move is
   * always the wrong answer for a small child.
   */
  findPath(from: Vector3, to: Vector3, out: Vector3[]): boolean {
    out.length = 0;

    const startIndex = this.nearestOpen(from.x, from.z);
    const goalIndex = this.nearestOpen(to.x, to.z);
    if (startIndex < 0 || goalIndex < 0) return false;
    if (startIndex === goalIndex) {
      out.push(to.clone());
      return true;
    }

    this.generation++;
    this.openCount = 0;
    this.pushOpen(startIndex, 0);
    this.gScore[startIndex] = 0;
    this.cameFrom[startIndex] = -1;
    this.stamp[startIndex] = this.generation;
    this.closed[startIndex] = 0;

    const goalX = goalIndex % DIM;
    const goalZ = Math.floor(goalIndex / DIM);

    let found = false;
    let guard = 0;
    while (this.openCount > 0 && guard++ < 60000) {
      const current = this.popOpen();
      if (current === goalIndex) {
        found = true;
        break;
      }
      if (this.closed[current] === 1 && this.stamp[current] === this.generation) continue;
      this.closed[current] = 1;
      this.stamp[current] = this.generation;

      const cx = current % DIM;
      const cz = Math.floor(current / DIM);

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.inside(nx, nz)) continue;
          const neighbour = nz * DIM + nx;
          if (this.blocked[neighbour] === 1) continue;
          // No cutting corners diagonally past a blocked cell, or the child
          // clips the corner of a building on the way round it.
          if (dx !== 0 && dz !== 0) {
            if (this.blocked[cz * DIM + nx] === 1 || this.blocked[nz * DIM + cx] === 1) continue;
          }
          const step = dx !== 0 && dz !== 0 ? 1.41421356 : 1;
          const tentative =
            (this.stamp[current] === this.generation ? this.gScore[current] : 0) + step;
          const seen = this.stamp[neighbour] === this.generation;
          if (seen && tentative >= this.gScore[neighbour]) continue;
          this.stamp[neighbour] = this.generation;
          this.gScore[neighbour] = tentative;
          this.cameFrom[neighbour] = current;
          this.closed[neighbour] = 0;
          const h = Math.hypot(nx - goalX, nz - goalZ);
          this.pushOpen(neighbour, tentative + h * 1.02);
        }
      }
    }

    if (!found) return false;

    // Walk the parent chain back, then smooth it: a grid path is a staircase,
    // and a child walking a staircase looks like a chess piece.
    const raw: number[] = [];
    let node = goalIndex;
    while (node !== -1) {
      raw.push(node);
      node = this.cameFrom[node];
    }
    raw.reverse();

    const points: Vector3[] = raw.map((index) =>
      new Vector3(this.worldX(index % DIM), 0, this.worldZ(Math.floor(index / DIM))),
    );
    // The true destination, not the centre of its cell.
    points[points.length - 1] = to.clone();

    let i = 0;
    while (i < points.length) {
      // Reach as far ahead as there is a clear straight line to.
      let furthest = i + 1;
      for (let j = points.length - 1; j > i; j--) {
        if (this.clearLine(points[i], points[j])) {
          furthest = j;
          break;
        }
      }
      out.push(points[furthest].clone());
      i = furthest;
      if (furthest === points.length - 1) break;
    }
    return out.length > 0;
  }

  /** Samples along a segment to see whether it is walkable end to end. */
  private clearLine(a: Vector3, b: Vector3): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    const steps = Math.ceil(distance / (CELL * 0.6));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isBlockedCell(a.x + dx * t, a.z + dz * t)) return false;
    }
    return true;
  }

  /* ---------------- binary heap ---------------- */

  private pushOpen(index: number, score: number): void {
    let i = this.openCount++;
    this.openHeap[i] = index;
    this.openScore[i] = score;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.openScore[parent] <= this.openScore[i]) break;
      this.swapOpen(parent, i);
      i = parent;
    }
  }

  private popOpen(): number {
    const top = this.openHeap[0];
    this.openCount--;
    if (this.openCount > 0) {
      this.openHeap[0] = this.openHeap[this.openCount];
      this.openScore[0] = this.openScore[this.openCount];
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.openCount && this.openScore[left] < this.openScore[smallest]) smallest = left;
        if (right < this.openCount && this.openScore[right] < this.openScore[smallest]) smallest = right;
        if (smallest === i) break;
        this.swapOpen(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swapOpen(a: number, b: number): void {
    const hi = this.openHeap[a];
    this.openHeap[a] = this.openHeap[b];
    this.openHeap[b] = hi;
    const si = this.openScore[a];
    this.openScore[a] = this.openScore[b];
    this.openScore[b] = si;
  }
}
