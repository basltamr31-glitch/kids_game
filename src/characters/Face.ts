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

const SIZE = 256;

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
    const cx = SIZE / 2;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // The face is a flat quad laid on a round head, so the texture must not
    // fill its own square: the corners would read as a box stuck to the face.
    // Instead we lay down a skin-coloured ellipse with a feathered edge, which
    // dissolves into the head geometry and leaves only the features visible.
    const faceGrad = ctx.createRadialGradient(SIZE / 2, SIZE * 0.52, SIZE * 0.18, SIZE / 2, SIZE * 0.52, SIZE * 0.5);
    faceGrad.addColorStop(0, this.style.skin);
    faceGrad.addColorStop(0.72, this.style.skin);
    faceGrad.addColorStop(1, this.style.skin + '00');
    ctx.fillStyle = faceGrad;
    ctx.beginPath();
    ctx.ellipse(SIZE / 2, SIZE * 0.52, SIZE * 0.5, SIZE * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Large eyes set wide apart. This is the single strongest lever on how
    // appealing a stylized child character reads, and the reason the features
    // are drawn generously rather than to human proportion.
    const eyeY = 112;
    const eyeDx = 54;
    const eyeRx = 22;
    const eyeRy = 26 * s.eyeScaleY;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    /* ---------------- freckles ---------------- */
    if (this.style.freckles) {
      ctx.fillStyle = this.style.blush;
      ctx.globalAlpha = 0.34;
      // Deterministic scatter across both cheeks and the nose bridge.
      for (let i = 0; i < 14; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const t = Math.floor(i / 2);
        const fx = cx + side * (30 + ((t * 11) % 28));
        const fy = 138 + ((t * 7) % 16);
        ctx.beginPath();
        ctx.arc(fx, fy, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* ---------------- blush ---------------- */
    if (s.blush > 0.01) {
      ctx.fillStyle = this.style.blush;
      ctx.globalAlpha = s.blush * 0.5;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + side * 66, 154, 26, 16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* ---------------- brows ---------------- */
    ctx.strokeStyle = this.style.brow;
    ctx.lineWidth = 8;
    for (const side of [-1, 1]) {
      const bx = cx + side * eyeDx;
      const by = eyeY - 36 + s.browY;
      // Tilt is mirrored so a worried brow rises at the inner end on both sides.
      const tilt = s.browTilt * side * -1;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(tilt);
      ctx.beginPath();
      ctx.moveTo(-17, 3);
      ctx.quadraticCurveTo(0, -5, 17, 2);
      ctx.stroke();
      ctx.restore();
    }

    /* ---------------- eyes ---------------- */
    for (const side of [-1, 1]) {
      const ex = cx + side * eyeDx;

      if (lid > 0.92) {
        // Closed: a curved lash line. Curving it upward reads as contentment.
        ctx.strokeStyle = this.style.eye;
        ctx.lineWidth = 7;
        ctx.beginPath();
        const arcUp = s.eyeSmile > 0.3;
        if (arcUp) {
          ctx.arc(ex, eyeY + 8, 15, Math.PI * 1.15, Math.PI * 1.85);
        } else {
          ctx.arc(ex, eyeY - 4, 15, Math.PI * 0.16, Math.PI * 0.84);
        }
        ctx.stroke();
        continue;
      }

      // Sclera.
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
      ctx.fill();

      // Iris and pupil, offset by gaze but kept inside the sclera.
      const px = ex + this.gazeX * eyeRx * 0.42;
      const py = eyeY - this.gazeY * eyeRy * 0.34;
      ctx.fillStyle = this.style.eye;
      ctx.beginPath();
      ctx.ellipse(px, py, eyeRx * 0.74, Math.min(eyeRy * 0.92, eyeRx * 0.86), 0, 0, Math.PI * 2);
      ctx.fill();

      // Catchlights. The single cheapest way to make eyes feel alive.
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(px + 5, py - 6, 4.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px - 5, py + 5, 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Upper lid sliding down over the eye.
      if (lid > 0.01) {
        ctx.fillStyle = this.style.skin;
        // Opaque here on purpose: this is an eyelid drawn over the eye, well
        // inside the feathered region, so it never reaches the quad's edge.
        ctx.beginPath();
        ctx.rect(ex - eyeRx - 2, eyeY - eyeRy - 2, eyeRx * 2 + 4, (eyeRy * 2 + 4) * lid);
        ctx.fill();
        ctx.strokeStyle = this.style.eye;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(ex - eyeRx, eyeY - eyeRy + (eyeRy * 2) * lid);
        ctx.lineTo(ex + eyeRx, eyeY - eyeRy + (eyeRy * 2) * lid);
        ctx.stroke();
      }

      // Lower lash lift for a smiling eye.
      if (s.eyeSmile > 0.1 && lid < 0.5) {
        ctx.fillStyle = this.style.skin;
        ctx.beginPath();
        ctx.ellipse(ex, eyeY + eyeRy * 0.85, eyeRx * 1.25, eyeRy * 0.75 * s.eyeSmile, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* ---------------- nose ---------------- */
    ctx.strokeStyle = this.style.blush;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, 152, 7, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.globalAlpha = 1;

    /* ---------------- mouth ---------------- */
    const mouthY = 190;
    const halfWidth = 30 * s.mouthWidth;

    if (s.mouthOpen > 0.06) {
      // Open mouth: a lens shape between an upper and lower curve.
      const openH = 6 + s.mouthOpen * 26;
      ctx.fillStyle = '#8C4A47';
      ctx.beginPath();
      ctx.moveTo(cx - halfWidth, mouthY);
      ctx.quadraticCurveTo(cx, mouthY - s.mouthCurve * 12, cx + halfWidth, mouthY);
      ctx.quadraticCurveTo(cx, mouthY + openH, cx - halfWidth, mouthY);
      ctx.fill();

      // Tongue, for a proper laugh.
      if (s.mouthOpen > 0.5) {
        ctx.fillStyle = '#D8807C';
        ctx.beginPath();
        ctx.ellipse(cx, mouthY + openH * 0.55, halfWidth * 0.5, openH * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Closed mouth: a single stroked curve.
      ctx.strokeStyle = this.style.eye;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - halfWidth, mouthY - s.mouthCurve * 4);
      ctx.quadraticCurveTo(cx, mouthY + s.mouthCurve * 18, cx + halfWidth, mouthY - s.mouthCurve * 4);
      ctx.stroke();
    }

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
