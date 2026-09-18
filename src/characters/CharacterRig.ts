import { Group, Mesh, Object3D, SphereGeometry, type Material } from 'three';
import { PartBuilder } from '../art/MeshKit';
import { M } from '../art/Materials';
import { Face, type Expression, type FaceStyle } from './Face';
import { damp, clamp01 } from '../core/Rng';

/**
 * Procedural humanoid rig.
 *
 * Bodies are built from primitives once and posed by rotating a joint
 * hierarchy. Animation is procedural rather than keyframed, which means no
 * animation files, free blending between any two clips, and a new action being
 * a short function rather than a trip to an animation tool.
 *
 * SKELETON
 *   root > body > hips > spine > chest > neck > head
 *                        chest > shoulder > upperArm > forearm > hand
 *                        hips  > thigh > shin > foot
 *
 * A real spine matters more than it sounds: it is what lets the character lean
 * into a reach, settle when they stop, and counter-rotate their shoulders
 * against their hips while walking. Without it everything reads as a puppet
 * rotating at the waist.
 *
 * LAYERS
 *   1. base clip      - the action being performed
 *   2. cross-fade     - blended from the previous clip over ~0.22s
 *   3. additive look  - head and eyes tracking a point of interest
 *   4. secondary      - hair and skirt lag, driven by joint velocity
 */

export interface CharacterLook {
  skin: string;
  hair: string;
  hairStyle: number;
  primary: string;
  secondary: string;
  adult: boolean;
  skirt: boolean;
  apron?: string;
  freckles?: boolean;
}

export type ClipName =
  /* locomotion */
  | 'idle'
  | 'idleTired'
  | 'walk'
  | 'run'
  | 'lookAround'
  /* social */
  | 'wave'
  | 'cheer'
  | 'shrug'
  /* object handling */
  | 'pickUpLow'
  | 'pickUpHigh'
  | 'place'
  | 'carry'
  | 'offer'
  | 'reach'
  | 'reachUp'
  | 'openDoor'
  | 'throw'
  /* seated */
  | 'sitDown'
  | 'sitIdle'
  | 'sitEat'
  | 'sitDrink'
  | 'standUp'
  /* chores */
  | 'pour'
  | 'milk'
  | 'scatter'
  | 'stir'
  | 'hammer'
  | 'sweep'
  | 'washHands'
  | 'brushTeeth'
  | 'crouchPet'
  | 'crouchPick'
  /* rest */
  | 'stretch'
  | 'yawn'
  | 'sleep'
  | 'spin';

/** Clips that play once and then hand back to whatever asked for them. */
export const ONE_SHOT_CLIPS = new Set<ClipName>([
  'pickUpLow', 'pickUpHigh', 'place', 'openDoor', 'throw',
  'sitDown', 'standUp', 'stretch', 'yawn', 'wave', 'cheer', 'shrug',
]);

/** Nominal length in seconds. Used by the activity system to time steps. */
export const CLIP_DURATION: Partial<Record<ClipName, number>> = {
  pickUpLow: 1.5, pickUpHigh: 1.2, place: 1.2, openDoor: 1.1, throw: 0.9,
  sitDown: 1.1, standUp: 1.0, stretch: 1.8, yawn: 1.6, wave: 1.8,
  cheer: 1.4, shrug: 1.2,
};

interface Joints {
  root: Group;
  body: Group;
  hips: Group;
  spine: Group;
  chest: Group;
  neck: Group;
  head: Group;
  shoulderL: Group; shoulderR: Group;
  armL: Group; armR: Group;
  forearmL: Group; forearmR: Group;
  handL: Group; handR: Group;
  thighL: Group; thighR: Group;
  shinL: Group; shinR: Group;
  footL: Group; footR: Group;
  hair: Group;
  /** Attachment point for a carried item. */
  holdR: Object3D;
  holdL: Object3D;
  /** Where speech bubbles and emotes anchor. */
  emote: Object3D;
}

export class CharacterRig {
  readonly group = new Group();
  readonly joints: Joints;
  readonly face: Face;

  private clip: ClipName = 'idle';
  private previousClip: ClipName = 'idle';
  private clipTime = 0;
  private blend = 1;
  private phase = 0;
  private scaleFactor: number;
  private faceMesh: Mesh;

  /** Additive look-at, in radians relative to the chest. */
  private lookYaw = 0;
  private lookPitch = 0;
  private lookWeight = 0;

  /** Secondary motion state for hair. */
  private hairSwing = 0;
  private hairVel = 0;
  private lastYaw = 0;

  private pose: Pose = zeroPose();
  private scratchA: Pose = zeroPose();
  private scratchB: Pose = zeroPose();

  /** Fires when a stride plants a foot, so footsteps sync to the animation. */
  onFootPlant: ((foot: 'left' | 'right') => void) | null = null;
  private lastStrideSign = 0;

