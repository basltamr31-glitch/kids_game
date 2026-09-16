import { Vector2 } from 'three';

/**
 * Touch input.
 *
 * DESIGN DECISION: tap-to-move, not a virtual joystick.
 * Four-year-olds cannot reliably hold and steer a thumbstick, and a stick eats
 * a corner of the screen. Tapping where you want to go is the single most
 * learnable control on a touchscreen — it is how children already use tablets.
 *
 * Gestures:
 *   tap            -> walk there / interact with what was tapped
 *   drag           -> orbit the camera
 *   two-finger     -> pinch to zoom
 *   long press     -> used only by the Parent Gate
 *
 * A drag never becomes a tap and a tap never nudges the camera, which matters
 * because small hands smear.
 */

export interface TapEvent {
  /** Normalised device coordinates, -1..1, for raycasting. */
  ndc: Vector2;
  /** Raw client coordinates, for UI hit-testing. */
  client: Vector2;
}

const TAP_MAX_MOVE_PX = 16;
const TAP_MAX_TIME_MS = 400;

export class InputManager {
  /** Accumulated camera orbit request, consumed each frame. */
  readonly orbitDelta = new Vector2();
  /** Accumulated zoom request (positive = zoom out), consumed each frame. */
  zoomDelta = 0;

  private canvas: HTMLCanvasElement;
  private pointers = new Map<number, { start: Vector2; last: Vector2; time: number; moved: boolean }>();
  private tapHandlers: ((event: TapEvent) => void)[] = [];
  private pinchStartDistance = 0;
  private enabled = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    canvas.addEventListener('pointermove', this.onMove, { passive: false });
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    // Stop the browser from hijacking two-finger gestures and long-press menus.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.style.touchAction = 'none';
  }

  /** Disabled while a modal UI screen or a scripted activity is playing. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pointers.clear();
      this.orbitDelta.set(0, 0);
      this.zoomDelta = 0;
    }
  }

  onTap(handler: (event: TapEvent) => void): () => void {
    this.tapHandlers.push(handler);
    return () => {
      const index = this.tapHandlers.indexOf(handler);
      if (index >= 0) this.tapHandlers.splice(index, 1);
    };
  }

  /** Called once per frame after the camera has consumed the deltas. */
  endFrame(): void {
    this.orbitDelta.set(0, 0);
    this.zoomDelta = 0;
  }

  private onDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, {
      start: new Vector2(event.clientX, event.clientY),
      last: new Vector2(event.clientX, event.clientY),
      time: performance.now(),
      moved: false,
    });

    if (this.pointers.size === 2) {
      this.pinchStartDistance = this.pointerDistance();
    }
  };

  private onMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;

    const dx = event.clientX - pointer.last.x;
    const dy = event.clientY - pointer.last.y;
    pointer.last.set(event.clientX, event.clientY);

    if (!pointer.moved) {
      const travelled = pointer.start.distanceTo(pointer.last);
      if (travelled > TAP_MAX_MOVE_PX) pointer.moved = true;
    }

    if (this.pointers.size === 2) {
      // Pinch zoom. Orbit is suppressed while two fingers are down.
      const distance = this.pointerDistance();
      if (this.pinchStartDistance > 0) {
        this.zoomDelta += (this.pinchStartDistance - distance) * 0.02;
        this.pinchStartDistance = distance;
      }
      return;
    }

    if (pointer.moved) {
      // Scale by viewport so a swipe feels the same on a phone and a tablet.
      this.orbitDelta.x += (dx / this.canvas.clientWidth) * 6.5;
      this.orbitDelta.y += (dy / this.canvas.clientHeight) * 4.0;
      event.preventDefault();
    }
  };

  private onUp = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    this.canvas.releasePointerCapture?.(event.pointerId);
    if (this.pointers.size < 2) this.pinchStartDistance = 0;

    if (!this.enabled || !pointer) return;

    const heldFor = performance.now() - pointer.time;
    if (pointer.moved || heldFor > TAP_MAX_TIME_MS) return;

    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((pointer.last.x - rect.left) / rect.width) * 2 - 1,
      -(((pointer.last.y - rect.top) / rect.height) * 2 - 1),
    );
    const tap: TapEvent = { ndc, client: pointer.last.clone() };
    for (const handler of [...this.tapHandlers]) handler(tap);
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.zoomDelta += Math.sign(event.deltaY) * 0.6;
  };

  private pointerDistance(): number {
    const list = [...this.pointers.values()];
    if (list.length < 2) return 0;
    return list[0].last.distanceTo(list[1].last);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.tapHandlers.length = 0;
  }
}
