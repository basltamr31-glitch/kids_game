import {
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  Euler,
  Color,
  DynamicDrawUsage,
} from 'three';
import { PartBuilder, geoPetal, paint, setNormalsUp } from '../art/MeshKit';
import { surface } from '../art/Materials';
import { color } from '../art/Palette';
import type { Rng } from '../core/Rng';
import type { Terrain } from './Terrain';
import type { QualitySettings } from '../core/DeviceProfile';

/**
 * The things that move when nobody is asking them to.
 *
 * A farm where only the animals and the child ever move reads as a diorama.
 * Butterflies over the meadow, birds turning overhead and smoke leaving the
 * chimney cost almost nothing and are most of what makes a still frame look
 * alive. None of it is interactive and none of it is on the critical path, so
 * it all scales down cleanly on weak hardware.
 *
 * Wings are two InstancedMeshes rather than one, left and right. An instance
 * carries a matrix and nothing else, so a single mesh could only ever flap by
 * rolling the whole creature; splitting the wings buys a real flap for one
 * extra draw call each.
 */

const _matrix = new Matrix4();
const _pos = new Vector3();
const _quat = new Quaternion();
const _euler = new Euler();
const _scale = new Vector3();
const _colour = new Color();

/** Birds range over the whole valley, not over the meadow. */
const BIRD_CENTRE = new Vector3(0, 0, 0);

interface Flyer {
  position: Vector3;
  target: Vector3;
  /** Radians per second of wing beat, and where in the beat it currently is. */
  flapSpeed: number;
  flapPhase: number;
  speed: number;
  /** Current heading, damped toward the target so turns are curves. */
  heading: number;
  /** Seconds until a new target is chosen. */
  restTimer: number;
  scale: number;
}

interface Puff {
  position: Vector3;
  age: number;
  life: number;
  rise: number;
  spin: number;
}

export interface AmbientLifeOptions {
  /** World-space points smoke leaves from. */
  chimneys: Vector3[];
  /** Centre of the meadow butterflies keep to. */
  meadowCentre: Vector3;
  meadowRadius: number;
}

export class AmbientLife {
  readonly group = new Group();

  private butterflies: Flyer[] = [];
  private birds: Flyer[] = [];
  private puffs: Puff[] = [];

  private butterflyWings: [InstancedMesh, InstancedMesh] | null = null;
  private birdWings: [InstancedMesh, InstancedMesh] | null = null;
  private smoke: InstancedMesh | null = null;

  private rng: Rng;
  private terrain: Terrain;
  private options: AmbientLifeOptions;

  constructor(
    rng: Rng,
    terrain: Terrain,
    quality: QualitySettings,
    options: AmbientLifeOptions,
  ) {
    this.group.name = 'ambient-life';
    this.rng = rng;
    this.terrain = terrain;
    this.options = options;

    const scale = quality.tier === 'low' ? 0.35 : quality.tier === 'medium' ? 0.7 : 1;
    this.buildButterflies(Math.round(16 * scale));
    this.buildBirds(Math.round(7 * scale));
    this.buildSmoke(Math.round(14 * scale));
  }

  /* ---------------- butterflies ---------------- */