  constructor(look: CharacterLook) {
    const s = look.adult ? 1.0 : 0.76;
    this.scaleFactor = s;

    const faceStyle: FaceStyle = {
      skin: look.skin,
      eye: '#3A2A22',
      brow: look.hair,
      blush: '#E08078',
      freckles: look.freckles ?? !look.adult,
    };
    this.face = new Face(faceStyle);

    /* ---------------- skeleton ---------------- */
    const mk = (): Group => new Group();
    const root = mk(), body = mk(), hips = mk(), spine = mk(), chest = mk();
    const neck = mk(), head = mk(), hair = mk();
    const shoulderL = mk(), shoulderR = mk(), armL = mk(), armR = mk();
    const forearmL = mk(), forearmR = mk(), handL = mk(), handR = mk();
    const thighL = mk(), thighR = mk(), shinL = mk(), shinR = mk();
    const footL = mk(), footR = mk();
    const holdR = new Object3D(), holdL = new Object3D(), emote = new Object3D();

    root.add(body);
    body.add(hips);
    hips.add(spine, thighL, thighR);
    spine.add(chest);
    chest.add(neck, shoulderL, shoulderR);
    neck.add(head);
    head.add(hair, emote);
    shoulderL.add(armL); shoulderR.add(armR);
    armL.add(forearmL); armR.add(forearmR);
    forearmL.add(handL); forearmR.add(handR);
    handR.add(holdR); handL.add(holdL);
    thighL.add(shinL); thighR.add(shinR);
    shinL.add(footL); shinR.add(footR);

    // Proportions are deliberately toy-like: a large head, a short torso and a
    // low centre of gravity. That is what reads as "children's book" rather
    // than "low-poly human".
    const hipH = 0.82 * s;
    hips.position.y = hipH;
    spine.position.y = 0.06 * s;
    chest.position.y = 0.26 * s;
    neck.position.y = 0.28 * s;
    head.position.y = 0.17 * s;
    shoulderL.position.set(-0.19 * s, 0.17 * s, 0);
    shoulderR.position.set(0.19 * s, 0.17 * s, 0);
    armL.position.set(-0.09 * s, 0, 0);
    armR.position.set(0.09 * s, 0, 0);
    forearmL.position.y = -0.27 * s;
    forearmR.position.y = -0.27 * s;
    handL.position.y = -0.25 * s;
    handR.position.y = -0.25 * s;
    holdR.position.set(0, -0.09 * s, 0.05 * s);
    holdL.position.set(0, -0.09 * s, 0.05 * s);
    thighL.position.set(-0.115 * s, -0.04 * s, 0);
    thighR.position.set(0.115 * s, -0.04 * s, 0);
    shinL.position.y = -0.34 * s;
    shinR.position.y = -0.34 * s;
    footL.position.y = -0.32 * s;
    footR.position.y = -0.32 * s;
    emote.position.y = 0.34 * s;

    this.joints = {
      root, body, hips, spine, chest, neck, head, hair,
      shoulderL, shoulderR, armL, armR, forearmL, forearmR, handL, handR,
      thighL, thighR, shinL, shinR, footL, footR, holdR, holdL, emote,
    };

    /* ---------------- geometry ---------------- */
    const skinMat = M.creature();
    const clothMat = M.cloth();

    hips.add(buildPelvis(look, s, clothMat));
    spine.add(buildTorso(look, s, clothMat));
    chest.add(buildChest(look, s, clothMat));
    neck.add(buildNeck(look, s, skinMat));
    head.add(buildHead(look, s, skinMat));
    hair.add(buildHair(look, s));

    for (const side of [-1, 1] as const) {
      const shoulder = side < 0 ? shoulderL : shoulderR;
      const arm = side < 0 ? armL : armR;
      const forearm = side < 0 ? forearmL : forearmR;
      const hand = side < 0 ? handL : handR;
      shoulder.add(buildShoulder(look, s, clothMat));
      arm.add(buildUpperArm(look, s, clothMat));
      forearm.add(buildForearm(look, s, skinMat));
      hand.add(buildHand(look, s, skinMat));
    }
    for (const side of [-1, 1] as const) {
      const thigh = side < 0 ? thighL : thighR;
      const shin = side < 0 ? shinL : shinR;
      const foot = side < 0 ? footL : footR;
      thigh.add(buildThigh(look, s, clothMat, skinMat));
      shin.add(buildShin(look, s, skinMat));
      foot.add(buildShoe(look, s));
    }

    // The face is a lightly curved patch on the front of the head, cut from a
    // sphere of the same radius so it sits flush instead of floating as a
    // flat card. Transparent + depthWrite off so the feathered edge blends.
    const headR = look.adult ? 0.25 * s : 0.275 * s;
    // phi is centred on PI/2, which is +Z in three's sphere convention — the
    // direction the character faces. Getting this wrong puts the face on the
    // side of the head.
    const faceGeo = new SphereGeometry(
      headR * 1.015, 16, 14,
      Math.PI * 0.22, Math.PI * 0.56,   // phi:   centred on +Z
      Math.PI * 0.27, Math.PI * 0.47,   // theta: centred just above the middle
    );
    const faceMat = M.face(this.face.texture);
    (faceMat as unknown as { depthWrite: boolean }).depthWrite = false;
    this.faceMesh = new Mesh(faceGeo, faceMat);
    this.faceMesh.position.set(0, 0.015 * s, 0);
    this.faceMesh.renderOrder = 1;
    head.add(this.faceMesh);

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
    return 1.76 * this.scaleFactor;
  }

  get scale(): number {
    return this.scaleFactor;
  }

  get currentClip(): ClipName {
    return this.clip;
  }

  /** How far through a one-shot clip we are, 0..1. */
  get clipProgress(): number {
    const duration = CLIP_DURATION[this.clip] ?? 1;
    return clamp01(this.clipTime / duration);
  }

  play(clip: ClipName, restart = false): void {
    if (this.clip === clip && !restart) return;
    this.previousClip = this.clip;
    this.clip = clip;
    this.clipTime = 0;
    this.blend = 0;
  }

  setExpression(expression: Expression): void {
    this.face.set(expression);
  }

  /**
   * Additive head and eye tracking.
   * @param yaw   radians relative to the character's facing
   * @param pitch radians, positive is up
   * @param weight 0 ignores the target entirely, 1 tracks it fully
   */
  lookTowards(yaw: number, pitch: number, weight = 1): void {
    this.lookYaw = yaw;
    this.lookPitch = pitch;
    this.lookWeight = weight;
  }

  clearLook(): void {
    this.lookWeight = 0;
  }

  update(dt: number, speed = 0): void {
    this.clipTime += dt;
    this.blend = Math.min(1, this.blend + dt / 0.22);
    this.face.update(dt);

    // Stride frequency scales with speed so walking never looks like skating.
    const cadence = speed > 0.05 ? 2.0 + speed * 1.75 : 1.05;
    this.phase += dt * cadence;

    const pose = this.scratchA;
    resetPose(pose);
    applyClip(pose, this.clip, this.clipTime, this.phase, speed);

    if (this.blend < 1) {
      const previous = this.scratchB;
      resetPose(previous);
      applyClip(previous, this.previousClip, this.clipTime, this.phase, speed);
      blendPose(pose, previous, 1 - this.blend);
    }

    this.applyLookLayer(pose);
    this.commit(pose, dt, speed);
  }

  /**
   * Look-at is applied on top of the clip rather than inside it, so a character
   * can watch the child while doing anything else. The rotation is split
   * between chest, neck and head the way a real body distributes it.
   */
  private applyLookLayer(pose: Pose): void {
    if (this.lookWeight <= 0.001) return;
    const w = clamp01(this.lookWeight);
    const yaw = clampAngle(this.lookYaw, 1.5);
    const pitch = clampAngle(this.lookPitch, 0.6);

    pose.chestYaw += yaw * 0.22 * w;
    pose.neckYaw += yaw * 0.34 * w;
    pose.headYaw += yaw * 0.44 * w;
    pose.neckPitch += pitch * 0.4 * w;
    pose.headPitch += pitch * 0.6 * w;

    // Eyes lead the head. They reach the target first and overshoot slightly,
    // which is exactly what real gaze does and reads as attention.
    this.face.lookAt(clamp01(Math.abs(yaw) / 1.2) * Math.sign(yaw), pitch / 0.6);
  }

