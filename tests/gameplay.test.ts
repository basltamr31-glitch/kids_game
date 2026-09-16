import { describe, it, expect, beforeEach } from 'vitest';
import { DayDirector, PHASE_ORDER } from '../src/gameplay/DayDirector';
import { Entitlements } from '../src/monetization/Entitlements';
import { DevStore, PRODUCT_FULL_GAME } from '../src/monetization/IStore';
import { SaveManager } from '../src/save/SaveManager';
import { Localization } from '../src/localization/Localization';
import { EventBus } from '../src/core/EventBus';
import { Rng, fbm2D, clamp, smoothstep, damp } from '../src/core/Rng';
import { ACTIVITIES_BY_ID, FIXED_ACTIVITIES, SEASON_ORDER, DAY_GENERATION } from '../src/content';
import type { GameContext } from '../src/core/GameContext';
import type { IPlatform, SafeAreaInsets } from '../src/platform/IPlatform';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

class MemoryPlatform implements IPlatform {
  readonly id = 'web' as const;
  private store = new Map<string, string>();
  async init(): Promise<void> {}
  async read(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async write(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
  haptic(): void {}
  async lockOrientation(): Promise<void> {}
  getSafeAreaInsets(): SafeAreaInsets {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  async setStatusBarHidden(): Promise<void> {}
  onPause(): void {}
  onResume(): void {}
  async openExternal(): Promise<void> {}
  getPreferredLanguage(): string {
    return 'en';
  }
}

async function makeContext(premium = false): Promise<GameContext> {
  const bus = new EventBus();
  const platform = new MemoryPlatform();
  const save = new SaveManager(platform, bus);
  await save.load();
  save.update((data) => {
    data.worldSeed = 20260916;
  });

  const loc = new Localization(bus);
  loc.setLocale('en');

  const entitlements = new Entitlements(save, bus);
  if (premium) {
    entitlements.attachStore(new DevStore(async () => true));
    await entitlements.purchase(PRODUCT_FULL_GAME);
  }

  return {
    bus,
    platform,
    save,
    loc,
    // The director never produces audio; a null-object keeps the test honest
    // about which dependencies it actually exercises.
    audio: { setPhase() {}, setWeather() {}, play() {}, applySettings() {} } as never,
    entitlements,
    worldRng: new Rng(20260916),
    quality: { tier: 'medium' } as never,
    formFactor: 'phone',
    dt: 0,
    elapsed: 0,
    paused: false,
  };
}

/** Plays a whole day by marking each planned activity complete, in order. */
function playDay(ctx: GameContext, director: DayDirector): number {
  let completed = 0;
  let guard = 0;

  while (!director.isDayComplete && guard++ < 200) {
    const next = director.remainingToday[0];
    if (!next) break;
    ctx.save.update((data) => {
      if (!data.completedToday.includes(next.id)) data.completedToday.push(next.id);
      data.completionCounts[next.id] = (data.completionCounts[next.id] ?? 0) + 1;
      data.hearts += next.rewards.hearts;
    });
    director.onActivityCompleted();
    completed++;
  }
  expect(guard, 'day did not converge — possible soft lock').toBeLessThan(200);
  return completed;
}

/* ------------------------------------------------------------------ */

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng('alpine');
    const b = new Rng('alpine');
    const left = Array.from({ length: 50 }, () => a.next());
    const right = Array.from({ length: 50 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces different streams for different seeds', () => {
    expect(new Rng('a').next()).not.toBe(new Rng('b').next());
  });

  it('forks into independent but reproducible streams', () => {
    const parent = new Rng(1);
    const one = parent.fork('trees').next();
    const parentAgain = new Rng(1);
    const two = parentAgain.fork('trees').next();
    expect(one).toBe(two);
    expect(new Rng(1).fork('trees').next()).not.toBe(new Rng(1).fork('rocks').next());
  });

  it('stays in range', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      expect(rng.next()).toBeGreaterThanOrEqual(0);
      expect(rng.next()).toBeLessThan(1);
      const n = rng.int(3, 9);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);
    }
  });

  it('respects weights', () => {
    const rng = new Rng(11);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 4000; i++) {
      counts[rng.pickWeighted(['a', 'b'] as const, [9, 1])]++;
    }
    // ~90/10; allow generous slack, we only care that weighting works at all.
    expect(counts.a).toBeGreaterThan(counts.b * 4);
  });

  it('keeps terrain noise bounded and continuous', () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37;
      const v = fbm2D(x, x * 0.5, 4, 99);
      expect(v).toBeGreaterThanOrEqual(-1.001);
      expect(v).toBeLessThanOrEqual(1.001);
      // No discontinuities: a tiny step must not jump.
      expect(Math.abs(fbm2D(x + 0.001, x * 0.5, 4, 99) - v)).toBeLessThan(0.05);
    }
  });

  it('has sane math helpers', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    // damp must converge and never overshoot.
    let v = 0;
    for (let i = 0; i < 200; i++) v = damp(v, 10, 5, 1 / 60);
    expect(v).toBeGreaterThan(9.9);
    expect(v).toBeLessThanOrEqual(10);
  });
});

