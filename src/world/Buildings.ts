import { Group, Mesh, Vector3, type Material } from 'three';
import { PartBuilder } from '../art/MeshKit';
import { surface, M } from '../art/Materials';
import type { Rng } from '../core/Rng';

/**
 * The chalet's half-height room dividers, in house-local metres (x, z centre,
 * w along x, d along z). Shared with the camera, which treats them as things
 * it cannot see through; they are deliberately not solid to the child, whose
 * route into the bedroom squeezes past the end of one.
 */
export const CHALET_DIVIDERS = [
  { x: 1.6, z: -3.0, w: 0.16, d: 4.4 },
  { x: 4.6, z: -0.8, w: 4.6, d: 0.16 },
  { x: 3.6, z: 2.6, w: 0.16, d: 3.2 },
] as const;

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
  /** Local-space point smoke leaves from, for buildings with a chimney. */
  chimneyTop?: Vector3;
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

  const shellMaterial = surface({
    vertexColors: true,
    transparent: true,
    opacity: 1,
    unique: true,
    detail: 'wood',
    detailScale: 1.1,
    detailStrength: 0.42,
  });

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

  const shell = new Mesh(b.build({ groundY: 0 }), shellMaterial);
  shell.name = 'chalet-shell';
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  /* --- upper floor ---
   *
   * Built into the SHELL rather than the interior, which is the whole trick
   * behind the interior camera. The shell is "everything that should get out
   * of the way once you are inside", and a solid first floor over the child's
   * head is exactly that: it is what stopped the camera being able to look
   * down into the room at all. Fading with the outer walls means the ceiling
   * lifts off at precisely the moment the child walks in.
   */
  {
    const uy = upperY + 0.16;
    b.box(W - 0.4, 0.14, D - 0.4, 'woodMid', { pos: [0, upperY + 0.08, 0] });
    b.bevelBox(2.3, 0.42, 2.4, 0.04, 'woodWarm', { pos: [3.2, uy + 0.3, 1.4] });
    b.bevelBox(2.2, 0.26, 2.1, 0.08, 'wallPlaster', { pos: [3.2, uy + 0.64, 1.4] });
    b.bevelBox(2.2, 0.2, 1.2, 0.07, 'motherDress', { pos: [3.2, uy + 0.74, 2.0] });
    b.bevelBox(1.5, 2.2, 0.7, 0.03, 'woodMid', { pos: [-4.0, uy + 1.1, -4.0] });
    b.bevelBox(2.0, 0.04, 1.6, 0.01, 'meadowFlowerC', { pos: [0.0, uy + 0.08, 0.6] });
  }

  /* --- interior (revealed by the cutaway) --- */
  const interior = buildChaletInterior(W, D, H1, upperY);
  group.add(interior);

  return { group, shell, interior, shellMaterial, chimneyTop: new Vector3(-3.2, roofY + 3.4, -1.2) };
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
 * Interior architecture only.
 *
 * Floors, walls, the fireplace and the stairs. Every piece of FURNITURE lives
 * in `Furniture.ts` as a separate interactive object with sockets and seats,
 * because a table you can put a plate on cannot be baked into a static mesh.
 *
 * Every room the child uses is on the GROUND floor, which is a normal layout
 * for an alpine farmhouse and means a four-year-old never navigates stairs to
 * reach a task. The upper floor is set dressing seen through the cutaway.
 */
