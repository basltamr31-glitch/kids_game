import type { FormFactor } from '../core/DeviceProfile';
import { detectFormFactor } from '../core/DeviceProfile';
import type { EventBus } from '../core/EventBus';

/**
 * Keeps the UI correctly sized on every device.
 *
 * The problem this solves: a 1rem button on a 5" phone and on an 11" tablet are
 * the same number of CSS pixels but wildly different physical sizes. A child's
 * fingertip does not get bigger with the tablet, so a UI that simply scales with
 * the viewport ends up either cramped on the phone or comically huge on the
 * tablet.
 *
 * So we compute a scale from the *physical* short side (CSS px / DPR-corrected)
 * and clamp it, then expose it as `--ui-scale`. Tablets additionally get the
 * layout changes in the media queries, which is what makes them a first-class
 * target rather than a stretched phone.
 */
export class ResponsiveLayout {
  formFactor: FormFactor = 'phone';
  uiScale = 1;

  private userScale = 1;
  private root = document.documentElement;

  constructor(private bus: EventBus) {
    window.addEventListener('resize', this.apply);
    window.addEventListener('orientationchange', this.apply);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.apply);
    }
  }

  /** Accessibility setting from the Parent Area, 0.85 .. 1.35. */
  setUserScale(scale: number): void {
    this.userScale = scale;
    this.apply();
  }

  apply = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const shortSide = Math.min(width, height);
    this.formFactor = detectFormFactor();

    // Base: 1.0 at a 400px short side (a typical phone in landscape).
    let scale = shortSide / 400;

    // Tablets should NOT scale linearly, or a button becomes a dinner plate.
    // Above phone size we take a fractional power, so controls grow a little
    // (bigger screen, arm's length) but stay proportionate.
    if (scale > 1) scale = Math.pow(scale, 0.42);

    // Very short landscape (a tall phone rotated) needs a slight reduction so
    // the task list and speech bubble both fit.
    if (height < 380) scale *= 0.92;

    scale = clamp(scale * this.userScale, 0.78, 1.7);

    this.uiScale = scale;
    this.root.style.setProperty('--ui-scale', scale.toFixed(3));

    // Re-export safe areas as plain numbers for the platform layer to read.
    const computed = getComputedStyle(this.root);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const value = computed.getPropertyValue(`--sa-${side}`).trim();
      if (!value) this.root.style.setProperty(`--sa-${side}`, '0px');
    }

    this.bus.emit('ui:layout-changed');
  };

  dispose(): void {
    window.removeEventListener('resize', this.apply);
    window.removeEventListener('orientationchange', this.apply);
    window.visualViewport?.removeEventListener('resize', this.apply);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
