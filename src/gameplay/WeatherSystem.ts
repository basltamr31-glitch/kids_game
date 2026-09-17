import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
  AmbientLight,
} from 'three';
import { color } from '../art/Palette';
import { setRimLight } from '../art/Materials';
import { clamp01, lerp, type Rng } from '../core/Rng';
import { skyColorsFor } from '../world/Sky';
import type { Weather, Season } from '../save/SaveSchema';
import type { QualitySettings } from '../core/DeviceProfile';

/**
 * Lighting, fog and precipitation.
 *
 * Time of day and weather are the two biggest levers on how the valley *feels*,
 * so they are handled together here: a rainy afternoon gets flat, cool, low-
 * contrast light and dense fog; a clear morning gets a long warm key light and
 * a deep blue ambient fill.
 *
 * Precipitation is a single Points cloud that follows the camera — a couple of
 * thousand particles, one draw call, and it never needs to cover the world.
 */

interface WeatherProfile {
  /** Directional light intensity multiplier. */
  sun: number;
  ambient: number;
  fogDensity: number;
  fogTint: string;
  /** 0..1, feeds the sky's cloud cover. */
  overcast: number;
  /** Particles per m³ (0 = none). */
  precipitation: number;
  precipitationKind: 'rain' | 'snow' | 'none';
  /** Desaturates the key light. */
  coolness: number;
}

const PROFILES: Record<Weather, WeatherProfile> = {
  sunny: { sun: 1.0, ambient: 0.62, fogDensity: 0.0032, fogTint: 'horizonDay', overcast: 0.12, precipitation: 0, precipitationKind: 'none', coolness: 0 },
  cloudy: { sun: 0.58, ambient: 0.74, fogDensity: 0.0052, fogTint: 'skyOvercast', overcast: 0.62, precipitation: 0, precipitationKind: 'none', coolness: 0.25 },
  rain: { sun: 0.3, ambient: 0.66, fogDensity: 0.011, fogTint: 'skyOvercast', overcast: 0.92, precipitation: 1, precipitationKind: 'rain', coolness: 0.5 },
  snow: { sun: 0.52, ambient: 0.86, fogDensity: 0.009, fogTint: 'snowShade', overcast: 0.78, precipitation: 0.75, precipitationKind: 'snow', coolness: 0.35 },
  fog: { sun: 0.42, ambient: 0.8, fogDensity: 0.02, fogTint: 'wallPlasterShade', overcast: 0.5, precipitation: 0, precipitationKind: 'none', coolness: 0.15 },
};

/** How far the key light is placed from the view centre. */
const SUN_DISTANCE = 90;

export class WeatherSystem {
  readonly sun: DirectionalLight;
  /**
   * Shadowless fill from roughly opposite the key.
   *
   * Standard three-point practice, and the single cheapest fix for surfaces
   * that face away from the sun reading as dead grey. It costs one extra
   * light term per fragment and buys back every shaded wall, flank and face
   * in the game.
   */
  readonly fill: DirectionalLight;
  readonly hemisphere: HemisphereLight;
  readonly ambient: AmbientLight;

  private scene: Scene;
  private fog: Fog;
  private quality: QualitySettings;

  private weather: Weather = 'sunny';
  private season: Season = 'summer';
  private blend = 1; // 0..1 transition between profiles
  private from: WeatherProfile = PROFILES.sunny;
  private to: WeatherProfile = PROFILES.sunny;

  private particles: Points | null = null;
  private particleVelocities: Float32Array | null = null;
  private particleCount = 0;
  private rng: Rng;

  private windowGlow = 0;

  constructor(scene: Scene, quality: QualitySettings, rng: Rng) {
    this.scene = scene;
    this.quality = quality;
    this.rng = rng;

    this.sun = new DirectionalLight(color('sunWarm').getHex(), 1.6);
    this.sun.castShadow = quality.shadows;
    this.configureShadow();
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.fill = new DirectionalLight(color('horizonDay').getHex(), 0.4);
    this.fill.castShadow = false;
    scene.add(this.fill);
    scene.add(this.fill.target);

    // Sky/ground bounce. On a stylized toon look this does most of the work of
    // a global illumination pass for essentially nothing.
    this.hemisphere = new HemisphereLight(
      color('skyDay').getHex(),
      color('grassDeep').getHex(),
      0.62,
    );
    scene.add(this.hemisphere);

    this.ambient = new AmbientLight(color('horizonDay').getHex(), 0.22);
    scene.add(this.ambient);

    this.fog = new Fog(color('horizonDay').getHex(), 40, 320);
    scene.fog = this.fog;

    this.buildParticles();
  }

