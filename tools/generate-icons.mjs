/**
 * App icon generator.
 *
 * WHY VECTOR, NOT PNG DENSITIES
 * Modern Android adaptive icons are authored as two VectorDrawable layers
 * (background + foreground). That is sharper than five PNG densities, is a few
 * hundred bytes instead of ~200 KB, and scales to whatever mask the launcher
 * applies. iOS still wants one raster master, and Play still wants a 512x512
 * PNG for the listing, so we emit an SVG master for those and document the
 * one-line export (see docs/BUILDING.md).
 *
 * The icon is drawn in code from the same palette as the game, so the store
 * icon and the game itself can never drift apart.
 *
 * CONCEPT: a child and a cow on a green meadow, snow-capped peaks behind, warm
 * morning sky. It must survive being shrunk to 48px, so it is built from a
 * handful of large shapes — no text, no thin lines, no fine detail.
 *
 * Run with: npm run icons
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'android-res');

/* Mirrors src/art/Palette.ts. */
const P = {
  skyTop: '#8FC4E8',
  skyLow: '#F7C7A0',
  peak: '#8E9BB5',
  peakShade: '#6F7C99',
  snow: '#EFF4FF',
  sun: '#FFE9BC',
  grassFar: '#6FB254',
  grassNear: '#8FCB6B',
  cow: '#FAF6EF',
  cowSpot: '#4A3A32',
  skin: '#F6D3B8',
  hair: '#6B4226',
  shirt: '#5B8FD0',
};

/* ------------------------------------------------------------------ */
/* Shared geometry, expressed on a 108x108 grid (Android's icon canvas) */
/* ------------------------------------------------------------------ */

/** Three peaks: [centreX, baseY, height]. */
const PEAKS = [
  [22, 64, 30],
  [54, 70, 40],
  [88, 62, 27],
];

function peakPath([cx, baseY, h]) {
  return `M${cx},${baseY - h} L${cx + h * 0.82},${baseY} L${cx - h * 0.82},${baseY} Z`;
}

function snowPath([cx, baseY, h]) {
  const y = baseY - h * 0.6;
  return `M${cx},${baseY - h} L${cx + h * 0.3},${y} L${cx - h * 0.3},${y} Z`;
}

/**
 * Characters are inset so they survive a circular mask. A launcher may crop to
 * a circle of radius 54 about the centre; at full size the cow's head reached
 * x=106, which falls outside it.
 */
const CHARACTER_TRANSFORM = 'translate(8,9) scale(0.84)';

const MEADOW_FAR = 'M0,66 Q54,58 108,66 L108,108 L0,108 Z';
const MEADOW_NEAR = 'M0,80 Q54,72 108,80 L108,108 L0,108 Z';

/** The scene, without any background fill. Used by both layers. */
function sceneMarkup() {
  return `
    <circle cx="82" cy="24" r="11" fill="${P.sun}"/>
    ${PEAKS.map((p) => `<path d="${peakPath(p)}" fill="${P.peak}"/>`).join('\n    ')}
    ${PEAKS.map((p) => `<path d="${snowPath(p)}" fill="${P.snow}"/>`).join('\n    ')}
    <path d="${MEADOW_FAR}" fill="${P.grassFar}"/>
    <path d="${MEADOW_NEAR}" fill="${P.grassNear}"/>

    <!-- Characters live in their own group, pulled inward so a circular
         launcher mask never clips the cow's head or the child's hair. -->
    <g transform="${CHARACTER_TRANSFORM}">
    <!-- cow -->
    <rect x="56" y="70" width="38" height="21" rx="9" fill="${P.cow}"/>
    <rect x="60" y="89" width="5" height="11" rx="2" fill="${P.cow}"/>
    <rect x="72" y="89" width="5" height="11" rx="2" fill="${P.cow}"/>
    <rect x="84" y="89" width="5" height="11" rx="2" fill="${P.cow}"/>
    <ellipse cx="70" cy="77" rx="6" ry="5" fill="${P.cowSpot}"/>
    <ellipse cx="86" cy="84" rx="4.5" ry="4" fill="${P.cowSpot}"/>
    <rect x="90" y="64" width="16" height="15" rx="6" fill="${P.cow}"/>
    <circle cx="99" cy="70" r="2" fill="${P.cowSpot}"/>

    <!-- child -->
    <rect x="18" y="72" width="20" height="23" rx="7" fill="${P.shirt}"/>
    <circle cx="28" cy="63" r="12" fill="${P.skin}"/>
    <path d="M16,62 A12,12 0 0 1 40,62 Z" fill="${P.hair}"/>
    <circle cx="24" cy="64" r="1.8" fill="#4C3A2A"/>
    <circle cx="33" cy="64" r="1.8" fill="#4C3A2A"/>
    <path d="M24,68 Q28.5,72 33,68" stroke="#4C3A2A" stroke-width="1.8"
          stroke-linecap="round" fill="none"/>
    </g>`;
}

