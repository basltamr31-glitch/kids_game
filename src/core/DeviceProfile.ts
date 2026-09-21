/**
 * Device classification and quality tiers.
 *
 * The game must run on a 2019 budget phone and a 2024 tablet from the same
 * build, so every expensive knob (shadows, grass density, pixel ratio, particle
 * budgets) is read from here instead of being hardcoded at the call site.
 */

export type QualityTier = 'low' | 'medium' | 'high';
export type FormFactor = 'phone' | 'small-tablet' | 'tablet';

export interface QualitySettings {
  tier: QualityTier;
  /** Multiplier applied on top of devicePixelRatio; the biggest single perf lever. */
  renderScale: number;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Number of instanced grass tufts scattered around the farm. */
  grassCount: number;
  /** Number of instanced scatter props (rocks, flowers, mushrooms). */
  scatterCount: number;
  treeDetail: 0 | 1 | 2;
  /** Max simultaneous particles across all emitters. */
  particleBudget: number;
  fogDensityScale: number;
  /** Render distant mountains with extra ridge geometry. */
  detailedMountains: boolean;
  antialias: boolean;
  /** Animate characters at a reduced rate when far from camera. */
  animationLodDistance: number;
}

const TIERS: Record<QualityTier, QualitySettings> = {
  low: {
    tier: 'low',
    renderScale: 0.72,
    maxPixelRatio: 1.25,
    shadows: false,
    shadowMapSize: 512,
    grassCount: 900,
    scatterCount: 160,
    treeDetail: 0,
    particleBudget: 60,
    fogDensityScale: 1.25,
    detailedMountains: false,
    antialias: false,
    animationLodDistance: 18,
  },
  medium: {
    tier: 'medium',
    renderScale: 0.9,
    maxPixelRatio: 1.75,
    shadows: true,
    shadowMapSize: 1024,
    grassCount: 3200,
    scatterCount: 420,
    treeDetail: 1,
    particleBudget: 180,
    fogDensityScale: 1.0,
    detailedMountains: true,
    antialias: false,
    animationLodDistance: 32,
  },
  high: {
    tier: 'high',
    renderScale: 1.0,
    maxPixelRatio: 2.0,
    shadows: true,
    shadowMapSize: 2048,
    grassCount: 7000,
    scatterCount: 900,
    treeDetail: 2,
    particleBudget: 420,
    fogDensityScale: 0.85,
    detailedMountains: true,
    antialias: true,
    animationLodDistance: 60,
  },
};

export function qualityFor(tier: QualityTier): QualitySettings {
  return { ...TIERS[tier] };
}

/**
 * Best-effort hardware guess used only for the *initial* tier. After the first
 * minute the adaptive monitor below takes over, and the player (or parent) can
 * always override it in the Parent Area.
 */
export function detectQualityTier(): QualityTier {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const pixels = window.screen.width * window.screen.height * (window.devicePixelRatio || 1);

  let score = 0;
  if (mem >= 6) score += 2;
  else if (mem >= 4) score += 1;

  if (cores >= 8) score += 2;
  else if (cores >= 6) score += 1;

  // A huge framebuffer on a weak GPU is the classic budget-tablet trap.
  if (pixels > 4_000_000 && mem < 4) score -= 2;

  if (score >= 3) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}

export function detectFormFactor(): FormFactor {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const shortSide = Math.min(w, h);
  const longSide = Math.max(w, h);
  // CSS px short-side thresholds; deliberately generous so 8" tablets in
  // landscape land in "small-tablet" rather than being treated as big phones.
  if (shortSide >= 700 || (shortSide >= 600 && longSide / shortSide < 1.6)) return 'tablet';
  if (shortSide >= 550) return 'small-tablet';
  return 'phone';
}

/** 120, 90, 60, 48 and 30 Hz. rAF is vsync-aligned, so real deltas cluster here. */
const REFRESH_PERIODS_MS = [1000 / 120, 1000 / 90, 1000 / 60, 1000 / 48, 1000 / 30];

/** Frames per decision window. At 60 Hz that is about two seconds. */
const WINDOW = 120;

/**
 * A delta above this is not a measurement of how fast we draw. The loop is
 * already paused when the tab is hidden, so what reaches us here is a GC
 * pause, a texture upload, or the one restamped frame a resume produces.
 */
const STALL_MS = 250;

/**
 * Unless they dominate the window, that is — because a window made mostly of
 * frames that long is not a hitch, it is a device drawing at under four frames
 * a second. That one is the whole reason the monitor exists.
 */
const STALL_SHARE = 0.25;

