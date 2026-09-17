import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FrontSide,
  LinearFilter,
  MeshBasicMaterial,
  MeshToonMaterial,
  RedFormat,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { color } from './Palette';
import { detailTexture, type DetailKind } from './Textures';
import { clamp01, smoothstep } from '../core/Rng';

/**
 * Stylized shading.
 *
 * Built on MeshToonMaterial rather than a raw ShaderMaterial so we inherit
 * three's shadow, fog and instancing machinery for free, then patched through
 * `onBeforeCompile` with the three things that actually lift procedural
 * geometry out of "flat prototype" territory:
 *
 *   1. VERTEX AO  - crevice darkening baked at build time (see MeshKit).
 *      This is the big one. Procedural models are assemblies of primitives, and
 *      without contact darkening the seams between them read as decals rather
 *      than as joins.
 *   2. RIM LIGHT  - a sky-tinted fresnel edge. Separates a brown cow from a
 *      brown barn, and is what makes a silhouette feel three-dimensional.
 *   3. DETAIL GRAIN - biplanar luminance-only texture. The palette still owns
 *      every hue; the texture only gives the eye something to land on.
 *
 * All three are per-tier: the low tier drops detail mapping and halves the rim.
 */

/* ------------------------------------------------------------------ */
/* Shared uniforms                                                     */
/* ------------------------------------------------------------------ */

interface SharedUniforms {
  uRimColor: { value: Color };
  uRimPower: { value: number };
  uRimStrength: { value: number };
  uAOStrength: { value: number };
  uTime: { value: number };
  uWindStrength: { value: number };
}

/**
 * One shared uniform object handed to every patched material, so the weather
 * system can re-tint every rim light in the world with a single write.
 */
const shared: SharedUniforms = {
  uRimColor: { value: new Color(0.6, 0.72, 0.9) },
  uRimPower: { value: 2.6 },
  uRimStrength: { value: 0.35 },
  uAOStrength: { value: 1.0 },
  uTime: { value: 0 },
  uWindStrength: { value: 1 },
};

/** Called each frame by the world; drives wind and keeps the rim in sync. */
export function updateSharedUniforms(time: number, windStrength: number): void {
  shared.uTime.value = time;
  shared.uWindStrength.value = windStrength;
}

/**
 * Rim light colour should be the sky, because that is physically where the
 * bounce comes from. Driving it from the weather system means a character
 * picks up cold blue edges under overcast and warm gold at sunset for free.
 */
export function setRimLight(tint: Color, strength: number): void {
  shared.uRimColor.value.copy(tint);
  shared.uRimStrength.value = strength;
}

export function setAOStrength(strength: number): void {
  shared.uAOStrength.value = strength;
}

/* ------------------------------------------------------------------ */
/* Toon ramp                                                           */
/* ------------------------------------------------------------------ */

let toonRamp: Texture | null = null;

/**
 * The lighting ramp. Five soft bands with a lifted floor: in a stylized
 * children's game a shadow should read as a cooler shade of the same colour,
 * never as darkness.
 */
export function getToonRamp(): Texture {
  if (toonRamp) return toonRamp;

  const size = 64;
  const data = new Uint8Array(size);
  const bands = 5;
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    const band = Math.floor(t * bands) / (bands - 1);
    const local = (t * bands) % 1;
    const soft = smoothstep(0.35, 0.65, local) / (bands - 1);
    const value = clamp01(band + soft * 0.9);
    data[i] = Math.round((0.45 + value * 0.55) * 255);
  }

  toonRamp = new DataTexture(data, size, 1, RedFormat);
  toonRamp.minFilter = LinearFilter;
  toonRamp.magFilter = LinearFilter;
  toonRamp.generateMipmaps = false;
  toonRamp.needsUpdate = true;
  return toonRamp;
}

/* ------------------------------------------------------------------ */
/* Quality                                                             */
/* ------------------------------------------------------------------ */

let detailEnabled = true;
let rimEnabled = true;

export function setMaterialQuality(options: { detail: boolean; rim: boolean }): void {
  detailEnabled = options.detail;
  rimEnabled = options.rim;
}

/* ------------------------------------------------------------------ */
/* Surface factory                                                     */
/* ------------------------------------------------------------------ */

