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

/**
 * Watches frame times and steps the tier down (never silently up) when the
 * device is clearly struggling. Stepping down once and staying there is much
 * kinder than oscillating.
 */
export class AdaptiveQualityMonitor {
  private samples: number[] = [];
  private lastAdjust = 0;
  private hasDroppedOnce = false;

  constructor(
    private getTier: () => QualityTier,
    private onDowngrade: (tier: QualityTier) => void,
  ) {}

  sample(deltaMs: number, nowMs: number): void {
    this.samples.push(deltaMs);
    if (this.samples.length < 120) return;

    const sorted = [...this.samples].sort((a, b) => a - b);
    // 80th percentile frame time ignores one-off hitches (GC, texture upload).
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    this.samples.length = 0;

    // Only consider a change every 8s, and at most twice per session.
    if (nowMs - this.lastAdjust < 8000 || this.hasDroppedOnce) return;

    const current = this.getTier();
    if (p80 > 38 && current !== 'low') {
      const next: QualityTier = current === 'high' ? 'medium' : 'low';
      this.lastAdjust = nowMs;
      this.hasDroppedOnce = current === 'medium'; // medium -> low is our floor
      this.onDowngrade(next);
    }
  }

  reset(): void {
    this.samples.length = 0;
    this.hasDroppedOnce = false;
  }
}