function buildChaletInterior(W: number, D: number, H1: number, upperY: number): Mesh {
  const b = new PartBuilder();
  const floorY = 0.72;

  /* --- floor: laid as boards, running front to back --- */
  const boards = 16;
  for (let i = 0; i < boards; i++) {
    const x = -(W - 0.4) / 2 + ((i + 0.5) * (W - 0.4)) / boards;
    b.bevelBox((W - 0.4) / boards - 0.012, 0.14, D - 0.4, 0.008,
      i % 3 === 0 ? 'woodMid' : i % 3 === 1 ? 'woodWarm' : 'woodBalcony',
      { pos: [x, floorY, 0] });
  }

  /* --- walls that remain when the shell fades --- */
  b.box(W - 0.4, H1, 0.18, 'wallPlasterShade', { pos: [0, floorY + H1 / 2, -D / 2 + 0.3] });
  for (const sx of [-1, 1]) {
    b.box(0.18, H1, D - 0.6, 'wallPlasterShade', {
      pos: [(sx * W) / 2 - sx * 0.3, floorY + H1 / 2, 0],
    });
  }
  // Skirting, which is most of what makes an interior read as a room.
  b.box(W - 0.4, 0.14, 0.06, 'woodDark', { pos: [0, floorY + 0.14, -D / 2 + 0.4] });
  for (const sx of [-1, 1]) {
    b.box(0.06, 0.14, D - 0.6, 'woodDark', { pos: [(sx * W) / 2 - sx * 0.42, floorY + 0.14, 0] });
  }
  // Exposed ceiling beams.
  for (let i = 0; i < 5; i++) {
    b.bevelBox(W - 0.5, 0.18, 0.2, 0.03, 'woodDark', {
      pos: [0, upperY - 0.14, -D / 2 + 1.2 + i * 2.1],
    });
  }

  /* --- half-height room dividers --- */
  // They mark the rooms without hiding them from the cutaway camera.
  for (const d of CHALET_DIVIDERS) {
    b.bevelBox(d.w, 1.55, d.d, 0.03, 'woodMid', { pos: [d.x, floorY + 0.78, d.z] });
  }

  /* --- fireplace --- */
  b.bevelBox(0.72, 2.3, 2.1, 0.05, 'stoneFoundation', { pos: [-6.3, floorY + 1.15, 1.2] });
  // Coursed stone face.
  for (let row = 0; row < 7; row++) {
    for (let i = 0; i < 4; i++) {
      b.bevelBox(0.1, 0.28, 0.48, 0.02, row % 2 ? 'rock' : 'rockDark', {
        pos: [-5.94, floorY + 0.2 + row * 0.32, 0.4 + i * 0.52 + (row % 2) * 0.1],
      });
    }
  }
  b.box(0.44, 0.92, 1.1, 'trunkDark', { pos: [-6.1, floorY + 0.5, 1.2] });
  // Logs and a fire.
  for (let i = 0; i < 4; i++) {
    b.cylinder(0.07, 0.07, 0.5, 'trunk', {
      pos: [-6.05, floorY + 0.12 + (i % 2) * 0.12, 1.0 + i * 0.12],
      rot: [Math.PI / 2, 0, 0.2 + i * 0.3],
    }, 6);
  }
  b.cone(0.22, 0.42, 'sunGold', { pos: [-6.05, floorY + 0.3, 1.2] }, 7);
  b.cone(0.13, 0.28, 'chickenBeak', { pos: [-6.05, floorY + 0.34, 1.2] }, 6);
  // Mantel with a couple of small objects on it.
  b.bevelBox(0.9, 0.16, 2.3, 0.03, 'woodDark', { pos: [-6.2, floorY + 1.62, 1.2] });
  b.lathe([[0, 0], [0.07, 0.01], [0.06, 0.14], [0.08, 0.17], [0, 0.17]], 'flowerBoxRed', {
    pos: [-6.2, floorY + 1.7, 0.6],
  }, 10);
  b.box(0.1, 0.22, 0.16, 'uiBlue', { pos: [-6.2, floorY + 1.81, 1.7], rot: [0, 0.3, 0] });

  /* --- stairs --- */
  for (let i = 0; i < 9; i++) {
    b.bevelBox(1.1, 0.16, 0.44, 0.02, 'woodMid', {
      pos: [0.9, floorY + 0.2 + i * 0.34, 4.3 - i * 0.44],
    });
    b.box(1.0, 0.3, 0.05, 'woodDark', { pos: [0.9, floorY + 0.05 + i * 0.34, 4.1 - i * 0.44] });
  }
  // Stair rail.
  for (let i = 0; i < 5; i++) {
    b.bevelBox(0.07, 0.75, 0.07, 0.015, 'woodDark', {
      pos: [1.48, floorY + 0.5 + i * 0.68, 4.2 - i * 0.88],
    });
  }

  // No groundY here: this mesh IS the floor, so grounding it would darken the
  // very surface the room is lit through. Furniture still grounds against it.
  const mesh = new Mesh(b.build({ aoStrength: 0.4 }), M.built('wood', 1.5));
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

  const shellMaterial = surface({
    vertexColors: true,
    transparent: true,
    opacity: 1,
    unique: true,
    detail: 'wood',
    detailScale: 1.1,
    detailStrength: 0.42,
  });
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

  const shell = new Mesh(b.build({ groundY: 0 }), shellMaterial);
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

  const interior = new Mesh(inner.build({ groundY: 0.6 }), M.built('wood', 1.3));
  interior.name = 'barn-interior';
  interior.receiveShadow = true;
  group.add(interior);

  return { group, shell, interior, shellMaterial, chimneyTop: new Vector3(-3.2, roofY + 3.4, -1.2) };
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

  const mesh = new Mesh(b.build({ groundY: 0 }), M.built('wood', 1.4));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
