import { Group, Mesh, type Material } from 'three';
import { PartBuilder } from '../art/MeshKit';
import { surface, M } from '../art/Materials';
import type { Rng } from '../core/Rng';

/**
 * Alpine buildings.
 *
 * The chalet is the single most important object in the game — it is the app
 * icon, the store screenshot and the child's home. It gets the most detail:
 * stone footing, plastered ground floor, timber upper storey, a deep-overhang
 * gable roof, a carved balcony, shutters, flower boxes and a stone chimney.
 *
 * INTERIORS use a doll's-house cutaway rather than separate scenes. When the
 * child steps inside, the near walls and roof fade out and the camera lifts.
 * No loading, no transition, and a four-year-old immediately understands they
 * are looking into their own home.
 */

export interface BuildingResult {
  group: Group;
  /** Parts that fade away when the child is inside. */
  shell: Mesh;
  /** Always-present interior. Hidden behind the shell from outside. */
  interior?: Mesh;
  shellMaterial: Material;
}

/* ------------------------------------------------------------------ */
/* The family chalet                                                   */
/* ------------------------------------------------------------------ */

export function buildChalet(rng: Rng): BuildingResult {
  const group = new Group();
  group.name = 'chalet';

  const W = 14; // width  (X)
  const D = 11; // depth  (Z)
  const H1 = 3.2; // ground floor height
  const H2 = 2.9; // upper floor height

  const shellMaterial = surface({ vertexColors: true, transparent: true, opacity: 1, unique: true });

  const b = new PartBuilder();

  /* --- stone footing: chalets sit on a masonry plinth --- */
  b.box(W + 0.6, 0.7, D + 0.6, 'stoneFoundation', { pos: [0, 0.35, 0] });
  for (let i = 0; i < 14; i++) {
    // Irregular stones break the silhouette so it does not read as a box.
    const t = i / 14;
    b.box(rng.range(0.7, 1.3), rng.range(0.35, 0.6), 0.25, 'rock', {
      pos: [-W / 2 + t * W + rng.range(-0.2, 0.2), rng.range(0.2, 0.55), D / 2 + 0.3],
      rot: [0, 0, rng.range(-0.08, 0.08)],
    });
  }

  /* --- ground floor: white plaster --- */
  b.box(W, H1, D, 'wallPlaster', { pos: [0, 0.7 + H1 / 2, 0] });
  // Corner quoins in shaded plaster for a little architectural weight.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.5, H1, 0.5, 'wallPlasterShade', {
        pos: [(sx * W) / 2, 0.7 + H1 / 2, (sz * D) / 2],
      });
    }
  }

  /* --- upper floor: timber, slightly overhanging (very alpine) --- */
  const upperY = 0.7 + H1;
  b.box(W + 0.5, H2, D + 0.5, 'woodWarm', { pos: [0, upperY + H2 / 2, 0] });
  // Horizontal log courses.
  const courses = 6;
  for (let i = 0; i < courses; i++) {
    const y = upperY + 0.25 + (i / courses) * (H2 - 0.5);
    b.box(W + 0.62, 0.12, D + 0.62, 'woodMid', { pos: [0, y, 0] });
  }

  /* --- balcony running the full width of the front --- */
  const balconyZ = D / 2 + 0.75;
  const balconyY = upperY + 0.25;
  b.box(W + 1.6, 0.18, 1.6, 'woodBalcony', { pos: [0, balconyY, balconyZ] });
  // Support brackets.
  for (let i = -2; i <= 2; i++) {
    b.box(0.18, 0.7, 0.18, 'woodDark', {
      pos: [i * 2.4, balconyY - 0.42, balconyZ + 0.5],
      rot: [0.32, 0, 0],
    });
  }
  // Railing: posts + top rail + carved balusters.
  b.box(W + 1.6, 0.14, 0.16, 'woodBalcony', { pos: [0, balconyY + 0.95, balconyZ + 0.72] });
  for (let i = 0; i <= 22; i++) {
    const x = -((W + 1.5) / 2) + (i / 22) * (W + 1.5);
    b.box(0.09, 0.9, 0.09, 'woodMid', { pos: [x, balconyY + 0.5, balconyZ + 0.72] });
  }
  for (const sx of [-1, 1]) {
    b.box(0.2, 1.05, 0.2, 'woodDark', {
      pos: [(sx * (W + 1.5)) / 2, balconyY + 0.55, balconyZ + 0.72],
    });
  }

  /* --- deep-overhang gable roof --- */
  const roofY = upperY + H2;
  const roofW = D + 4.0; // overhang front and back
  const roofL = W + 3.0; // overhang at the gable ends
  b.prism(roofW, 3.1, roofL, 'roofTile', { pos: [0, roofY, 0] });
  // Ridge cap and eave boards.
  b.box(roofL + 0.2, 0.22, 0.34, 'roofTileDark', { pos: [0, roofY + 3.12, 0] });
  for (const sz of [-1, 1]) {
    b.box(roofL + 0.2, 0.2, 0.3, 'woodDark', {
      pos: [0, roofY + 0.12, (sz * roofW) / 2 - sz * 0.15],
    });
  }
  // Purlins poking out under the eaves — a signature alpine detail.
  for (let i = -3; i <= 3; i++) {
    for (const sz of [-1, 1]) {
      b.box(0.16, 0.16, 0.9, 'woodDark', {
        pos: [i * 2.0, roofY + 0.3, (sz * roofW) / 2 - sz * 0.4],
      });
    }
  }

  /* --- chimney --- */
  b.box(0.9, 2.6, 0.9, 'stoneFoundation', { pos: [-3.2, roofY + 1.9, -1.2] });
  b.box(1.1, 0.25, 1.1, 'rockDark', { pos: [-3.2, roofY + 3.25, -1.2] });

  /* --- front door --- */
  b.box(1.5, 2.4, 0.16, 'woodDark', { pos: [0, 0.7 + 1.2, D / 2 + 0.02] });
  b.box(1.2, 2.1, 0.1, 'woodWarm', { pos: [0, 0.7 + 1.15, D / 2 + 0.1] });
  b.sphere(0.09, 'metal', { pos: [0.42, 0.7 + 1.15, D / 2 + 0.18] }, 8);
  // Porch step.
  b.box(2.4, 0.2, 1.1, 'stoneFoundation', { pos: [0, 0.35, D / 2 + 0.8] });

  /* --- windows with shutters and flower boxes --- */
  const windows: [number, number, number][] = [
    [-3.4, 0.7 + 1.8, D / 2],
    [3.4, 0.7 + 1.8, D / 2],
    [-2.6, upperY + 1.5, D / 2 + 0.25],
    [2.6, upperY + 1.5, D / 2 + 0.25],
  ];
  for (const [x, y, z] of windows) {
    addWindow(b, x, y, z, 0);
  }
  // Gable-end windows.
  addWindow(b, -W / 2 - 0.02, 0.7 + 1.8, 0, Math.PI / 2);
  addWindow(b, W / 2 + 0.02, 0.7 + 1.8, 0, -Math.PI / 2);

  /* --- stacked firewood under the eave --- */
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 9; i++) {
      b.cylinder(
        0.12,
        0.12,
        1.6,
        row % 2 === 0 ? 'trunk' : 'trunkDark',
        {
          pos: [W / 2 + 1.1, 0.75 + row * 0.26, -D / 2 + 0.6 + i * 0.26],
          rot: [0, 0, Math.PI / 2],
        },
        6,
      );
    }
  }

  const shell = new Mesh(b.build(), shellMaterial);
  shell.name = 'chalet-shell';
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  /* --- interior (revealed by the cutaway) --- */
  const interior = buildChaletInterior(W, D, H1, upperY);
  group.add(interior);

  return { group, shell, interior, shellMaterial };
}