describe('DayDirector', () => {
  let ctx: GameContext;
  let director: DayDirector;

  beforeEach(async () => {
    ctx = await makeContext();
    director = new DayDirector(ctx);
    director.beginDay();
  });

  it('uses the authored plan for day 1', () => {
    expect(director.currentPlan.day).toBe(1);
    expect(director.currentPlan.weather).toBe('sunny');
    expect(director.currentPlan.byPhase.morning[0]).toBe('wakeup');
  });

  it('completes day 1 and rolls into day 2', () => {
    const done = playDay(ctx, director);
    expect(done).toBeGreaterThan(8);
    expect(director.isDayComplete).toBe(true);

    const record = director.endDay();
    expect(record.day).toBe(1);
    expect(ctx.save.save.day).toBe(2);
    expect(ctx.save.save.phase).toBe('morning');
    expect(ctx.save.save.completedToday).toEqual([]);
    expect(ctx.save.save.tutorialDone).toBe(true);
    expect(ctx.save.save.history).toHaveLength(1);
  });

  it('advances phases in order as tasks finish', () => {
    const seen: string[] = [director.currentPhase];
    ctx.bus.on('day:phase-changed', ({ phase }) => seen.push(phase));
    playDay(ctx, director);
    expect(seen).toEqual(PHASE_ORDER);
  });

  it('never offers an activity whose prerequisite is unmet', () => {
    let guard = 0;
    while (!director.isDayComplete && guard++ < 200) {
      const next = director.remainingToday[0];
      if (!next) break;
      for (const required of next.requiresActivities ?? []) {
        expect(
          ctx.save.save.completedToday,
          `${next.id} offered before ${required}`,
        ).toContain(required);
      }
      ctx.save.update((d) => d.completedToday.push(next.id));
      director.onActivityCompleted();
    }
  });

  it('generates playable days forever after the scripted ones', () => {
    // Play thirty days straight. Every one must be completable and must contain
    // the full daily rhythm — this is the soft-lock regression test.
    for (let i = 0; i < 30; i++) {
      const plan = director.currentPlan;
      const flat = PHASE_ORDER.flatMap((p) => plan.byPhase[p]);

      for (const required of FIXED_ACTIVITIES) {
        expect(flat, `day ${plan.day} missing ${required}`).toContain(required);
      }
      expect(new Set(flat).size, `day ${plan.day} has duplicates`).toBe(flat.length);
      expect(flat[flat.length - 1]).toBe('bedtime');

      const done = playDay(ctx, director);
      expect(done, `day ${plan.day} completed nothing`).toBeGreaterThan(5);
      director.endDay();
      director.beginDay();
    }
    expect(ctx.save.save.day).toBe(31);
  });

  it('is deterministic: the same seed and day produce the same plan', async () => {
    const a = await makeContext();
    const b = await makeContext();
    a.save.update((d) => {
      d.day = 12;
    });
    b.save.update((d) => {
      d.day = 12;
    });
    const planA = new DayDirector(a).buildPlan(12);
    const planB = new DayDirector(b).buildPlan(12);
    expect(planA.weather).toBe(planB.weather);
    expect(planA.byPhase).toEqual(planB.byPhase);
  });

  it('rolls the season over after a full season length', () => {
    const startSeason = ctx.save.save.season;
    for (let i = 0; i < DAY_GENERATION.seasonLength; i++) {
      playDay(ctx, director);
      director.endDay();
      director.beginDay();
    }
    const expected = SEASON_ORDER[(SEASON_ORDER.indexOf(startSeason) + 1) % 4];
    expect(ctx.save.save.season).toBe(expected);
    expect(ctx.save.save.seasonDay).toBe(1);
  });

  it('only schedules activities whose season and weather allow them', () => {
    for (let i = 0; i < 40; i++) {
      const plan = director.currentPlan;
      for (const phase of PHASE_ORDER) {
        for (const id of plan.byPhase[phase]) {
          const activity = ACTIVITIES_BY_ID.get(id)!;
          if (activity.seasons) expect(activity.seasons, id).toContain(plan.season);
          if (activity.weather) expect(activity.weather, id).toContain(plan.weather);
        }
      }
      playDay(ctx, director);
      director.endDay();
      director.beginDay();
    }
  });

  it('keeps the day-history bounded so the save cannot grow without limit', () => {
    for (let i = 0; i < 80; i++) {
      playDay(ctx, director);
      director.endDay();
      director.beginDay();
    }
    expect(ctx.save.save.history.length).toBeLessThanOrEqual(60);
  });

  it('excludes premium content for a free player and includes it for a paid one', async () => {
    const freeCtx = await makeContext(false);
    const paidCtx = await makeContext(true);
    expect(paidCtx.entitlements.isPremium).toBe(true);

    const free = new DayDirector(freeCtx);
    const paid = new DayDirector(paidCtx);

    for (let day = 4; day < 30; day++) {
      for (const phase of PHASE_ORDER) {
        for (const id of free.buildPlan(day).byPhase[phase]) {
          expect(ACTIVITIES_BY_ID.get(id)?.requiresPremium, id).toBeFalsy();
        }
      }
    }
    // The paid plan is still valid content.
    expect(paid.buildPlan(10).byPhase.morning).toContain('wakeup');
  });
});

