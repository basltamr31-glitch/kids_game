import { describe, it, expect } from 'vitest';
import { AdaptiveQualityMonitor, qualityFor } from '../src/core/DeviceProfile';
import type { QualityTier } from '../src/core/DeviceProfile';

/**
 * The adaptive monitor is the one piece of the engine that can permanently
 * change how the game looks without anybody asking it to, and it does so on
 * evidence that is easy to misread. These tests are written as device
 * descriptions rather than as unit assertions, because that is how it fails:
 * not on a bad number, but on a plausible device it draws the wrong conclusion
 * about.
 */

/** Drives a monitor with a frame-time generator and reports where it ended up. */
function run(
  frames: (frame: number) => number,
  count: number,
  startTier: QualityTier = 'high',
): { tier: QualityTier; steps: QualityTier[] } {
  let tier = startTier;
  const steps: QualityTier[] = [];
  const monitor = new AdaptiveQualityMonitor(
    () => tier,
    (next) => {
      tier = next;
      steps.push(next);
    },
  );

  // A real clock, so the 8s cooldown between downgrades behaves as it does in
  // the game rather than being sidestepped by a fixed timestamp.
  let now = 0;
  for (let i = 0; i < count; i++) {
    const delta = frames(i);
    now += Math.max(0, delta);
    monitor.sample(delta, now);
  }
  return { tier, steps };
}

/** Deterministic jitter, so a run that passes keeps passing. */
function jitter(frame: number, spread: number): number {
  const n = Math.sin(frame * 12.9898) * 43758.5453;
  return (n - Math.floor(n) - 0.5) * spread;
}

describe('AdaptiveQualityMonitor', () => {
  it('leaves a healthy 60 Hz device alone', () => {
    const { tier, steps } = run((i) => 1000 / 60 + jitter(i, 2), 3000);
    expect(steps).toEqual([]);
    expect(tier).toBe('high');
  });

  it('leaves a healthy 30 Hz device alone', () => {
    // The case that started this: a device presenting at a locked 30 fps is
    // not a struggling device, but every one of its frames is over the old
    // 38ms limit. It used to lose its shadows within twenty seconds of boot.
    const { tier, steps } = run((i) => 1000 / 30 + jitter(i, 2), 3000);
    expect(steps).toEqual([]);
    expect(tier).toBe('high');
  });

  it('leaves a healthy 30 Hz device alone through an occasional bad window', () => {
    // Measured from a real session: a steady 33.3ms with one four-second
    // stretch where a fifth of the frames took 50ms. One window is a hitch.
    const { tier } = run((i) => {
      const bad = i >= 1700 && i < 1820 && i % 5 === 0;
      return bad ? 50 : 1000 / 30 + jitter(i, 1.5);
    }, 3000);
    expect(tier).toBe('high');
  });

  it('steps down a 60 Hz device that is genuinely rendering at 15 fps', () => {
    const { tier, steps } = run((i) => 1000 / 15 + jitter(i, 4), 3000);
    expect(steps.length).toBeGreaterThan(0);
    expect(tier).toBe('low');
  });

  it('steps down a 30 Hz device that has slipped to 15 fps', () => {
    // Snapping the estimate to a real refresh rate is what makes this work: a
    // slow device must not be able to read its own slowness back as a slow
    // display and excuse itself.
    const { tier } = run((i) => 1000 / 15 + jitter(i, 4), 3000);
    expect(tier).toBe('low');
  });

  it('never steps below low, and never more than twice', () => {
    const { steps } = run(() => 500, 6000);
    expect(steps).toEqual(['medium', 'low']);
  });

  it('ignores tab stalls rather than counting them as slow frames', () => {
    // A backgrounded tab delivers a handful of enormous deltas. Those used to
    // drag the percentile up and cost the player a tier on return.
    const { tier, steps } = run((i) => (i % 40 === 0 ? 4000 : 1000 / 60 + jitter(i, 2)), 3000);
    expect(steps).toEqual([]);
    expect(tier).toBe('high');
  });

  it('ignores the negative delta a resume can produce', () => {
    const { tier } = run((i) => (i % 97 === 0 ? -6.3 : 1000 / 60 + jitter(i, 2)), 3000);
    expect(tier).toBe('high');
  });

  it('steps down a device whose frames are too long to even measure', () => {
    // The loop is paused while the tab is hidden, so a window made of
    // half-second frames is not somebody alt-tabbing. It is the device the
    // monitor exists for, and dropping these as "stalls" left it unhelped.
    const { tier } = run(() => 500, 6000);
    expect(tier).toBe('low');
  });

  it('reports why it stepped down', () => {
    let tier: QualityTier = 'high';
    const reasons: string[] = [];
    const monitor = new AdaptiveQualityMonitor(
      () => tier,
      (next, reason) => {
        tier = next;
        reasons.push(reason);
      },
    );
    let now = 0;
    for (let i = 0; i < 1200; i++) {
      now += 1000 / 15;
      monitor.sample(1000 / 15, now);
    }
    // With every frame identical there is no fast frame to calibrate against,
    // so the estimate lands on the slowest display in the table. It still
    // downgrades, which is the point; the snap only has to stop the device
    // from claiming something slower still.
    expect(reasons[0]).toMatch(/p80 66\.7ms over two windows, limit 50\.0ms \(display 30Hz\)/);
  });

  it('forgets everything on reset', () => {
    let tier: QualityTier = 'high';
    const monitor = new AdaptiveQualityMonitor(
      () => tier,
      (next) => {
        tier = next;
      },
    );
    let now = 0;
    // Enough bad windows to arm a downgrade, then wiped before it lands.
    for (let i = 0; i < 239; i++) {
      now += 200;
      monitor.sample(200, now);
    }
    monitor.reset();
    for (let i = 0; i < 600; i++) {
      now += 1000 / 60;
      monitor.sample(1000 / 60, now);
    }
    expect(tier).toBe('high');
  });

  it('keeps shadows on for every tier a downgrade can reach except the floor', () => {
    // The visible cost of getting this wrong: the scene loses its shadows and
    // everything in it stops touching the ground.
    expect(qualityFor('high').shadows).toBe(true);
    expect(qualityFor('medium').shadows).toBe(true);
    expect(qualityFor('low').shadows).toBe(false);
  });
});