  private configureShadow(): void {
    const s = this.sun.shadow;
    s.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    // Tight frustum around the farmyard: the whole point is crisp shadows on
    // the things the child is looking at, not on the far mountains.
    const extent = 34;
    s.camera.left = -extent;
    s.camera.right = extent;
    s.camera.top = extent;
    s.camera.bottom = -extent;
    // The light sits SUN_DISTANCE away, so the useful depth range is a narrow
    // band around it. Spanning 1..160 wasted almost all the depth precision and
    // produced severe acne — every shadow-casting object rendered near-black.
    s.camera.near = SUN_DISTANCE - extent * 1.6;
    s.camera.far = SUN_DISTANCE + extent * 1.8;
    s.bias = -0.0006;
    s.normalBias = 0.06;
    s.camera.updateProjectionMatrix();
  }

  onQualityChanged(quality: QualitySettings): void {
    this.quality = quality;
    this.sun.castShadow = quality.shadows;
    this.configureShadow();
    this.buildParticles();
  }

  setWeather(weather: Weather, immediate = false): void {
    if (this.weather === weather && !immediate) return;
    this.from = immediate ? PROFILES[weather] : this.currentProfile();
    this.to = PROFILES[weather];
    this.weather = weather;
    this.blend = immediate ? 1 : 0;
  }

  setSeason(season: Season): void {
    this.season = season;
  }

  get currentWeather(): Weather {
    return this.weather;
  }

  get overcast(): number {
    return this.currentProfile().overcast;
  }

  private currentProfile(): WeatherProfile {
    const t = clamp01(this.blend);
    return {
      sun: lerp(this.from.sun, this.to.sun, t),
      ambient: lerp(this.from.ambient, this.to.ambient, t),
      fogDensity: lerp(this.from.fogDensity, this.to.fogDensity, t),
      fogTint: t > 0.5 ? this.to.fogTint : this.from.fogTint,
      overcast: lerp(this.from.overcast, this.to.overcast, t),
      precipitation: lerp(this.from.precipitation, this.to.precipitation, t),
      precipitationKind: t > 0.5 ? this.to.precipitationKind : this.from.precipitationKind,
      coolness: lerp(this.from.coolness, this.to.coolness, t),
    };
  }

  /**
   * @param hour 0..24
   * @param sunDirection from the Sky, so light and sky always agree
   */
  update(dt: number, hour: number, sunDirection: Vector3, cameraPosition: Vector3): void {
    this.blend = Math.min(1, this.blend + dt * 0.35);
    const profile = this.currentProfile();

    /* --- key light --- */
    // Elevation drives both intensity and warmth; low sun = long warm light.
    const elevation = clamp01(sunDirection.y);
    const dayFactor = clamp01(elevation * 1.6);
    const sky = skyColorsFor(hour, profile.overcast);

    this.sun.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE).add(cameraPosition);
    this.sun.target.position.copy(cameraPosition);
    this.sun.target.updateMatrixWorld();

    const warm = color('sunGold').clone();
    const neutral = color('sunWarm').clone();
    const keyColor = warm.lerp(neutral, clamp01(elevation * 2.2));
    // Cool the key light in bad weather.
    keyColor.lerp(color('skyOvercast'), profile.coolness);
    this.sun.color.copy(keyColor);
    this.sun.intensity = (0.25 + dayFactor * 1.55) * profile.sun;

    /* --- fill --- */
    // Mirrored through the vertical axis and pushed lower, so it rakes across
    // exactly the faces the key light misses.
    this.fill.position
      .set(-sunDirection.x, Math.max(0.25, sunDirection.y * 0.35), -sunDirection.z)
      .normalize()
      .multiplyScalar(SUN_DISTANCE)
      .add(cameraPosition);
    this.fill.target.position.copy(cameraPosition);
    this.fill.target.updateMatrixWorld();
    // Takes the sky's colour but desaturated toward white, so it lifts shadows
    // without painting them blue.
    this.fill.color.copy(sky.zenith).lerp(color('sunWarm'), 0.55);
    this.fill.intensity = (0.16 + dayFactor * 0.34) * profile.ambient;

    /* --- fill --- */
    // Desaturated toward white for the same reason as the fill: a fully
    // saturated sky term tints every upward face blue.
    this.hemisphere.color.copy(sky.zenith).lerp(color('wallPlaster'), 0.38);
    this.hemisphere.groundColor.copy(
      this.season === 'winter' ? color('snowShade') : color('grassDeep'),
    );
    this.hemisphere.intensity = (0.3 + (1 - dayFactor) * 0.22 + dayFactor * 0.35) * profile.ambient;