export interface SurfaceOptions {
  /** Palette key or hex string. Ignored when `vertexColors` is set. */
  tint?: string;
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  doubleSided?: boolean;
  /** Unlit - sky dome, emissive windows, UI-ish billboards. */
  unlit?: boolean;
  alphaTest?: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** Do not share the instance (needed when the caller animates a property). */
  unique?: boolean;
  fog?: boolean;
  /** Surface grain. Omit for no detail mapping. */
  detail?: DetailKind;
  /** World-space tiling for the detail texture. */
  detailScale?: number;
  /** How strongly the grain modulates brightness. 0..1 */
  detailStrength?: number;
  /** Per-material rim multiplier; 0 disables. */
  rim?: number;
  /** Vertex-shader wind sway strength. 0 disables. */
  wind?: number;
  /** Vertex AO is read from the `aAO` attribute; set false for geometry without it. */
  useAO?: boolean;
}

const cache = new Map<string, Material>();

type PatchedMaterial = Material & {
  onBeforeCompile: (shader: ShaderLike) => void;
  customProgramCacheKey?: () => string;
};

interface ShaderLike {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

/**
 * The one material factory. Everything visible in the game is created here, so
 * a global look change is a single edit in this file.
 */
export function surface(options: SurfaceOptions = {}): Material {
  const key = JSON.stringify(options) + `|d${detailEnabled}|r${rimEnabled}`;
  if (!options.unique) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  const side = options.doubleSided ? DoubleSide : FrontSide;
  const baseColor = options.vertexColors ? 0xffffff : color(options.tint ?? 'grassMid');
  const transparent = options.transparent ?? false;
  const opacity = options.opacity ?? 1;

  let material: Material;

  if (options.unlit) {
    const basic = new MeshBasicMaterial({
      color: baseColor,
      vertexColors: options.vertexColors ?? false,
      transparent,
      opacity,
      side,
      fog: options.fog ?? true,
      depthWrite: transparent ? opacity > 0.95 : true,
    });
    if (options.alphaTest) basic.alphaTest = options.alphaTest;
    material = basic;
  } else {
    const toon = new MeshToonMaterial({
      color: baseColor,
      gradientMap: getToonRamp(),
      vertexColors: options.vertexColors ?? false,
      transparent,
      opacity,
      side,
      fog: options.fog ?? true,
      depthWrite: transparent ? opacity > 0.95 : true,
    });
    if (options.alphaTest) toon.alphaTest = options.alphaTest;
    if (options.emissive) {
      toon.emissive = color(options.emissive);
      toon.emissiveIntensity = options.emissiveIntensity ?? 1;
    }
    material = toon;
  }

  applyPatches(material as PatchedMaterial, options);

  if (!options.unique) cache.set(key, material);
  return material;
}

/**
 * Installs the AO / rim / detail / wind shader patches.
 *
 * They all go through a single `onBeforeCompile` because three only supports
 * one hook per material, and because composing them here lets a mesh be, say,
 * wind-swayed AND rim-lit without the two fighting over the shader source.
 */
function applyPatches(material: PatchedMaterial, options: SurfaceOptions): void {
  const useAO = options.useAO !== false;
  const useDetail = detailEnabled && !!options.detail && !options.unlit;
  const useRim = rimEnabled && !options.unlit && (options.rim ?? 1) > 0;
  const useWind = (options.wind ?? 0) > 0;

  if (!useAO && !useDetail && !useRim && !useWind) return;

  const detailMap = useDetail ? detailTexture(options.detail!) : null;
  const detailScale = options.detailScale ?? 1.4;
  const detailStrength = options.detailStrength ?? 0.5;
  const rimScale = options.rim ?? 1;
  const windStrength = options.wind ?? 0;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = shared.uRimColor;
    shader.uniforms.uRimPower = shared.uRimPower;
    shader.uniforms.uRimStrength = shared.uRimStrength;
    shader.uniforms.uAOStrength = shared.uAOStrength;
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWindStrength = shared.uWindStrength;
    shader.uniforms.uRimScale = { value: rimScale };
    shader.uniforms.uDetailMap = { value: detailMap };
    shader.uniforms.uDetailScale = { value: detailScale };
    shader.uniforms.uDetailStrength = { value: detailStrength };
    shader.uniforms.uWindLocal = { value: windStrength };

    /* ---------------- vertex ---------------- */

    let vertexHead = '';
    let vertexBody = '';

    if (useAO) {
      vertexHead += '\nattribute float aAO;\nvarying float vAO;';
      vertexBody += '\n  vAO = aAO;';
    }
    if (useDetail || useRim) {
      vertexHead += '\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;';
    }
    if (useWind) {
      vertexHead += '\nuniform float uTime;\nuniform float uWindStrength;\nuniform float uWindLocal;';
    }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>${vertexHead}`,
    );

    if (useAO) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>${vertexBody}`,
      );
    }

    if (useWind) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          // Sway scales with height above the object's own root so the base
          // stays planted. Phase comes from world position, which desyncs
          // every instance without needing a per-instance attribute.
          float swayMask = max(transformed.y, 0.0);
          #ifdef USE_INSTANCING
            float phase = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.9;
          #else
            float phase = 0.0;
          #endif
          float w = uWindStrength * uWindLocal;
          float sway = sin(uTime * 1.6 + phase) * 0.06
                     + sin(uTime * 3.1 + phase * 1.7) * 0.025;
          transformed.x += sway * swayMask * w;
          transformed.z += sway * 0.55 * swayMask * w;
        }`,
      );
    }

    if (useDetail || useRim) {
      // worldpos_vertex runs after the instance/skin transform, so this is
      // correct for instanced meshes too.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        }`,
      );
    }

    /* ---------------- fragment ---------------- */

    let fragmentHead = '';
    if (useAO) fragmentHead += '\nvarying float vAO;\nuniform float uAOStrength;';
    if (useDetail || useRim) fragmentHead += '\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;';
    if (useDetail) {
      fragmentHead +=
        '\nuniform sampler2D uDetailMap;\nuniform float uDetailScale;\nuniform float uDetailStrength;';
    }
    if (useRim) {
      fragmentHead +=
        '\nuniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;\nuniform float uRimScale;';
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>${fragmentHead}`,
    );

    // AO and detail modulate the diffuse colour before lighting, so they read
    // as the surface being darker rather than as a shadow laid on top.
    let colorPatch = '';
    if (useAO) {
      colorPatch += `
      {
        float ao = mix(1.0, clamp(vAO, 0.0, 1.0), uAOStrength);
        diffuseColor.rgb *= ao;
      }`;
    }
    if (useDetail) {
      colorPatch += `
      {
        // Biplanar: sample the horizontal plane for up-facing surfaces and the
        // vertical plane for walls, then blend. Two samples instead of the
        // three a full triplanar needs, which matters on a mobile GPU.
        vec3 n = abs(normalize(vWorldNormal));
        vec2 uvTop = vWorldPos.xz * uDetailScale;
        vec2 uvSide = vec2(mix(vWorldPos.x, vWorldPos.z, step(n.x, n.z)), vWorldPos.y) * uDetailScale;
        float top = texture2D(uDetailMap, uvTop).r;
        float side = texture2D(uDetailMap, uvSide).r;
        float grain = mix(side, top, smoothstep(0.55, 0.95, n.y));
        // Texture is luminance-only around 0.5, so this brightens and darkens
        // symmetrically and never shifts the hue the palette chose.
        diffuseColor.rgb *= 1.0 + (grain - 0.5) * 2.0 * uDetailStrength;
      }`;
    }

    if (colorPatch) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>${colorPatch}`,
      );
    }

    if (useRim) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `{
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = 1.0 - clamp(dot(viewDir, normalize(vWorldNormal)), 0.0, 1.0);
          float rim = pow(fresnel, uRimPower) * uRimStrength * uRimScale;
          // Additive and unshadowed on purpose: this is standing in for sky
          // bounce, which reaches surfaces the sun does not.
          gl_FragColor.rgb += uRimColor * rim * gl_FragColor.a;
        }
        #include <dithering_fragment>`,
      );
    }
  };

  // Materials with different patches must not share a compiled program.
  material.customProgramCacheKey = () =>
    `lad|${useAO ? 1 : 0}${useDetail ? options.detail : 0}${useRim ? rimScale : 0}${useWind ? windStrength : 0}`;
}