function addWindow(b: PartBuilder, x: number, y: number, z: number, rotY: number): void {
  const t: { pos: [number, number, number]; rot: [number, number, number] } = {
    pos: [x, y, z],
    rot: [0, rotY, 0],
  };
  // Frame, glass, mullions.
  b.box(1.5, 1.5, 0.12, 'woodDark', t);
  b.box(1.25, 1.25, 0.06, 'windowGlass', {
    pos: [x + Math.sin(rotY) * 0.06, y, z + Math.cos(rotY) * 0.06],
    rot: [0, rotY, 0],
  });
  b.box(0.08, 1.25, 0.08, 'woodDark', {
    pos: [x + Math.sin(rotY) * 0.1, y, z + Math.cos(rotY) * 0.1],
    rot: [0, rotY, 0],
  });
  b.box(1.25, 0.08, 0.08, 'woodDark', {
    pos: [x + Math.sin(rotY) * 0.1, y, z + Math.cos(rotY) * 0.1],
    rot: [0, rotY, 0],
  });
  // Shutters, thrown open against the wall.
  for (const side of [-1, 1]) {
    const ox = Math.cos(rotY) * side * 1.05;
    const oz = -Math.sin(rotY) * side * 1.05;
    b.box(0.7, 1.5, 0.1, 'shutter', { pos: [x + ox, y, z + oz], rot: [0, rotY, 0] });
    for (let i = 0; i < 3; i++) {
      b.box(0.62, 0.12, 0.12, 'shutterAlt', {
        pos: [
          x + ox + Math.sin(rotY) * 0.06,
          y - 0.45 + i * 0.45,
          z + oz + Math.cos(rotY) * 0.06,
        ],
        rot: [0, rotY, 0],
      });
    }
  }
  // Flower box — the detail that makes the house feel lived in.
  const fx = Math.sin(rotY) * 0.28;
  const fz = Math.cos(rotY) * 0.28;
  b.box(1.5, 0.32, 0.4, 'woodBalcony', { pos: [x + fx, y - 0.9, z + fz], rot: [0, rotY, 0] });
  for (let i = 0; i < 6; i++) {
    const offset = -0.6 + (i / 5) * 1.2;
    const bx = x + fx + Math.cos(rotY) * offset;
    const bz = z + fz - Math.sin(rotY) * offset;
    b.sphere(0.16, i % 2 === 0 ? 'flowerBoxRed' : 'flowerBoxPink', {
      pos: [bx, y - 0.66, bz],
    }, 6);
    b.sphere(0.13, 'deciduousLight', { pos: [bx, y - 0.78, bz + 0.1] }, 6);
  }
}