    /* --- rim light --- */
    // The rim is standing in for sky bounce, so it takes the sky's own colour.
    // A low sun gives a warm gold edge; overcast gives a cold blue one; night
    // gives a faint moon-silver one. This is most of what makes a silhouette
    // read as three-dimensional against a bright background.
    const rimTint = sky.zenith.clone().lerp(sky.horizon, 0.45);
    const rimStrength =
      (0.22 + (1 - Math.abs(elevation - 0.25) * 2) * 0.16) * (1 - profile.overcast * 0.35);
    setRimLight(rimTint, Math.max(0.12, rimStrength));

    // Night never goes truly black — a child should always see their farm.
    const nightLift = 1 - dayFactor;
    this.ambient.color.copy(sky.horizon);
    this.ambient.intensity = 0.16 + nightLift * 0.3;

    /* --- fog --- */
    const fogColor = color(profile.fogTint).clone().lerp(sky.horizon, 0.55);
    this.fog.color.copy(fogColor);
    const density = profile.fogDensity * this.quality.fogDensityScale;
    // Fog expressed as near/far from a density so the tuning reads naturally.
    // Far is pushed well past the outermost mountain band. Tuned so the three
    // ridges land at roughly 25% / 45% / 65% fogged: enough separation to read
    // as distance, not so much that the farthest one dissolves into the sky.
    this.fog.near = lerp(60, 14, clamp01(density * 60));
    this.fog.far = lerp(520, 120, clamp01(density * 60));

    /* --- precipitation --- */
    this.updateParticles(dt, profile, cameraPosition);

    /* --- warm windows after dark --- */
    this.windowGlow = lerp(this.windowGlow, nightLift > 0.55 ? 1 : 0, 1 - Math.exp(-2 * dt));
  }

  /** 0..1 — used by the world to light the chalet windows at night. */
  get interiorLightAmount(): number {
    return this.windowGlow;
  }

  private buildParticles(): void {
    if (this.particles) {
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
      (this.particles.material as PointsMaterial).dispose();
      this.particles = null;
    }

    this.particleCount = Math.floor(this.quality.particleBudget * 4);
    if (this.particleCount < 20) return;

    const positions = new Float32Array(this.particleCount * 3);
    this.particleVelocities = new Float32Array(this.particleCount);

    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = this.rng.range(-22, 22);
      positions[i * 3 + 1] = this.rng.range(0, 26);
      positions[i * 3 + 2] = this.rng.range(-22, 22);
      this.particleVelocities[i] = this.rng.range(0.7, 1.4);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));

    const material = new PointsMaterial({
      size: 0.14,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      color: new Color(0xffffff),
      fog: false,
    });

    this.particles = new Points(geometry, material);
    this.particles.name = 'precipitation';
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 20;
    this.scene.add(this.particles);
  }

  private updateParticles(dt: number, profile: WeatherProfile, cameraPosition: Vector3): void {
    if (!this.particles || !this.particleVelocities) return;

    const material = this.particles.material as PointsMaterial;
    const isSnow = profile.precipitationKind === 'snow';
    const targetOpacity = profile.precipitation * (isSnow ? 0.85 : 0.5);
    material.opacity = lerp(material.opacity, targetOpacity, 1 - Math.exp(-2 * dt));

    if (material.opacity < 0.01) {
      this.particles.visible = false;
      return;
    }
    this.particles.visible = true;

    material.size = isSnow ? 0.2 : 0.09;
    material.color.copy(isSnow ? color('snow') : color('waterFoam'));

    // Follow the camera in whole-cell steps so particles never appear to swim.
    this.particles.position.set(
      Math.round(cameraPosition.x),
      0,
      Math.round(cameraPosition.z),
    );

    const attribute = this.particles.geometry.attributes.position as BufferAttribute;
    const array = attribute.array as Float32Array;
    const fallSpeed = isSnow ? 1.6 : 17;
    const drift = isSnow ? 1.1 : 0.25;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;
      array[i3 + 1] -= fallSpeed * this.particleVelocities[i] * dt;
      if (isSnow) {
        // Snow tumbles; rain does not.
        array[i3] += Math.sin(array[i3 + 1] * 0.6 + i) * drift * dt;
        array[i3 + 2] += Math.cos(array[i3 + 1] * 0.5 + i) * drift * dt;
      } else {
        array[i3] += drift * dt;
      }

      if (array[i3 + 1] < -2) {
        array[i3] = this.rng.range(-22, 22);
        array[i3 + 1] = this.rng.range(20, 28);
        array[i3 + 2] = this.rng.range(-22, 22);
      }
    }
    attribute.needsUpdate = true;
  }

  dispose(): void {
    if (this.particles) {
      this.particles.geometry.dispose();
      (this.particles.material as PointsMaterial).dispose();
      this.scene.remove(this.particles);
    }
  }
}
