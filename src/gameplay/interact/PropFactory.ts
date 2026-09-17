import { Group, Object3D } from 'three';
import { PartBuilder } from '../../art/MeshKit';
import { M } from '../../art/Materials';
import { Prop } from './Interactable';

/**
 * Hand props.
 *
 * Every one of these is a real object that exists in the world, gets carried in
 * the child's hand, and is put down somewhere specific. They are small, so they
 * are built at higher relative detail than scenery: a plate the child is
 * holding at arm's length is the closest thing to the camera in the game.
 *
 * Each is authored around a 0,0,0 origin at its BASE, so a socket can place it
 * on a surface without per-prop offsets.
 */

let nextId = 0;

export type PropKind =
  | 'plate'
  | 'bread'
  | 'milkJug'
  | 'glass'
  | 'glassFull'
  | 'egg'
  | 'basket'
  | 'bucket'
  | 'bucketFull'
  | 'hay'
  | 'grain'
  | 'apple'
  | 'carrot'
  | 'toothbrush'
  | 'towel'
  | 'wateringCan'
  | 'teddy';

type Builder = () => Object3D;

const BUILDERS: Record<PropKind, Builder> = {
  plate: () => {
    const b = new PartBuilder();
    // Shallow dish with a rim, turned on a lathe.
    b.lathe(
      [
        [0, 0],
        [0.075, 0.004],
        [0.08, 0.012],
        [0.105, 0.022],
        [0.112, 0.03],
        [0.108, 0.034],
        [0.1, 0.026],
        [0.075, 0.016],
        [0, 0.008],
      ],
      'uiCream', {}, 18,
    );
    // A painted band, because a plain white disc reads as a placeholder.
    b.lathe([[0.086, 0.019], [0.096, 0.023], [0.095, 0.025], [0.085, 0.021]], 'uiBlue', {}, 18);
    return b.toMesh('plate', M.painted(), { smooth: true, smoothAngle: 1.2 });
  },

  bread: () => {
    const b = new PartBuilder();
    // Rounded loaf slice with a crust edge and a couple of slashes.
    b.sphere(0.055, 'chickenBeak', { pos: [0, 0.03, 0], scale: [1.35, 0.55, 1.0] }, 10);
    b.sphere(0.05, 'hay', { pos: [0, 0.042, 0], scale: [1.28, 0.42, 0.92] }, 10);
    for (const x of [-0.02, 0.02]) {
      b.box(0.012, 0.01, 0.05, 'chickenBeak', { pos: [x, 0.055, 0], rot: [0, 0.3, 0] });
    }
    return b.toMesh('bread', M.painted(), { smooth: true, smoothAngle: 1.3 });
  },

  milkJug: () => {
    const b = new PartBuilder();
    b.lathe(
      [
        [0, 0],
        [0.055, 0.005],
        [0.06, 0.05],
        [0.055, 0.1],
        [0.032, 0.12],
        [0.035, 0.14],
        [0.03, 0.145],
        [0, 0.145],
      ],
      'uiCream', {}, 14,
    );
    // Handle and a lip.
    b.torus(0.032, 0.008, 'uiCream', { pos: [0.058, 0.095, 0], rot: [0, Math.PI / 2, 0.3] }, 10);
    b.box(0.022, 0.008, 0.02, 'uiCream', { pos: [-0.04, 0.142, 0], rot: [0, 0, -0.4] });
    b.lathe([[0.03, 0.146], [0.034, 0.15], [0, 0.152]], 'uiBlue', {}, 12);
    return b.toMesh('milkjug', M.painted(), { smooth: true, smoothAngle: 1.2 });
  },

  glass: () => {
    const b = new PartBuilder();
    b.lathe(
      [
        [0, 0],
        [0.034, 0.004],
        [0.036, 0.02],
        [0.04, 0.085],
        [0.037, 0.088],
        [0.033, 0.02],
        [0.03, 0.006],
        [0, 0.004],
      ],
      'windowGlass', {}, 14,
    );
    return b.toMesh('glass', M.glass('windowGlass', 0.55), { smooth: true });
  },

  glassFull: () => {
    const group = new Group();
    const b = new PartBuilder();
    b.lathe(
      [
        [0, 0],
        [0.034, 0.004],
        [0.036, 0.02],
        [0.04, 0.085],
        [0.037, 0.088],
        [0.033, 0.02],
        [0.03, 0.006],
        [0, 0.004],
      ],
      'windowGlass', {}, 14,
    );
    group.add(b.toMesh('glass', M.glass('windowGlass', 0.45), { smooth: true }));
    const milk = new PartBuilder();
    milk.cylinder(0.034, 0.03, 0.062, 'uiCream', { pos: [0, 0.038, 0] }, 14);
    group.add(milk.toMesh('milk', M.painted(), { smooth: true }));
    return group;
  },

  egg: () => {
    const b = new PartBuilder();
    b.lathe(
      [
        [0, 0],
        [0.019, 0.008],
        [0.023, 0.024],
        [0.02, 0.042],
        [0.012, 0.052],
        [0, 0.056],
      ],
      'uiCream', {}, 12,
    );
    return b.toMesh('egg', M.painted(), { smooth: true, smoothAngle: 1.5 });
  },

  basket: () => {
    const b = new PartBuilder();
    // Woven sides: alternating horizontal bands read as wicker at this size.
    for (let i = 0; i < 5; i++) {
      const y = 0.012 + i * 0.022;
      const r = 0.085 + i * 0.006;
      b.torus(r, 0.008, i % 2 ? 'hay' : 'hayDark', { pos: [0, y, 0], rot: [Math.PI / 2, 0, 0] }, 14);
    }
    b.lathe([[0, 0], [0.08, 0.004], [0.085, 0.01], [0, 0.008]], 'hayDark', {}, 14);
    b.torus(0.062, 0.009, 'trunk', { pos: [0, 0.13, 0], rot: [0, 0, 0] }, 12);
    return b.toMesh('basket', M.painted(), { smooth: true, smoothAngle: 1.2 });
  },

  bucket: () => {
    const b = new PartBuilder();
    b.lathe(
      [
        [0, 0],
        [0.072, 0.004],
        [0.085, 0.14],
        [0.088, 0.15],
        [0.082, 0.15],
        [0.068, 0.012],
        [0, 0.008],
      ],
      'bucket', {}, 14,
    );
    b.torus(0.086, 0.007, 'bucketRim', { pos: [0, 0.148, 0], rot: [Math.PI / 2, 0, 0] }, 14);
    b.torus(0.085, 0.006, 'metalDark', { pos: [0, 0.155, 0], rot: [0, 0, 0.1] }, 12);
    return b.toMesh('bucket', M.painted(), { smooth: true, smoothAngle: 1.2 });
  },

  bucketFull: () => {
    const group = new Group();
    const b = new PartBuilder();
    b.lathe(
      [
        [0, 0],
        [0.072, 0.004],
        [0.085, 0.14],
        [0.088, 0.15],
        [0.082, 0.15],
        [0.068, 0.012],
        [0, 0.008],
      ],
      'bucket', {}, 14,
    );
    b.torus(0.086, 0.007, 'bucketRim', { pos: [0, 0.148, 0], rot: [Math.PI / 2, 0, 0] }, 14);
    b.torus(0.085, 0.006, 'metalDark', { pos: [0, 0.155, 0], rot: [0, 0, 0.1] }, 12);
    group.add(b.toMesh('bucket', M.painted(), { smooth: true, smoothAngle: 1.2 }));
    const milk = new PartBuilder();
    milk.cylinder(0.078, 0.072, 0.02, 'uiCream', { pos: [0, 0.118, 0] }, 14);
    group.add(milk.toMesh('milk', M.painted()));
    return group;
  },

  hay: () => {
    const b = new PartBuilder();
    // A loose armful: stalks fanned in a rough bundle.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const lean = 0.25 + (i % 3) * 0.1;
      b.box(0.018, 0.012, 0.3, i % 2 ? 'hay' : 'hayDark', {
        pos: [Math.cos(a) * 0.035, 0.04 + (i % 4) * 0.012, Math.sin(a) * 0.02],
        rot: [lean, a, 0],
      });
    }
    return b.toMesh('hay', M.painted(), { ao: false });
  },

  grain: () => {
    const b = new PartBuilder();
    // A small sack, slumped.
    b.lathe(
      [
        [0, 0],
        [0.07, 0.006],
        [0.075, 0.06],
        [0.055, 0.1],
        [0.03, 0.115],
        [0.034, 0.125],
        [0, 0.125],
      ],
      'hayDark', {}, 12,
    );
    b.torus(0.032, 0.008, 'trunk', { pos: [0, 0.118, 0], rot: [Math.PI / 2, 0, 0] }, 10);
    for (let i = 0; i < 6; i++) {
      b.sphere(0.012, 'hay', { pos: [(i - 2.5) * 0.015, 0.128, 0.012] }, 5);
    }
    return b.toMesh('grain', M.painted(), { smooth: true, smoothAngle: 1.2 });
  },

  apple: () => {
    const b = new PartBuilder();
    b.sphere(0.036, 'uiRed', { pos: [0, 0.036, 0], scale: [1, 0.94, 1] }, 10);
    b.cylinder(0.005, 0.004, 0.025, 'trunkDark', { pos: [0, 0.078, 0], rot: [0, 0, 0.2] }, 5);
    b.box(0.022, 0.004, 0.012, 'deciduousLight', { pos: [0.016, 0.082, 0], rot: [0, 0.3, 0.4] });
    return b.toMesh('apple', M.painted(), { smooth: true, smoothAngle: 1.4 });
  },

  carrot: () => {
    const b = new PartBuilder();
    b.cone(0.022, 0.12, 'chickenBeak', { pos: [0, 0.06, 0], rot: [Math.PI, 0, 0] }, 9);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      b.box(0.012, 0.05, 0.008, 'grassDeep', {
        pos: [Math.cos(a) * 0.012, 0.14, Math.sin(a) * 0.012],
        rot: [Math.sin(a) * 0.4, -a, Math.cos(a) * 0.4],
      });
    }
    return b.toMesh('carrot', M.painted(), { smooth: true });
  },

  toothbrush: () => {
    const b = new PartBuilder();
    b.bevelBox(0.014, 0.012, 0.12, 0.004, 'uiBlue', { pos: [0, 0.006, 0] });
    b.bevelBox(0.02, 0.01, 0.03, 0.003, 'uiCream', { pos: [0, 0.012, 0.055] });
    for (let i = 0; i < 4; i++) {
      b.box(0.018, 0.012, 0.004, 'wallPlaster', { pos: [0, 0.022, 0.045 + i * 0.007] });
    }
    return b.toMesh('toothbrush', M.painted(), { smooth: true });
  },

  towel: () => {
    const b = new PartBuilder();
    b.bevelBox(0.11, 0.02, 0.14, 0.008, 'motherApron', { pos: [0, 0.01, 0] });
    b.bevelBox(0.112, 0.008, 0.03, 0.004, 'uiBlue', { pos: [0, 0.02, 0.045] });
    return b.toMesh('towel', M.cloth(), { smooth: true });
  },

  wateringCan: () => {
    const b = new PartBuilder();
    b.lathe(
      [
        [0, 0],
        [0.06, 0.005],
        [0.065, 0.09],
        [0.055, 0.115],
        [0, 0.118],
      ],
      'uiGreen', {}, 12,
    );
    b.cylinder(0.012, 0.016, 0.13, 'uiGreen', { pos: [0.075, 0.085, 0], rot: [0, 0, -0.9] }, 7);
    b.lathe([[0, 0], [0.028, 0.008], [0.026, 0.014], [0, 0.014]], 'uiGreenDeep', { pos: [0.13, 0.13, 0] }, 10);
    b.torus(0.032, 0.007, 'uiGreenDeep', { pos: [-0.04, 0.115, 0], rot: [0, Math.PI / 2, 0.4] }, 10);
    return b.toMesh('wateringcan', M.painted(), { smooth: true, smoothAngle: 1.2 });
  },

  teddy: () => {
    const b = new PartBuilder();
    b.sphere(0.045, 'trunk', { pos: [0, 0.05, 0], scale: [1, 1.1, 0.9] }, 9);
    b.sphere(0.038, 'trunk', { pos: [0, 0.115, 0] }, 9);
    for (const side of [-1, 1]) {
      b.sphere(0.016, 'trunk', { pos: [side * 0.028, 0.142, 0] }, 6);
      b.sphere(0.02, 'trunk', { pos: [side * 0.05, 0.06, 0], rot: [0, 0, side * 0.5] }, 6);
      b.sphere(0.02, 'trunk', { pos: [side * 0.025, 0.012, 0.01] }, 6);
    }
    b.sphere(0.016, 'hay', { pos: [0, 0.105, 0.03], scale: [1, 0.8, 0.7] }, 7);
    b.sphere(0.006, 'cowSpot', { pos: [0, 0.112, 0.045] }, 5);
    for (const side of [-1, 1]) {
      b.sphere(0.005, 'cowSpot', { pos: [side * 0.014, 0.125, 0.032] }, 5);
    }
    return b.toMesh('teddy', M.creature(), { smooth: true, smoothAngle: 1.4 });
  },
};

/** Creates a prop instance. Each call makes a fresh, independent object. */
export function makeProp(kind: PropKind): Prop {
  const builder = BUILDERS[kind];
  if (!builder) throw new Error(`unknown prop kind: ${kind}`);
  const object = builder();
  object.castShadow = true;
  object.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return new Prop(`${kind}-${nextId++}`, kind, object);
}

/** Item id used by the inventory, for props that map onto a content item. */
export const PROP_ITEM: Partial<Record<PropKind, string>> = {
  egg: 'egg',
  apple: 'apple',
  carrot: 'carrot',
  bucketFull: 'milk',
  milkJug: 'milk',
  hay: 'hay',
  grain: 'grain',
  bucket: 'bucket',
  wateringCan: 'wateringcan',
};
