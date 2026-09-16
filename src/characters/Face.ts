import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';

/**
 * Faces.
 *
 * Facial expression carries most of this game's emotional communication, so
 * faces are drawn on a canvas and swapped as a texture rather than being built
 * from geometry. That makes a blink cost nothing and a new expression a
 * ten-line function.
 *
 * Every expression is drawn into one shared 128x128 atlas slot per character,
 * redrawn only when the expression actually changes.
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
  | 'blink';

export interface FaceStyle {
  skin: string;
  eye: string;
  blush: string;
}

const SIZE = 128;

export class Face {
  readonly texture: Texture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private current: Expression | null = null;
  private style: FaceStyle;

  /* Blinking is automatic and independent of the acted expression. */
  private blinkTimer = 0;
  private blinking = false;
  private baseExpression: Expression = 'neutral';

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

    this.set('neutral');
  }

  /** Sets the acted expression. Blinks layer on top of it. */
  set(expression: Expression): void {
    this.baseExpression = expression;
    this.draw(expression);
  }

  get expression(): Expression {
    return this.baseExpression;
  }

  update(dt: number): void {
    // Asleep characters keep their eyes shut.
    if (this.baseExpression === 'asleep') return;

    this.blinkTimer -= dt;
    if (this.blinking) {
      if (this.blinkTimer <= 0) {
        this.blinking = false;
        this.blinkTimer = 1.8 + Math.random() * 3.4;
        this.draw(this.baseExpression);
      }
    } else if (this.blinkTimer <= 0) {
      this.blinking = true;
      this.blinkTimer = 0.11;
      this.draw('blink');
    }
  }

  private draw(expression: Expression): void {
    if (this.current === expression) return;
    this.current = expression;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = this.style.skin;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const eyeY = 54;
    const eyeDx = 26;
    const cx = SIZE / 2;

    ctx.fillStyle = this.style.eye;
    ctx.strokeStyle = this.style.eye;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (expression) {
      case 'blink':
      case 'asleep':
        ctx.lineWidth = 5;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + side * eyeDx, eyeY + 2, 11, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
        }
        break;

      case 'happy':
      case 'laugh':
        // Upturned crescent eyes read as a genuine smile at any size.
        ctx.lineWidth = 6;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + side * eyeDx, eyeY + 8, 12, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        }
        break;

      case 'surprised':
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(cx + side * eyeDx, eyeY, 10, 13, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      case 'sleepy':
        ctx.lineWidth = 5;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + side * eyeDx, eyeY + 4, 11, Math.PI * 0.05, Math.PI * 0.95);
          ctx.stroke();
        }
        break;

      case 'curious':
        // One eye a touch higher — instantly reads as inquisitive.
        ctx.beginPath();
        ctx.ellipse(cx - eyeDx, eyeY - 3, 8, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + eyeDx, eyeY + 1, 8, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'sad':
        ctx.lineWidth = 5;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + side * eyeDx, eyeY - 6, 11, Math.PI * 0.2, Math.PI * 0.8);
          ctx.stroke();
        }
        break;

      default:
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(cx + side * eyeDx, eyeY, 8, 11, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // Catchlights: the single cheapest way to make eyes feel alive.
        ctx.fillStyle = '#FFFFFF';
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + side * eyeDx + 3, eyeY - 4, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = this.style.eye;
        break;
    }

    /* --- mouth --- */
    const mouthY = 88;
    ctx.strokeStyle = this.style.eye;
    ctx.fillStyle = '#8C4A47';
    ctx.lineWidth = 5;

    switch (expression) {
      case 'laugh':
        ctx.beginPath();
        ctx.ellipse(cx, mouthY + 2, 15, 12, 0, 0, Math.PI);
        ctx.fill();
        break;
      case 'happy':
        ctx.beginPath();
        ctx.arc(cx, mouthY - 6, 15, Math.PI * 0.18, Math.PI * 0.82);
        ctx.stroke();
        break;
      case 'surprised':
        ctx.beginPath();
        ctx.ellipse(cx, mouthY + 2, 8, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'sad':
        ctx.beginPath();
        ctx.arc(cx, mouthY + 12, 13, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();
        break;
      case 'asleep':
      case 'sleepy':
        ctx.beginPath();
        ctx.arc(cx, mouthY - 2, 8, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
        break;
      default:
        ctx.beginPath();
        ctx.arc(cx, mouthY - 4, 11, Math.PI * 0.22, Math.PI * 0.78);
        ctx.stroke();
        break;
    }

    /* --- blush --- */
    if (expression === 'happy' || expression === 'laugh' || expression === 'surprised') {
      ctx.fillStyle = this.style.blush;
      ctx.globalAlpha = 0.5;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + side * 40, mouthY - 16, 12, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