  private commit(pose: Pose, dt: number, speed: number): void {
    const j = this.joints;
    const k = 16;
    const p = this.pose;

    // Smooth every channel toward the target pose. Doing it here rather than
    // inside the clips means every clip transition is soft for free.
    for (const key of POSE_KEYS) {
      p[key] = damp(p[key], pose[key], k, dt);
    }

    j.body.position.y = p.bodyY;
    j.body.rotation.set(p.bodyPitch, p.bodyYaw, p.bodyRoll);
    j.hips.rotation.set(p.hipsPitch, p.hipsYaw, p.hipsRoll);
    j.spine.rotation.set(p.spinePitch, p.spineYaw, p.spineRoll);
    j.chest.rotation.set(p.chestPitch, p.chestYaw, p.chestRoll);
    j.neck.rotation.set(p.neckPitch, p.neckYaw, p.neckRoll);
    j.head.rotation.set(p.headPitch, p.headYaw, p.headRoll);

    j.shoulderL.rotation.z = p.shoulderL;
    j.shoulderR.rotation.z = -p.shoulderR;
    j.armL.rotation.set(p.armLPitch, p.armLYaw, p.armLRoll);
    j.armR.rotation.set(p.armRPitch, p.armRYaw, -p.armRRoll);
    j.forearmL.rotation.set(p.forearmL, 0, 0);
    j.forearmR.rotation.set(p.forearmR, 0, 0);
    j.handL.rotation.set(p.handL, 0, 0);
    j.handR.rotation.set(p.handR, 0, 0);

    j.thighL.rotation.set(p.thighLPitch, 0, p.thighLRoll);
    j.thighR.rotation.set(p.thighRPitch, 0, -p.thighRRoll);
    j.shinL.rotation.x = p.shinL;
    j.shinR.rotation.x = p.shinR;
    j.footL.rotation.x = p.footL;
    j.footR.rotation.x = p.footR;

    /* --- secondary motion: hair lags behind the head --- */
    const yawNow = j.head.rotation.y + this.group.rotation.y;
    const yawDelta = (yawNow - this.lastYaw) / Math.max(dt, 0.001);
    this.lastYaw = yawNow;
    // A damped spring driven by head angular velocity and vertical bob.
    const drive = -yawDelta * 0.02 - (pose.bodyY - p.bodyY) * 2;
    this.hairVel += (drive - this.hairSwing * 16 - this.hairVel * 5) * dt;
    this.hairSwing += this.hairVel * dt;
    this.hairSwing = Math.max(-0.35, Math.min(0.35, this.hairSwing));
    j.hair.rotation.z = this.hairSwing;
    j.hair.rotation.x = -Math.abs(this.hairSwing) * 0.3;

    /* --- footstep events --- */
    if (speed > 0.2 && (this.clip === 'walk' || this.clip === 'run')) {
      const sign = Math.sign(Math.sin(this.phase));
      if (sign !== 0 && sign !== this.lastStrideSign) {
        this.lastStrideSign = sign;
        this.onFootPlant?.(sign > 0 ? 'right' : 'left');
      }
    } else {
      this.lastStrideSign = 0;
    }
  }

  dispose(): void {
    this.face.dispose();
    (this.faceMesh.material as Material).dispose();
    this.faceMesh.geometry.dispose();
  }
}

