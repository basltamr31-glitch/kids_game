import { Group, Mesh, Object3D, PlaneGeometry, MeshBasicMaterial, DoubleSide } from 'three';
import { PartBuilder } from '../art/MeshKit';
import { Face, type Expression, type FaceStyle } from './Face';
import { damp } from '../core/Rng';

/**
 * Procedural humanoid rig.
 *
 * Bodies are built from primitives once and posed by rotating a small joint
 * hierarchy. Animation is procedural (sine-based) rather than keyframed, which
 * means:
 *   - no animation files to load, so the install stays tiny
 *   - clips blend into each other for free, so the child never sees a pop
 *   - a new action is a ~15-line function, not a trip to an animation tool
 *
 * Proportions are deliberately toy-like: a big head, short limbs, and a low
 * centre of gravity. That is what makes the characters read as "children's
 * book" rather than "low-poly human".
 */

export interface CharacterLook {
  skin: string;
  hair: string;
  hairStyle: number;
  primary: string;
  secondary: string;
  /** Adults are taller and slightly narrower-headed. */
  adult: boolean;
  /** Skirt instead of trousers. */
  skirt: boolean;
  apron?: string;
}

export type ClipName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'wave'
  | 'offer'
  | 'reach'
  | 'reachUp'
  | 'crouchPick'
  | 'crouchPet'
  | 'pour'
  | 'milk'
  | 'scatter'
  | 'eat'
  | 'stir'
  | 'hammer'
  | 'sweep'
  | 'brush'
  | 'spin'
  | 'throw'
  | 'stretch'
  | 'sleep'
  | 'carry';

interface Joints {
  root: Group;
  body: Group; // whole-body bob & lean
  hips: Group;
  torso: Group;
  head: Group;
  armL: Group;
  armR: Group;
  forearmL: Group;
  forearmR: Group;
  legL: Group;
  legR: Group;
  shinL: Group;
  shinR: Group;
  /** Attachment point for carried items. */
  handR: Object3D;
}

export class CharacterRig {
  readonly group = new Group();
  readonly joints: Joints;
  readonly face: Face;

  private clip: ClipName = 'idle';
  private clipTime = 0;
  /** 0..1 blend from the previous clip, keeps transitions soft. */
  private blend = 1;
  private previousClip: ClipName = 'idle';
  private phase = 0;
  private scaleFactor: number;
  private faceMesh: Mesh;

