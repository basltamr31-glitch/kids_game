import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';
import { clamp01, damp } from '../core/Rng';

/**
 * Faces.
 *
 * Facial expression carries most of this game's emotional communication, so
 * faces are drawn to a canvas and uploaded as a texture rather than built from
 * geometry. A blink costs nothing, a new expression is a short function, and
 * the eyes can track a point in the world without a single extra triangle.
 *
 * The canvas is redrawn only when something actually changes, and a redraw is
 * ~0.3ms. In practice that is a handful of redraws per second per character
 * during a blink, and none at all while a face holds still.
 */

export type Expression =
  | 'neutral'
  | 'happy'
  | 'laugh'
  | 'surprised'
  | 'curious'
  | 'sleepy'
  | 'asleep'
  | 'sad'
  | 'worried'
  | 'delighted';

export interface FaceStyle {
  skin: string;
  eye: string;
  brow: string;
  blush: string;
  /** Freckles read as "child" faster than any other single detail. */
  freckles?: boolean;
}

/**
 * Face texture resolution.
 *
 * The features are laid out in a fixed 256-unit design space and scaled up, so
 * this is a pure quality dial: raising it sharpens the face without moving a
 * single feature. 256 was soft as soon as the camera came close, which is
 * exactly when the face matters most.
 */
let SIZE = 768;

/** Set once at start-up from the device's quality tier. */
export function setFaceResolution(px: number): void {
  SIZE = Math.max(256, Math.min(1024, Math.round(px)));
}

/** Design-space unit: all drawing below is authored against a 256 grid. */
const DESIGN = 256;

/** Per-expression drawing parameters, interpolated for smooth transitions. */
interface FaceShape {
  /** 0 = wide open, 1 = fully closed. */
  lidClose: number;
  /** Upward curve of the closed/squinting eye. */
  eyeSmile: number;
  eyeScaleY: number;
  /** Vertical brow offset in px; negative is raised. */
  browY: number;
  /** Brow tilt; positive is angry-inward, negative is worried-outward. */
  browTilt: number;
  /** Mouth curve: +1 grin, -1 frown. */
  mouthCurve: number;
  mouthOpen: number;
  mouthWidth: number;
  blush: number;
}

const SHAPES: Record<Expression, FaceShape> = {
  neutral:   { lidClose: 0.0,  eyeSmile: 0,    eyeScaleY: 1.0, browY: 0,   browTilt: 0,     mouthCurve: 0.25, mouthOpen: 0.0,  mouthWidth: 1.0, blush: 0.15 },
  happy:     { lidClose: 0.0,  eyeSmile: 0.55, eyeScaleY: 0.9, browY: -3,  browTilt: -0.05, mouthCurve: 0.85, mouthOpen: 0.1,  mouthWidth: 1.1, blush: 0.5 },
  laugh:     { lidClose: 0.85, eyeSmile: 1.0,  eyeScaleY: 0.8, browY: -6,  browTilt: -0.1,  mouthCurve: 1.0,  mouthOpen: 0.75, mouthWidth: 1.2, blush: 0.75 },
  delighted: { lidClose: 0.0,  eyeSmile: 0.2,  eyeScaleY: 1.25, browY: -8, browTilt: -0.12, mouthCurve: 0.95, mouthOpen: 0.45, mouthWidth: 1.15, blush: 0.65 },
  surprised: { lidClose: 0.0,  eyeSmile: 0,    eyeScaleY: 1.45, browY: -10, browTilt: -0.08, mouthCurve: 0.0,  mouthOpen: 0.85, mouthWidth: 0.7, blush: 0.35 },
  curious:   { lidClose: 0.0,  eyeSmile: 0,    eyeScaleY: 1.12, browY: -5,  browTilt: 0.14,  mouthCurve: 0.15, mouthOpen: 0.05, mouthWidth: 0.9, blush: 0.2 },
  sleepy:    { lidClose: 0.55, eyeSmile: 0.15, eyeScaleY: 0.9, browY: 3,   browTilt: -0.12, mouthCurve: 0.1,  mouthOpen: 0.15, mouthWidth: 0.85, blush: 0.3 },
  asleep:    { lidClose: 1.0,  eyeSmile: 0.35, eyeScaleY: 0.8, browY: 2,   browTilt: -0.08, mouthCurve: 0.2,  mouthOpen: 0.12, mouthWidth: 0.8, blush: 0.25 },
  sad:       { lidClose: 0.2,  eyeSmile: 0,    eyeScaleY: 1.05, browY: -1,  browTilt: -0.3,  mouthCurve: -0.7, mouthOpen: 0.0,  mouthWidth: 0.85, blush: 0.2 },
  worried:   { lidClose: 0.1,  eyeSmile: 0,    eyeScaleY: 1.1, browY: -4,  browTilt: -0.24, mouthCurve: -0.3, mouthOpen: 0.1,  mouthWidth: 0.8, blush: 0.15 },
};

