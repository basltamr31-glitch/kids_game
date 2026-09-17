import { Group, Object3D, Vector3 } from 'three';
import { PartBuilder } from '../art/MeshKit';
import { M } from '../art/Materials';
import {
  Hinge,
  Socket,
  type InteractableRegistry,
  type Seat,
} from '../gameplay/interact/Interactable';

/**
 * Interactive furniture.
 *
 * Everything here is a separate object with real state, rather than decoration
 * baked into the interior mesh. That costs a few draw calls and buys the entire
 * point of the game: a table you can put a plate on, a chair you can sit on, a
 * wardrobe that opens, a bed you sleep in.
 *
 * Each builder registers its sockets, seats and hinges with the registry, and
 * returns the Group to add to the scene. Positions are in HOUSE-LOCAL space;
 * the caller parents the result to the chalet group.
 */

export interface FurnitureResult {
  group: Group;
  /** Named anchors the interactables and activities refer to. */
  nodes: Map<string, Object3D>;
}

/** Creates an empty node at a local position, for use as a socket mount. */
function anchor(parent: Object3D, name: string, x: number, y: number, z: number): Object3D {
  const node = new Object3D();
  node.name = name;
  node.position.set(x, y, z);
  parent.add(node);
  return node;
}

const FLOOR = 0.79; // top of the interior floor slab

/* ------------------------------------------------------------------ */
/* Dining table and chairs                                             */
/* ------------------------------------------------------------------ */