/**
 * Interior.
 *
 * Every room the child actually uses is on the GROUND floor - kitchen, dining,
 * living corner, the child's bedroom and the bathroom. That is a normal layout
 * for an alpine farmhouse and it means a four-year-old never has to navigate
 * stairs to reach a task. The upper floor holds the parents' room and is set
 * dressing: visible through the cutaway, never entered.
 */
function buildChaletInterior(W: number, D: number, H1: number, upperY: number): Mesh {
  const b = new PartBuilder();
  const floorY = 0.72;

  /* --- floors and the walls that stay when the shell fades --- */
  b.box(W - 0.4, 0.14, D - 0.4, 'woodWarm', { pos: [0, floorY, 0] });
  b.box(W - 0.4, 0.14, D - 0.4, 'woodMid', { pos: [0, upperY + 0.08, 0] });
  b.box(W - 0.4, H1, 0.16, 'wallPlasterShade', { pos: [0, floorY + H1 / 2, -D / 2 + 0.3] });
  for (const sx of [-1, 1]) {
    b.box(0.16, H1, D - 0.6, 'wallPlasterShade', {
      pos: [(sx * W) / 2 - sx * 0.3, floorY + H1 / 2, 0],
    });
  }
  // Half-height dividers mark the rooms without hiding them from the camera.
  b.box(0.14, 1.5, 4.4, 'woodMid', { pos: [1.6, floorY + 0.75, -3.0] });
  b.box(4.6, 1.5, 0.14, 'woodMid', { pos: [4.6, floorY + 0.75, -0.8] });

  /* ---------------- kitchen (back left) ---------------- */
  b.box(4.6, 0.9, 0.9, 'woodMid', { pos: [-4.0, floorY + 0.45, -4.4] });
  b.box(4.7, 0.12, 1.0, 'wallPlaster', { pos: [-4.0, floorY + 0.95, -4.4] });
  b.box(1.0, 0.85, 0.85, 'metalDark', { pos: [-1.4, floorY + 0.43, -4.4] });
  b.cylinder(0.3, 0.3, 0.3, 'metal', { pos: [-1.4, floorY + 1.0, -4.4] }, 10);
  b.cylinder(0.32, 0.32, 0.06, 'bucketRim', { pos: [-1.4, floorY + 1.16, -4.4] }, 10);
  b.box(3.2, 0.1, 0.4, 'woodDark', { pos: [-4.0, floorY + 1.9, -4.7] });
  for (let i = 0; i < 5; i++) {
    b.cylinder(0.14, 0.12, 0.3, i % 2 ? 'flowerBoxRed' : 'windowGlass', {
      pos: [-5.3 + i * 0.66, floorY + 2.05, -4.7],
    }, 8);
  }
  // Hanging pans - a small detail that reads instantly as "kitchen".
  for (let i = 0; i < 3; i++) {
    b.cylinder(0.2, 0.2, 0.08, 'metal', { pos: [-5.6 + i * 0.5, floorY + 1.55, -4.6] }, 8);
  }

  /* ---------------- dining (centre) ---------------- */
  b.box(2.8, 0.14, 1.6, 'woodWarm', { pos: [-1.4, floorY + 0.78, -1.4] });
  for (const [dx, dz] of [[-1.2, -0.6], [1.2, -0.6], [-1.2, 0.6], [1.2, 0.6]] as const) {
    b.box(0.12, 0.78, 0.12, 'woodDark', { pos: [-1.4 + dx, floorY + 0.39, -1.4 + dz] });
  }
  b.box(1.0, 0.04, 0.7, 'motherApron', { pos: [-1.4, floorY + 0.86, -1.4] });
  for (let i = 0; i < 3; i++) {
    b.cylinder(0.16, 0.13, 0.05, 'uiCream', { pos: [-2.2 + i * 0.8, floorY + 0.89, -1.4] }, 10);
  }
  for (const [cx, cz, rot] of [
    [-1.4, -2.5, 0],
    [-1.4, -0.3, Math.PI],
    [-3.2, -1.4, Math.PI / 2],
    [0.4, -1.4, -Math.PI / 2],
  ] as const) {
    b.box(0.6, 0.08, 0.6, 'woodMid', { pos: [cx, floorY + 0.46, cz] });
    b.box(0.6, 0.7, 0.08, 'woodMid', {
      pos: [cx - Math.sin(rot) * 0.28, floorY + 0.8, cz - Math.cos(rot) * 0.28],
      rot: [0, rot, 0],
    });
    for (const [ox, oz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] as const) {
      b.box(0.07, 0.46, 0.07, 'woodDark', { pos: [cx + ox, floorY + 0.23, cz + oz] });
    }
  }

  /* ---------------- living corner (front left) ---------------- */
  b.box(3.4, 0.04, 2.6, 'flowerBoxRed', { pos: [-4.2, floorY + 0.1, 2.6] });
  b.box(2.6, 0.5, 1.0, 'fatherShirt', { pos: [-4.2, floorY + 0.38, 3.1] });
  b.box(2.6, 0.7, 0.3, 'fatherShirt', { pos: [-4.2, floorY + 0.75, 3.6] });
  for (const ox of [-0.8, 0.8]) {
    b.box(0.6, 0.3, 0.8, 'motherDress', { pos: [-4.2 + ox, floorY + 0.62, 3.0] });
  }
  b.box(1.0, 0.5, 0.7, 'woodWarm', { pos: [-4.2, floorY + 0.3, 1.6] });
  // Fireplace on the side wall.
  b.box(0.7, 2.2, 2.0, 'stoneFoundation', { pos: [-6.4, floorY + 1.1, 1.2] });
  b.box(0.4, 0.9, 1.1, 'trunkDark', { pos: [-6.1, floorY + 0.5, 1.2] });
  b.box(0.3, 0.45, 0.9, 'sunGold', { pos: [-6.0, floorY + 0.34, 1.2] });
  b.box(0.9, 0.16, 2.2, 'woodDark', { pos: [-6.3, floorY + 1.7, 1.2] });
  // Toy basket by the sofa.
  b.cylinder(0.42, 0.36, 0.5, 'hay', { pos: [-2.4, floorY + 0.3, 3.4] }, 10);
  for (let i = 0; i < 3; i++) {
    const ball = i === 0 ? 'uiRed' : i === 1 ? 'uiBlue' : 'uiGold';
    b.sphere(0.17, ball, { pos: [-2.4 + (i - 1) * 0.2, floorY + 0.58, 3.4] }, 7);
  }

  /* ---------------- child's bedroom (back right) ---------------- */
  b.box(1.6, 0.42, 2.4, 'woodWarm', { pos: [4.6, floorY + 0.3, -3.2] });
  b.box(1.5, 0.28, 2.1, 'wallPlaster', { pos: [4.6, floorY + 0.64, -3.2] });
  b.box(1.5, 0.3, 1.2, 'fatherShirt', { pos: [4.6, floorY + 0.74, -3.8] });
  b.box(0.95, 0.24, 0.5, 'uiCream', { pos: [4.6, floorY + 0.86, -2.3] });
  b.box(1.7, 1.3, 0.14, 'woodDark', { pos: [4.6, floorY + 0.95, -2.0] });
  // Wardrobe.
  b.box(1.4, 2.2, 0.75, 'woodMid', { pos: [2.5, floorY + 1.1, -4.2] });
  b.box(0.62, 2.0, 0.08, 'woodDark', { pos: [2.16, floorY + 1.1, -3.83] });
  b.box(0.62, 2.0, 0.08, 'woodDark', { pos: [2.86, floorY + 1.1, -3.83] });
  b.sphere(0.07, 'metal', { pos: [2.52, floorY + 1.1, -3.76] }, 6);
  // Toy chest and rug.
  b.box(1.1, 0.62, 0.65, 'flowerBoxRed', { pos: [6.0, floorY + 0.31, -1.4] });
  b.box(1.14, 0.1, 0.69, 'roofTileDark', { pos: [6.0, floorY + 0.65, -1.4] });
  b.box(1.8, 0.04, 1.4, 'meadowFlowerB', { pos: [4.4, floorY + 0.08, -1.3] });

  /* ---------------- bathroom (front right) ---------------- */
  b.box(1.2, 0.18, 0.7, 'uiCream', { pos: [5.9, floorY + 0.9, 1.6] });
  b.box(1.0, 0.8, 0.6, 'wallPlaster', { pos: [5.9, floorY + 0.45, 1.6] });
  b.cylinder(0.05, 0.05, 0.3, 'metal', { pos: [5.9, floorY + 1.05, 1.35] }, 8);
  b.box(0.85, 1.05, 0.08, 'windowGlass', {
    pos: [6.4, floorY + 1.75, 1.6],
    rot: [0, Math.PI / 2, 0],
  });
  b.box(1.8, 0.65, 1.0, 'uiCream', { pos: [5.6, floorY + 0.32, 3.4] });
  b.cylinder(0.05, 0.05, 0.22, 'uiBlue', { pos: [5.6, floorY + 1.02, 1.5] }, 6);
  b.box(0.5, 0.06, 0.3, 'motherApron', { pos: [4.9, floorY + 1.4, 2.4] });

  /* ---------------- stairs + upper floor dressing ---------------- */
  for (let i = 0; i < 8; i++) {
    b.box(1.1, 0.16, 0.44, 'woodMid', { pos: [0.9, floorY + 0.2 + i * 0.38, 4.2 - i * 0.44] });
  }
  const uy = upperY + 0.16;
  b.box(2.3, 0.42, 2.4, 'woodWarm', { pos: [3.2, uy + 0.3, 1.4] });
  b.box(2.2, 0.28, 2.1, 'wallPlaster', { pos: [3.2, uy + 0.64, 1.4] });
  b.box(2.2, 0.3, 1.2, 'motherDress', { pos: [3.2, uy + 0.74, 2.0] });
  b.box(1.5, 2.2, 0.7, 'woodMid', { pos: [-4.0, uy + 1.1, -4.0] });
  b.box(2.0, 0.04, 1.6, 'meadowFlowerC', { pos: [0.0, uy + 0.08, 0.6] });

  const mesh = new Mesh(b.build(), M.vertexPainted());
  mesh.name = 'chalet-interior';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* The barn                                                            */
/* ------------------------------------------------------------------ */

export function buildBarn(rng: Rng): BuildingResult {
  const group = new Group();
  group.name = 'barn';

  const W = 13;
  const D = 10;
  const H = 4.6;

  const shellMaterial = surface({ vertexColors: true, transparent: true, opacity: 1, unique: true });
  const b = new PartBuilder();

  b.box(W + 0.5, 0.6, D + 0.5, 'stoneFoundation', { pos: [0, 0.3, 0] });
  b.box(W, H, D, 'barnRed', { pos: [0, 0.6 + H / 2, 0] });

  // White cross-bracing on the gable ends — instantly reads as "barn".
  for (const sx of [-1, 1]) {
    const x = (sx * W) / 2 + sx * 0.04;
    b.box(0.2, H * 0.95, 0.26, 'wallPlaster', {
      pos: [x, 0.6 + H / 2, 0],
      rot: [0.62, 0, 0],
    });
    b.box(0.2, H * 0.95, 0.26, 'wallPlaster', {
      pos: [x, 0.6 + H / 2, 0],
      rot: [-0.62, 0, 0],
    });
  }
  // Horizontal planking.
  for (let i = 0; i < 7; i++) {
    b.box(W + 0.1, 0.1, D + 0.1, 'barnRedDark', { pos: [0, 0.9 + i * 0.62, 0] });
  }

  // Roof.
  const roofY = 0.6 + H;
  b.prism(D + 2.4, 3.3, W + 1.8, 'roofShingle', { pos: [0, roofY, 0] });
  b.box(W + 2.0, 0.2, 0.3, 'woodDark', { pos: [0, roofY + 3.32, 0] });

  // Big sliding doors, open.
  b.box(2.6, 3.6, 0.14, 'woodMid', { pos: [-2.0, 0.6 + 1.8, D / 2 + 0.05] });
  b.box(2.6, 3.6, 0.14, 'woodMid', { pos: [2.0, 0.6 + 1.8, D / 2 + 0.05] });
  b.box(W - 0.4, 0.16, 0.2, 'metalDark', { pos: [0, 0.6 + 3.7, D / 2 + 0.1] });
  // Dark opening between them so it reads as a way in.
  b.box(2.6, 3.4, 0.1, 'trunkDark', { pos: [0, 0.6 + 1.7, D / 2 - 0.05] });

  // Hay loft door high on the gable, with a hoist beam.
  b.box(1.6, 1.6, 0.12, 'woodDark', { pos: [0, roofY + 1.0, D / 2 + 0.06] });
  b.box(0.2, 0.2, 1.4, 'woodDark', { pos: [0, roofY + 2.2, D / 2 + 0.6] });

  // Loose straw on the ground by the doors.
  for (let i = 0; i < 18; i++) {
    b.box(rng.range(0.25, 0.6), 0.04, 0.06, 'hay', {
      pos: [rng.range(-4, 4), 0.62, D / 2 + rng.range(0.4, 2.4)],
      rot: [0, rng.range(0, Math.PI), 0],
    });
  }

  const shell = new Mesh(b.build(), shellMaterial);
  shell.name = 'barn-shell';
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  // Interior: stalls, hay stack, water trough, milk cans.
  const inner = new PartBuilder();
  inner.box(W - 0.6, 0.1, D - 0.6, 'dirt', { pos: [0, 0.64, 0] });
  for (let i = 0; i < 3; i++) {
    const x = -4 + i * 4;
    inner.box(0.16, 1.5, D - 2.0, 'woodMid', { pos: [x, 1.4, -0.8] });
  }
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < 3 - layer; i++) {
      inner.box(1.5, 1.0, 1.5, 'hay', {
        pos: [-W / 2 + 1.4 + i * 1.6, 1.15 + layer * 1.02, -D / 2 + 1.4],
      });
      inner.box(1.55, 0.08, 1.55, 'hayDark', {
        pos: [-W / 2 + 1.4 + i * 1.6, 1.15 + layer * 1.02 + 0.5, -D / 2 + 1.4],
      });
    }
  }
  for (let i = 0; i < 3; i++) {
    inner.cylinder(0.3, 0.34, 0.9, 'metal', { pos: [4.2, 1.1, -2.4 + i * 1.2] }, 10);
    inner.cylinder(0.2, 0.2, 0.12, 'metalDark', { pos: [4.2, 1.6, -2.4 + i * 1.2] }, 10);
  }

  const interior = new Mesh(inner.build(), M.vertexPainted());
  interior.name = 'barn-interior';
  interior.receiveShadow = true;
  group.add(interior);

  return { group, shell, interior, shellMaterial };
}

