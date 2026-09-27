import { Group, Mesh, Vector3 } from 'three';
import { PartBuilder } from '../art/MeshKit';
import { M, surface } from '../art/Materials';
import type { FarmFeature } from '../content/Milestones';
import type { BuiltWorld } from './WorldBuilder';
import { LAYOUT } from './Layout';

/**
 * Things that appear on the farm as the child earns hearts.
 *
 * The farm growing is the part of progression a child can actually see: come
 * back tomorrow and the swing Dad promised is hanging in the yard. Each
 * feature is a small hand-assembled prop placed near a fixed spot, nudged to
 * the nearest clear ground so a tree or a fence planted there by the seed can
 * never swallow it, and registered as solid so the child walks round it.
 */

interface Placement {
  /** Preferred ground position. */
  x: number;
  z: number;
  /** Yaw, radians. */
  yaw: number;
  /** Solid footprint radius; 0 = walk-through. */
  radius: number;
}

const h = LAYOUT.house;

const PLACEMENTS: Record<FarmFeature, Placement> = {
  // In the yard between the house and the coop, where the child passes often.
  swing: { x: -10.5, z: 13.5, yaw: 0.35, radius: 1.3 },
  // Beside the porch, looking down the valley.
  bench: { x: h.x + 5.2, z: h.z + 8.4, yaw: 0.1, radius: 0.9 },
  // A post at the corner of the vegetable garden.
  birdhouse: { x: LAYOUT.garden.x + 5.2, z: LAYOUT.garden.z - 1.6, yaw: -0.6, radius: 0.35 },
  // Standing guard over the garden beds.
  scarecrow: { x: LAYOUT.garden.x - 4.6, z: LAYOUT.garden.z + 2.4, yaw: 0.4, radius: 0.45 },
  // Along the path from the porch to the yard (placed per post, see below).
  lanterns: { x: h.x + 7, z: h.z + 9.5, yaw: 0, radius: 0 },
};

export class FarmFeatures {
  private built = new Map<FarmFeature, Group>();
  private swingSeat: Group | null = null;
  private time = 0;

  constructor(private world: BuiltWorld) {}

  /** Adds whatever is unlocked and not yet built. Returns what was new. */
  sync(unlocked: readonly FarmFeature[]): FarmFeature[] {
    const added: FarmFeature[] = [];
    for (const feature of unlocked) {
      if (this.built.has(feature)) continue;
      this.build(feature);
      added.push(feature);
    }
    if (added.length > 0) this.world.nav.rebuild();
    return added;
  }

  /** Where a feature stands, for the camera to look at when it appears. */
  positionOf(feature: FarmFeature): Vector3 | null {
    return this.built.get(feature)?.position.clone() ?? null;
  }

  update(dt: number): void {
    this.time += dt;
    // An empty swing still moves a little in the breeze.
    if (this.swingSeat) this.swingSeat.rotation.x = Math.sin(this.time * 1.3) * 0.08;
  }

  private build(feature: FarmFeature): void {
    const spot = PLACEMENTS[feature];
    const group = feature === 'lanterns' ? this.buildLanterns() : new Group();
    if (feature !== 'lanterns') {
      const at = this.clearSpot(spot.x, spot.z, Math.max(spot.radius, 0.4));
      group.position.set(at.x, this.world.terrain.heightAt(at.x, at.z), at.z);
      group.rotation.y = spot.yaw;
      group.add(this.mesh(feature));
      if (spot.radius > 0) this.world.collision.addCircle(at.x, at.z, spot.radius, 'prop');
    }
    group.name = `farm-${feature}`;
    this.world.root.add(group);
    this.built.set(feature, group);
  }

