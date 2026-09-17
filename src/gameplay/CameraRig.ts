import { PerspectiveCamera, Vector3, Spherical, MathUtils } from 'three';
import { damp, clamp } from '../core/Rng';
import type { Terrain } from '../world/Terrain';
import type { FormFactor } from '../core/DeviceProfile';

/**
 * Third-person follow camera.
 *
 * Tuning targets, in order:
 *   1. The child is always clearly visible and never behind anything.
 *   2. Movement is smooth and slightly lazy — no snapping, no motion sickness.
 *   3. The mountains stay in frame, because they are the game's identity.
 *
 * The camera never collides *out* of a wall with a hard push; instead it
 * shortens its boom, which looks intentional rather than glitchy.
 */

export type CameraMode = 'follow' | 'focus' | 'cinematic';

const _roomLook = new Vector3();

/**
 * Pitch used once the child is fully indoors. The boom length comes from the
 * building's own radius, since a chalet and a coop need very different ones.
 *
 * Only the outer shell ghosts; the upper floor is solid set dressing. So the
 * camera must not climb to roof height looking for a top-down view, because
 * there isn't one to be had — it would simply be inside the roof. This sits
 * just above the ground-floor wall head and looks in over it, which is the
 * angle a doll's house is actually viewed from.
 */
// Nearly level on purpose. The upper floor is a solid slab across the whole
// footprint, so there is no view down into the ground floor to be had; the
// only way in is through the open front, under that slab. This is what a
// doll's house actually looks like — seen square on from the open side.
const INDOOR_PHI = MathUtils.degToRad(81);

export class CameraRig {
  readonly camera: PerspectiveCamera;

  // Default: 13m back, 12 degrees above the child, looking north up the valley.
  // Pitched this shallow deliberately — the mountains are the game's identity
  // and a steeper "management game" angle throws them off the top of the frame.
  private spherical = new Spherical(13, MathUtils.degToRad(78), MathUtils.degToRad(180));
  private targetSpherical = new Spherical(13, MathUtils.degToRad(78), MathUtils.degToRad(180));
  private lookAt = new Vector3();
  private smoothedTarget = new Vector3();
  private mode: CameraMode = 'follow';

  private focusPoint = new Vector3();
  private focusTimer = 0;
  private shake = 0;

  private minDistance = 6;
  private maxDistance = 20;

  /**
   * 0 outdoors .. 1 indoors, damped so the move through a doorway is a glide.
   *
   * The doll's-house cutaway ghosts the near walls, but that is worth nothing
   * while the boom is still 12m out at eye level, because the camera is then
   * simply outside the building looking at the back of an interior wall.
   * Indoors the boom comes in and lifts to look down into the room.
   */
  private indoorBlend = 0;

  /** Orbit angle of the current building's open face; see setIndoor. */
  private indoorTheta = 0;
  /** Centre of the building the child is in, and how far out to stand. */
  private indoorCentre = new Vector3();
  private indoorStandoff = 12;

  constructor(aspect: number, formFactor: FormFactor) {
    this.camera = new PerspectiveCamera(fovFor(formFactor), aspect, 0.4, 700);
    this.applyFormFactor(formFactor);
  }