function clampAngle(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/* ------------------------------------------------------------------ */
/* Pose                                                                */
/* ------------------------------------------------------------------ */

interface Pose {
  bodyY: number; bodyPitch: number; bodyRoll: number; bodyYaw: number;
  hipsPitch: number; hipsRoll: number; hipsYaw: number;
  spinePitch: number; spineRoll: number; spineYaw: number;
  chestPitch: number; chestRoll: number; chestYaw: number;
  neckPitch: number; neckRoll: number; neckYaw: number;
  headPitch: number; headRoll: number; headYaw: number;
  shoulderL: number; shoulderR: number;
  armLPitch: number; armLRoll: number; armLYaw: number;
  armRPitch: number; armRRoll: number; armRYaw: number;
  forearmL: number; forearmR: number;
  handL: number; handR: number;
  thighLPitch: number; thighRPitch: number; thighLRoll: number; thighRRoll: number;
  shinL: number; shinR: number;
  footL: number; footR: number;
}

const REST: Pose = {
  bodyY: 0, bodyPitch: 0, bodyRoll: 0, bodyYaw: 0,
  hipsPitch: 0, hipsRoll: 0, hipsYaw: 0,
  spinePitch: 0, spineRoll: 0, spineYaw: 0,
  chestPitch: 0, chestRoll: 0, chestYaw: 0,
  neckPitch: 0, neckRoll: 0, neckYaw: 0,
  headPitch: 0, headRoll: 0, headYaw: 0,
  // A small outward roll keeps the arms off the ribs at rest.
  shoulderL: 0.1, shoulderR: 0.1,
  armLPitch: 0.04, armLRoll: 0.1, armLYaw: 0,
  armRPitch: 0.04, armRRoll: 0.1, armRYaw: 0,
  forearmL: -0.22, forearmR: -0.22,
  handL: 0, handR: 0,
  thighLPitch: 0, thighRPitch: 0, thighLRoll: 0, thighRRoll: 0,
  shinL: 0.04, shinR: 0.04,
  footL: 0, footR: 0,
};

const POSE_KEYS = Object.keys(REST) as (keyof Pose)[];

function zeroPose(): Pose {
  return { ...REST };
}

function resetPose(pose: Pose): void {
  for (const key of POSE_KEYS) pose[key] = REST[key];
}

function blendPose(target: Pose, other: Pose, amount: number): void {
  for (const key of POSE_KEYS) {
    target[key] = target[key] * (1 - amount) + other[key] * amount;
  }
}

/* ------------------------------------------------------------------ */
/* Clips                                                               */
/* ------------------------------------------------------------------ */

const sin = Math.sin;
const cos = Math.cos;

/** Eased 0..1 ramp for one-shot clips. */
function ramp(t: number, duration: number): number {
  const x = clamp01(t / duration);
  return x * x * (3 - 2 * x);
}

/** Up-and-back pulse: rises to 1 at `peak` then returns to 0. */
function pulse(t: number, duration: number, peak = 0.5): number {
  const x = clamp01(t / duration);
  return x < peak
    ? ramp(x / peak, 1)
    : 1 - ramp((x - peak) / (1 - peak), 1);
}

/** Two-bone reach: drives shoulder, elbow and wrist together. */
function reachArm(
  p: Pose,
  side: 'L' | 'R',
  pitch: number,
  roll: number,
  elbow: number,
  wrist = 0,
): void {
  if (side === 'R') {
    p.armRPitch = pitch;
    p.armRRoll = roll;
    p.forearmR = elbow;
    p.handR = wrist;
    p.shoulderR = 0.1 + Math.max(0, -pitch) * 0.18;
  } else {
    p.armLPitch = pitch;
    p.armLRoll = roll;
    p.forearmL = elbow;
    p.handL = wrist;
    p.shoulderL = 0.1 + Math.max(0, -pitch) * 0.18;
  }
}

/** Lowers the whole body by bending hips, knees and ankles together. */
function crouch(p: Pose, amount: number, s = 1): void {
  p.bodyY = -0.42 * amount * s;
  p.thighLPitch = 0.95 * amount;
  p.thighRPitch = 0.95 * amount;
  p.shinL = 1.55 * amount;
  p.shinR = 1.55 * amount;
  p.footL = -0.6 * amount;
  p.footR = -0.6 * amount;
  p.spinePitch = 0.2 * amount;
  p.hipsPitch = 0.12 * amount;
}

/** Seated base pose: hips back, thighs forward, shins down. */
function seated(p: Pose): void {
  p.bodyY = -0.46;
  p.thighLPitch = -1.5;
  p.thighRPitch = -1.5;
  p.thighLRoll = 0.1;
  p.thighRRoll = 0.1;
  p.shinL = 1.45;
  p.shinR = 1.45;
  p.footL = 0.18;
  p.footR = 0.18;
  p.hipsPitch = 0.12;
  p.spinePitch = -0.04;
}

/** Every animation in the game lives in this one function. */
function applyClip(p: Pose, clip: ClipName, t: number, phase: number, speed: number): void {
  switch (clip) {
    /* ---------------- locomotion ---------------- */
    case 'walk':
    case 'run': {
      const running = clip === 'run';
      const amp = running ? 1.45 : 1.0;
      const swing = sin(phase) * 0.6 * amp;

      p.thighLPitch = swing;
      p.thighRPitch = -swing;
      // Knees flex only on the recovery half of the stride.
      p.shinL = Math.max(0, -sin(phase)) * 0.95 * amp;
      p.shinR = Math.max(0, sin(phase)) * 0.95 * amp;
      // Ankles roll through the step: toe-off then heel-strike.
      p.footL = -sin(phase + 0.6) * 0.32;
      p.footR = sin(phase + 0.6) * 0.32;

      // Arms counter-swing, and the elbow tightens on the forward swing.
      p.armLPitch = -swing * 0.66;
      p.armRPitch = swing * 0.66;
      p.forearmL = -0.34 - Math.max(0, -swing) * 0.5 * amp;
      p.forearmR = -0.34 - Math.max(0, swing) * 0.5 * amp;

      // Two bobs per stride plus a weight-shift roll.
      p.bodyY = Math.abs(sin(phase)) * 0.055 * amp - 0.02;
      p.bodyRoll = sin(phase) * 0.05 * amp;
      // Counter-rotation: hips and shoulders twist against each other.
      p.hipsYaw = sin(phase) * 0.16 * amp;
      p.chestYaw = -sin(phase) * 0.2 * amp;
      p.spineRoll = -sin(phase) * 0.05;
      p.spinePitch = 0.05 + Math.min(speed * 0.035, 0.14) * amp;
      p.headRoll = -sin(phase) * 0.035;
      p.neckPitch = -0.05;
      break;
    }

    case 'idle': {
      // Breathing, a slow weight shift, and an occasional head turn.
      const breath = sin(t * 1.5);
      p.bodyY = breath * 0.013;
      p.chestPitch = breath * 0.03;
      p.spinePitch = breath * 0.015;
      p.bodyRoll = sin(t * 0.4) * 0.035;
      p.hipsRoll = -sin(t * 0.4) * 0.03;
      p.headYaw = sin(t * 0.31) * 0.2;
      p.headPitch = sin(t * 0.44) * 0.05;
      p.armLPitch = 0.04 + sin(t * 1.5 + 0.4) * 0.05;
      p.armRPitch = 0.04 + sin(t * 1.5) * 0.05;
      p.armLRoll = 0.1 + sin(t * 0.4) * 0.02;
      p.armRRoll = 0.1 - sin(t * 0.4) * 0.02;
      break;
    }

    case 'idleTired': {
      const breath = sin(t * 1.1);
      p.bodyY = breath * 0.018 - 0.03;
      p.spinePitch = 0.12 + breath * 0.02;
      p.chestPitch = 0.08;
      p.neckPitch = 0.16;
      p.headPitch = 0.12 + sin(t * 0.5) * 0.05;
      p.armLPitch = 0.1;
      p.armRPitch = 0.1;
      p.shoulderL = 0.02;
      p.shoulderR = 0.02;
      break;
    }

    case 'lookAround': {
      // Scan left, hold, scan right, hold. Reads as genuine curiosity.
      const cycle = (t * 0.45) % 1;
      const yaw = cycle < 0.5 ? sin(cycle * Math.PI * 2) : sin(cycle * Math.PI * 2);
      p.headYaw = yaw * 0.7;
      p.neckYaw = yaw * 0.3;
      p.chestYaw = yaw * 0.16;
      p.headPitch = -0.08 + sin(t * 0.9) * 0.08;
      p.bodyY = sin(t * 1.4) * 0.012;
      break;
    }

    /* ---------------- social ---------------- */
    case 'wave': {
      reachArm(p, 'R', -2.45, -0.5, -0.35 + sin(t * 10) * 0.6, sin(t * 10) * 0.3);
      p.headRoll = 0.13;
      p.chestYaw = -0.12;
      p.bodyY = sin(t * 3) * 0.018;
      break;
    }

    case 'cheer': {
      const lift = ramp(t, 0.35);
      reachArm(p, 'R', -2.7 * lift, -0.35, -0.2);
      reachArm(p, 'L', -2.7 * lift, 0.35, -0.2);
      p.bodyY = Math.abs(sin(t * 7)) * 0.1 * lift;
      p.headPitch = -0.28 * lift;
      p.chestPitch = -0.12 * lift;
      break;
    }

    case 'shrug': {
      const up = pulse(t, 1.2, 0.45);
      p.shoulderL = 0.1 + up * 0.5;
      p.shoulderR = 0.1 + up * 0.5;
      reachArm(p, 'R', 0.3 * up, 0.55 * up, -1.1 * up, 0.4 * up);
      reachArm(p, 'L', 0.3 * up, -0.55 * up, -1.1 * up, 0.4 * up);
      p.headRoll = up * 0.12;
      break;
    }

    /* ---------------- object handling ---------------- */
    case 'pickUpLow': {
      // Crouch, reach, close the hand, then rise with the object.
      const down = pulse(t, 1.5, 0.42);
      crouch(p, down * 0.85);
      const grasp = ramp(t - 0.45, 0.35) * (1 - ramp(t - 1.0, 0.4));
      reachArm(p, 'R', -0.35 - down * 0.85, -0.12, -0.55 - grasp * 0.35, 0.3 * grasp);
      reachArm(p, 'L', -0.2 - down * 0.4, 0.2, -0.4);
      p.spinePitch = 0.34 * down;
      p.neckPitch = 0.3 * down;
      // Once risen, the object is held in front.
      const hold = ramp(t - 1.0, 0.4);
      reachArmBlend(p, 'R', hold, -1.15, -0.1, -0.85, 0.15);
      break;
    }

    case 'pickUpHigh': {
      const reach = pulse(t, 1.2, 0.5);
      reachArm(p, 'R', -2.35 * reach, -0.22, -0.3 - reach * 0.3);
      p.chestPitch = -0.14 * reach;
      p.spinePitch = -0.1 * reach;
      p.neckPitch = -0.3 * reach;
      p.bodyY = 0.06 * reach;
      p.footL = -0.2 * reach;
      p.footR = -0.2 * reach;
      break;
    }

    case 'place': {
      // Lean forward, extend, open the hand, withdraw.
      const extend = pulse(t, 1.2, 0.45);
      reachArm(p, 'R', -1.35 - extend * 0.45, -0.1, -0.7 + extend * 0.45, -0.25 * extend);
      p.spinePitch = 0.2 * extend;
      p.chestPitch = 0.1 * extend;
      p.neckPitch = 0.22 * extend;
      break;
    }

    case 'carry': {
      // Both hands cradling something at chest height, with a little sway.
      reachArm(p, 'R', -1.2, -0.28, -1.15, 0.1);
      reachArm(p, 'L', -1.2, 0.28, -1.15, 0.1);
      p.spinePitch = -0.06;
      p.chestPitch = 0.06;
      p.bodyY = sin(t * 1.6) * 0.01;
      break;
    }

    case 'offer': {
      const reach = ramp(t, 0.4);
      reachArm(p, 'R', -1.3 * reach, -0.3, -0.5 * reach, -0.3 * reach);
      reachArm(p, 'L', -1.3 * reach, 0.3, -0.5 * reach, -0.3 * reach);
      p.spinePitch = 0.14 * reach;
      p.chestPitch = 0.06;
      p.neckPitch = 0.1;
      p.bodyY = sin(t * 4) * 0.012;
      break;
    }

    case 'reach': {
      const reach = ramp(t, 0.4);
      reachArm(p, 'R', -1.55 * reach, -0.15, -0.28 * reach, 0.1);
      p.chestYaw = -0.2 * reach;
      p.spinePitch = 0.08 * reach;
      break;
    }

    case 'reachUp': {
      const reach = ramp(t, 0.5);
      reachArm(p, 'R', -2.6 * reach, -0.2, -0.22);
      reachArm(p, 'L', -2.6 * reach, 0.2, -0.22);
      p.neckPitch = -0.4 * reach;
      p.headPitch = -0.2 * reach;
      p.chestPitch = -0.16 * reach;
      p.bodyY = 0.08 * reach + Math.abs(sin(t * 4.5)) * 0.025;
      p.footL = -0.3 * reach;
      p.footR = -0.3 * reach;
      break;
    }

    case 'openDoor': {
      // Reach for the handle, turn the wrist, push through.
      const reach = ramp(t, 0.35);
      const push = ramp(t - 0.5, 0.45);
      reachArm(p, 'R', -1.5 * reach, -0.2, -0.5 * reach + push * 0.4, 0.5 * reach);
      p.chestYaw = -0.22 * reach + push * 0.1;
      p.spinePitch = 0.06 + push * 0.1;
      p.bodyY = -0.01;
      break;
    }

    case 'throw': {
      const wind = clamp01(t / 0.35);
      const release = ramp(t - 0.35, 0.3);
      reachArm(
        p, 'R',
        -2.5 * wind + release * 3.2,
        -0.3,
        -0.95 * wind + release * 0.85,
      );
      p.chestYaw = 0.4 * wind - release * 0.8;
      p.hipsYaw = 0.16 * wind - release * 0.3;
      p.spinePitch = release * 0.2;
      break;
    }

    /* ---------------- seated ---------------- */
    case 'sitDown': {
      const down = ramp(t, 1.0);
      const s2 = zeroPose();
      seated(s2);
      lerpInto(p, s2, down);
      // Hands come forward to steady the descent.
      reachArm(p, 'R', -0.5 * down, -0.35, -0.5);
      reachArm(p, 'L', -0.5 * down, 0.35, -0.5);
      p.spinePitch = 0.24 * (1 - Math.abs(down - 0.5) * 2);
      break;
    }

    case 'sitIdle': {
      seated(p);
      const breath = sin(t * 1.4);
      p.chestPitch = -0.04 + breath * 0.03;
      p.bodyY = -0.46 + breath * 0.008;
      p.headYaw = sin(t * 0.33) * 0.22;
      p.headPitch = sin(t * 0.47) * 0.06;
      // Hands rest on the thighs.
      reachArm(p, 'R', -0.75, -0.2, -0.85, 0.3);
      reachArm(p, 'L', -0.75, 0.2, -0.85, 0.3);
      break;
    }

    case 'sitEat': {
      seated(p);
      // Hand travels from the plate to the mouth and back.
      const cycle = (t * 0.7) % 1;
      const toMouth = cycle < 0.5 ? ramp(cycle / 0.5, 1) : 1 - ramp((cycle - 0.5) / 0.5, 1);
      reachArm(p, 'R', -0.8 - toMouth * 1.05, -0.28, -0.95 - toMouth * 0.75, 0.2 + toMouth * 0.5);
      reachArm(p, 'L', -0.7, 0.24, -0.9, 0.25);
      p.chestPitch = 0.12 - toMouth * 0.06;
      p.neckPitch = 0.2 - toMouth * 0.16;
      p.headPitch = 0.1 - toMouth * 0.05;
      break;
    }

    case 'sitDrink': {
      seated(p);
      const lift = pulse(t, 2.4, 0.42);
      reachArm(p, 'R', -0.85 - lift * 1.2, -0.3, -1.0 - lift * 0.7, 0.2 + lift * 0.75);
      reachArm(p, 'L', -0.7, 0.24, -0.9, 0.25);
      p.neckPitch = -0.12 * lift;
      p.headPitch = -0.2 * lift;
      p.chestPitch = -0.05 * lift;
      break;
    }

    case 'standUp': {
      const up = ramp(t, 1.0);
      const s2 = zeroPose();
      seated(s2);
      lerpInto(p, s2, 1 - up);
      // Lean forward over the feet before rising, as anyone actually does.
      p.spinePitch += (1 - Math.abs(up - 0.45) * 2.2) * 0.3;
      reachArm(p, 'R', -0.4 * (1 - up), -0.3, -0.5);
      reachArm(p, 'L', -0.4 * (1 - up), 0.3, -0.5);
      break;
    }

    /* ---------------- chores ---------------- */
    case 'pour': {
      const lift = ramp(t, 0.45);
      const tip = ramp(t - 0.5, 0.6);
      reachArm(p, 'R', -1.5 * lift, -0.25 - tip * 0.5, -0.85, -0.3 - tip * 0.9);
      reachArm(p, 'L', -0.9 * lift, 0.3, -1.0);
      p.spinePitch = 0.1 * lift;
      p.neckPitch = 0.24 * lift;
      p.headPitch = 0.12;
      break;
    }

    case 'milk': {
      crouch(p, 0.92);
      // Alternating hands with a slight squeeze at the bottom of each pull.
      const l = sin(t * 5.5);
      const r = sin(t * 5.5 + Math.PI);
      reachArm(p, 'L', -1.0 + l * 0.2, 0.3, -1.25 - Math.max(0, l) * 0.25, 0.3);
      reachArm(p, 'R', -1.0 + r * 0.2, -0.3, -1.25 - Math.max(0, r) * 0.25, 0.3);
      p.spinePitch = 0.3;
      p.neckPitch = 0.28;
      p.headPitch = 0.16;
      p.chestYaw = 0.1;
      break;
    }

    case 'scatter': {
      // Wide sweeping throws alternating across the body.
      const swing = sin(t * 3.2);
      reachArm(p, 'R', -1.0 + swing * 0.45, -0.35 - swing * 0.55, -0.35, -0.3 - swing * 0.4);
      reachArm(p, 'L', -0.85, 0.35, -1.25, 0.2);
      p.chestYaw = swing * 0.3;
      p.hipsYaw = swing * 0.1;
      p.bodyY = Math.abs(sin(t * 3.2)) * 0.018;
      p.neckPitch = 0.16;
      break;
    }

    case 'stir': {
      const circle = t * 4.4;
      reachArm(p, 'R', -1.25 + sin(circle) * 0.12, -0.3 + cos(circle) * 0.3, -0.75, 0.2);
      reachArm(p, 'L', -0.7, 0.35, -1.1, 0.2);
      p.chestYaw = cos(circle) * 0.1;
      p.spinePitch = 0.14;
      p.neckPitch = 0.24;
      p.headPitch = 0.1;
      break;
    }

    case 'hammer': {
      // Sharp down-stroke, slow lift. The rhythm is what reads as effort.
      const cycle = (t * 2.2) % 1;
      const strike = cycle < 0.22 ? 1 - cycle / 0.22 : (cycle - 0.22) / 0.78;
      reachArm(p, 'R', -2.2 + strike * 1.6, -0.25, -0.35 - strike * 0.7);
      reachArm(p, 'L', -1.0, 0.3, -1.2, 0.2);
      p.spinePitch = 0.18 + strike * 0.12;
      p.chestYaw = -0.12;
      p.neckPitch = 0.22;
      break;
    }

    case 'sweep': {
      const swing = sin(t * 2.4);
      reachArm(p, 'L', -0.95 + swing * 0.3, 0.3, -0.55, 0.15);
      reachArm(p, 'R', -1.2 + swing * 0.3, -0.25, -0.35, 0.15);
      p.chestYaw = swing * 0.34;
      p.hipsYaw = swing * 0.12;
      p.spinePitch = 0.26;
      p.neckPitch = 0.26;
      p.bodyY = Math.abs(swing) * 0.018 - 0.01;
      break;
    }

    case 'washHands': {
      // Hands together at basin height, rotating against each other.
      const rub = sin(t * 7);
      reachArm(p, 'R', -1.3, -0.42, -1.3 + rub * 0.18, 0.2);
      reachArm(p, 'L', -1.3, 0.42, -1.3 - rub * 0.18, 0.2);
      p.spinePitch = 0.2;
      p.neckPitch = 0.3;
      p.headPitch = 0.14;
      p.chestPitch = 0.08;
      break;
    }

    case 'brushTeeth': {
      const scrub = sin(t * 9);
      reachArm(p, 'R', -2.25, -0.3, -0.8 + scrub * 0.28, 0.2);
      reachArm(p, 'L', 0.1, 0.12, -0.3);
      p.headRoll = scrub * 0.07;
      p.headPitch = -0.06;
      p.neckPitch = -0.04;
      p.bodyY = scrub * 0.006;
      break;
    }

    case 'crouchPet': {
      crouch(p, 0.82);
      const stroke = sin(t * 3.8);
      reachArm(p, 'R', -1.05 + stroke * 0.28, -0.3, -0.5 + cos(t * 3.8) * 0.16, 0.25);
      reachArm(p, 'L', -0.5, 0.35, -0.7);
      p.spinePitch = 0.26;
      p.neckPitch = 0.22;
      p.headPitch = 0.12;
      p.headRoll = sin(t * 1.9) * 0.09;
      break;
    }

    case 'crouchPick': {
      crouch(p, 0.88);
      const grab = sin(t * 4.2);
      reachArm(p, 'R', -0.9 + grab * 0.22, -0.2, -0.7, 0.3);
      reachArm(p, 'L', -0.5, 0.25, -0.6);
      p.spinePitch = 0.36;
      p.neckPitch = 0.3;
      p.headPitch = 0.16;
      break;
    }

    /* ---------------- rest ---------------- */
    case 'stretch': {
      const arc = pulse(t, 1.8, 0.5);
      reachArm(p, 'R', -2.85 * arc, -0.35, -0.2);
      reachArm(p, 'L', -2.85 * arc, 0.35, -0.2);
      p.chestPitch = -0.3 * arc;
      p.spinePitch = -0.16 * arc;
      p.neckPitch = -0.35 * arc;
      p.headPitch = -0.18 * arc;
      p.bodyY = 0.1 * arc;
      p.footL = -0.35 * arc;
      p.footR = -0.35 * arc;
      break;
    }

    case 'yawn': {
      const open = pulse(t, 1.6, 0.42);
      reachArm(p, 'R', -2.1 * open, -0.5, -1.5 * open, 0.4);
      p.neckPitch = -0.28 * open;
      p.headPitch = -0.2 * open;
      p.chestPitch = -0.12 * open;
      p.spinePitch = 0.08 * open;
      break;
    }

    case 'sleep': {
      // Lying on one side, curled, breathing.
      p.bodyPitch = -Math.PI / 2 + 0.05;
      p.bodyRoll = 0.35;
      p.bodyY = -0.66;
      p.spinePitch = 0.2 + sin(t * 1.0) * 0.035;
      p.chestPitch = 0.1;
      p.neckPitch = 0.22;
      p.headPitch = 0.1;
      reachArm(p, 'R', -0.55, -0.4, -1.5);
      reachArm(p, 'L', -0.35, 0.4, -1.2);
      p.thighLPitch = -0.55;
      p.thighRPitch = -0.42;
      p.shinL = 0.85;
      p.shinR = 0.7;
      break;
    }

    case 'spin': {
      p.armLRoll = 1.3;
      p.armRRoll = 1.3;
      p.armLPitch = -0.35;
      p.armRPitch = -0.35;
      p.forearmL = -0.1;
      p.forearmR = -0.1;
      p.bodyY = Math.abs(sin(t * 4)) * 0.12;
      p.bodyYaw = t * 3.4;
      p.chestYaw = sin(t * 3) * 0.2;
      p.headRoll = sin(t * 3) * 0.2;
      p.headPitch = -0.22;
      break;
    }

    default:
      break;
  }
}

/** Blends `p` toward a fully-specified pose. */
function lerpInto(p: Pose, target: Pose, amount: number): void {
  for (const key of POSE_KEYS) {
    p[key] = p[key] + (target[key] - p[key]) * amount;
  }
}

/** Blends one arm toward a target reach without disturbing the rest. */
function reachArmBlend(
  p: Pose,
  side: 'L' | 'R',
  amount: number,
  pitch: number,
  roll: number,
  elbow: number,
  wrist: number,
): void {
  if (amount <= 0) return;
  const mix = (a: number, b: number): number => a + (b - a) * amount;
  if (side === 'R') {
    p.armRPitch = mix(p.armRPitch, pitch);
    p.armRRoll = mix(p.armRRoll, roll);
    p.forearmR = mix(p.forearmR, elbow);
    p.handR = mix(p.handR, wrist);
  } else {
    p.armLPitch = mix(p.armLPitch, pitch);
    p.armLRoll = mix(p.armLRoll, roll);
    p.forearmL = mix(p.forearmL, elbow);
    p.handL = mix(p.handL, wrist);
  }
}

/* ------------------------------------------------------------------ */
/* Body geometry                                                       */
/* ------------------------------------------------------------------ */

function buildPelvis(look: CharacterLook, s: number, material: import('three').Material): Mesh {
  const b = new PartBuilder();
  if (look.skirt) {
    // Flared skirt built from a lathe so the hem has a proper sweep.
    b.lathe(
      [
        [0.16 * s, 0],
        [0.2 * s, 0.06 * s],
        [0.3 * s, -0.16 * s],
        [0.36 * s, -0.3 * s],
        [0.34 * s, -0.32 * s],
        [0, -0.32 * s],
      ],
      look.primary,
      { pos: [0, 0.06 * s, 0] },
      14,
    );
  } else {
    b.bevelBox(0.34 * s, 0.22 * s, 0.24 * s, 0.05 * s, look.secondary, { pos: [0, -0.02 * s, 0] });
  }
  return b.toMesh('pelvis', material, { smooth: true, smoothAngle: 1.0 });
}

function buildTorso(look: CharacterLook, s: number, material: import('three').Material): Mesh {
  const b = new PartBuilder();
  // Slight taper from chest to waist.
  b.lathe(
    [
      [0.18 * s, 0],
      [0.21 * s, 0.1 * s],
      [0.22 * s, 0.2 * s],
      [0.2 * s, 0.26 * s],
      [0, 0.28 * s],
    ],
    look.primary,
    {},
    12,
  );
  return b.toMesh('torso', material, { smooth: true, smoothAngle: 1.2 });
}

function buildChest(look: CharacterLook, s: number, material: import('three').Material): Mesh {
  const b = new PartBuilder();
  b.lathe(
    [
      [0.2 * s, -0.04 * s],
      [0.225 * s, 0.06 * s],
      [0.215 * s, 0.16 * s],
      [0.17 * s, 0.22 * s],
      [0, 0.24 * s],
    ],
    look.primary,
    {},
    12,
  );
  // Collar band in the secondary colour.
  b.lathe(
    [
      [0.13 * s, 0.2 * s],
      [0.175 * s, 0.215 * s],
      [0.17 * s, 0.245 * s],
      [0, 0.25 * s],
    ],
    look.secondary,
    {},
    12,
  );

  if (look.apron) {
    b.bevelBox(0.28 * s, 0.4 * s, 0.05 * s, 0.02 * s, look.apron, {
      pos: [0, 0.0, 0.17 * s],
    });
    for (const side of [-1, 1]) {
      b.box(0.05 * s, 0.22 * s, 0.03 * s, look.apron, {
        pos: [side * 0.1 * s, 0.16 * s, 0.17 * s],
        rot: [0, 0, side * 0.12],
      });
    }
  } else if (!look.skirt) {
    // Button placket.
    for (let i = 0; i < 3; i++) {
      b.sphere(0.018 * s, look.secondary, { pos: [0, 0.14 * s - i * 0.08 * s, 0.2 * s] }, 5);
    }
  }
  return b.toMesh('chest', material, { smooth: true, smoothAngle: 1.2 });
}

function buildNeck(look: CharacterLook, s: number, material: import('three').Material): Mesh {
  const b = new PartBuilder();
  b.cylinder(0.078 * s, 0.09 * s, 0.13 * s, look.skin, { pos: [0, 0.04 * s, 0] }, 9);
  return b.toMesh('neck', material, { smooth: true });
}

function buildHead(look: CharacterLook, s: number, material: import('three').Material): Mesh {
  const b = new PartBuilder();
  const r = look.adult ? 0.25 * s : 0.275 * s;

  // A child's skull, not a ball: a broad cranium, a brow line, cheeks that
  // pull in below it, and a small rounded chin. The extra profile points are
  // what stop the head reading as a sphere with a face painted on it.
  b.lathe(
    [
      [0, -r * 1.02],
      [r * 0.52, -r * 0.94],
      [r * 0.86, -r * 0.62],
      [r * 0.99, -r * 0.22],   // brow line, the widest point
      [r * 1.0, r * 0.08],
      [r * 0.93, r * 0.38],    // cheekbone
      [r * 0.74, r * 0.66],    // jaw pulling in
      [r * 0.44, r * 0.9],
      [0, r * 1.0],
    ],
    look.skin,
    // Narrower front-to-back than side-to-side, as a head actually is.
    { scale: [1, 1, 0.92] },
    18,
  );

  // Nose. The one facial feature that has to be geometry rather than paint,
  // because it is the only one that shows in profile and the only one that
  // should catch the light as the child turns their head.
  //
  // It sits deliberately PROUD of the face decal. The decal is a curved patch
  // just off the skull, so anything at a similar radius punches through it in
  // patches; putting the nose clearly in front instead makes that intentional,
  // and the decal draws no nose of its own.
  const noseZ = r * 1.0;
  b.sphere(r * 0.1, look.skin, {
    pos: [0, -r * 0.16, noseZ],
    scale: [0.95, 0.66, 0.72],
  }, 9);
  b.sphere(r * 0.07, look.skin, {
    pos: [0, -r * 0.02, noseZ - r * 0.05],
    scale: [0.6, 1.3, 0.65],
  }, 8);

  // Ears, angled slightly out.
  for (const side of [-1, 1]) {
    b.sphere(0.062 * s, look.skin, {
      pos: [side * r * 0.96, -0.01 * s, -0.01 * s],
      rot: [0, 0, side * 0.2],
      scale: [0.5, 1.05, 0.85],
    }, 7);
  }
  // Barely any contact AO. A head is one smooth organic form, and the baked
  // occlusion is size-weighted: a small sphere against a large one reads as a
  // deep crease, which turned the nose into a dark ball stuck on the face.
  return b.toMesh('head', material, { smooth: true, smoothAngle: 1.4, aoStrength: 0.12 });
}

/**
 * A fringe of overlapping locks across the forehead.
 *
 * Every style used to lay a single flat box here. Straight across, with hard
 * square ends and a perfectly level lower edge, it read as a headband — or,
 * sitting where it did just above the eyes, as a blindfold. Locks on an arc
 * with an uneven hem follow the skull and break that line, which is the whole
 * difference between "child with hair" and "child wearing a bar".
 *
 * @param drop  How far the longest locks hang, in head radii.
 * @param ragged 0 for a blunt cut, 1 for tousled.
 */
function addFringe(
  b: PartBuilder,
  r: number,
  s: number,
  hair: string,
  locks: number,
  drop: number,
  ragged: number,
): void {
  const spread = 0.92;
  for (let i = 0; i < locks; i++) {
    const t = locks === 1 ? 0.5 : i / (locks - 1);
    const a = (t - 0.5) * 2 * spread;
    // Alternating lengths give the hem a scalloped edge rather than a rule.
    const wobble = (i % 2 === 0 ? 0.0 : -0.42) + Math.sin(i * 2.399) * 0.3;
    const length = drop * (1 + wobble * ragged);
    b.sphere(0.062 * s, hair, {
      pos: [
        Math.sin(a) * r * 0.94,
        r * 0.5 - length * r,
        Math.cos(a) * r * 0.9,
      ],
      // Flattened against the skull so the fringe is a sheet, not a row of beads.
      scale: [1.05, 1 + length * 1.5, 0.62],
    }, 6);
  }
}

/**
 * Hair, on its own joint so it can lag behind the head.
 *
 * Four styles, each chosen for a distinct silhouette rather than for detail:
 * at gameplay distance the outline is all that reads.
 */
function buildHair(look: CharacterLook, s: number): Mesh {
  const b = new PartBuilder();
  const r = look.adult ? 0.25 * s : 0.275 * s;
  const hair = look.hair;

  switch (look.hairStyle % 4) {
    case 0: {
      // Short and tousled, with a fringe and a cowlick.
      b.lathe(
        [
          [0, r * 1.06],
          [r * 0.66, r * 0.9],
          [r * 1.02, r * 0.42],
          [r * 1.05, -r * 0.1],
          [r * 1.0, -r * 0.3],
        ],
        hair, { scale: [1, 1, 0.98] }, 14,
      );
      addFringe(b, r, s, hair, 7, 0.12, 1);
      for (let i = 0; i < 5; i++) {
        b.sphere(0.055 * s, hair, {
          pos: [(-2 + i) * 0.06 * s, r * 0.78 + (i % 2) * 0.03 * s, r * 0.3],
        }, 6);
      }
      b.capsule(0.03 * s, 0.09 * s, hair, { pos: [0.05 * s, r * 1.1, -0.02 * s], rot: [0.5, 0, 0.3] });
      break;
    }
    case 1: {
      // Bob with a blunt fringe.
      b.lathe(
        [
          [0, r * 1.08],
          [r * 0.7, r * 0.92],
          [r * 1.06, r * 0.36],
          [r * 1.1, -r * 0.5],
          [r * 1.05, -r * 0.95],
          [r * 0.9, -r * 1.0],
        ],
        hair, { scale: [1, 1, 1.02] }, 14,
      );
      addFringe(b, r, s, hair, 9, 0.15, 0.3);
      for (const side of [-1, 1]) {
        b.capsule(0.07 * s, 0.2 * s, hair, {
          pos: [side * r * 0.98, -r * 0.5, 0],
          scale: [1, 1, 0.8],
        });
      }
      break;
    }
    case 2: {
      // Two high ponytails.
      b.lathe(
        [
          [0, r * 1.06],
          [r * 0.68, r * 0.9],
          [r * 1.03, r * 0.35],
          [r * 1.04, -r * 0.15],
        ],
        hair, {}, 14,
      );
      addFringe(b, r, s, hair, 7, 0.1, 0.7);
      for (const side of [-1, 1]) {
        b.sphere(0.055 * s, 'uiRed', { pos: [side * r * 0.95, r * 0.42, -r * 0.12] }, 6);
        b.capsule(0.075 * s, 0.22 * s, hair, {
          pos: [side * r * 1.2, r * 0.05, -r * 0.3],
          rot: [0.3, 0, side * -0.5],
        });
        b.sphere(0.06 * s, hair, { pos: [side * r * 1.42, -r * 0.42, -r * 0.5] }, 7);
      }
      break;
    }
    default: {
      // Curly: a cap of overlapping puffs.
      b.lathe(
        [
          [0, r * 1.0],
          [r * 0.64, r * 0.86],
          [r * 0.98, r * 0.34],
          [r * 1.0, -r * 0.16],
        ],
        hair, {}, 12,
      );
      // Three staggered rings of small, flattened curls rather than one ring of
      // big spheres. Curls read as hair when they are smaller than the eye and
      // overlap; at eleven large balls they read as a bunch of grapes.
      for (let ring = 0; ring < 3; ring++) {
        const count = 13 - ring * 2;
        const height = r * (0.2 + ring * 0.3);
        const spread = r * (1.0 - ring * 0.17);
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + ring * 0.42;
          b.sphere(0.046 * s, hair, {
            pos: [
              Math.cos(a) * spread,
              height + Math.sin(i * 2.7) * r * 0.06,
              Math.sin(a) * spread * 0.92,
            ],
            // Flattened against the skull, so they sit as curls rather than
            // as beads threaded round the head.
            scale: [1.15, 0.85, 1.15],
          }, 6);
        }
      }
      break;
    }
  }

  const mesh = new Mesh(b.build({ smooth: true, smoothAngle: 1.3, aoStrength: 0.35 }), M.creature());
  mesh.name = 'hair';
  mesh.castShadow = true;
  return mesh;
}