function blendShape(a: FaceShape, b: FaceShape, t: number): FaceShape {
  const mix = (x: number, y: number): number => x + (y - x) * t;
  return {
    lidClose: mix(a.lidClose, b.lidClose),
    eyeSmile: mix(a.eyeSmile, b.eyeSmile),
    eyeScaleY: mix(a.eyeScaleY, b.eyeScaleY),
    browY: mix(a.browY, b.browY),
    browTilt: mix(a.browTilt, b.browTilt),
    mouthCurve: mix(a.mouthCurve, b.mouthCurve),
    mouthOpen: mix(a.mouthOpen, b.mouthOpen),
    mouthWidth: mix(a.mouthWidth, b.mouthWidth),
    blush: mix(a.blush, b.blush),
  };
}


/**
 * Lightens or darkens a hex colour, returning `#rrggbb` so the caller can
 * append an alpha suffix. Used throughout the face for skin structure, where
 * every shadow and highlight has to stay in the same family as the skin tone
 * the player chose.
 */
function shadeSkin(hex: string, factor: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3
    ? value.split('').map((c) => c + c).join('')
    : value.slice(0, 6);
  const n = parseInt(full, 16);
  const to = (x: number): number => Math.max(0, Math.min(255, Math.round(x * factor)));
  const r = to((n >> 16) & 255);
  const g = to((n >> 8) & 255);
  const b = to(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export class Face {
  readonly texture: Texture;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private style: FaceStyle;

  private target: Expression = 'neutral';
  private from: FaceShape = SHAPES.neutral;
  private current: FaceShape = { ...SHAPES.neutral };
  private blend = 1;

  /** Pupil offset in px, -1..1 normalised. Driven by look-at. */
  private gazeX = 0;
  private gazeY = 0;
  private gazeTargetX = 0;
  private gazeTargetY = 0;

  private blinkTimer = 2;
  private blinkAmount = 0;
  private blinking = false;
  private dirty = true;
  private lastDrawKey = '';

  constructor(style: FaceStyle) {
    this.style = style;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new CanvasTexture(this.canvas);
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = SRGBColorSpace;

    this.draw();
  }

  get expression(): Expression {
    return this.target;
  }

  /** Cross-fades to a new expression over ~0.18s. */
  set(expression: Expression): void {
    if (this.target === expression) return;
    this.from = { ...this.current };
    this.target = expression;
    this.blend = 0;
  }

  /**
   * Points the eyes at something.
   * @param x -1 (hard left) .. 1 (hard right)
   * @param y -1 (down) .. 1 (up)
   */
  lookAt(x: number, y: number): void {
    this.gazeTargetX = Math.max(-1, Math.min(1, x));
    this.gazeTargetY = Math.max(-1, Math.min(1, y));
  }

  update(dt: number): void {
    /* --- expression cross-fade --- */
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.18);
      this.current = blendShape(this.from, SHAPES[this.target], this.blend);
      this.dirty = true;
    }

    /* --- gaze --- */
    const gx = damp(this.gazeX, this.gazeTargetX, 9, dt);
    const gy = damp(this.gazeY, this.gazeTargetY, 9, dt);
    if (Math.abs(gx - this.gazeX) > 0.004 || Math.abs(gy - this.gazeY) > 0.004) {
      this.dirty = true;
    }
    this.gazeX = gx;
    this.gazeY = gy;

    /* --- blinking --- */
    // Sleeping characters keep their eyes shut.
    if (this.target !== 'asleep') {
      this.blinkTimer -= dt;
      if (this.blinking) {
        // A blink is a fast close and a slightly slower open.
        this.blinkAmount = this.blinkTimer > 0.055 ? 1 : this.blinkTimer / 0.055;
        if (this.blinkTimer <= 0) {
          this.blinking = false;
          this.blinkAmount = 0;
          // Humans blink irregularly; a fixed interval reads as a machine.
          this.blinkTimer = 1.6 + Math.random() * 4.2;
        }
        this.dirty = true;
      } else if (this.blinkTimer <= 0) {
        this.blinking = true;
        this.blinkTimer = 0.13;
        this.dirty = true;
      }
    }

    if (this.dirty) this.draw();
  }

  private draw(): void {
    const s = this.current;
    const lid = clamp01(s.lidClose + this.blinkAmount * (1 - s.lidClose));

    // Skip the redraw if nothing meaningful changed since last frame.
    const key = [
      Math.round(lid * 40),
      Math.round(s.eyeSmile * 20),
      Math.round(s.eyeScaleY * 20),
      Math.round(s.browY),
      Math.round(s.browTilt * 30),
      Math.round(s.mouthCurve * 20),
      Math.round(s.mouthOpen * 20),
      Math.round(s.mouthWidth * 20),
      Math.round(s.blush * 10),
      Math.round(this.gazeX * 12),
      Math.round(this.gazeY * 12),
    ].join(',');
    if (key === this.lastDrawKey) {
      this.dirty = false;
      return;
    }
    this.lastDrawKey = key;
    this.dirty = false;

    const ctx = this.ctx;
    // Everything below is authored on a 256 grid and scaled, so the layout is
    // independent of the texture resolution.
    const k = SIZE / DESIGN;
    const cx = DESIGN / 2;

    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, DESIGN, DESIGN);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const skin = this.style.skin;

    /* ---------------- skin base ---------------- */
    // The face is a curved patch on a round head, so the texture must not fill
    // its own square: the corners would read as a box stuck to the face. A
    // feathered ellipse dissolves into the head geometry and leaves only the
    // features showing.
    const faceGrad = ctx.createRadialGradient(cx, 133, 46, cx, 133, 128);
    faceGrad.addColorStop(0, skin);
    faceGrad.addColorStop(0.72, skin);
    faceGrad.addColorStop(1, skin + '00');
    ctx.fillStyle = faceGrad;
    ctx.beginPath();
    ctx.ellipse(cx, 133, 128, 128, 0, 0, Math.PI * 2);
    ctx.fill();

    // Structure. A single flat skin tone reads as a mask however good the
    // features are, so the temples and jaw are shaded down and the forehead,
    // nose bridge and chin lifted. This is what gives the face form up close.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, 133, 118, 122, 0, 0, Math.PI * 2);
    ctx.clip();

    const shade = ctx.createRadialGradient(cx, 120, 40, cx, 128, 116);
    shade.addColorStop(0, shadeSkin(skin, 0.86) + '00');
    shade.addColorStop(0.72, shadeSkin(skin, 0.86) + '00');
    shade.addColorStop(1, shadeSkin(skin, 0.86) + '66');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, DESIGN, DESIGN);

    ctx.restore();

    /* ---------------- blush ---------------- */
    if (s.blush > 0.01) {
      ctx.save();
      ctx.globalAlpha = s.blush * 0.46;
      for (const side of [-1, 1]) {
        const g = ctx.createRadialGradient(cx + side * 62, 156, 3, cx + side * 62, 156, 30);
        g.addColorStop(0, this.style.blush);
        g.addColorStop(1, this.style.blush + '00');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx + side * 62, 156, 30, 20, side * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    /* ---------------- freckles ---------------- */
    if (this.style.freckles) {
      ctx.save();
      ctx.fillStyle = shadeSkin(this.style.blush, 0.92);
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 14; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const t = Math.floor(i / 2);
        const fx = cx + side * (28 + ((t * 11) % 26));
        const fy = 146 + ((t * 7) % 14);
        ctx.beginPath();
        ctx.arc(fx, fy, 1.9 + (t % 2) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    /* ---------------- under-nose shadow ---------------- */
    // The nose itself is geometry now. All that is painted is the soft shadow
    // it drops onto the top lip, which is what seats it on the face.
    {
      ctx.save();
      const drop = ctx.createRadialGradient(cx, 166, 2, cx, 166, 16);
      drop.addColorStop(0, shadeSkin(skin, 0.74) + '77');
      drop.addColorStop(1, shadeSkin(skin, 0.74) + '00');
      ctx.fillStyle = drop;
      ctx.beginPath();
      ctx.ellipse(cx, 166, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* ---------------- eyes ---------------- */
    const eyeY = 112;
    const eyeDx = 52;
    const eyeRx = 21;
    const eyeRy = 25 * s.eyeScaleY;

    for (const side of [-1, 1]) {
      const ex = cx + side * eyeDx;

      if (lid > 0.92) {
        // Closed: a tapered lash line. Curving it up reads as contentment.
        ctx.save();
        ctx.strokeStyle = this.style.eye;
        ctx.lineWidth = 5.5;
        ctx.beginPath();
        if (s.eyeSmile > 0.3) ctx.arc(ex, eyeY + 8, 15, Math.PI * 1.14, Math.PI * 1.86);
        else ctx.arc(ex, eyeY - 4, 15, Math.PI * 0.16, Math.PI * 0.84);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      ctx.save();
      // Clipped to the eye opening, so lids and socket shading can be drawn as
      // broad fills without spilling onto the cheek.
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
      ctx.clip();

      // Sclera: never pure white. A faintly warm, top-shaded ball sits in a
      // socket instead of glowing out of the face.
      const sclera = ctx.createLinearGradient(0, eyeY - eyeRy, 0, eyeY + eyeRy);
      sclera.addColorStop(0, '#D9D2CE');
      sclera.addColorStop(0.38, '#F7F3F0');
      sclera.addColorStop(1, '#EDE6E1');
      ctx.fillStyle = sclera;
      ctx.fillRect(ex - eyeRx, eyeY - eyeRy, eyeRx * 2, eyeRy * 2);

      const px = ex + this.gazeX * eyeRx * 0.40;
      const py = eyeY - this.gazeY * eyeRy * 0.30;
      const irisR = Math.min(eyeRy * 0.86, eyeRx * 0.80);

      const iris = ctx.createRadialGradient(px, py - irisR * 0.25, irisR * 0.15, px, py, irisR);
      iris.addColorStop(0, shadeSkin(this.style.eye, 1.5));
      iris.addColorStop(0.55, this.style.eye);
      iris.addColorStop(1, shadeSkin(this.style.eye, 0.55));
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.arc(px, py, irisR, 0, Math.PI * 2);
      ctx.fill();

      // Limbal ring. Real eyes have one, and stylised eyes read far better
      // with it: it separates iris from white cleanly at any distance.
      ctx.strokeStyle = shadeSkin(this.style.eye, 0.42);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(px, py, irisR - 1, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#14100F';
      ctx.beginPath();
      ctx.arc(px, py, irisR * 0.44, 0, Math.PI * 2);
      ctx.fill();

      // Catchlights: one large upper-left, one small lower-right. The cheapest
      // thing that makes eyes look wet and alive.
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(px - irisR * 0.34, py - irisR * 0.40, irisR * 0.30, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(px + irisR * 0.36, py + irisR * 0.34, irisR * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Socket shadow under the upper lid.
      const socket = ctx.createLinearGradient(0, eyeY - eyeRy, 0, eyeY);
      socket.addColorStop(0, '#6A4A3C88');
      socket.addColorStop(1, '#6A4A3C00');
      ctx.fillStyle = socket;
      ctx.fillRect(ex - eyeRx, eyeY - eyeRy, eyeRx * 2, eyeRy);

      if (lid > 0.01) {
        ctx.fillStyle = skin;
        ctx.fillRect(ex - eyeRx - 2, eyeY - eyeRy - 2, eyeRx * 2 + 4, (eyeRy * 2 + 4) * lid);
      }

      // Lower lash lift for a smiling eye: the cheek pushing up into the eye.
      if (s.eyeSmile > 0.1) {
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.ellipse(ex, eyeY + eyeRy * 0.92, eyeRx * 1.3, eyeRy * 0.8 * s.eyeSmile, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Upper lash line, drawn OUTSIDE the clip so it reads as a rim around
      // the eye rather than a stroke inside it.
      ctx.save();
      ctx.strokeStyle = this.style.eye;
      ctx.lineCap = 'round';
      const lashY = eyeY - eyeRy + (eyeRy * 2) * lid;
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.moveTo(ex - eyeRx * 0.98, lashY + eyeRy * 0.18);
      ctx.quadraticCurveTo(ex, lashY - eyeRy * 0.22, ex + eyeRx * 0.98, lashY + eyeRy * 0.18);
      ctx.stroke();
      // Outer corner lash, which is what makes the eye read as a child's.
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ex + side * eyeRx * 0.92, lashY + eyeRy * 0.16);
      ctx.lineTo(ex + side * eyeRx * 1.24, lashY + eyeRy * 0.02);
      ctx.stroke();
      ctx.restore();
    }

    /* ---------------- brows ---------------- */
    // Filled tapered shapes rather than constant-width strokes. A brow is thick
    // at the inner end and thins toward the temple, and that taper is most of
    // what stops it reading as a drawn-on dash.
    for (const side of [-1, 1]) {
      const bx = cx + side * eyeDx;
      const by = eyeY - 34 + s.browY;
      const tilt = s.browTilt * side * -1;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(tilt);
      ctx.fillStyle = this.style.brow;
      ctx.beginPath();
      const inner = -side * 17;
      const outer = side * 17;
      ctx.moveTo(inner, 4.5);
      ctx.quadraticCurveTo(0, -5.5, outer, 1.5);
      ctx.quadraticCurveTo(0, 0.5, inner, 8.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    /* ---------------- mouth ---------------- */
    const mouthY = 188;
    const halfWidth = 29 * s.mouthWidth;
    // A mouth drawn in a desaturated skin shade reads as a pencil line. Lips
    // are the one warm feature on a face and have to be drawn that way.
    const lipDark = '#9C4A44';

    if (s.mouthOpen > 0.06) {
      const openH = 5 + s.mouthOpen * 25;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - halfWidth, mouthY);
      ctx.quadraticCurveTo(cx, mouthY - s.mouthCurve * 11, cx + halfWidth, mouthY);
      ctx.quadraticCurveTo(cx, mouthY + openH, cx - halfWidth, mouthY);
      ctx.closePath();
      ctx.fillStyle = '#6E322F';
      ctx.fill();
      ctx.clip();

      // Upper teeth: a soft band, never individual teeth at this scale.
      ctx.fillStyle = '#FBF6F1';
      ctx.beginPath();
      ctx.moveTo(cx - halfWidth, mouthY - 1);
      ctx.quadraticCurveTo(cx, mouthY - s.mouthCurve * 11 - 1, cx + halfWidth, mouthY - 1);
      ctx.lineTo(cx + halfWidth, mouthY + Math.min(6, openH * 0.3));
      ctx.quadraticCurveTo(cx, mouthY + Math.min(9, openH * 0.42), cx - halfWidth, mouthY + Math.min(6, openH * 0.3));
      ctx.closePath();
      ctx.fill();

      if (s.mouthOpen > 0.5) {
        ctx.fillStyle = '#D8807C';
        ctx.beginPath();
        ctx.ellipse(cx, mouthY + openH * 0.72, halfWidth * 0.52, openH * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.strokeStyle = lipDark;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - halfWidth, mouthY);
      ctx.quadraticCurveTo(cx, mouthY - s.mouthCurve * 11, cx + halfWidth, mouthY);
      ctx.quadraticCurveTo(cx, mouthY + openH, cx - halfWidth, mouthY);
      ctx.closePath();
      ctx.stroke();
    } else {
      // Closed: a lip line with a dip in the middle, plus a lit lower lip. A
      // single stroked arc is what made the old mouth read as a drawn-on smile.
      const curve = s.mouthCurve;
      ctx.save();
      ctx.strokeStyle = lipDark;
      ctx.lineWidth = 5;
      ctx.beginPath();
      // Corners lifted well above the centre, so even a neutral mouth has the
      // faint upturn a contented child has rather than reading as a flat dash.
      ctx.moveTo(cx - halfWidth, mouthY - 4 - curve * 5);
      ctx.quadraticCurveTo(cx - halfWidth * 0.42, mouthY + 4 + curve * 12, cx, mouthY + 2 + curve * 7);
      ctx.quadraticCurveTo(cx + halfWidth * 0.42, mouthY + 4 + curve * 12, cx + halfWidth, mouthY - 4 - curve * 5);
      ctx.stroke();

      const lipLit = ctx.createLinearGradient(0, mouthY + curve * 7, 0, mouthY + curve * 7 + 11);
      lipLit.addColorStop(0, shadeSkin(skin, 1.1) + 'BB');
      lipLit.addColorStop(1, shadeSkin(skin, 1.1) + '00');
      ctx.fillStyle = lipLit;
      ctx.beginPath();
      ctx.ellipse(cx, mouthY + curve * 7 + 5, halfWidth * 0.8, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