/* ------------------------------------------------------------------ */
/* Convenience wrappers                                                */
/* ------------------------------------------------------------------ */

export const M = {
  /** Vertex-painted, grain-free. For small props where detail would alias. */
  painted: () => surface({ vertexColors: true }),

  /** The default for built structures: vertex-painted with wood grain. */
  built: (detail: DetailKind = 'wood', detailScale = 1.2) =>
    surface({ vertexColors: true, detail, detailScale, detailStrength: 0.45 }),

  /** Living things: softer grain, stronger rim so silhouettes read. */
  creature: () =>
    surface({
      vertexColors: true,
      detail: 'organic',
      detailScale: 2.6,
      detailStrength: 0.3,
      rim: 1.35,
    }),

  cloth: () =>
    surface({ vertexColors: true, detail: 'fabric', detailScale: 5.0, detailStrength: 0.35 }),

  ground: () =>
    surface({
      vertexColors: true,
      detail: 'organic',
      detailScale: 0.35,
      detailStrength: 0.35,
      rim: 0.25,
      useAO: false,
    }),

  rock: () => surface({ vertexColors: true, detail: 'stone', detailScale: 1.1, detailStrength: 0.5 }),

  foliage: (wind = 1) =>
    surface({
      vertexColors: true,
      doubleSided: true,
      detail: 'organic',
      detailScale: 1.8,
      detailStrength: 0.3,
      wind,
      useAO: false,
      unique: true,
    }),

  glass: (tint: string, opacity = 0.62) =>
    surface({ tint, transparent: true, opacity, rim: 2.2, useAO: false }),

  glow: (tint: string) => surface({ tint, unlit: true, useAO: false }),
};