  private clearSpot(x: number, z: number, radius: number): Vector3 {
    const collision = this.world.collision;
    if (!collision.blocks(x, z, radius)) return new Vector3(x, 0, z);
    for (let ring = 1; ring <= 12; ring++) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const px = x + Math.sin(a) * ring * 0.5;
        const pz = z + Math.cos(a) * ring * 0.5;
        if (!collision.blocks(px, pz, radius)) return new Vector3(px, 0, pz);
      }
    }
    return new Vector3(x, 0, z);
  }

  private mesh(feature: FarmFeature): Group {
    const group = new Group();
    const b = new PartBuilder();
    switch (feature) {
      case 'swing': {
        // A-frame with a crossbar, and a seat on two ropes that sways.
        for (const side of [-1, 1]) {
          b.bevelBox(0.14, 2.7, 0.14, 0.03, 'woodMid', { pos: [side * 1.1, 1.3, 0.55], rot: [0.38, 0, 0] });
          b.bevelBox(0.14, 2.7, 0.14, 0.03, 'woodMid', { pos: [side * 1.1, 1.3, -0.55], rot: [-0.38, 0, 0] });
        }
        b.cylinder(0.08, 0.08, 2.5, 'woodDark', { pos: [0, 2.55, 0], rot: [0, 0, Math.PI / 2] }, 8);
        group.add(b.toMesh('swing-frame', M.built('wood', 1.6), { groundY: 0 }));

        const seat = new Group();
        seat.position.y = 2.5;
        const s = new PartBuilder();
        for (const side of [-1, 1]) {
          s.cylinder(0.018, 0.018, 1.95, 'hayDark', { pos: [side * 0.34, -0.98, 0] }, 5);
        }
        s.bevelBox(0.85, 0.07, 0.34, 0.02, 'woodWarm', { pos: [0, -1.97, 0] });
        seat.add(s.toMesh('swing-seat', M.built('wood', 2.0)));
        group.add(seat);
        this.swingSeat = seat;
        return group;
      }
      case 'bench': {
        b.bevelBox(1.7, 0.08, 0.46, 0.02, 'woodWarm', { pos: [0, 0.46, 0] });
        b.bevelBox(1.7, 0.3, 0.06, 0.02, 'woodWarm', { pos: [0, 0.78, -0.22], rot: [-0.15, 0, 0] });
        for (const side of [-1, 1]) {
          b.bevelBox(0.08, 0.46, 0.4, 0.02, 'woodDark', { pos: [side * 0.72, 0.23, 0] });
          b.bevelBox(0.06, 0.06, 0.44, 0.015, 'woodDark', { pos: [side * 0.8, 0.64, 0] });
        }
        // A cushion and a pot of flowers keep it from reading as park furniture.
        b.bevelBox(0.5, 0.08, 0.38, 0.04, 'flowerBoxRed', { pos: [-0.45, 0.54, 0.02] });
        b.cylinder(0.14, 0.11, 0.24, 'roofTile', { pos: [1.15, 0.12, 0.1] }, 10);
        for (let i = 0; i < 5; i++) {
          b.sphere(0.07, i % 2 ? 'meadowFlowerA' : 'meadowFlowerB', {
            pos: [1.15 + Math.sin(i * 1.3) * 0.08, 0.3 + (i % 3) * 0.03, 0.1 + Math.cos(i * 1.3) * 0.08],
          }, 6);
        }
        group.add(b.toMesh('bench', M.built('wood', 2.0), { groundY: 0 }));
        return group;
      }
      case 'birdhouse': {
        b.bevelBox(0.1, 1.9, 0.1, 0.02, 'woodDark', { pos: [0, 0.95, 0] });
        b.bevelBox(0.42, 0.42, 0.38, 0.03, 'shutterAlt', { pos: [0, 2.08, 0] });
        b.prism(0.54, 0.24, 0.48, 'roofTile', { pos: [0, 2.4, 0] });
        b.cylinder(0.075, 0.075, 0.03, 'woodDark', { pos: [0, 2.12, 0.2], rot: [Math.PI / 2, 0, 0] }, 10);
        b.cylinder(0.015, 0.015, 0.12, 'woodMid', { pos: [0, 1.98, 0.25], rot: [Math.PI / 2, 0, 0] }, 5);
        // A bird at home.
        b.sphere(0.06, 'chickenBrown', { pos: [0.1, 2.63, 0.05], scale: [1.2, 1, 1] }, 7);
        b.cone(0.02, 0.05, 'chickenBeak', { pos: [0.18, 2.64, 0.05], rot: [0, 0, -Math.PI / 2] }, 5);
        group.add(b.toMesh('birdhouse', M.built('wood', 2.2), { groundY: 0 }));
        return group;
      }
      case 'scarecrow': {
        b.bevelBox(0.08, 1.8, 0.08, 0.02, 'woodDark', { pos: [0, 0.9, 0] });
        b.bevelBox(1.4, 0.07, 0.07, 0.02, 'woodDark', { pos: [0, 1.35, 0] });
        // Patched shirt and straw hands.
        b.bevelBox(0.6, 0.62, 0.3, 0.08, 'shutter', { pos: [0, 1.2, 0] });
        b.box(0.16, 0.16, 0.02, 'flowerBoxRed', { pos: [0.12, 1.1, 0.16] });
        for (const side of [-1, 1]) {
          b.cone(0.07, 0.2, 'hay', { pos: [side * 0.8, 1.35, 0], rot: [0, 0, side * Math.PI / 2] }, 6);
        }
        // Sack head with a stitched smile, and a hat.
        b.sphere(0.24, 'hay', { pos: [0, 1.72, 0] }, 10);
        b.sphere(0.03, 'woodDark', { pos: [-0.08, 1.76, 0.21] }, 5);
        b.sphere(0.03, 'woodDark', { pos: [0.08, 1.76, 0.21] }, 5);
        b.box(0.14, 0.02, 0.02, 'woodDark', { pos: [0, 1.64, 0.22] });
        b.cylinder(0.42, 0.42, 0.03, 'hayDark', { pos: [0, 1.92, 0] }, 14);
        b.cylinder(0.2, 0.24, 0.24, 'hayDark', { pos: [0, 2.04, 0] }, 12);
        group.add(b.toMesh('scarecrow', M.built('wood', 2.0), { groundY: 0 }));
        return group;
      }
      default:
        return group;
    }
  }

  /** Five lantern posts along the path from the porch to the yard. */
  private buildLanterns(): Group {
    const group = new Group();
    const from = new Vector3(h.x + 4, 0, h.z + 9.5);
    const to = new Vector3(LAYOUT.yardCentre.x - 3.5, 0, LAYOUT.yardCentre.z + 1.5);
    const post = new PartBuilder();
    post.bevelBox(0.09, 1.7, 0.09, 0.02, 'woodDark', { pos: [0, 0.85, 0] });
    post.bevelBox(0.34, 0.05, 0.08, 0.015, 'woodDark', { pos: [0.13, 1.66, 0] });
    post.cylinder(0.12, 0.12, 0.03, 'metalDark', { pos: [0.26, 1.52, 0] }, 8);
    post.cone(0.14, 0.12, 'metalDark', { pos: [0.26, 1.33, 0] }, 8);
    const postGeometry = post.build({ groundY: 0 });
    const glass = surface({ tint: '#FFE3A0', emissive: '#FFB347', emissiveIntensity: 0.9, rim: 0 });
    const postMaterial = M.built('wood', 2.0);

    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t + Math.sin(t * Math.PI) * 1.2;
      const lamp = new Group();
      lamp.position.set(x, this.world.terrain.heightAt(x, z), z);
      lamp.rotation.y = i % 2 ? Math.PI : 0;
      const pole = new Mesh(postGeometry, postMaterial);
      pole.castShadow = true;
      lamp.add(pole);
      const light = new PartBuilder();
      light.bevelBox(0.18, 0.2, 0.18, 0.03, '#FFFFFF', { pos: [0.26, 1.4, 0] });
      lamp.add(new Mesh(light.build(), glass));
      group.add(lamp);
      this.world.collision.addCircle(x, z, 0.18, 'prop');
    }
    return group;
  }
}