function buildShoulder(look: CharacterLook, s: number, material: import('three').Material): Mesh {
  const b = new PartBuilder();
  b.sphere(0.088 * s, look.primary, { scale: [1, 0.9, 1] }, 8);
  return b.toMesh('shoulder', material, { smooth: true });
}

function buildUpperArm(look: CharacterLook, s: number, material: import('three').Material): Mesh {
  const b = new PartBuilder();
  b.capsule(0.068 * s, 0.2 * s, look.primary, { pos: [0, -0.14 * s, 0] });
  // Sleeve cuff marks where fabric ends and skin begins.
  b.lathe(
    [
      [0.072 * s, -0.24 * s],
      [0.082 * s, -0.255 * s],
      [0.078 * s, -0.275 * s],
      [0, -0.28 * s],
    ],
    look.secondary, {}, 10,
  );
  return b.toMesh('upperarm', material, { smooth: true });
}

function buildForearm(look: CharacterLook, s: number, material: import('three').Material): Mesh {
  const b = new PartBuilder();
  b.capsule(0.055 * s, 0.17 * s, look.skin, { pos: [0, -0.13 * s, 0] });
  return b.toMesh('forearm', material, { smooth: true });
}

/**
 * Hand with a thumb.
 *
 * At this scale nobody counts fingers, but the thumb changes the silhouette
 * enough that a hand reaching for a door handle reads as a hand rather than a
 * mitten, which matters a great deal once the game is about handling objects.
 */