/* ------------------------------------------------------------------ */
/* Chicken coop                                                        */
/* ------------------------------------------------------------------ */

export function buildCoop(): Group {
  const group = new Group();
  group.name = 'coop';
  const b = new PartBuilder();

  // Raised hut on legs.
  for (const [x, z] of [
    [-1.3, -0.9],
    [1.3, -0.9],
    [-1.3, 0.9],
    [1.3, 0.9],
  ] as const) {
    b.box(0.16, 0.7, 0.16, 'woodDark', { pos: [x, 0.35, z] });
  }
  b.box(3.2, 1.8, 2.4, 'woodWarm', { pos: [0, 1.6, 0] });
  for (let i = 0; i < 4; i++) {
    b.box(3.26, 0.1, 2.46, 'woodMid', { pos: [0, 0.95 + i * 0.42, 0] });
  }
  b.prism(3.0, 1.1, 3.6, 'roofTile', { pos: [0, 2.5, 0] });

  // Entrance hole and ramp.
  b.box(0.6, 0.7, 0.1, 'trunkDark', { pos: [0, 1.05, 1.22] });
  b.box(0.7, 0.1, 2.0, 'woodMid', { pos: [0, 0.55, 2.1], rot: [-0.45, 0, 0] });
  for (let i = 0; i < 5; i++) {
    b.box(0.7, 0.06, 0.1, 'woodDark', { pos: [0, 0.28 + i * 0.22, 2.85 - i * 0.44], rot: [-0.45, 0, 0] });
  }

  // Nest boxes bumped out of the side, lid slightly ajar.
  b.box(1.0, 0.9, 1.4, 'woodMid', { pos: [2.05, 1.5, 0] });
  b.box(1.1, 0.12, 1.5, 'roofTileDark', { pos: [2.05, 1.99, 0.06], rot: [0, 0, -0.14] });
  b.box(0.85, 0.1, 1.2, 'hay', { pos: [2.05, 1.12, 0] });
  for (let i = 0; i < 3; i++) {
    b.sphere(0.13, 'uiCream', { pos: [2.05, 1.22, -0.4 + i * 0.4], scale: [1, 0.82, 1.15] }, 8);
  }

  // Perch and a feeding tray.
  b.cylinder(0.06, 0.06, 2.4, 'trunk', { pos: [0, 0.9, -1.8], rot: [0, 0, Math.PI / 2] }, 6);
  b.box(1.2, 0.16, 0.5, 'woodDark', { pos: [-1.8, 0.1, 1.6] });
  b.box(1.05, 0.1, 0.36, 'hay', { pos: [-1.8, 0.2, 1.6] });

  const mesh = new Mesh(b.build(), M.vertexPainted());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