/* ------------------------------------------------------------------ */
/* Outputs                                                             */
/* ------------------------------------------------------------------ */

/** Master SVG: square, full-bleed. Source for the Play/App Store rasters. */
function masterSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 108 108">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.skyTop}"/>
      <stop offset="1" stop-color="${P.skyLow}"/>
    </linearGradient>
  </defs>
  <rect width="108" height="108" fill="url(#sky)"/>
  ${sceneMarkup()}
</svg>
`;
}

/**
 * Adaptive foreground. The launcher may crop to the central 66%, so the art is
 * scaled into that safe zone and everything outside it is expendable.
 */
function foregroundSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">
  <g transform="translate(18,18) scale(0.6667)">
    ${sceneMarkup()}
  </g>
</svg>
`;
}

/**
 * Android VectorDrawable.
 *
 * Hand-emitted rather than converted, because VectorDrawable supports only a
 * subset of SVG: no <circle>, no <ellipse>, no gradients on <path> without API
 * 24+ syntax. Everything below is expressed as explicit path data.
 */
function circlePath(cx, cy, r) {
  return (
    `M${cx - r},${cy} ` +
    `a${r},${r} 0 1,0 ${r * 2},0 ` +
    `a${r},${r} 0 1,0 ${-r * 2},0 Z`
  );
}

function ellipsePath(cx, cy, rx, ry) {
  return (
    `M${cx - rx},${cy} ` +
    `a${rx},${ry} 0 1,0 ${rx * 2},0 ` +
    `a${rx},${ry} 0 1,0 ${-rx * 2},0 Z`
  );
}

function roundRectPath(x, y, w, h, r) {
  return (
    `M${x + r},${y} h${w - r * 2} a${r},${r} 0 0 1 ${r},${r} ` +
    `v${h - r * 2} a${r},${r} 0 0 1 ${-r},${r} ` +
    `h${-(w - r * 2)} a${r},${r} 0 0 1 ${-r},${-r} ` +
    `v${-(h - r * 2)} a${r},${r} 0 0 1 ${r},${-r} Z`
  );
}

function vectorPath(d, color, extra = '') {
  return `    <path android:pathData="${d}" android:fillColor="${color}"${extra}/>`;
}