  applyFormFactor(formFactor: FormFactor): void {
    this.camera.fov = fovFor(formFactor);
    // A tablet's bigger screen wants a slightly wider, further view so the
    // valley fills it; a phone wants to stay closer to the child.
    if (formFactor === 'tablet') {
      this.minDistance = 7;
      this.maxDistance = 24;
      this.targetSpherical.radius = clamp(this.targetSpherical.radius, 11, 18);
    } else if (formFactor === 'small-tablet') {
      this.minDistance = 6.5;
      this.maxDistance = 22;
    } else {
      this.minDistance = 5.5;
      this.maxDistance = 18;
    }
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Orbit input from a drag. */
  orbit(dx: number, dy: number): void {
    if (this.mode !== 'follow') return;
    this.targetSpherical.theta -= dx;
    this.targetSpherical.phi = clamp(
      this.targetSpherical.phi + dy,
      // Never look from below the horizon, never straight down: both are
      // disorienting, and the second loses the mountains entirely.
      MathUtils.degToRad(40),
      MathUtils.degToRad(86),
    );
  }

  zoom(delta: number): void {
    if (this.mode !== 'follow') return;
    this.targetSpherical.radius = clamp(
      this.targetSpherical.radius + delta,
      this.minDistance,
      this.maxDistance,
    );
  }

  /** Pull the camera to a scripted point of interest for a few seconds. */
  focusOn(point: Vector3, seconds: number): void {
    this.focusPoint.copy(point);
    this.focusTimer = seconds;
    this.mode = 'focus';
  }

  clearFocus(): void {
    this.focusTimer = 0;
    this.mode = 'follow';
  }

  get isFocused(): boolean {
    return this.mode === 'focus';
  }

  /**
   * Tells the rig whether the child is inside a building.
   * Driven from the same test that drives the cutaway, so the walls ghosting
   * and the camera coming in are always the same event.
   */
  setIndoor(building: { centre: Vector3; radius: number; openTheta: number } | null, dt: number): void {
    this.indoorBlend = damp(this.indoorBlend, building === null ? 0 : 1, 3.2, dt);
    // Keep the last building's framing while the blend falls away, so stepping
    // out of a door does not whip the camera round mid-fade.
    if (building) {
      this.indoorTheta = building.openTheta;
      this.indoorCentre.copy(building.centre);
      // Stand clear of the building itself. A boom measured from the child
      // lands inside the walls whenever they are at the back of a deep room.
      this.indoorStandoff = building.radius + 2;
    }
  }

  /** Small positive shake, used sparingly (a snowball landing, a door). */
  nudge(amount = 0.12): void {
    this.shake = Math.min(0.3, this.shake + amount);
  }

  update(targetPosition: Vector3, targetHeight: number, terrain: Terrain, dt: number): void {
    if (this.focusTimer > 0) {
      this.focusTimer -= dt;
      if (this.focusTimer <= 0) this.mode = 'follow';
    }

    // Aim a little above the child's hips: framing them dead-centre looks flat.
    const desired = this.smoothedTarget.set(
      targetPosition.x,
      targetPosition.y + targetHeight * 0.62,
      targetPosition.z,
    );

    if (this.mode === 'focus') {
      // Swing behind the child and look toward the point of interest.
      const toPoint = new Vector3().subVectors(this.focusPoint, targetPosition).setY(0);
      if (toPoint.lengthSq() > 1e-4) {
        this.targetSpherical.theta = Math.atan2(-toPoint.x, -toPoint.z);
        this.targetSpherical.phi = MathUtils.degToRad(64);
        this.targetSpherical.radius = clamp(
          this.targetSpherical.radius,
          this.minDistance,
          this.minDistance + 3,
        );
      }
      desired.lerp(this.focusPoint, 0.22);
    }

    // Indoors the shot is a doll's house: the camera stands off the building's
    // open face and looks in at the whole room. It orbits the BUILDING, not the
    // child, so the framing holds still while they move about inside, and so
    // the boom cannot end up inside a wall when they are at the back of a deep
    // room. Everything else about the interior is wasted if the camera is
    // parked behind the one wall that stays solid.
    const blend = this.indoorBlend;
    const wantRadius = MathUtils.lerp(this.targetSpherical.radius, this.indoorStandoff, blend);
    const wantPhi = MathUtils.lerp(this.targetSpherical.phi, INDOOR_PHI, blend);
    const wantTheta = blend > 0.001
      ? lerpAngle(this.targetSpherical.theta, this.indoorTheta, blend)
      : this.targetSpherical.theta;
    // Pull the look-at toward the room's middle so the child stays in frame
    // wherever they are in it, without the camera chasing them around.
    if (blend > 0.001) {
      _roomLook.set(this.indoorCentre.x, this.indoorCentre.y + 1.5, this.indoorCentre.z);
      desired.lerp(_roomLook, blend * 0.7);
    }

    // Damp the orbit itself so even a flick reads as a smooth pan.
    this.spherical.radius = damp(this.spherical.radius, wantRadius, 5, dt);
    this.spherical.phi = damp(this.spherical.phi, wantPhi, 7, dt);
    this.spherical.theta = dampAngle(this.spherical.theta, wantTheta, 7, dt);

    this.lookAt.lerp(desired, 1 - Math.exp(-9 * dt));

    const offset = new Vector3().setFromSpherical(this.spherical);
    const position = new Vector3().addVectors(this.lookAt, offset);

    // Keep the camera above the ground with a comfortable clearance; if the
    // terrain pushes up behind the child, shorten the boom instead of clipping.
    const groundHere = terrain.heightAt(position.x, position.z);
    const clearance = 1.6;
    if (position.y < groundHere + clearance) {
      const shortfall = groundHere + clearance - position.y;
      // Raise and pull in proportionally.
      position.y = groundHere + clearance;
      const flat = new Vector3(offset.x, 0, offset.z);
      const shrink = clamp(1 - shortfall * 0.12, 0.45, 1);
      flat.multiplyScalar(shrink);
      position.x = this.lookAt.x + flat.x;
      position.z = this.lookAt.z + flat.z;
    }

    if (this.shake > 0.001) {
      this.shake = damp(this.shake, 0, 6, dt);
      position.x += (Math.random() - 0.5) * this.shake;
      position.y += (Math.random() - 0.5) * this.shake;
    }

    this.camera.position.copy(position);
    this.camera.lookAt(this.lookAt);
  }

  /** Camera-relative forward/right on the ground plane, for movement input. */
  getGroundBasis(forward: Vector3, right: Vector3): void {
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.set(forward.z, 0, -forward.x);
  }

  /** Used by the day-end / bedtime sequences. */
  setCinematic(enabled: boolean): void {
    this.mode = enabled ? 'cinematic' : 'follow';
  }
}

function fovFor(formFactor: FormFactor): number {
  // Wider on a phone so the world still feels big on a small screen.
  return formFactor === 'tablet' ? 46 : formFactor === 'small-tablet' ? 50 : 54;
}

/** Interpolates along the shorter way round the circle. */
function lerpAngle(from: number, to: number, t: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}
