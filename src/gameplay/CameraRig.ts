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

    // Damp the orbit itself so even a flick reads as a smooth pan.
    this.spherical.radius = damp(this.spherical.radius, this.targetSpherical.radius, 5, dt);
    this.spherical.phi = damp(this.spherical.phi, this.targetSpherical.phi, 7, dt);
    this.spherical.theta = dampAngle(this.spherical.theta, this.targetSpherical.theta, 7, dt);

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

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}