/** Below roughly 26 fps is unpleasant however fast the display happens to be. */
const SLOW_FRAME_MS = 38;

/**
 * Watches frame times and steps the tier down (never silently up) when the
 * device is clearly struggling. Stepping down once and staying there is much
 * kinder than oscillating.
 *
 * The hard part is deciding what "struggling" means, because a frame delta
 * measures two things at once: how long our work took, and how long the
 * display made us wait for it. A device presenting at 30 Hz sits at 33ms when
 * it is perfectly healthy, and an absolute millisecond threshold cannot tell
 * that apart from a 60 Hz device rendering at half rate. So the threshold is
 * floored against the display's own frame period, read back out of the fastest
 * frames the device actually produces.
 */
export class AdaptiveQualityMonitor {
  private samples: number[] = [];
  private discarded = 0;
  /** One fast-frame estimate per window, used to work out the refresh rate. */
  private fastFrames: number[] = [];
  private badWindows = 0;
  private lastAdjust = 0;
  private hasDroppedOnce = false;

  constructor(
    private getTier: () => QualityTier,
    private onDowngrade: (tier: QualityTier, reason: string) => void,
  ) {}

  sample(deltaMs: number, nowMs: number): void {
    // Negative deltas are real: resume() restamps the clock while a frame
    // callback carrying an earlier timestamp is already queued.
    if (deltaMs > 0 && deltaMs <= STALL_MS) this.samples.push(deltaMs);
    else this.discarded++;

    if (this.samples.length + this.discarded < WINDOW) return;

    const accepted = this.samples.sort((a, b) => a - b);
    const stalled = this.discarded;
    this.samples = [];
    this.discarded = 0;

    const swamped = stalled > WINDOW * STALL_SHARE;
    // Only frames we could actually measure tell us about the display.
    if (!swamped) {
      const p05 = accepted[Math.floor(accepted.length * 0.05)];
      this.fastFrames.push(p05);
      if (this.fastFrames.length > 16) this.fastFrames.shift();
    }

    const threshold = this.downgradeThreshold();
    // 80th percentile frame time ignores one-off hitches (GC, texture upload).
    const p80 = accepted.length > 0 ? accepted[Math.floor(accepted.length * 0.8)] : Infinity;

    // One bad window is a hitch: a texture upload, a day change, the OS
    // deciding to do something else. Two in a row is the device. The downgrade
    // cannot be undone within the session, so it is worth waiting for.
    this.badWindows = swamped || p80 > threshold ? this.badWindows + 1 : 0;
    if (this.badWindows < 2) return;

    // Only consider a change every 8s, and at most twice per session.
    if (nowMs - this.lastAdjust < 8000 || this.hasDroppedOnce) return;

    const current = this.getTier();
    if (current === 'low') return;

    const next: QualityTier = current === 'high' ? 'medium' : 'low';
    this.lastAdjust = nowMs;
    this.hasDroppedOnce = current === 'medium'; // medium -> low is our floor
    this.badWindows = 0;
    this.onDowngrade(
      next,
      swamped
        ? `${stalled} of ${WINDOW} frames over ${STALL_MS}ms, twice running`
        : `p80 ${p80.toFixed(1)}ms over two windows, limit ${threshold.toFixed(1)}ms ` +
          `(display ${(1000 / this.displayPeriodMs()).toFixed(0)}Hz` +
          `${stalled > 0 ? `, ${stalled} hitches ignored` : ''})`,
    );
  }

  /**
   * The display's frame period, snapped to a rate a display actually runs at.
   *
   * Snapping is the load-bearing part. Without it a device that is simply slow
   * reads its own 60ms frames back as "my display must be 16 fps" and excuses
   * itself forever; the table stops at 30 Hz, so nothing can make that claim.
   */
  private displayPeriodMs(): number {
    if (this.fastFrames.length === 0) return 1000 / 60;
    const sorted = [...this.fastFrames].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    let best = REFRESH_PERIODS_MS[0];
    for (const period of REFRESH_PERIODS_MS) {
      // Compared as a ratio, so 8ms vs 11ms is as big a gap as 24ms vs 33ms.
      if (Math.abs(Math.log(period / median)) < Math.abs(Math.log(best / median))) best = period;
    }
    return best;
  }

  private downgradeThreshold(): number {
    return Math.max(SLOW_FRAME_MS, this.displayPeriodMs() * 1.5);
  }

  reset(): void {
    this.samples.length = 0;
    this.discarded = 0;
    this.fastFrames.length = 0;
    this.badWindows = 0;
    this.hasDroppedOnce = false;
  }
}
