import {
  BackSide,
  BufferAttribute,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  AdditiveBlending,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Vector3,
} from 'three';
import { PartBuilder } from '../art/MeshKit';
import { surface } from '../art/Materials';
import { color } from '../art/Palette';
import { clamp01, type Rng } from '../core/Rng';

/**
 * Sky, sun, moon and clouds.
 *
 * The dome is a two-colour vertical gradient driven by a 20-line shader — far
 * cheaper than a cubemap and, more importantly, it can be animated smoothly
 * from dawn to night without any texture swapping.
 */

const SKY_VERT = /* glsl */ `
  varying float vHeight;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vHeight = normalize(world.xyz).y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunStrength;
  varying float vHeight;

  void main() {
    // Bias the gradient toward the horizon so the sky reads as "big".
    float t = pow(clamp(vHeight, 0.0, 1.0), 0.62);
    vec3 sky = mix(uHorizon, uZenith, t);

    // A wide, soft glow around the sun direction; this is what sells sunrise.
    float glow = pow(clamp(dot(normalize(vec3(0.0, vHeight, 1.0)), uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
    float horizonGlow = smoothstep(0.35, -0.08, vHeight) * uSunStrength;
    sky += uSunColor * (glow * 0.10 + horizonGlow * 0.35);

    gl_FragColor = vec4(sky, 1.0);

    // Opt into the renderer's output pipeline. Without these two chunks a raw
    // ShaderMaterial writes linear values that are then read as sRGB, which is
    // why an untreated sky dome comes out muddy and slightly purple.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Sky {
  readonly group = new Group();
  readonly sunDirection = new Vector3(0.4, 0.7, 0.3).normalize();

  private domeMaterial: ShaderMaterial;
  private sun: Sprite;
  private moon: Sprite;
  private clouds: Group;
  private cloudDrift = 0;

  constructor(rng: Rng) {
    /* --- gradient dome --- */
    const dome = new SphereGeometry(420, 24, 16);
    this.domeMaterial = new ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uHorizon: { value: color('horizonDay').clone() },
        uZenith: { value: color('skyDay').clone() },
        uSunColor: { value: color('sunGold').clone() },
        uSunDir: { value: this.sunDirection.clone() },
        uSunStrength: { value: 1 },
      },
    });
    const domeMesh = new Mesh(dome, this.domeMaterial);
    domeMesh.name = 'sky-dome';
    domeMesh.frustumCulled = false;
    domeMesh.renderOrder = -1000;
    this.group.add(domeMesh);

    /* --- sun & moon as soft sprites --- */
    this.sun = makeGlowSprite('#FFF4D8', 70);
    this.moon = makeGlowSprite('#DCE6FF', 42);
    this.group.add(this.sun, this.moon);

    /* --- stylized cloud banks --- */
    this.clouds = buildClouds(rng);
    this.group.add(this.clouds);
  }

  /**
   * Drives the whole sky from a normalised time of day.
   * @param hour 0..24
   * @param overcast 0 (clear) .. 1 (heavy cloud), from the weather system
   */
  update(hour: number, overcast: number, dt: number): void {
    // Sun travels a tilted arc so shadows sweep across the valley nicely.
    const dayT = clamp01((hour - 5) / 14); // 05:00 sunrise .. 19:00 sunset
    const angle = dayT * Math.PI;
    const elevation = Math.sin(angle);
    // The vertical component is deliberately capped and a constant southerly
    // bias is kept. A sun that climbs to the zenith leaves every vertical wall
    // lit only by the sky, which turns warm plaster a dead blue-grey at noon.
    // A ~50-degree peak also matches the latitude these valleys actually sit at.
    this.sunDirection
      .set(Math.cos(angle) * 0.95, Math.max(-0.35, elevation * 0.76), 0.58)
      .normalize();

    const u = this.domeMaterial.uniforms;
    (u.uSunDir.value as Vector3).copy(this.sunDirection);

    const { horizon, zenith, sunTint, strength } = skyColorsFor(hour, overcast);
    (u.uHorizon.value as Color).lerp(horizon, 1 - Math.exp(-3 * dt));
    (u.uZenith.value as Color).lerp(zenith, 1 - Math.exp(-3 * dt));
    (u.uSunColor.value as Color).lerp(sunTint, 1 - Math.exp(-3 * dt));
    u.uSunStrength.value += (strength - (u.uSunStrength.value as number)) * (1 - Math.exp(-3 * dt));

    // Place the billboards far out along their directions.
    this.sun.position.copy(this.sunDirection).multiplyScalar(360);
    this.moon.position.copy(this.sunDirection).multiplyScalar(-360);

    const sunVisible = elevation > -0.05 ? 1 : 0;
    this.sun.material.opacity = sunVisible * (1 - overcast * 0.85);
    this.moon.material.opacity = (1 - sunVisible) * 0.9;

    // Clouds drift slowly; they thicken and darken with the weather.
    this.cloudDrift += dt * 0.35;
    this.clouds.position.x = Math.sin(this.cloudDrift * 0.06) * 24;
    this.clouds.rotation.y += dt * 0.004;
    const first = this.clouds.children[0] as Mesh | undefined;
    if (first) {
      // All banks share one material instance, so a single write fades them all.
      (first.material as { opacity: number }).opacity = 0.35 + overcast * 0.6;
    }
    this.clouds.visible = overcast > 0.04;
  }

  /** Keeps the dome centred on the player so it never clips. */
  follow(x: number, z: number): void {
    this.group.position.set(x, 0, z);
  }

  dispose(): void {
    this.domeMaterial.dispose();
    this.sun.material.map?.dispose();
    this.sun.material.dispose();
    this.moon.material.map?.dispose();
    this.moon.material.dispose();
  }
}

/** Key-framed sky palette across the day, blended with the overcast amount. */
export function skyColorsFor(
  hour: number,
  overcast: number,
): { horizon: Color; zenith: Color; sunTint: Color; strength: number } {
  const keys: { at: number; horizon: string; zenith: string; sun: string; strength: number }[] = [
    { at: 0, horizon: 'horizonNight', zenith: 'skyNight', sun: 'moonPale', strength: 0.05 },
    { at: 5, horizon: 'horizonNight', zenith: 'skyNight', sun: 'sunGold', strength: 0.2 },
    { at: 6.5, horizon: 'skyDawn', zenith: 'skyDay', sun: 'sunGold', strength: 1.0 },
    { at: 9, horizon: 'horizonDay', zenith: 'skyDay', sun: 'sunWarm', strength: 0.5 },
    { at: 13, horizon: 'horizonDay', zenith: 'skyNoon', sun: 'sunWarm', strength: 0.35 },
    { at: 17, horizon: 'horizonDay', zenith: 'skyDay', sun: 'sunGold', strength: 0.5 },
    { at: 19, horizon: 'horizonDusk', zenith: 'skyDusk', sun: 'sunGold', strength: 1.0 },
    { at: 20.5, horizon: 'horizonNight', zenith: 'skyNight', sun: 'moonPale', strength: 0.25 },
    { at: 24, horizon: 'horizonNight', zenith: 'skyNight', sun: 'moonPale', strength: 0.05 },
  ];

  const h = ((hour % 24) + 24) % 24;
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (h >= keys[i].at && h <= keys[i + 1].at) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const span = Math.max(1e-4, b.at - a.at);
  const t = clamp01((h - a.at) / span);

  const horizon = color(a.horizon).clone().lerp(color(b.horizon), t);
  const zenith = color(a.zenith).clone().lerp(color(b.zenith), t);
  const sunTint = color(a.sun).clone().lerp(color(b.sun), t);
  const strength = a.strength + (b.strength - a.strength) * t;

  // Overcast desaturates the sky toward flat grey-blue.
  const grey = color('skyOvercast');
  horizon.lerp(grey, overcast * 0.7);
  zenith.lerp(grey, overcast * 0.55);

  return { horizon, zenith, sunTint, strength: strength * (1 - overcast * 0.6) };
}

function makeGlowSprite(hexColor: string, size: number): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, hexColor);
  gradient.addColorStop(0.35, `${hexColor}CC`);
  gradient.addColorStop(1, `${hexColor}00`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new CanvasTexture(canvas);
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    fog: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.setScalar(size);
  sprite.renderOrder = -999;
  return sprite;
}

/** Chunky stylized cloud banks made of overlapping spheres, far overhead. */
function buildClouds(rng: Rng): Group {
  const group = new Group();
  group.name = 'clouds';

  // One shared, unique material so the weather system can fade every bank at once.
  const cloudMaterial = surface({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    fog: false,
    unique: true,
    useAO: false,
    rim: 0,
  });

  const count = 9;
  for (let i = 0; i < count; i++) {
    const builder = new PartBuilder();
    const puffs = rng.int(4, 7);
    for (let p = 0; p < puffs; p++) {
      const radius = rng.range(9, 17);
      builder.sphere(
        radius,
        'wallPlaster',
        {
          pos: [rng.range(-22, 22), rng.range(-3, 4), rng.range(-9, 9)],
          scale: [1, rng.range(0.55, 0.8), 1],
        },
        8,
      );
    }
    const geometry = builder.build({ ao: false });
    // Flatten the underside so clouds read as a ceiling, not floating balls.
    const pos = geometry.attributes.position as BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      if (pos.getY(v) < -2) pos.setY(v, -2);
    }
    geometry.computeVertexNormals();

    const mesh = new Mesh(geometry, cloudMaterial);
    const angle = (i / count) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const distance = rng.range(120, 230);
    mesh.position.set(
      Math.cos(angle) * distance,
      rng.range(70, 105),
      Math.sin(angle) * distance,
    );
    mesh.renderOrder = -500;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