  private buildButterflies(count: number): void {
    if (count <= 0) return;

    // A wing is a petal: rounded, tapering to the joint. Hinged at the origin
    // so the instance matrix's rotation IS the flap.
    //
    // geoPetal builds in the XY plane, standing up and facing +Z. A wing has to
    // lie flat and reach out along +X, or the creature renders as a thin bar
    // seen edge-on. The default XYZ Euler order applies Z first, so this rolls
    // the shape onto +X and then tips it over into the XZ plane.
    const wing = new PartBuilder();
    wing.add(geoPetal(0.055, 0.07), 'meadowFlowerA', { rot: [-Math.PI / 2, 0, -Math.PI / 2] });
    const geometry = wing.build({ ao: false });
    setNormalsUp(geometry);
    // Instanced colour multiplies the vertex colour, so the geometry must be
    // white or every butterfly comes out muddy.
    paint(geometry, '#FFFFFF');

    const material = surface({
      vertexColors: true,
      doubleSided: true,
      useAO: false,
      rim: 0.6,
    });

    const variants = ['meadowFlowerA', 'meadowFlowerB', 'sunGold', 'uiBlue', 'wallPlaster'];
    const meshes: InstancedMesh[] = [];
    for (let side = 0; side < 2; side++) {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.name = `butterfly-wing-${side}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      meshes.push(mesh);
      this.group.add(mesh);
    }

    const { meadowCentre, meadowRadius } = this.options;
    for (let i = 0; i < count; i++) {
      const flyer = this.spawnFlyer(meadowCentre, meadowRadius, 0.5, 1.9);
      flyer.flapSpeed = this.rng.range(14, 20);
      flyer.speed = this.rng.range(0.7, 1.4);
      flyer.scale = this.rng.range(0.75, 1.25);
      this.butterflies.push(flyer);

      _colour.copy(color(this.rng.pick(variants)));
      for (const mesh of meshes) mesh.setColorAt(i, _colour);
    }
    for (const mesh of meshes) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.butterflyWings = [meshes[0], meshes[1]];
  }

  /* ---------------- birds ---------------- */

  private buildBirds(count: number): void {
    if (count <= 0) return;

    const wing = new PartBuilder();
    // Laid flat and reaching out along +X, as for the butterflies above. Tapered
    // so the silhouette reads as a bird rather than as a plank.
    wing.add(geoPetal(0.34, 0.85), 'trunkDark', { rot: [-Math.PI / 2, 0, -Math.PI / 2] });
    const geometry = wing.build({ ao: false });
    setNormalsUp(geometry);
    paint(geometry, '#FFFFFF');

    const material = surface({
      vertexColors: true,
      doubleSided: true,
      useAO: false,
      rim: 0,
    });

    const meshes: InstancedMesh[] = [];
    for (let side = 0; side < 2; side++) {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.name = `bird-wing-${side}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      meshes.push(mesh);
      this.group.add(mesh);
    }

    for (let i = 0; i < count; i++) {
      const flyer = this.spawnFlyer(new Vector3(0, 0, 0), 62, 17, 27);
      flyer.flapSpeed = this.rng.range(3.4, 5.2);
      flyer.speed = this.rng.range(4.5, 7.5);
      flyer.scale = this.rng.range(0.7, 1.05);
      this.birds.push(flyer);

      // Dark against the sky, with a little variation so they are not a set.
      _colour.setScalar(this.rng.range(0.16, 0.34));
      for (const mesh of meshes) mesh.setColorAt(i, _colour);
    }
    for (const mesh of meshes) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.birdWings = [meshes[0], meshes[1]];
  }

  /* ---------------- chimney smoke ---------------- */

  private buildSmoke(count: number): void {
    if (count <= 0 || this.options.chimneys.length === 0) return;

    const puff = new PartBuilder();
    puff.sphere(0.52, 'wallPlaster', {}, 7);
    const geometry = puff.build({ ao: false });
    setNormalsUp(geometry);
    paint(geometry, '#FFFFFF');

    // Unlit and translucent: toon-shaded smoke bands into lumps, and smoke has
    // no surface to shade anyway.
    const material = surface({
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      unlit: true,
      useAO: false,
      rim: 0,
      fog: true,
    });

    const mesh = new InstancedMesh(geometry, material, count);
    mesh.name = 'chimney-smoke';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.add(mesh);
    this.smoke = mesh;

    for (let i = 0; i < count; i++) {
      const source = this.options.chimneys[i % this.options.chimneys.length];
      this.puffs.push({
        position: source.clone(),
        // Stagger evenly across one lifetime so the column is continuous from
        // the first frame. Staggering past the lifetime just makes them all
        // respawn together and clump.
        age: (i / count) * 4,
        life: this.rng.range(3.4, 4.6),
        rise: this.rng.range(0.85, 1.25),
        spin: this.rng.range(-0.6, 0.6),
      });
    }
  }

  /* ---------------- shared ---------------- */

  private spawnFlyer(
    centre: Vector3,
    radius: number,
    minY: number,
    maxY: number,
  ): Flyer {
    const angle = this.rng.range(0, Math.PI * 2);
    const distance = Math.sqrt(this.rng.next()) * radius;
    const x = centre.x + Math.cos(angle) * distance;
    const z = centre.z + Math.sin(angle) * distance;
    const y = this.terrain.heightAt(x, z) + this.rng.range(minY, maxY);
    const position = new Vector3(x, y, z);
    return {
      position,
      target: position.clone(),
      flapSpeed: 10,
      flapPhase: this.rng.range(0, Math.PI * 2),
      speed: 1,
      heading: this.rng.range(0, Math.PI * 2),
      restTimer: this.rng.range(0, 3),
      scale: 1,
    };
  }

  private retarget(flyer: Flyer, centre: Vector3, radius: number, minY: number, maxY: number): void {
    const angle = this.rng.range(0, Math.PI * 2);
    const distance = Math.sqrt(this.rng.next()) * radius;
    const x = centre.x + Math.cos(angle) * distance;
    const z = centre.z + Math.sin(angle) * distance;
    flyer.target.set(x, this.terrain.heightAt(x, z) + this.rng.range(minY, maxY), z);
  }