export function buildDiningSet(registry: InteractableRegistry): FurnitureResult {
  const group = new Group();
  group.name = 'dining-set';
  const nodes = new Map<string, Object3D>();

  const tableY = FLOOR + 0.72;

  /* --- table --- */
  const table = new PartBuilder();
  // Planked top with a visible edge moulding.
  for (let i = 0; i < 5; i++) {
    table.bevelBox(0.56, 0.06, 1.6, 0.012, i % 2 ? 'woodWarm' : 'woodMid', {
      pos: [-1.12 + i * 0.56, tableY, 0],
    });
  }
  table.bevelBox(2.92, 0.05, 1.72, 0.015, 'woodDark', { pos: [0, tableY - 0.045, 0] });
  // Turned legs, and a stretcher between them.
  for (const [lx, lz] of [[-1.24, -0.62], [1.24, -0.62], [-1.24, 0.62], [1.24, 0.62]] as const) {
    table.lathe(
      [
        [0.055, 0],
        [0.07, 0.06],
        [0.045, 0.16],
        [0.055, 0.3],
        [0.045, 0.52],
        [0.062, 0.66],
        [0.05, 0.7],
      ],
      'woodDark',
      { pos: [lx, FLOOR, lz] },
      8,
    );
  }
  table.bevelBox(2.3, 0.07, 0.07, 0.015, 'woodDark', { pos: [0, FLOOR + 0.22, 0] });
  const tableMesh = table.toMesh('table', M.built('wood', 2.0), { groundY: FLOOR });
  group.add(tableMesh);

  // Four places, each a socket that accepts a plate or a glass.
  const places: [number, number][] = [
    [-0.75, -0.45], [0.75, -0.45], [-0.75, 0.45], [0.75, 0.45],
  ];
  places.forEach(([px, pz], i) => {
    const plateNode = anchor(group, `place-${i}`, px, tableY + 0.03, pz);
    registry.addSocket(new Socket(`table.plate.${i}`, plateNode, ['plate']));
    const glassNode = anchor(group, `glass-${i}`, px + 0.24, tableY + 0.03, pz - 0.22);
    registry.addSocket(new Socket(`table.glass.${i}`, glassNode, ['glass', 'glassFull']));
  });
  // A shared spot in the middle for the bread board or a jug.
  const centreNode = anchor(group, 'table-centre', 0, tableY + 0.03, 0);
  registry.addSocket(new Socket('table.centre', centreNode, []));
  nodes.set('tableCentre', centreNode);
  nodes.set('table', tableMesh);

  /* --- chairs --- */
  const chairLayout: { x: number; z: number; yaw: number; id: string }[] = [
    { x: -0.78, z: -1.25, yaw: 0, id: 'chair.a' },
    { x: 0.78, z: -1.25, yaw: 0, id: 'chair.b' },
    { x: -0.78, z: 1.25, yaw: Math.PI, id: 'chair.c' },
    { x: 0.78, z: 1.25, yaw: Math.PI, id: 'chair.d' },
  ];

  for (const spec of chairLayout) {
    const chair = new Group();
    chair.name = spec.id;
    chair.position.set(spec.x, 0, spec.z);
    chair.rotation.y = spec.yaw;

    const b = new PartBuilder();
    const seatY = FLOOR + 0.44;
    b.bevelBox(0.44, 0.06, 0.42, 0.015, 'woodWarm', { pos: [0, seatY, 0] });
    // Back: two uprights and three slats.
    for (const ux of [-0.18, 0.18]) {
      b.bevelBox(0.055, 0.56, 0.055, 0.012, 'woodDark', { pos: [ux, seatY + 0.28, -0.185] });
    }
    for (let i = 0; i < 3; i++) {
      b.bevelBox(0.34, 0.07, 0.035, 0.01, 'woodMid', {
        pos: [0, seatY + 0.14 + i * 0.16, -0.185],
      });
    }
    b.bevelBox(0.42, 0.06, 0.05, 0.012, 'woodDark', { pos: [0, seatY + 0.56, -0.185] });
    for (const [lx, lz] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]] as const) {
      b.bevelBox(0.05, 0.44, 0.05, 0.012, 'woodDark', { pos: [lx, FLOOR + 0.22, lz] });
    }
    // Stretchers.
    for (const sz of [-0.16, 0.16]) {
      b.box(0.3, 0.035, 0.035, 'woodDark', { pos: [0, FLOOR + 0.13, sz] });
    }
    chair.add(b.toMesh('chair', M.built('wood', 2.4), { groundY: FLOOR }));
    group.add(chair);

    // The seat the child actually sits on, and where they stand to do it.
    const approach = new Vector3(
      spec.x + Math.sin(spec.yaw) * 0.9,
      0,
      spec.z + Math.cos(spec.yaw) * 0.9,
    );
    const seat: Seat = {
      id: spec.id,
      node: chair,
      offset: new Vector3(0, FLOOR + 0.5, 0.02),
      // Seated facing is the chair's own yaw plus half a turn: chairs face the
      // table, and the child sits with their back to the chair back.
      yaw: spec.yaw + Math.PI,
      occupied: false,
      approachFrom: approach,
    };
    registry.addSeat(seat);
    nodes.set(spec.id, chair);
  }

  return { group, nodes };
}

/* ------------------------------------------------------------------ */
/* Kitchen                                                             */
/* ------------------------------------------------------------------ */