function foregroundVector() {
  // The same scene, pre-scaled into the 66% safe zone by baking the transform
  // into a <group>.
  const backdrop = [
    vectorPath(circlePath(82, 24, 11), P.sun),
    ...PEAKS.map((p) => vectorPath(peakPath(p), P.peak)),
    ...PEAKS.map((p) => vectorPath(snowPath(p), P.snow)),
    vectorPath(MEADOW_FAR, P.grassFar),
    vectorPath(MEADOW_NEAR, P.grassNear),
  ];

  const characters = [
    vectorPath(roundRectPath(56, 70, 38, 21, 9), P.cow),
    vectorPath(roundRectPath(60, 89, 5, 11, 2), P.cow),
    vectorPath(roundRectPath(72, 89, 5, 11, 2), P.cow),
    vectorPath(roundRectPath(84, 89, 5, 11, 2), P.cow),
    vectorPath(ellipsePath(70, 77, 6, 5), P.cowSpot),
    vectorPath(ellipsePath(86, 84, 4.5, 4), P.cowSpot),
    vectorPath(roundRectPath(90, 64, 16, 15, 6), P.cow),
    vectorPath(circlePath(99, 70, 2), P.cowSpot),
    vectorPath(roundRectPath(18, 72, 20, 23, 7), P.shirt),
    vectorPath(circlePath(28, 63, 12), P.skin),
    vectorPath('M16,62 a12,12 0 0 1 24,0 Z', P.hair),
    vectorPath(circlePath(24, 64, 1.8), '#4C3A2A'),
    vectorPath(circlePath(33, 64, 1.8), '#4C3A2A'),
    `    <path android:pathData="M24,68 Q28.5,72 33,68" android:strokeColor="#4C3A2A"
          android:strokeWidth="1.8" android:strokeLineCap="round"/>`,
  ];

  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/generate-icons.mjs — do not edit by hand. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
  <group android:translateX="18" android:translateY="18"
         android:scaleX="0.6667" android:scaleY="0.6667">
${backdrop.join('\n')}
    <group android:translateX="8" android:translateY="9"
           android:scaleX="0.84" android:scaleY="0.84">
${characters.join('\n')}
    </group>
  </group>
</vector>
`;
}

function backgroundVector() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/generate-icons.mjs — do not edit by hand. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
  <path android:pathData="M0,0 h108 v108 h-108 Z">
    <aapt:attr xmlns:aapt="http://schemas.android.com/aapt" name="android:fillColor">
      <gradient android:startX="54" android:startY="0"
                android:endX="54" android:endY="108" android:type="linear">
        <item android:offset="0" android:color="${P.skyTop}"/>
        <item android:offset="1" android:color="${P.skyLow}"/>
      </gradient>
    </aapt:attr>
  </path>
</vector>
`;
}

function adaptiveIconXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
`;
}

/** Splash: the meadow with no characters, so it reads as a backdrop. */
function splashSvg(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 108 108" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.skyTop}"/>
      <stop offset="1" stop-color="${P.skyLow}"/>
    </linearGradient>
  </defs>
  <rect width="108" height="108" fill="url(#sky)"/>
  <circle cx="82" cy="24" r="11" fill="${P.sun}"/>
  ${PEAKS.map((p) => `<path d="${peakPath(p)}" fill="${P.peak}"/>`).join('\n  ')}
  ${PEAKS.map((p) => `<path d="${snowPath(p)}" fill="${P.snow}"/>`).join('\n  ')}
  <path d="${MEADOW_FAR}" fill="${P.grassFar}"/>
  <path d="${MEADOW_NEAR}" fill="${P.grassNear}"/>
</svg>
`;
}

function write(relativePath, contents) {
  const path = join(OUT, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
  console.log(`  ${relativePath}  ${(Buffer.byteLength(contents) / 1024).toFixed(1)} KB`);
}

write('master/icon.svg', masterSvg());
write('master/icon-foreground.svg', foregroundSvg());
write('master/splash.svg', splashSvg(1280, 1280));
write('master/feature-graphic.svg', splashSvg(1024, 500));

write('android/mipmap-anydpi-v26/ic_launcher.xml', adaptiveIconXml());
write('android/mipmap-anydpi-v26/ic_launcher_round.xml', adaptiveIconXml());
write('android/drawable/ic_launcher_foreground.xml', foregroundVector());
write('android/drawable/ic_launcher_background.xml', backgroundVector());

console.log(`
Vector launcher icons written. To install them:
  cp -r android-res/android/* android/app/src/main/res/

For the raster masters the stores require (they do not accept SVG):
  Play listing  512x512  — android-res/master/icon.svg
  App Store     1024x1024 — android-res/master/icon.svg
Export with any of:
  npx svgexport android-res/master/icon.svg icon-512.png 512:512
  inkscape -w 512 -h 512 android-res/master/icon.svg -o icon-512.png
  magick -background none -size 512x512 android-res/master/icon.svg icon-512.png
`);