/** Legacy alias kept so existing call sites stay valid. */
export const vertexPainted = M.painted;

export function disposeMaterials(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
  toonRamp?.dispose();
  toonRamp = null;
}

/* ------------------------------------------------------------------ */
/* AO helpers                                                          */
/* ------------------------------------------------------------------ */

/**
 * Guarantees an `aAO` attribute exists.
 *
 * WebGL supplies 0 for a missing generic attribute, so a shader that reads
 * `aAO` on geometry that lacks it renders solid black. Every geometry handed
 * to an AO-enabled material must pass through here.
 */
export function ensureAO(geometry: BufferGeometry, value = 1): void {
  if (geometry.getAttribute('aAO')) return;
  const count = geometry.attributes.position.count;
  const ao = new Float32Array(count);
  ao.fill(value);
  geometry.setAttribute('aAO', new BufferAttribute(ao, 1));
}

const _v = new Vector3();

/**
 * Bakes contact darkening into a merged geometry.
 *
 * For each vertex we ask how deeply it sits inside the bounding boxes of the
 * *other* parts it was assembled from. Where two primitives interpenetrate —
 * a chimney meeting a roof, an arm meeting a torso — the vertices in the crease
 * darken, and the assembly reads as one solid object instead of a pile of
 * shapes. Cheap to compute once at build time and free at runtime.
 */
export function bakeContactAO(
  geometry: BufferGeometry,
  boxes: { min: Vector3; max: Vector3 }[],
  options: { strength?: number; radius?: number; groundY?: number } = {},
): void {
  const position = geometry.attributes.position as BufferAttribute;
  const count = position.count;
  const strength = options.strength ?? 0.45;
  const radius = options.radius ?? 0.12;

  const ao = new Float32Array(count);

  // Weight each occluder by how small it is.
  //
  // This matters more than it sounds. A chalet's roof prism has an enormous
  // bounding box that encloses half the building, and treating it like a
  // shutter means every vertex it contains gets blanket-darkened and the whole
  // roof goes muddy. A crease is caused by something SMALL sitting against a
  // surface, so contribution falls off with the occluder's own size.
  const weights = boxes.map((box) => {
    const sx = box.max.x - box.min.x;
    const sy = box.max.y - box.min.y;
    const sz = box.max.z - box.min.z;
    const scale = Math.cbrt(Math.max(1e-4, sx * sy * sz));
    return 1 / (1 + scale * 1.6);
  });

  for (let i = 0; i < count; i++) {
    _v.fromBufferAttribute(position, i);
    let occlusion = 0;

    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      // Distance to the box, zero inside.
      const dx = Math.max(box.min.x - _v.x, 0, _v.x - box.max.x);
      const dy = Math.max(box.min.y - _v.y, 0, _v.y - box.max.y);
      const dz = Math.max(box.min.z - _v.z, 0, _v.z - box.max.z);
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < radius) {
        // Vertices close to another part are in a crease; fade out by radius.
        occlusion += (1 - distance / radius) * weights[b];
      }
    }

    // A vertex always sits inside its own part, so the strongest single
    // contribution is discounted and only genuine overlaps darken.
    occlusion = Math.max(0, occlusion - 0.5);

    // Gentle grounding: geometry near the object's base picks up a little
    // extra darkness, standing in for the shadow it casts on itself.
    if (options.groundY !== undefined) {
      const height = _v.y - options.groundY;
      occlusion += clamp01(1 - height / 0.5) * 0.5;
    }

    ao[i] = clamp01(1 - clamp01(occlusion) * strength);
  }

  geometry.setAttribute('aAO', new BufferAttribute(ao, 1));
}