function buildHand(look: CharacterLook, s: number, material: import('three').Material): Mesh {
  const b = new PartBuilder();
  b.sphere(0.062 * s, look.skin, { pos: [0, -0.05 * s, 0.005 * s], scale: [0.85, 1.05, 0.7] }, 8);
  b.capsule(0.026 * s, 0.05 * s, look.skin, {
    pos: [0.05 * s, -0.045 * s, 0.02 * s],
    rot: [0, 0, -0.7],
  });
  return b.toMesh('hand', material, { smooth: true });
}

function buildThigh(
  look: CharacterLook,
  s: number,
  cloth: import('three').Material,
  skin: import('three').Material,
): Mesh {
  const b = new PartBuilder();
  const tint = look.skirt ? look.skin : look.secondary;
  b.capsule(0.082 * s, 0.22 * s, tint, { pos: [0, -0.17 * s, 0] });
  return b.toMesh('thigh', look.skirt ? skin : cloth, { smooth: true });
}

function buildShin(look: CharacterLook, s: number, material: import('three').Material): Mesh {
  const b = new PartBuilder();
  b.capsule(0.068 * s, 0.2 * s, look.skirt ? look.skin : look.secondary, {
    pos: [0, -0.16 * s, 0],
  });
  // Sock cuff.
  b.lathe(
    [
      [0.072 * s, -0.26 * s],
      [0.082 * s, -0.275 * s],
      [0.078 * s, -0.3 * s],
      [0, -0.305 * s],
    ],
    'wallPlaster', {}, 10,
  );
  return b.toMesh('shin', material, { smooth: true });
}

/** Boot with a separate sole and a raised toe. */
function buildShoe(look: CharacterLook, s: number): Mesh {
  const b = new PartBuilder();
  b.bevelBox(0.115 * s, 0.085 * s, 0.2 * s, 0.025 * s, 'shoe', { pos: [0, -0.01 * s, 0.03 * s] });
  b.sphere(0.058 * s, 'shoe', { pos: [0, -0.005 * s, 0.11 * s], scale: [1, 0.8, 1.1] }, 7);
  b.bevelBox(0.125 * s, 0.03 * s, 0.215 * s, 0.012 * s, 'trunkDark', {
    pos: [0, -0.055 * s, 0.03 * s],
  });
  // Heel.
  b.box(0.11 * s, 0.03 * s, 0.06 * s, 'trunkDark', { pos: [0, -0.075 * s, -0.04 * s] });
  void look;
  return b.toMesh('shoe', M.cloth(), { smooth: true, smoothAngle: 0.9 });
}
