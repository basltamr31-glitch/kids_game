import { PerspectiveCamera, Vector3, Spherical, MathUtils } from 'three';
import { damp, clamp } from '../core/Rng';
import type { Terrain } from '../world/Terrain';
import type { CollisionWorld } from '../world/Collision';
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

export type CameraMode = 'follow' | 'focus' | 'cinematic' | 'portrait';

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
/**
 * Indoor framing: close, and looking down into the room.
 *
 * The upper floor is part of the shell now, so it fades when the child goes in
 * and the camera can sit above the wall head looking down. Before that it was
 * a solid slab across the whole footprint and the only possible shot was a
 * near-level one through the open front.
 */
// Tuned against the room, not against taste: the ground floor is 3.2m from
// floor to ceiling, so a boom that lifts the camera much over 2m above the
// child's eye line puts it inside the first floor looking at the underside of
// the boards. This sits just under the ceiling, looking down across the room.
const INDOOR_RADIUS = 4.6;
const INDOOR_PHI = MathUtils.degToRad(66);

const _shortened = new Vector3();

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

  /** The follow framing to return to after a title drift or a portrait. */
  private saved = new Spherical(13, MathUtils.degToRad(78), MathUtils.degToRad(180));
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

  /** Used to keep the child in view; set once the world exists. */
  private collision: CollisionWorld | null = null;


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

  /**
   * Cuts straight to a framing of the target, skipping the damped glide.
   * Used behind a fade so the first visible frame is already composed.
   */
  snapTo(targetPosition: Vector3, targetHeight: number, theta: number, indoor: boolean): void {
    this.mode = 'follow';
    this.focusTimer = 0;
    this.targetSpherical.theta = theta;
    this.spherical.theta = theta;
    this.indoorBlend = indoor ? 1 : 0;
    this.spherical.radius = indoor ? INDOOR_RADIUS : this.targetSpherical.radius;
    this.spherical.phi = indoor ? INDOOR_PHI : this.targetSpherical.phi;
    this.lookAt.set(
      targetPosition.x,
      targetPosition.y + targetHeight * (0.62 + (indoor ? 0.3 : 0)),
      targetPosition.z,
    );
  }

  clearFocus(): void {
    this.focusTimer = 0;
    this.mode = 'follow';
  }

  get isFocused(): boolean {
    return this.mode === 'focus';
  }

  /** Handed the world's obstacles, so the camera can keep the child in view. */
  setCollision(collision: CollisionWorld): void {
    this.collision = collision;
  }

  /**
   * Tells the rig whether the child is inside a building.
   * Driven from the same test that drives the cutaway, so the walls ghosting
   * and the camera coming in are always the same event.
   */
  setIndoor(building: { centre: Vector3; radius: number; openTheta: number } | null, dt: number): void {
    this.indoorBlend = damp(this.indoorBlend, building === null ? 0 : 1, 3.2, dt);
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

    if (this.mode === 'cinematic') {
      // Behind the title screen: a slow, wide drift round the valley.
      this.targetSpherical.theta += dt * 0.045;
      this.targetSpherical.radius = damp(this.targetSpherical.radius, 19, 0.8, dt);
      this.targetSpherical.phi = damp(this.targetSpherical.phi, MathUtils.degToRad(74), 0.8, dt);
      desired.y += 1.4;
    } else if (this.mode === 'portrait') {
      // Slide the aim point to the child's screen-right so they stand left of
      // centre, clear of the panel.
      const theta = this.spherical.theta;
      desired.x += Math.cos(theta) * 1.05;
      desired.z -= Math.sin(theta) * 1.05;
      desired.y -= targetHeight * 0.08;
    }

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

    // Indoors the camera comes inside with the child and looks down into the
    // room over the ghosted walls. The first floor fades with the shell, so
    // there is no ceiling in the way and the shot can be a proper overhead
    // follow rather than a view through a doorway from the garden.
    //
    // It follows the CHILD, not the building: a camera parked on the house
    // leaves them wandering around in the corner of frame, and a small child
    // needs to be looking at the person they are controlling.
    const blend = this.indoorBlend;
    const wantRadius = MathUtils.lerp(this.targetSpherical.radius, INDOOR_RADIUS, blend);
    const wantPhi = MathUtils.lerp(this.targetSpherical.phi, INDOOR_PHI, blend);
    // Keep the player's chosen orbit indoors rather than snapping to a fixed
    // angle: rooms are small and being able to turn is how you see into corners.
    const wantTheta = this.targetSpherical.theta;
    // Aim a little higher on the body so the floor does not fill the frame.
    desired.y += targetHeight * 0.3 * blend;
    // Damp the orbit itself so even a flick reads as a smooth pan.
    this.spherical.radius = damp(this.spherical.radius, wantRadius, 5, dt);
    this.spherical.phi = damp(this.spherical.phi, wantPhi, 7, dt);
    this.spherical.theta = dampAngle(this.spherical.theta, wantTheta, 7, dt);

    this.lookAt.lerp(desired, 1 - Math.exp(-9 * dt));

    const offset = new Vector3().setFromSpherical(this.spherical);
    let position = new Vector3().addVectors(this.lookAt, offset);

    // Pull in until the child is actually visible.
    //
    // Indoors there is furniture between the camera and the child constantly —
    // stand behind the dining table and a fixed boom puts a table top across
    // their face. Shortening the boom rather than fading the furniture keeps
    // the room solid and readable, and it is the same thing a camera operator
    // would do: step closer until you can see them.
    if (this.collision && this.indoorBlend > 0.01) {
      const clear = this.firstClearDistance(this.lookAt, offset);
      if (clear < 1) {
        _shortened.copy(offset).multiplyScalar(Math.max(0.35, clear));
        position = new Vector3().addVectors(this.lookAt, _shortened);
      }
    }

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

  /**
   * Fraction of the boom that is clear of obstacles, 0..1.
   *
   * Marched rather than swept: the camera only needs to know how far back it
   * can sit, and a handful of samples along a 5m boom is both accurate enough
   * and far cheaper than a real shape cast.
   */
  private firstClearDistance(lookAt: Vector3, offset: Vector3): number {
    const collision = this.collision;
    if (!collision) return 1;

    const length = Math.hypot(offset.x, offset.z);
    if (length < 0.01) return 1;

    // Step finely enough to catch a wall. The chalet's walls are 0.6m thick, so
    // sampling every 0.65m can straddle one entirely and put the camera outside
    // the house looking at the back of it — which is exactly what happened.
    const steps = Math.max(8, Math.ceil(length / 0.18));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = lookAt.x + offset.x * t;
      const z = lookAt.z + offset.z * t;
      // Only walls and furniture; an animal wandering past must not yank the
      // camera in.
      if (collision.blocks(x, z, 0.3, 'animal')) {
        // Stop just short of whatever was hit.
        return Math.max(0.3, (i - 1) / steps);
      }
    }
    return 1;
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
    if (enabled) this.saved.copy(this.targetSpherical);
    else this.targetSpherical.copy(this.saved);
  }

  /**
   * A close, front-on framing of the child, offset so they stand in the left
   * part of the screen and a panel can sit on the right. Used while choosing
   * how the child looks, so every tap visibly changes the person in front of
   * you. `facing` is the direction the child faces; null returns to follow.
   */
  setPortrait(facing: number | null): void {
    if (facing === null) {
      if (this.mode === 'portrait') {
        this.mode = 'follow';
        this.targetSpherical.copy(this.saved);
      }
      return;
    }
    if (this.mode !== 'portrait') this.saved.copy(this.targetSpherical);
    this.mode = 'portrait';
    this.targetSpherical.set(3.6, MathUtils.degToRad(80), facing);
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