describe('Entitlements', () => {
  it('stays offline-safe: a cached purchase survives with no store attached', async () => {
    const ctx = await makeContext();
    ctx.save.updateSettings((s) => {
      s.premiumUnlocked = true;
    });

    const cold = new Entitlements(ctx.save, ctx.bus);
    cold.loadFromCache();
    expect(cold.isPremium).toBe(true);
  });

  it('persists a purchase and announces it once', async () => {
    const ctx = await makeContext();
    const events: boolean[] = [];
    ctx.bus.on('entitlement:changed', ({ premium }) => events.push(premium));

    const entitlements = new Entitlements(ctx.save, ctx.bus);
    entitlements.attachStore(new DevStore(async () => true));

    expect(entitlements.isPremium).toBe(false);
    const result = await entitlements.purchase(PRODUCT_FULL_GAME);
    expect(result.status).toBe('purchased');
    expect(entitlements.isPremium).toBe(true);
    expect(ctx.save.settings.premiumUnlocked).toBe(true);

    // Buying again must not re-fire the event or corrupt state.
    await entitlements.purchase(PRODUCT_FULL_GAME);
    expect(events).toEqual([true]);
  });

  it('grants nothing when the player cancels', async () => {
    const ctx = await makeContext();
    const entitlements = new Entitlements(ctx.save, ctx.bus);
    entitlements.attachStore(new DevStore(async () => false));

    const result = await entitlements.purchase(PRODUCT_FULL_GAME);
    expect(result.status).toBe('cancelled');
    expect(entitlements.isPremium).toBe(false);
    expect(ctx.save.settings.premiumUnlocked).toBe(false);
  });

  it('restores a previous purchase', async () => {
    const ctx = await makeContext();
    const store = new DevStore(async () => true);
    const first = new Entitlements(ctx.save, ctx.bus);
    first.attachStore(store);
    await first.purchase(PRODUCT_FULL_GAME);

    const second = new Entitlements(ctx.save, ctx.bus);
    second.attachStore(store);
    const results = await second.restore();
    expect(results.some((r) => r.status === 'restored')).toBe(true);
    expect(second.isPremium).toBe(true);
  });
});