export function buildKitchen(registry: InteractableRegistry): FurnitureResult {
  const group = new Group();
  group.name = 'kitchen';
  const nodes = new Map<string, Object3D>();

  const counterY = FLOOR + 0.9;
  const b = new PartBuilder();

  // Counter carcass with panelled doors.
  b.bevelBox(4.6, 0.86, 0.86, 0.03, 'woodMid', { pos: [0, FLOOR + 0.43, 0] });
  b.bevelBox(4.74, 0.08, 0.96, 0.02, 'wallPlaster', { pos: [0, counterY, 0] });
  for (let i = 0; i < 4; i++) {
    const x = -1.65 + i * 1.1;
    b.bevelBox(0.95, 0.66, 0.05, 0.015, 'woodWarm', { pos: [x, FLOOR + 0.45, 0.44] });
    b.bevelBox(0.7, 0.44, 0.03, 0.01, 'woodMid', { pos: [x, FLOOR + 0.45, 0.47] });
    b.sphere(0.03, 'metal', { pos: [x + 0.36, FLOOR + 0.45, 0.5] }, 6);
  }

  // Stove with rings and a stockpot.
  b.bevelBox(0.95, 0.88, 0.88, 0.03, 'metalDark', { pos: [1.85, FLOOR + 0.44, 0] });
  b.bevelBox(0.98, 0.06, 0.9, 0.015, 'rockDark', { pos: [1.85, counterY, 0] });
  for (const [rx, rz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as const) {
    b.torus(0.1, 0.018, 'metal', { pos: [1.85 + rx, counterY + 0.04, rz], rot: [Math.PI / 2, 0, 0] }, 10);
  }
  b.lathe(
    [[0, 0], [0.19, 0.01], [0.2, 0.22], [0.22, 0.24], [0.2, 0.25], [0, 0.25]],
    'metal', { pos: [1.65, counterY + 0.05, 0.15] }, 12,
  );
  b.lathe([[0, 0], [0.2, 0.012], [0.19, 0.03], [0, 0.03]], 'bucketRim', { pos: [1.65, counterY + 0.3, 0.15] }, 12);

  // Open shelving with jars and hanging pans.
  b.bevelBox(3.0, 0.07, 0.34, 0.015, 'woodDark', { pos: [-0.6, FLOOR + 1.5, -0.28] });
  b.bevelBox(3.0, 0.07, 0.34, 0.015, 'woodDark', { pos: [-0.6, FLOOR + 1.92, -0.28] });
  for (let i = 0; i < 5; i++) {
    b.lathe(
      [[0, 0], [0.07, 0.01], [0.075, 0.16], [0.06, 0.2], [0.065, 0.22], [0, 0.22]],
      i % 2 ? 'windowGlass' : 'flowerBoxRed',
      { pos: [-1.7 + i * 0.55, FLOOR + 1.54, -0.28] }, 10,
    );
  }
  for (let i = 0; i < 3; i++) {
    b.lathe([[0, 0], [0.16, 0.01], [0.17, 0.09], [0.15, 0.1], [0, 0.09]], 'metal', {
      pos: [-1.5 + i * 0.5, FLOOR + 1.96, -0.28],
    }, 10);
  }

  group.add(b.toMesh('kitchen', M.built('wood', 1.9), { groundY: FLOOR }));

  // Sockets on the counter: a stack of plates, the bread board, the milk jug.
  const plateNode = anchor(group, 'counter-plates', -1.75, counterY + 0.04, 0);
  registry.addSocket(new Socket('kitchen.plates', plateNode, ['plate']));
  nodes.set('plates', plateNode);

  const breadNode = anchor(group, 'counter-bread', -0.85, counterY + 0.06, 0.05);
  registry.addSocket(new Socket('kitchen.bread', breadNode, ['bread']));
  nodes.set('bread', breadNode);

  const jugNode = anchor(group, 'counter-jug', -0.1, counterY + 0.04, -0.05);
  registry.addSocket(new Socket('kitchen.jug', jugNode, ['milkJug']));
  nodes.set('jug', jugNode);

  const glassNode = anchor(group, 'counter-glass', 0.5, counterY + 0.04, 0.05);
  registry.addSocket(new Socket('kitchen.glasses', glassNode, ['glass', 'glassFull']));
  nodes.set('glasses', glassNode);

  // A bread board under the loaf, purely so the loaf has somewhere to belong.
  const board = new PartBuilder();
  board.bevelBox(0.38, 0.03, 0.26, 0.01, 'woodWarm', { pos: [-0.85, counterY + 0.045, 0.05] });
  group.add(board.toMesh('breadboard', M.built('wood', 3.0), { ao: false }));

  return { group, nodes };
}

/* ------------------------------------------------------------------ */
/* Bathroom                                                            */
/* ------------------------------------------------------------------ */

export function buildBathroom(registry: InteractableRegistry): FurnitureResult {
  const group = new Group();
  group.name = 'bathroom';
  const nodes = new Map<string, Object3D>();

  const b = new PartBuilder();
  const basinY = FLOOR + 0.78;

  // Pedestal basin.
  b.lathe(
    [[0.16, 0], [0.2, 0.06], [0.14, 0.4], [0.2, 0.66], [0.3, 0.72], [0.32, 0.78]],
    'uiCream', { pos: [0, FLOOR, 0] }, 14,
  );
  b.lathe(
    [[0, 0.78], [0.3, 0.78], [0.34, 0.82], [0.33, 0.86], [0.27, 0.83], [0.24, 0.79], [0, 0.79]],
    'uiCream', { pos: [0, FLOOR, 0] }, 16,
  );
  // Tap and a mirror.
  b.cylinder(0.022, 0.026, 0.16, 'metal', { pos: [0, basinY + 0.14, -0.2] }, 8);
  b.cylinder(0.018, 0.018, 0.1, 'metal', { pos: [0, basinY + 0.21, -0.15], rot: [1.2, 0, 0] }, 8);
  for (const hx of [-0.09, 0.09]) {
    b.sphere(0.028, 'metal', { pos: [hx, basinY + 0.1, -0.2] }, 6);
  }
  b.bevelBox(0.62, 0.78, 0.05, 0.02, 'woodDark', { pos: [0, basinY + 0.66, -0.3] });
  b.bevelBox(0.54, 0.7, 0.03, 0.01, 'windowGlass', { pos: [0, basinY + 0.66, -0.27] });

  // A small shelf for the toothbrush cup and soap.
  b.bevelBox(0.5, 0.05, 0.16, 0.012, 'woodWarm', { pos: [0, basinY + 0.24, -0.29] });
  b.lathe([[0, 0], [0.05, 0.005], [0.055, 0.1], [0.05, 0.105], [0, 0.1]], 'uiBlue', {
    pos: [-0.15, basinY + 0.27, -0.29],
  }, 10);
  b.bevelBox(0.11, 0.045, 0.07, 0.02, 'meadowFlowerB', { pos: [0.14, basinY + 0.29, -0.29] });

  group.add(b.toMesh('bathroom', M.built('plaster', 1.6), { groundY: FLOOR }));

  const brushNode = anchor(group, 'brush-cup', -0.15, basinY + 0.32, -0.29);
  registry.addSocket(new Socket('bath.brush', brushNode, ['toothbrush']));
  nodes.set('brushCup', brushNode);

  const basinNode = anchor(group, 'basin', 0, basinY, 0);
  nodes.set('basin', basinNode);

  return { group, nodes };
}

/* ------------------------------------------------------------------ */
/* Bedroom                                                             */
/* ------------------------------------------------------------------ */

export function buildBedroom(registry: InteractableRegistry): FurnitureResult {
  const group = new Group();
  group.name = 'bedroom';
  const nodes = new Map<string, Object3D>();

  /* --- bed --- */
  const bed = new PartBuilder();
  const mattressY = FLOOR + 0.46;
  // Frame with turned posts and a headboard.
  bed.bevelBox(1.5, 0.22, 2.3, 0.03, 'woodWarm', { pos: [0, FLOOR + 0.32, 0] });
  for (const [px, pz] of [[-0.68, -1.1], [0.68, -1.1], [-0.68, 1.1], [0.68, 1.1]] as const) {
    bed.lathe(
      [[0.07, 0], [0.085, 0.08], [0.06, 0.2], [0.075, 0.42], [0.05, 0.5]],
      'woodDark', { pos: [px, FLOOR, pz] }, 8,
    );
  }
  bed.bevelBox(1.52, 0.72, 0.09, 0.02, 'woodMid', { pos: [0, FLOOR + 0.72, -1.14] });
  for (let i = 0; i < 4; i++) {
    bed.bevelBox(0.22, 0.5, 0.05, 0.015, 'woodWarm', { pos: [-0.52 + i * 0.35, FLOOR + 0.7, -1.1] });
  }
  bed.bevelBox(1.5, 0.4, 0.08, 0.02, 'woodMid', { pos: [0, FLOOR + 0.5, 1.14] });
  // Mattress, folded quilt and a pillow.
  bed.bevelBox(1.4, 0.2, 2.1, 0.06, 'wallPlaster', { pos: [0, mattressY, 0] });
  bed.bevelBox(1.42, 0.14, 1.35, 0.05, 'fatherShirt', { pos: [0, mattressY + 0.15, 0.36] });
  bed.bevelBox(1.44, 0.06, 0.3, 0.02, 'motherApron', { pos: [0, mattressY + 0.2, -0.28] });
  bed.bevelBox(0.86, 0.17, 0.42, 0.07, 'uiCream', { pos: [0, mattressY + 0.18, -0.78] });
  group.add(bed.toMesh('bed', M.built('wood', 1.7), { groundY: FLOOR }));

  const bedNode = anchor(group, 'bed-lie', 0, mattressY + 0.2, 0.1);
  nodes.set('bed', bedNode);

  /* --- bedside table with a lamp --- */
  const side = new PartBuilder();
  side.bevelBox(0.44, 0.5, 0.4, 0.02, 'woodMid', { pos: [-1.05, FLOOR + 0.25, -0.75] });
  side.bevelBox(0.48, 0.05, 0.44, 0.015, 'woodWarm', { pos: [-1.05, FLOOR + 0.52, -0.75] });
  side.sphere(0.028, 'metal', { pos: [-1.05, FLOOR + 0.3, -0.56] }, 6);
  side.cylinder(0.035, 0.05, 0.22, 'metalDark', { pos: [-1.05, FLOOR + 0.64, -0.75] }, 8);
  side.lathe([[0.07, 0], [0.15, 0.18], [0.14, 0.19], [0, 0.19]], 'sunGold', {
    pos: [-1.05, FLOOR + 0.74, -0.75],
  }, 12);
  group.add(side.toMesh('bedside', M.built('wood', 2.2), { groundY: FLOOR }));

  const lampSocket = anchor(group, 'bedside-top', -1.05, FLOOR + 0.56, -0.75);
  registry.addSocket(new Socket('bedroom.bedside', lampSocket, []));

  /* --- wardrobe with two hinged doors --- */
  const wardrobe = new Group();
  wardrobe.name = 'wardrobe';
  wardrobe.position.set(-2.1, 0, -1.5);

  const carcass = new PartBuilder();
  carcass.bevelBox(1.4, 2.2, 0.66, 0.03, 'woodMid', { pos: [0, FLOOR + 1.1, -0.04] });
  carcass.bevelBox(1.5, 0.1, 0.74, 0.02, 'woodDark', { pos: [0, FLOOR + 2.2, -0.04] });
  carcass.bevelBox(1.44, 0.1, 0.7, 0.02, 'woodDark', { pos: [0, FLOOR + 0.06, -0.04] });
  // Interior, visible when the doors open.
  carcass.box(1.24, 2.0, 0.5, 'trunkDark', { pos: [0, FLOOR + 1.1, -0.06] });
  carcass.cylinder(0.02, 0.02, 1.2, 'metal', { pos: [0, FLOOR + 1.85, -0.04], rot: [0, 0, Math.PI / 2] }, 6);
  for (let i = 0; i < 4; i++) {
    const tint = ['fatherShirt', 'motherDress', 'uiGreen', 'chickenBeak'][i];
    carcass.bevelBox(0.22, 0.6, 0.16, 0.03, tint, { pos: [-0.42 + i * 0.28, FLOOR + 1.5, -0.04] });
  }
  wardrobe.add(carcass.toMesh('wardrobe', M.built('wood', 1.8), { groundY: FLOOR }));

  const leaves: Hinge[] = [];
  for (const side2 of [-1, 1] as const) {
    const pivot = new Object3D();
    pivot.position.set(side2 * 0.68, 0, 0.3);
    wardrobe.add(pivot);

    const leaf = new PartBuilder();
    leaf.bevelBox(0.66, 2.04, 0.06, 0.02, 'woodWarm', { pos: [side2 * -0.33, FLOOR + 1.1, 0] });
    leaf.bevelBox(0.44, 1.6, 0.03, 0.012, 'woodMid', { pos: [side2 * -0.33, FLOOR + 1.1, 0.03] });
    leaf.sphere(0.035, 'metal', { pos: [side2 * -0.6, FLOOR + 1.1, 0.06] }, 7);
    pivot.add(leaf.toMesh('wardrobe-leaf', M.built('wood', 2.6), { ao: false }));

    leaves.push(registry.addHinge(new Hinge(pivot, { open: side2 * -1.9, speed: 3.0 })));
  }
  group.add(wardrobe);
  nodes.set('wardrobe', wardrobe);
  nodes.set('wardrobeHingeA', leaves[0].node);
  nodes.set('wardrobeHingeB', leaves[1].node);

  /* --- toy basket and a rug --- */
  const toys = new PartBuilder();
  for (let i = 0; i < 4; i++) {
    const y = FLOOR + 0.02 + i * 0.055;
    toys.torus(0.26 + i * 0.008, 0.022, i % 2 ? 'hay' : 'hayDark', {
      pos: [1.5, y, 0.9], rot: [Math.PI / 2, 0, 0],
    }, 12);
  }
  toys.lathe([[0, 0], [0.25, 0.01], [0.26, 0.03], [0, 0.02]], 'hayDark', {
    pos: [1.5, FLOOR, 0.9],
  }, 12);
  group.add(toys.toMesh('toybasket', M.built('organic', 3.0), { groundY: FLOOR }));

  const toyNode = anchor(group, 'toy-basket', 1.5, FLOOR + 0.16, 0.9);
  registry.addSocket(new Socket('bedroom.toys', toyNode, ['teddy']));
  nodes.set('toys', toyNode);

  const rug = new PartBuilder();
  rug.bevelBox(1.8, 0.03, 1.3, 0.01, 'meadowFlowerB', { pos: [0.6, FLOOR + 0.015, 1.0] });
  rug.bevelBox(1.5, 0.035, 1.0, 0.01, 'flowerBoxPink', { pos: [0.6, FLOOR + 0.02, 1.0] });
  group.add(rug.toMesh('rug', M.cloth(), { ao: false }));

  return { group, nodes };
}

/* ------------------------------------------------------------------ */
/* Living room                                                         */
/* ------------------------------------------------------------------ */

export function buildLivingRoom(registry: InteractableRegistry): FurnitureResult {
  const group = new Group();
  group.name = 'living-room';
  const nodes = new Map<string, Object3D>();

  const b = new PartBuilder();
  const seatY = FLOOR + 0.42;

  // Sofa: base, back, arms, two cushions.
  b.bevelBox(2.4, 0.42, 0.98, 0.06, 'woodDark', { pos: [0, FLOOR + 0.21, 0] });
  b.bevelBox(2.4, 0.2, 0.9, 0.08, 'fatherShirt', { pos: [0, seatY, 0.02] });
  b.bevelBox(2.4, 0.62, 0.26, 0.08, 'fatherShirt', { pos: [0, seatY + 0.34, -0.36] });
  for (const ax of [-1.14, 1.14]) {
    b.bevelBox(0.24, 0.52, 0.94, 0.07, 'fatherShirt', { pos: [ax, seatY + 0.16, 0] });
  }
  for (const cx of [-0.55, 0.55]) {
    b.bevelBox(1.0, 0.16, 0.8, 0.07, 'motherDress', { pos: [cx, seatY + 0.16, 0.04] });
  }
  group.add(b.toMesh('sofa', M.cloth(), { groundY: FLOOR }));

  // Two seats on the sofa.
  for (const [i, sx] of [-0.55, 0.55].entries()) {
    const node = new Object3D();
    node.position.set(sx, 0, 0);
    group.add(node);
    const seat: Seat = {
      id: `sofa.${i}`,
      node,
      offset: new Vector3(0, seatY + 0.2, 0.08),
      yaw: Math.PI,
      occupied: false,
      approachFrom: new Vector3(sx, 0, 1.1),
    };
    registry.addSeat(seat);
    nodes.set(`sofa.${i}`, node);
  }

  // Low table with a book on it.
  const t = new PartBuilder();
  t.bevelBox(1.1, 0.06, 0.62, 0.015, 'woodWarm', { pos: [0, FLOOR + 0.4, 1.1] });
  for (const [lx, lz] of [[-0.46, -0.22], [0.46, -0.22], [-0.46, 0.22], [0.46, 0.22]] as const) {
    b.box(0.06, 0.4, 0.06, 'woodDark', { pos: [lx, FLOOR + 0.2, 1.1 + lz] });
  }
  t.bevelBox(0.26, 0.05, 0.2, 0.008, 'flowerBoxRed', { pos: [0.15, FLOOR + 0.455, 1.1], rot: [0, 0.3, 0] });
  group.add(t.toMesh('coffee-table', M.built('wood', 2.4), { groundY: FLOOR }));

  const tableNode = anchor(group, 'living-table', -0.2, FLOOR + 0.43, 1.1);
  registry.addSocket(new Socket('living.table', tableNode, []));
  nodes.set('livingTable', tableNode);

  return { group, nodes };
}

/* ------------------------------------------------------------------ */
/* Doors                                                               */
/* ------------------------------------------------------------------ */

/**
 * A hinged door in a frame.
 *
 * The leaf is parented to a pivot at the hinge edge rather than to its own
 * centre, which is the only way a door swings correctly rather than spinning
 * about its middle.
 */
export function buildDoor(
  registry: InteractableRegistry,
  options: {
    id: string;
    width: number;
    height: number;
    /** 1 hinges on the right, -1 on the left. */
    hand: 1 | -1;
    openAngle?: number;
    tint?: string;
  },
): { group: Group; hinge: Hinge; pivot: Object3D } {
  const group = new Group();
  group.name = options.id;

  const w = options.width;
  const h = options.height;

  // Frame.
  const frame = new PartBuilder();
  for (const fx of [-1, 1]) {
    frame.bevelBox(0.14, h + 0.12, 0.22, 0.03, 'woodDark', { pos: [(fx * (w + 0.14)) / 2, h / 2, 0] });
  }
  frame.bevelBox(w + 0.28, 0.16, 0.22, 0.03, 'woodDark', { pos: [0, h + 0.06, 0] });
  group.add(frame.toMesh(`${options.id}-frame`, M.built('wood', 2.0), { ao: false }));

  const pivot = new Object3D();
  pivot.position.set((options.hand * w) / 2, 0, 0);
  group.add(pivot);

  const leaf = new PartBuilder();
  const tint = options.tint ?? 'woodWarm';
  leaf.bevelBox(w, h, 0.09, 0.02, tint, { pos: [(-options.hand * w) / 2, h / 2, 0] });
  // Panelling and a couple of cross-braces.
  for (let i = 0; i < 2; i++) {
    leaf.bevelBox(w * 0.66, h * 0.36, 0.04, 0.012, 'woodMid', {
      pos: [(-options.hand * w) / 2, h * (0.3 + i * 0.4), 0.05],
    });
  }
  // Handle on the swinging edge.
  leaf.sphere(0.055, 'metal', {
    pos: [(-options.hand * w) / 2 + options.hand * -w * 0.38, h * 0.48, 0.09],
  }, 8);
  leaf.cylinder(0.02, 0.02, 0.06, 'metalDark', {
    pos: [(-options.hand * w) / 2 + options.hand * -w * 0.38, h * 0.48, 0.06],
    rot: [Math.PI / 2, 0, 0],
  }, 6);
  pivot.add(leaf.toMesh(`${options.id}-leaf`, M.built('wood', 2.2), { ao: false }));

  const hinge = registry.addHinge(
    new Hinge(pivot, { open: options.hand * (options.openAngle ?? 1.9), speed: 2.6 }),
  );

  return { group, hinge, pivot };
}
