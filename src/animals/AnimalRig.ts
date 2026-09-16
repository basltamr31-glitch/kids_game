import { Group, Mesh, Object3D } from 'three';
import { PartBuilder } from '../art/MeshKit';
import { damp, type Rng } from '../core/Rng';
import type { AnimalDefinition, AnimalKind } from '../content/Types';

/**
 * Animal rigs.
 *
 * Same idea as the humanoid rig: a small joint tree with procedural poses. Each
 * species gets its own body function and its own idle rhythm, because a cow
 * that idles like a chicken instantly breaks the spell.
 */

export type AnimalClip = 'idle' | 'walk' | 'eat' | 'drink' | 'sleep' | 'happy' | 'alert';

interface AnimalJoints {
  root: Group;
  body: Group;
  head: Group;
  neck: Group;
  tail: Group;
  legs: Group[];
  /** Where a "💛" bubble is anchored. */
  emoteAnchor: Object3D;
}

export class AnimalRig {
  readonly group = new Group();
  readonly joints: AnimalJoints;
  readonly kind: AnimalKind;

  private clip: AnimalClip = 'idle';
  private time = 0;
  private phase: number;
  private bodyHeight: number;

  constructor(definition: AnimalDefinition, rng: Rng) {
    this.kind = definition.kind;
    this.phase = rng.range(0, Math.PI * 2); // desync identical species

    const root = new Group();
    const body = new Group();
    const neck = new Group();
    const head = new Group();
    const tail = new Group();
    const emoteAnchor = new Object3D();
    const legs: Group[] = [];

    root.add(body);
    body.add(neck, tail);
    neck.add(head);
    head.add(emoteAnchor);

    switch (definition.kind) {
      case 'cow':
        this.bodyHeight = 1.05;
        buildCow(body, neck, head, tail, legs, definition);
        break;
      case 'sheep':
        this.bodyHeight = 0.62;
        buildSheep(body, neck, head, tail, legs, definition);
        break;
      case 'chicken':
        this.bodyHeight = 0.3;
        buildChicken(body, neck, head, tail, legs, definition);
        break;
      default:
        this.bodyHeight = 0.8;
        buildSheep(body, neck, head, tail, legs, definition);
        break;
    }

    for (const leg of legs) body.add(leg);
    emoteAnchor.position.y = 0.45;

    body.position.y = this.bodyHeight;
    root.scale.setScalar(definition.scale);

    this.joints = { root, body, head, neck, tail, legs, emoteAnchor };
    this.group.add(root);
    this.group.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  play(clip: AnimalClip): void {
    if (this.clip === clip) return;
    this.clip = clip;
    this.time = 0;
  }

  get currentClip(): AnimalClip {
    return this.clip;
  }

  update(dt: number, speed = 0): void {
    this.time += dt;
    const t = this.time + this.phase;
    const j = this.joints;
    const k = 12;

    let bodyY = this.bodyHeight;
    let bodyPitch = 0;
    let neckPitch = 0;
    let headPitch = 0;
    let headRoll = 0;
    let tailSwing = 0;
    let legSwing = 0;

    switch (this.clip) {
      case 'walk': {
        const cadence = t * (4 + speed * 3);
        legSwing = Math.sin(cadence) * 0.55;
        bodyY += Math.abs(Math.sin(cadence * 2)) * 0.035;
        bodyPitch = Math.sin(cadence * 2) * 0.03;
        neckPitch = Math.sin(cadence) * 0.06;
        tailSwing = Math.sin(cadence * 0.8) * 0.3;
        break;
      }
      case 'eat': {
        neckPitch = 0.95 + Math.sin(t * 5) * 0.09;
        headPitch = 0.35;
        headRoll = Math.sin(t * 7) * 0.09;
        tailSwing = Math.sin(t * 2.4) * 0.35;
        break;
      }
      case 'drink': {
        neckPitch = 1.15;
        headPitch = 0.28;
        bodyY -= 0.02;
        tailSwing = Math.sin(t * 1.8) * 0.16;
        break;
      }
      case 'sleep': {
        bodyY -= this.bodyHeight * 0.45;
        neckPitch = 0.5;
        headRoll = 0.3;
        bodyPitch = Math.sin(t * 0.9) * 0.02; // breathing
        break;
      }
      case 'happy': {
        // A little bounce and a wagging tail — unmistakable to a small child.
        bodyY += Math.abs(Math.sin(t * 7)) * 0.13;
        neckPitch = -0.2 + Math.sin(t * 7) * 0.12;
        headRoll = Math.sin(t * 9) * 0.18;
        tailSwing = Math.sin(t * 12) * 0.6;
        legSwing = Math.sin(t * 7) * 0.12;
        break;
      }
      case 'alert': {
        neckPitch = -0.3;
        headPitch = -0.15;
        headRoll = Math.sin(t * 2.2) * 0.22;
        tailSwing = Math.sin(t * 3) * 0.2;
        break;
      }
      default: {
        // Idle: slow breathing, occasional ear/head flick, lazy tail.
        bodyY += Math.sin(t * 1.3) * 0.012;
        neckPitch = 0.12 + Math.sin(t * 0.7) * 0.06;
        headRoll = Math.sin(t * 0.45) * 0.1;
        headPitch = Math.sin(t * 0.9) * 0.04;
        tailSwing = Math.sin(t * 1.6) * 0.22;
        break;
      }
    }

    j.body.position.y = damp(j.body.position.y, bodyY, k, dt);
    j.body.rotation.x = damp(j.body.rotation.x, bodyPitch, k, dt);
    j.neck.rotation.x = damp(j.neck.rotation.x, neckPitch, k, dt);
    j.head.rotation.x = damp(j.head.rotation.x, headPitch, k, dt);
    j.head.rotation.z = damp(j.head.rotation.z, headRoll, k, dt);
    j.tail.rotation.z = damp(j.tail.rotation.z, tailSwing, k, dt);

    for (let i = 0; i < j.legs.length; i++) {
      // Diagonal gait: front-left moves with back-right.
      const sign = i === 0 || i === 3 ? 1 : -1;
      j.legs[i].rotation.x = damp(j.legs[i].rotation.x, legSwing * sign, k, dt);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Species geometry                                                    */
/* ------------------------------------------------------------------ */

function buildCow(
  body: Group,
  neck: Group,
  head: Group,
  tail: Group,
  legs: Group[],
  definition: AnimalDefinition,
): void {
  const spot = definition.colorVariant === 0 ? 'cowSpot' : 'cowSpotBrown';

  const b = new PartBuilder();
  b.box(0.95, 0.82, 1.75, 'cowBody', { pos: [0, 0, 0] });
  // Rounded shoulders and rump so it is not a crate.
  b.sphere(0.46, 'cowBody', { pos: [0, 0.05, 0.8], scale: [1.02, 0.95, 0.8] }, 10);
  b.sphere(0.48, 'cowBody', { pos: [0, 0.05, -0.8], scale: [1.02, 0.95, 0.85] }, 10);
  // Markings — the thing that makes a cow read as a cow at a glance.
  b.sphere(0.3, spot, { pos: [0.4, 0.2, 0.35], scale: [0.6, 0.9, 1.25] }, 8);
  b.sphere(0.26, spot, { pos: [-0.44, 0.05, -0.2], scale: [0.5, 1.1, 1.0] }, 8);
  b.sphere(0.22, spot, { pos: [0.3, -0.2, -0.65], scale: [0.7, 0.8, 1.0] }, 8);
  b.sphere(0.2, 'cowUdder', { pos: [0, -0.42, -0.45], scale: [1.1, 0.8, 1.2] }, 8);
  body.add(b.toMesh('cow-body'));

  neck.position.set(0, 0.24, 0.85);
  const n = new PartBuilder();
  n.box(0.5, 0.48, 0.5, 'cowBody', { pos: [0, 0.05, 0.2] });
  neck.add(n.toMesh('cow-neck'));

  head.position.set(0, 0.1, 0.42);
  const h = new PartBuilder();
  h.box(0.46, 0.44, 0.62, 'cowBody', { pos: [0, 0, 0.2] });
  h.box(0.38, 0.3, 0.26, 'cowUdder', { pos: [0, -0.08, 0.56] }); // muzzle
  for (const side of [-1, 1]) {
    h.sphere(0.075, 'cowSpot', { pos: [side * 0.15, 0.1, 0.44] }, 6); // eye
    h.sphere(0.05, 'cowSpot', { pos: [side * 0.08, -0.1, 0.66] }, 5); // nostril
    h.sphere(0.13, 'cowBody', { pos: [side * 0.27, 0.12, 0.02], scale: [1.5, 0.8, 0.9] }, 6); // ear
    h.cone(0.06, 0.16, 'hayDark', { pos: [side * 0.13, 0.28, 0.1], rot: [0, 0, side * -0.3] }, 5); // horn
  }
  h.sphere(0.2, spot, { pos: [0, 0.16, 0.3], scale: [1.0, 0.7, 0.8] }, 8); // forehead patch
  head.add(h.toMesh('cow-head'));

  tail.position.set(0, 0.3, -0.88);
  const tl = new PartBuilder();
  tl.cylinder(0.05, 0.04, 0.7, 'cowBody', { pos: [0, -0.35, 0] }, 5);
  tl.sphere(0.09, spot, { pos: [0, -0.72, 0] }, 6);
  tail.add(tl.toMesh('cow-tail'));

  const legPositions: [number, number][] = [
    [0.33, 0.62],
    [-0.33, 0.62],
    [0.33, -0.62],
    [-0.33, -0.62],
  ];
  for (const [x, z] of legPositions) {
    const leg = new Group();
    leg.position.set(x, -0.35, z);
    const lb = new PartBuilder();
    lb.cylinder(0.13, 0.11, 0.7, 'cowBody', { pos: [0, -0.35, 0] }, 7);
    lb.cylinder(0.12, 0.13, 0.16, 'cowHoof', { pos: [0, -0.74, 0] }, 7);
    leg.add(lb.toMesh('cow-leg'));
    legs.push(leg);
  }
}

function buildSheep(
  body: Group,
  neck: Group,
  head: Group,
  tail: Group,
  legs: Group[],
  definition: AnimalDefinition,
): void {
  const wool = definition.colorVariant === 1 ? 'sheepWoolDark' : 'sheepWool';

  const b = new PartBuilder();
  // Wool is a cluster of spheres — fluffier and cheaper than a subdivided body.
  b.sphere(0.46, wool, { pos: [0, 0, 0], scale: [1.0, 0.95, 1.35] }, 10);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.sphere(
      0.23,
      i % 3 === 0 ? 'sheepWoolDark' : wool,
      {
        pos: [Math.cos(a) * 0.34, Math.sin(a) * 0.22 + 0.06, Math.sin(a * 1.6) * 0.42],
      },
      7,
    );
  }
  body.add(b.toMesh('sheep-body'));

  neck.position.set(0, 0.18, 0.42);
  const n = new PartBuilder();
  n.sphere(0.2, wool, { pos: [0, 0, 0.08] }, 8);
  neck.add(n.toMesh('sheep-neck'));

  head.position.set(0, 0.04, 0.2);
  const h = new PartBuilder();
  h.sphere(0.2, 'sheepFace', { pos: [0, 0, 0.1], scale: [0.85, 1.0, 1.2] }, 9);
  h.sphere(0.17, wool, { pos: [0, 0.12, -0.02] }, 8); // woolly forelock
  for (const side of [-1, 1]) {
    h.sphere(0.045, 'cowSpot', { pos: [side * 0.09, 0.05, 0.19] }, 5);
    h.sphere(0.07, 'sheepFace', { pos: [side * 0.19, 0.04, 0.0], scale: [1.6, 0.7, 0.8] }, 5);
  }
  h.sphere(0.07, 'sheepFace', { pos: [0, -0.06, 0.26], scale: [1.1, 0.8, 0.8] }, 6);
  head.add(h.toMesh('sheep-head'));

  tail.position.set(0, 0.16, -0.5);
  const tl = new PartBuilder();
  tl.sphere(0.11, wool, { pos: [0, -0.06, 0] }, 6);
  tail.add(tl.toMesh('sheep-tail'));

  const legPositions: [number, number][] = [
    [0.2, 0.32],
    [-0.2, 0.32],
    [0.2, -0.3],
    [-0.2, -0.3],
  ];
  for (const [x, z] of legPositions) {
    const leg = new Group();
    leg.position.set(x, -0.3, z);
    const lb = new PartBuilder();
    lb.cylinder(0.065, 0.055, 0.42, 'sheepFace', { pos: [0, -0.21, 0] }, 6);
    lb.cylinder(0.062, 0.07, 0.09, 'cowHoof', { pos: [0, -0.45, 0] }, 6);
    leg.add(lb.toMesh('sheep-leg'));
    legs.push(leg);
  }
}

function buildChicken(
  body: Group,
  neck: Group,
  head: Group,
  tail: Group,
  legs: Group[],
  definition: AnimalDefinition,
): void {
  const feather =
    definition.colorVariant === 1
      ? 'chickenBrown'
      : definition.colorVariant === 2
        ? 'chickenSpeck'
        : 'chickenBody';

  const b = new PartBuilder();
  b.sphere(0.26, feather, { pos: [0, 0, 0], scale: [0.95, 1.0, 1.25] }, 10);
  // Wings tucked against the body.
  for (const side of [-1, 1]) {
    b.sphere(0.16, feather, { pos: [side * 0.2, 0.02, 0.02], scale: [0.45, 1.0, 1.3] }, 7);
  }
  body.add(b.toMesh('chicken-body'));

  neck.position.set(0, 0.18, 0.16);
  const n = new PartBuilder();
  n.cylinder(0.08, 0.1, 0.18, feather, { pos: [0, 0.08, 0.02] }, 7);
  neck.add(n.toMesh('chicken-neck'));

  head.position.set(0, 0.18, 0.04);
  const h = new PartBuilder();
  h.sphere(0.13, feather, { pos: [0, 0, 0.02] }, 9);
  h.cone(0.06, 0.14, 'chickenBeak', { pos: [0, -0.01, 0.16], rot: [Math.PI / 2, 0, 0] }, 5);
  // Comb and wattle — the reason a chicken silhouette is unmistakable.
  for (let i = 0; i < 3; i++) {
    h.sphere(0.045, 'chickenComb', { pos: [0, 0.13, 0.05 - i * 0.05] }, 5);
  }
  h.sphere(0.04, 'chickenComb', { pos: [0, -0.09, 0.1] }, 5);
  for (const side of [-1, 1]) {
    h.sphere(0.028, 'cowSpot', { pos: [side * 0.08, 0.03, 0.09] }, 5);
  }
  head.add(h.toMesh('chicken-head'));

  tail.position.set(0, 0.12, -0.24);
  const tl = new PartBuilder();
  for (let i = 0; i < 4; i++) {
    tl.box(0.05, 0.26, 0.1, i % 2 ? 'chickenSpeck' : feather, {
      pos: [(i - 1.5) * 0.05, 0.1, -0.06],
      rot: [-0.7, 0, (i - 1.5) * 0.14],
    });
  }
  tail.add(tl.toMesh('chicken-tail'));

  for (const x of [0.09, -0.09]) {
    const leg = new Group();
    leg.position.set(x, -0.18, 0.02);
    const lb = new PartBuilder();
    lb.cylinder(0.025, 0.025, 0.22, 'chickenBeak', { pos: [0, -0.11, 0] }, 5);
    lb.box(0.09, 0.03, 0.13, 'chickenBeak', { pos: [0, -0.22, 0.03] });
    leg.add(lb.toMesh('chicken-leg'));
    legs.push(leg);
  }
}