  constructor(look: CharacterLook) {
    const s = look.adult ? 1.0 : 0.72;
    this.scaleFactor = s;

    const faceStyle: FaceStyle = {
      skin: look.skin,
      eye: '#3A2A22',
      blush: '#E8837F',
    };
    this.face = new Face(faceStyle);

    /* --- joint hierarchy --- */
    const root = new Group();
    const body = new Group();
    const hips = new Group();
    const torso = new Group();
    const head = new Group();
    const armL = new Group();
    const armR = new Group();
    const forearmL = new Group();
    const forearmR = new Group();
    const legL = new Group();
    const legR = new Group();
    const shinL = new Group();
    const shinR = new Group();
    const handR = new Object3D();

    root.add(body);
    body.add(hips);
    hips.add(torso, legL, legR);
    torso.add(head, armL, armR);
    armL.add(forearmL);
    armR.add(forearmR);
    forearmR.add(handR);
    legL.add(shinL);
    legR.add(shinR);

    const hipY = 0.86 * s;
    hips.position.y = hipY;
    torso.position.y = 0;
    head.position.y = 0.62 * s;
    armL.position.set(-0.3 * s, 0.46 * s, 0);
    armR.position.set(0.3 * s, 0.46 * s, 0);
    forearmL.position.y = -0.34 * s;
    forearmR.position.y = -0.34 * s;
    handR.position.set(0, -0.34 * s, 0.1 * s);
    legL.position.set(-0.14 * s, 0, 0);
    legR.position.set(0.14 * s, 0, 0);
    shinL.position.y = -0.38 * s;
    shinR.position.y = -0.38 * s;

    this.joints = {
      root,
      body,
      hips,
      torso,
      head,
      armL,
      armR,
      forearmL,
      forearmR,
      legL,
      legR,
      shinL,
      shinR,
      handR,
    };

    /* --- geometry --- */
    torso.add(buildTorso(look, s));
    const headMesh = buildHead(look, s);
    head.add(headMesh);

    // The face is a quad on the front of the head, using the canvas texture.
    const faceGeo = new PlaneGeometry(0.46 * s, 0.46 * s);
    this.faceMesh = new Mesh(
      faceGeo,
      new MeshBasicMaterial({ map: this.face.texture, transparent: false, side: DoubleSide }),
    );
    this.faceMesh.position.set(0, 0.02 * s, 0.295 * s);
    this.faceMesh.renderOrder = 1;
    head.add(this.faceMesh);

    armL.add(buildArm(look, s));
    armR.add(buildArm(look, s));
    forearmL.add(buildForearm(look, s));
    forearmR.add(buildForearm(look, s));
    legL.add(buildLeg(look, s));
    legR.add(buildLeg(look, s));
    shinL.add(buildShin(look, s));
    shinR.add(buildShin(look, s));

    this.group.add(root);
    this.group.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  get height(): number {
    return 1.72 * this.scaleFactor;
  }

  /** Requests a clip. Repeats are ignored so a held state does not restart. */
  play(clip: ClipName, restart = false): void {
    if (this.clip === clip && !restart) return;
    this.previousClip = this.clip;
    this.clip = clip;
    this.clipTime = 0;
    this.blend = 0;
  }

  get currentClip(): ClipName {
    return this.clip;
  }

  setExpression(expression: Expression): void {
    this.face.set(expression);
  }

  /**
   * @param dt      seconds
   * @param speed   horizontal movement speed, drives walk/run cadence
   */
  update(dt: number, speed = 0): void {
    this.clipTime += dt;
    this.blend = Math.min(1, this.blend + dt * 6);
    this.face.update(dt);

    // Stride frequency scales with speed so walking never looks like skating.
    this.phase += dt * (speed > 0.05 ? 2.2 + speed * 1.9 : 1.1);

    const pose = POSE_ZERO();
    applyClip(pose, this.clip, this.clipTime, this.phase, speed);

    if (this.blend < 1) {
      const previous = POSE_ZERO();
      applyClip(previous, this.previousClip, this.clipTime, this.phase, speed);
      blendPose(pose, previous, 1 - this.blend);
    }

    this.commit(pose, dt);
  }

  private commit(pose: Pose, dt: number): void {
    const j = this.joints;
    const k = 18; // smoothing rate; keeps everything buttery without lag

    j.body.position.y = damp(j.body.position.y, pose.bodyY, k, dt);
    j.body.rotation.x = damp(j.body.rotation.x, pose.bodyPitch, k, dt);
    j.body.rotation.z = damp(j.body.rotation.z, pose.bodyRoll, k, dt);

    j.torso.rotation.x = damp(j.torso.rotation.x, pose.torsoPitch, k, dt);
    j.torso.rotation.y = damp(j.torso.rotation.y, pose.torsoYaw, k, dt);

    j.head.rotation.x = damp(j.head.rotation.x, pose.headPitch, k, dt);
    j.head.rotation.y = damp(j.head.rotation.y, pose.headYaw, k, dt);
    j.head.rotation.z = damp(j.head.rotation.z, pose.headRoll, k, dt);

    j.armL.rotation.x = damp(j.armL.rotation.x, pose.armLPitch, k, dt);
    j.armL.rotation.z = damp(j.armL.rotation.z, pose.armLRoll, k, dt);
    j.armR.rotation.x = damp(j.armR.rotation.x, pose.armRPitch, k, dt);
    j.armR.rotation.z = damp(j.armR.rotation.z, pose.armRRoll, k, dt);
    j.forearmL.rotation.x = damp(j.forearmL.rotation.x, pose.forearmL, k, dt);
    j.forearmR.rotation.x = damp(j.forearmR.rotation.x, pose.forearmR, k, dt);

    j.legL.rotation.x = damp(j.legL.rotation.x, pose.legLPitch, k, dt);
    j.legR.rotation.x = damp(j.legR.rotation.x, pose.legRPitch, k, dt);
    j.shinL.rotation.x = damp(j.shinL.rotation.x, pose.shinL, k, dt);
    j.shinR.rotation.x = damp(j.shinR.rotation.x, pose.shinR, k, dt);
  }

  /** Lets the head follow a point of interest — a strong "alive" signal. */
  lookAt(yaw: number, pitch: number, dt: number): void {
    const j = this.joints;
    j.head.rotation.y = damp(j.head.rotation.y, clampAngle(yaw, 0.8), 6, dt);
    j.head.rotation.x = damp(j.head.rotation.x, clampAngle(pitch, 0.4), 6, dt);
  }

  dispose(): void {
    this.face.dispose();
    (this.faceMesh.material as MeshBasicMaterial).dispose();
    this.faceMesh.geometry.dispose();
  }
}

function clampAngle(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/* ------------------------------------------------------------------ */
/* Poses                                                               */
/* ------------------------------------------------------------------ */

interface Pose {
  bodyY: number;
  bodyPitch: number;
  bodyRoll: number;
  torsoPitch: number;
  torsoYaw: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  armLPitch: number;
  armLRoll: number;
  armRPitch: number;
  armRRoll: number;
  forearmL: number;
  forearmR: number;
  legLPitch: number;
  legRPitch: number;
  shinL: number;
  shinR: number;
}

function POSE_ZERO(): Pose {
  return {
    bodyY: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    torsoPitch: 0,
    torsoYaw: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    armLPitch: 0,
    armLRoll: 0.12,
    armRPitch: 0,
    armRRoll: -0.12,
    forearmL: -0.15,
    forearmR: -0.15,
    legLPitch: 0,
    legRPitch: 0,
    shinL: 0,
    shinR: 0,
  };
}

function blendPose(target: Pose, other: Pose, amount: number): void {
  for (const key of Object.keys(target) as (keyof Pose)[]) {
    target[key] = target[key] * (1 - amount) + other[key] * amount;
  }
}

/** All animation in the game lives in this one switch. */
function applyClip(p: Pose, clip: ClipName, t: number, phase: number, speed: number): void {
  const sin = Math.sin;
  const cos = Math.cos;

  switch (clip) {
    case 'walk':
    case 'run': {
      const amp = clip === 'run' ? 1.5 : 1.0;
      const swing = sin(phase) * 0.62 * amp;
      p.legLPitch = swing;
      p.legRPitch = -swing;
      // Knees only bend on the forward half of the stride.
      p.shinL = Math.max(0, -sin(phase)) * 0.75 * amp;
      p.shinR = Math.max(0, sin(phase)) * 0.75 * amp;
      p.armLPitch = -swing * 0.72;
      p.armRPitch = swing * 0.72;
      p.forearmL = -0.3 - Math.max(0, swing) * 0.3;
      p.forearmR = -0.3 - Math.max(0, -swing) * 0.3;
      // Two bobs per stride, plus a little roll — this is what sells the walk.
      p.bodyY = Math.abs(sin(phase)) * 0.055 * amp;
      p.bodyRoll = sin(phase) * 0.05 * amp;
      p.torsoYaw = -sin(phase) * 0.12;
      p.bodyPitch = 0.06 * amp + Math.min(speed * 0.04, 0.12);
      p.headRoll = -sin(phase) * 0.04;
      break;
    }

    case 'idle': {
      // Breathing plus a slow weight shift, so standing still is never static.
      p.bodyY = sin(t * 1.6) * 0.016;
      p.torsoPitch = sin(t * 1.6) * 0.022;
      p.bodyRoll = sin(t * 0.42) * 0.035;
      p.headYaw = sin(t * 0.33) * 0.18;
      p.headPitch = sin(t * 0.47) * 0.05;
      p.armLPitch = sin(t * 1.6 + 0.4) * 0.05;
      p.armRPitch = sin(t * 1.6) * 0.05;
      break;
    }

    case 'wave': {
      p.armRPitch = -2.5;
      p.armRRoll = -0.5;
      p.forearmR = -0.4 + sin(t * 9) * 0.55;
      p.headRoll = 0.12;
      p.bodyY = sin(t * 3) * 0.02;
      break;
    }

    case 'offer': {
      // Both arms forward, palms up, with a small hopeful lean.
      const reach = Math.min(1, t * 3);
      p.armLPitch = -1.35 * reach;
      p.armRPitch = -1.35 * reach;
      p.forearmL = -0.55 * reach;
      p.forearmR = -0.55 * reach;
      p.torsoPitch = 0.16 * reach;
      p.bodyY = sin(t * 4) * 0.012;
      break;
    }

    case 'reach': {
      const reach = Math.min(1, t * 2.6);
      p.armRPitch = -1.6 * reach;
      p.forearmR = -0.3 * reach;
      p.torsoPitch = 0.1 * reach;
      p.torsoYaw = -0.2 * reach;
      break;
    }

    case 'reachUp': {
      const reach = Math.min(1, t * 2.2);
      p.armLPitch = -2.7 * reach;
      p.armRPitch = -2.7 * reach;
      p.forearmL = -0.2;
      p.forearmR = -0.2;
      p.headPitch = -0.42 * reach;
      p.bodyY = 0.07 * reach + Math.abs(sin(t * 5)) * 0.03;
      p.torsoPitch = -0.12 * reach;
      break;
    }

    case 'crouchPick': {
      const crouch = Math.min(1, t * 2.4);
      p.bodyY = -0.34 * crouch;
      p.legLPitch = 0.75 * crouch;
      p.legRPitch = 0.75 * crouch;
      p.shinL = 1.35 * crouch;
      p.shinR = 1.35 * crouch;
      p.torsoPitch = 0.42 * crouch;
      p.headPitch = 0.3 * crouch;
      p.armRPitch = -0.85 * crouch + sin(t * 5) * 0.2 * crouch;
      p.armLPitch = -0.5 * crouch;
      p.forearmR = -0.7;
      break;
    }

    case 'crouchPet': {
      const crouch = Math.min(1, t * 2.2);
      p.bodyY = -0.3 * crouch;
      p.legLPitch = 0.7 * crouch;
      p.legRPitch = 0.7 * crouch;
      p.shinL = 1.25 * crouch;
      p.shinR = 1.25 * crouch;
      p.torsoPitch = 0.3 * crouch;
      p.headPitch = 0.22 * crouch;
      // The stroking motion itself.
      p.armRPitch = -1.0 * crouch + sin(t * 4.2) * 0.3 * crouch;
      p.forearmR = -0.5 + cos(t * 4.2) * 0.18;
      p.headRoll = sin(t * 2.1) * 0.08;
      break;
    }

    case 'pour': {
      const lift = Math.min(1, t * 2.4);
      p.armRPitch = -1.5 * lift;
      p.armLPitch = -1.1 * lift;
      p.forearmR = -0.9 - sin(Math.min(t, 2) * 1.5) * 0.5;
      p.torsoPitch = 0.12 * lift;
      p.headPitch = 0.2 * lift;
      break;
    }

    case 'milk': {
      const crouch = Math.min(1, t * 2.4);
      p.bodyY = -0.38 * crouch;
      p.legLPitch = 0.9 * crouch;
      p.legRPitch = 0.9 * crouch;
      p.shinL = 1.5 * crouch;
      p.shinR = 1.5 * crouch;
      p.torsoPitch = 0.28 * crouch;
      // Alternating hands.
      p.armLPitch = -0.9 + sin(t * 6) * 0.22;
      p.armRPitch = -0.9 + sin(t * 6 + Math.PI) * 0.22;
      p.forearmL = -0.9;
      p.forearmR = -0.9;
      p.headPitch = 0.34 * crouch;
      break;
    }

    case 'scatter': {
      // Wide sweeping throws, alternating side to side.
      const swing = sin(t * 3.4);
      p.armRPitch = -1.1 + swing * 0.5;
      p.armRRoll = -0.4 - swing * 0.5;
      p.forearmR = -0.3;
      p.torsoYaw = swing * 0.3;
      p.bodyY = Math.abs(sin(t * 3.4)) * 0.02;
      break;
    }

    case 'eat': {
      p.torsoPitch = 0.16;
      p.armRPitch = -1.25 + sin(t * 3.2) * 0.35;
      p.forearmR = -1.1 - Math.max(0, sin(t * 3.2)) * 0.5;
      p.headPitch = 0.16 + Math.max(0, sin(t * 3.2)) * 0.1;
      break;
    }

    case 'stir': {
      p.armRPitch = -1.3;
      p.forearmR = -0.7;
      p.armRRoll = -0.3 + sin(t * 5) * 0.32;
      p.torsoYaw = sin(t * 5) * 0.12;
      p.torsoPitch = 0.14;
      p.headPitch = 0.22;
      break;
    }

    case 'hammer': {
      // Sharp down-stroke, slow lift — the rhythm reads as effort.
      const cycle = (t * 2.4) % 1;
      const strike = cycle < 0.25 ? 1 - cycle / 0.25 : (cycle - 0.25) / 0.75;
      p.armRPitch = -2.2 + strike * 1.5;
      p.forearmR = -0.3 - strike * 0.6;
      p.torsoPitch = 0.16 + strike * 0.14;
      p.headPitch = 0.22;
      break;
    }

    case 'sweep': {
      const swing = sin(t * 2.6);
      p.armLPitch = -0.95 + swing * 0.3;
      p.armRPitch = -1.15 + swing * 0.3;
      p.forearmL = -0.5;
      p.forearmR = -0.35;
      p.torsoYaw = swing * 0.34;
      p.torsoPitch = 0.26;
      p.headPitch = 0.28;
      p.bodyY = Math.abs(swing) * 0.02;
      break;
    }

    case 'brush': {
      p.armRPitch = -2.3;
      p.forearmR = -0.75 + sin(t * 11) * 0.3;
      p.headRoll = sin(t * 5.5) * 0.06;
      p.bodyY = sin(t * 11) * 0.008;
      break;
    }

    case 'spin': {
      // A joyful twirl with arms out.
      p.armLPitch = -0.3;
      p.armRPitch = -0.3;
      p.armLRoll = 1.25;
      p.armRRoll = -1.25;
      p.bodyY = Math.abs(sin(t * 4)) * 0.11;
      p.torsoYaw = sin(t * 3) * 0.3;
      p.headRoll = sin(t * 3) * 0.2;
      p.headPitch = -0.2;
      break;
    }

    case 'throw': {
      const cycle = Math.min(1, t * 2.2);
      p.armRPitch = -2.6 + cycle * 3.4;
      p.forearmR = -0.9 + cycle * 0.8;
      p.torsoYaw = 0.4 - cycle * 0.75;
      p.torsoPitch = cycle * 0.2;
      break;
    }

    case 'stretch': {
      const arc = Math.min(1, t * 1.4);
      p.armLPitch = -2.9 * arc;
      p.armRPitch = -2.9 * arc;
      p.armLRoll = 0.35 * arc;
      p.armRRoll = -0.35 * arc;
      p.torsoPitch = -0.28 * arc;
      p.headPitch = -0.35 * arc;
      p.bodyY = 0.09 * arc;
      break;
    }

    case 'sleep': {
      p.bodyPitch = -Math.PI / 2 + 0.06;
      p.bodyY = -0.62;
      p.armLPitch = -0.3;
      p.armRPitch = -0.3;
      p.armLRoll = 0.4;
      p.armRRoll = -0.4;
      p.legLPitch = 0.18;
      p.legRPitch = 0.12;
      // Breathing.
      p.torsoPitch = sin(t * 1.1) * 0.05;
      break;
    }

    case 'carry': {
      // Holding something in front with both hands; walk blends over this.
      p.armLPitch = -1.15;
      p.armRPitch = -1.15;
      p.forearmL = -0.8;
      p.forearmR = -0.8;
      p.torsoPitch = 0.08;
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Body geometry                                                       */
/* ------------------------------------------------------------------ */

function buildTorso(look: CharacterLook, s: number): Mesh {
  const b = new PartBuilder();
  if (look.skirt) {
    b.box(0.52 * s, 0.6 * s, 0.32 * s, look.primary, { pos: [0, 0.3 * s, 0] });
    b.cylinder(0.3 * s, 0.52 * s, 0.42 * s, look.primary, { pos: [0, -0.06 * s, 0] }, 10);
  } else {
    b.box(0.52 * s, 0.72 * s, 0.32 * s, look.primary, { pos: [0, 0.26 * s, 0] });
  }
  // Collar / neckline in the secondary colour.
  b.box(0.54 * s, 0.1 * s, 0.34 * s, look.secondary, { pos: [0, 0.56 * s, 0] });
  // Neck.
  b.cylinder(0.11 * s, 0.11 * s, 0.14 * s, look.skin, { pos: [0, 0.62 * s, 0] }, 8);

  if (look.apron) {
    b.box(0.4 * s, 0.56 * s, 0.06 * s, look.apron, { pos: [0, 0.18 * s, 0.17 * s] });
    b.box(0.1 * s, 0.3 * s, 0.05 * s, look.apron, { pos: [-0.14 * s, 0.48 * s, 0.17 * s] });
    b.box(0.1 * s, 0.3 * s, 0.05 * s, look.apron, { pos: [0.14 * s, 0.48 * s, 0.17 * s] });
  }

  // A simple button placket adds a lot of perceived tailoring for 2 boxes.
  if (!look.skirt) {
    for (let i = 0; i < 3; i++) {
      b.sphere(0.028 * s, look.secondary, { pos: [0, 0.4 * s - i * 0.16 * s, 0.17 * s] }, 5);
    }
  }

  return b.toMesh('torso');
}

function buildHead(look: CharacterLook, s: number): Mesh {
  const b = new PartBuilder();
  const headR = look.adult ? 0.27 * s : 0.3 * s;

  // Slightly squashed sphere reads friendlier than a perfect one.
  b.sphere(headR, look.skin, { scale: [1.0, 1.06, 0.98] }, 12);

  // Ears.
  for (const side of [-1, 1]) {
    b.sphere(0.07 * s, look.skin, { pos: [side * headR * 0.98, -0.02 * s, 0], scale: [0.6, 1, 0.8] }, 6);
  }

  /* --- hair: four styles, all silhouette-driven --- */
  const hair = look.hair;
  switch (look.hairStyle % 4) {
    case 0: // short and round
      b.sphere(headR * 1.06, hair, { pos: [0, 0.06 * s, -0.01 * s], scale: [1, 0.86, 1] }, 12);
      b.box(headR * 1.9, 0.09 * s, 0.1 * s, hair, { pos: [0, 0.16 * s, headR * 0.92] });
      break;
    case 1: // bob with a fringe
      b.sphere(headR * 1.09, hair, { pos: [0, 0.04 * s, -0.02 * s], scale: [1.04, 0.95, 1.02] }, 12);
      for (const side of [-1, 1]) {
        b.box(0.13 * s, 0.36 * s, 0.24 * s, hair, {
          pos: [side * headR * 0.95, -0.12 * s, -0.02 * s],
        });
      }
      b.box(headR * 1.8, 0.14 * s, 0.12 * s, hair, { pos: [0, 0.13 * s, headR * 0.9] });
      break;
    case 2: // ponytails
      b.sphere(headR * 1.05, hair, { pos: [0, 0.06 * s, -0.01 * s], scale: [1, 0.85, 1] }, 12);
      for (const side of [-1, 1]) {
        b.sphere(0.13 * s, hair, { pos: [side * headR * 1.1, 0.05 * s, -0.08 * s] }, 8);
        b.capsule(0.09 * s, 0.26 * s, hair, {
          pos: [side * headR * 1.25, -0.14 * s, -0.12 * s],
          rot: [0, 0, side * -0.35],
        });
      }
      break;
    default: // curly / tousled
      b.sphere(headR * 1.02, hair, { pos: [0, 0.05 * s, -0.01 * s], scale: [1, 0.85, 1] }, 10);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        b.sphere(
          0.105 * s,
          hair,
          { pos: [Math.cos(a) * headR * 0.8, 0.16 * s + (i % 2) * 0.05 * s, Math.sin(a) * headR * 0.7] },
          6,
        );
      }
      break;
  }

  return b.toMesh('head');
}

function buildArm(look: CharacterLook, s: number): Mesh {
  const b = new PartBuilder();
  b.capsule(0.085 * s, 0.26 * s, look.primary, { pos: [0, -0.17 * s, 0] });
  // Shoulder cap smooths the joint.
  b.sphere(0.1 * s, look.primary, { pos: [0, 0, 0] }, 8);
  return b.toMesh('arm');
}

function buildForearm(look: CharacterLook, s: number): Mesh {
  const b = new PartBuilder();
  b.capsule(0.075 * s, 0.22 * s, look.skin, { pos: [0, -0.15 * s, 0] });
  b.sphere(0.095 * s, look.skin, { pos: [0, -0.32 * s, 0.02 * s] }, 8);
  return b.toMesh('forearm');
}

function buildLeg(look: CharacterLook, s: number): Mesh {
  const b = new PartBuilder();
  const tint = look.skirt ? look.skin : look.secondary;
  b.capsule(0.095 * s, 0.26 * s, tint, { pos: [0, -0.2 * s, 0] });
  return b.toMesh('leg');
}

function buildShin(look: CharacterLook, s: number): Mesh {
  const b = new PartBuilder();
  b.capsule(0.085 * s, 0.24 * s, look.skirt ? look.skin : look.secondary, {
    pos: [0, -0.18 * s, 0],
  });
  // Boot.
  b.box(0.15 * s, 0.13 * s, 0.26 * s, 'shoe', { pos: [0, -0.36 * s, 0.04 * s] });
  b.box(0.16 * s, 0.05 * s, 0.28 * s, 'trunkDark', { pos: [0, -0.42 * s, 0.05 * s] });
  return b.toMesh('shin');
}