  /**
   * Moves a flyer toward its target and writes both wings' matrices.
   *
   * `flapAxis` is which way the wings hinge: butterflies beat almost vertically
   * about their own length, birds sweep about their shoulder.
   */
  private stepFlyer(
    flyer: Flyer,
    index: number,
    dt: number,
    wings: [InstancedMesh, InstancedMesh],
    flapRange: number,
    bankStrength: number,
  ): void {
    const toTarget = _pos.subVectors(flyer.target, flyer.position);
    const distance = toTarget.length();
    if (distance > 0.001) toTarget.divideScalar(distance);

    // Turn toward the target rather than snapping, so paths are curves.
    const wanted = Math.atan2(toTarget.x, toTarget.z);
    let delta = wanted - flyer.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const turn = delta * Math.min(1, dt * 2.4);
    flyer.heading += turn;

    const forward = _scale.set(Math.sin(flyer.heading), 0, Math.cos(flyer.heading));
    flyer.position.addScaledVector(forward, flyer.speed * dt);
    flyer.position.y += toTarget.y * flyer.speed * dt;

    flyer.flapPhase += flyer.flapSpeed * dt;
    const flap = Math.sin(flyer.flapPhase) * flapRange;
    // Bank into the turn; it is the single cue that sells flight.
    const bank = -turn * bankStrength;

    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      _euler.set(0, flyer.heading + (sign > 0 ? 0 : Math.PI), bank + flap * sign, 'YXZ');
      _quat.setFromEuler(_euler);
      _scale.setScalar(flyer.scale);
      _matrix.compose(flyer.position, _quat, _scale);
      wings[side].setMatrixAt(index, _matrix);
    }
  }

  update(dt: number, windDrift: number): void {
    const { meadowCentre, meadowRadius } = this.options;

    if (this.butterflyWings) {
      for (let i = 0; i < this.butterflies.length; i++) {
        const b = this.butterflies[i];
        b.restTimer -= dt;
        if (b.restTimer <= 0 || b.position.distanceToSquared(b.target) < 0.25) {
          b.restTimer = this.rng.range(1.5, 4);
          this.retarget(b, meadowCentre, meadowRadius, 0.5, 1.9);
        }
        // A butterfly's path is all bob and no straight line.
        b.position.y += Math.sin(b.flapPhase * 0.23) * 0.5 * dt;
        this.stepFlyer(b, i, dt, this.butterflyWings, 1.05, 0.8);
      }
      for (const mesh of this.butterflyWings) mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.birdWings) {
      for (let i = 0; i < this.birds.length; i++) {
        const bird = this.birds[i];
        bird.restTimer -= dt;
        if (bird.restTimer <= 0 || bird.position.distanceToSquared(bird.target) < 25) {
          bird.restTimer = this.rng.range(4, 9);
          this.retarget(bird, BIRD_CENTRE, 62, 17, 27);
        }
        this.stepFlyer(bird, i, dt, this.birdWings, 0.95, 1.4);
      }
      for (const mesh of this.birdWings) mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.smoke) {
      for (let i = 0; i < this.puffs.length; i++) {
        const puff = this.puffs[i];
        puff.age += dt;
        if (puff.age >= puff.life) {
          const source = this.options.chimneys[i % this.options.chimneys.length];
          puff.position.copy(source);
          puff.age = 0;
          puff.life = this.rng.range(3.4, 4.6);
          puff.rise = this.rng.range(0.85, 1.25);
          puff.spin = this.rng.range(-0.6, 0.6);
        }
        const t = puff.age / puff.life;
        puff.position.y += puff.rise * dt;
        // Lean downwind as it climbs, the way a plume actually behaves.
        puff.position.x += windDrift * dt * 0.28 * (0.3 + t);
        puff.position.z += windDrift * dt * 0.12 * (0.3 + t);

        // Grow, then shrink away. Shrinking stands in for fading, because an
        // InstancedMesh has no per-instance opacity to fade with. It must start
        // at a visible size rather than at zero, or the first second of every
        // puff's life is invisible and the plume floats detached above the pot.
        const grow = 0.42 + t * 1.5;
        const fade = t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28;
        const size = grow * fade;
        _euler.set(0, puff.spin * puff.age, 0);
        _quat.setFromEuler(_euler);
        _scale.setScalar(Math.max(0.001, size));
        _matrix.compose(puff.position, _quat, _scale);
        this.smoke.setMatrixAt(i, _matrix);
      }
      this.smoke.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of [
      ...(this.butterflyWings ?? []),
      ...(this.birdWings ?? []),
      ...(this.smoke ? [this.smoke] : []),
    ]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.group.clear();
  }
}

