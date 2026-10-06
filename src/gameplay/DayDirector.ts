import type { GameContext } from '../core/GameContext';
import type { DayPhase, Season, Weather, DayRecord } from '../save/SaveSchema';
import {
  ACTIVITIES,
  ACTIVITIES_BY_ID,
  FIXED_ACTIVITIES,
  SCRIPTED_DAYS_BY_NUMBER,
  DAY_GENERATION,
  WEATHER_TABLE,
  SEASON_ORDER,
  DISCOVERIES,
  type ActivityDefinition,
  type DayDefinition,
} from '../content';
import { Rng } from '../core/Rng';

/**
 * Runs the day.
 *
 * Days 1-3 are authored (see Days.ts) and teach the loop. From day 4 the
 * director generates them, which is what produces the "life continues" feeling
 * the brief asks for without any procedural world generation.
 *
 * Generation rules, in priority order:
 *   1. The fixed rhythm always happens: wake, dress, eat, ... dinner, bed.
 *   2. Animals that need care are always offered — a child must never be
 *      unable to look after Bella.
 *   3. The rest is a weighted draw, penalised for recent repeats, filtered by
 *      season, weather and ownership.
 *   4. There is always at least one gentle, no-chore thing to do.
 */

export const PHASE_ORDER: DayPhase[] = ['morning', 'midday', 'afternoon', 'evening', 'night'];

/** In-world clock at which each phase begins. */
const PHASE_START_HOUR: Record<DayPhase, number> = {
  morning: 7,
  midday: 11,
  afternoon: 14,
  evening: 18,
  night: 20.5,
};

export interface DayPlan {
  day: number;
  season: Season;
  weather: Weather;
  /** Ordered activity ids per phase. */
  byPhase: Record<DayPhase, string[]>;
  beats: { phase: DayPhase; textKey: string; actor: string }[];
  /** Discoveries seeded for this day, if any. */
  discoveries: string[];
}

export class DayDirector {
  private ctx: GameContext;
  private plan: DayPlan;
  private phase: DayPhase = 'morning';

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.plan = this.buildPlan(ctx.save.save.day);
    this.phase = ctx.save.save.phase;
  }

  get currentPlan(): DayPlan {
    return this.plan;
  }

  get currentPhase(): DayPhase {
    return this.phase;
  }

  /** Tasks remaining in the current phase, in order. */
  get currentTasks(): ActivityDefinition[] {
    const completed = this.ctx.save.save.completedToday;
    return this.plan.byPhase[this.phase]
      .filter((id) => !completed.includes(id))
      .map((id) => ACTIVITIES_BY_ID.get(id))
      .filter((a): a is ActivityDefinition => a !== undefined);
  }

  /** Everything still to do today, across all remaining phases. */
  get remainingToday(): ActivityDefinition[] {
    const completed = this.ctx.save.save.completedToday;
    const startIndex = PHASE_ORDER.indexOf(this.phase);
    const out: ActivityDefinition[] = [];
    for (let i = startIndex; i < PHASE_ORDER.length; i++) {
      for (const id of this.plan.byPhase[PHASE_ORDER[i]]) {
        if (completed.includes(id)) continue;
        const activity = ACTIVITIES_BY_ID.get(id);
        if (activity) out.push(activity);
      }
    }
    return out;
  }

  get totalTasksToday(): number {
    return PHASE_ORDER.reduce((sum, phase) => sum + this.plan.byPhase[phase].length, 0);
  }

  /** True when every task in every phase is done. */
  get isDayComplete(): boolean {
    const completed = this.ctx.save.save.completedToday;
    return PHASE_ORDER.every((phase) =>
      this.plan.byPhase[phase].every((id) => completed.includes(id)),
    );
  }

  /** Emits the start-of-day events and applies weather/season to the save. */
  beginDay(): void {
    const save = this.ctx.save.save;
    this.plan = this.buildPlan(save.day);
    this.phase = save.phase;

    this.ctx.save.update((data) => {
      data.season = this.plan.season;
      data.weather = this.plan.weather;
    });

    this.ctx.bus.emit('day:started', { day: this.plan.day, phase: this.phase });
    this.ctx.bus.emit('weather:changed', {
      weather: this.plan.weather,
      season: this.plan.season,
    });
    this.emitBeat(this.phase);
    this.ctx.bus.emit('day:task-list-changed');
  }

  /**
   * Called after each completed activity. Advances the phase when its tasks are
   * done, and reports whether the whole day is finished.
   */
  onActivityCompleted(): { phaseChanged: boolean; dayComplete: boolean } {
    const completed = this.ctx.save.save.completedToday;
    const phaseDone = () => this.plan.byPhase[this.phase].every((id) => completed.includes(id));

    // Keep going while the phase we land in is already finished. The child is
    // free to do the afternoon's jobs in the morning, and when they do, the
    // afternoon has nothing left in it the moment it begins; stopping there
    // would leave the day waiting for a task that is already done.
    let phaseChanged = false;
    while (phaseDone() && PHASE_ORDER.indexOf(this.phase) < PHASE_ORDER.length - 1) {
      const previous = this.phase;
      this.phase = PHASE_ORDER[PHASE_ORDER.indexOf(this.phase) + 1];
      phaseChanged = true;
      this.ctx.save.update((data) => {
        data.phase = this.phase;
        // Push the clock forward to the new phase if the chores were quick.
        data.hour = Math.max(data.hour, PHASE_START_HOUR[this.phase]);
      });
      this.ctx.bus.emit('day:phase-changed', { phase: this.phase, previous });
    }
    // One beat, for the phase the day settled in. Skipped-over phases each
    // talking at once would be Mum and Dad speaking over each other.
    if (phaseChanged) this.emitBeat(this.phase);

    this.ctx.bus.emit('day:task-list-changed');
    return { phaseChanged, dayComplete: this.isDayComplete };
  }

  /** Wraps the day up and rolls the save forward to the next morning. */
  endDay(): DayRecord {
    const save = this.ctx.save.save;
    const completedCount = save.completedToday.length;

    const record: DayRecord = {
      day: save.day,
      season: save.season,
      weather: save.weather,
      tasksCompleted: completedCount,
      tasksTotal: this.totalTasksToday,
      hearts: save.hearts,
    };

    this.ctx.save.update((data) => {
      data.history.push(record);
      // Keep history bounded; nobody needs 400 entries and it bloats the save.
      if (data.history.length > 60) data.history.splice(0, data.history.length - 60);

      data.day += 1;
      data.seasonDay += 1;
      if (data.seasonDay > DAY_GENERATION.seasonLength) {
        data.seasonDay = 1;
        const index = SEASON_ORDER.indexOf(data.season);
        data.season = SEASON_ORDER[(index + 1) % SEASON_ORDER.length];
      }
      data.completedToday = [];
      data.phase = 'morning';
      data.hour = PHASE_START_HOUR.morning;
      data.tutorialDone = true;

      // Long-play sticker.
      if (data.day > 7 && !data.stickers.includes('weekone')) data.stickers.push('weekone');
      if (data.day === 2 && !data.stickers.includes('firstday')) data.stickers.push('firstday');
    });

    void this.ctx.save.flush(true);
    this.ctx.bus.emit('day:ended', {
      day: record.day,
      summary: {
        day: record.day,
        tasksCompleted: record.tasksCompleted,
        tasksTotal: record.tasksTotal,
        hearts: record.hearts,
        discoveries: this.plan.discoveries,
        weather: record.weather,
        season: record.season,
      },
    });

    return record;
  }

  /** Lets the player skip ahead when they have run out of listed tasks. */
  advancePhase(): boolean {
    const index = PHASE_ORDER.indexOf(this.phase);
    if (index >= PHASE_ORDER.length - 1) return false;
    const previous = this.phase;
    this.phase = PHASE_ORDER[index + 1];
    this.ctx.save.update((data) => {
      data.phase = this.phase;
      data.hour = Math.max(data.hour, PHASE_START_HOUR[this.phase]);
    });
    this.ctx.bus.emit('day:phase-changed', { phase: this.phase, previous });
    this.emitBeat(this.phase);
    this.ctx.bus.emit('day:task-list-changed');
    return true;
  }

  private emitBeat(phase: DayPhase): void {
    const beat = this.plan.beats.find((b) => b.phase === phase);
    if (!beat) return;
    // Story beats play once per save, ever.
    const key = `${this.plan.day}:${beat.phase}:${beat.textKey}`;
    if (this.ctx.save.save.seenStoryBeats.includes(key)) return;
    this.ctx.save.update((data) => data.seenStoryBeats.push(key));
    this.ctx.bus.emit('ui:speech', {
      actor: beat.actor,
      textKey: this.ctx.loc.tVariant(beat.textKey, this.ctx.save.save.day),
      duration: 3.2,
    });
  }

  /* ---------------- planning ---------------- */

  buildPlan(day: number): DayPlan {
    const scripted = SCRIPTED_DAYS_BY_NUMBER.get(day);
    if (scripted) return this.planFromDefinition(scripted, day);
    return this.generatePlan(day);
  }

  private planFromDefinition(definition: DayDefinition, day: number): DayPlan {
    const byPhase = emptyPhases();
    const premium = this.ctx.entitlements.isPremium;

    for (const entry of definition.schedule) {
      byPhase[entry.phase] = entry.activities.filter((id) => {
        const activity = ACTIVITIES_BY_ID.get(id);
        if (!activity) {
          console.warn(`[DayDirector] scripted day references unknown activity "${id}"`);
          return false;
        }
        return premium || !activity.requiresPremium;
      });
    }

    return {
      day,
      season: definition.season ?? this.ctx.save.save.season,
      weather: definition.weather ?? this.ctx.save.save.weather,
      byPhase,
      beats: definition.beats ?? [],
      discoveries: [],
    };
  }

  private generatePlan(day: number): DayPlan {
    // Deterministic per (world, day): reloading mid-day gives the same plan.
    const rng = new Rng(`${this.ctx.save.save.worldSeed}:day:${day}`);
    const season = this.ctx.save.save.season;
    const weather = this.rollWeather(rng, season);
    const premium = this.ctx.entitlements.isPremium;

    const byPhase = emptyPhases();

    /* --- 1. the fixed rhythm --- */
    byPhase.morning.push('wakeup', 'getdressed', 'breakfast');
    byPhase.evening.push('dinner');
    byPhase.night.push('brushteeth', 'bedtime');

    /* --- 2. animal care is never optional --- */
    const careActivities = ['feedcow', 'feedsheep', 'feedchickens'];
    for (const id of careActivities) {
      const activity = ACTIVITIES_BY_ID.get(id);
      if (!activity) continue;
      if (activity.requiresPremium && !premium) continue;
      // Spread them across morning and midday so the morning is not a wall.
      const target = byPhase.morning.length < 5 ? 'morning' : 'midday';
      byPhase[target].push(id);
    }
    // Eggs and milk follow their feeds, same day.
    if (byPhase.morning.includes('feedchickens') || byPhase.midday.includes('feedchickens')) {
      byPhase.midday.push('collecteggs');
    }
    if (byPhase.morning.includes('feedcow') || byPhase.midday.includes('feedcow')) {
      byPhase.midday.push('milkcow');
      byPhase.afternoon.push('bringmilk');
    }

    /* --- 3. the variable pool --- */
    const recent = this.recentActivityIds(DAY_GENERATION.repeatMemoryDays);
    const alreadyPlanned = new Set(PHASE_ORDER.flatMap((p) => byPhase[p]));

    for (const phase of ['morning', 'midday', 'afternoon'] as DayPhase[]) {
      const want = DAY_GENERATION.activitiesPerPhase[phase] ?? 0;
      for (let i = 0; i < want; i++) {
        const candidates = ACTIVITIES.filter((activity) =>
          this.isEligible(activity, phase, season, weather, premium, alreadyPlanned),
        );
        if (candidates.length === 0) break;

        const weights = candidates.map((activity) => {
          let weight = activity.weight;
          if (recent.has(activity.id)) weight *= DAY_GENERATION.repeatPenalty;
          // Nudge toward activities this child has done least.
          const done = this.ctx.save.save.completionCounts[activity.id] ?? 0;
          weight *= 1 / (1 + done * 0.06);
          return Math.max(0.01, weight);
        });

        const chosen = rng.pickWeighted(candidates, weights);
        byPhase[phase].push(chosen.id);
        alreadyPlanned.add(chosen.id);
      }
    }

    /* --- 4. always something gentle --- */
    const gentle = ['petanimal', 'smellflowers', 'explore', 'visitstream', 'playoutside'];
    const hasGentle = gentle.some((id) => alreadyPlanned.has(id));
    if (!hasGentle) {
      const candidates = gentle
        .map((id) => ACTIVITIES_BY_ID.get(id))
        .filter(
          (a): a is ActivityDefinition =>
            a !== undefined &&
            this.isEligible(a, 'afternoon', season, weather, premium, alreadyPlanned),
        );
      if (candidates.length > 0) {
        const chosen = rng.pick(candidates);
        byPhase.afternoon.push(chosen.id);
        alreadyPlanned.add(chosen.id);
      }
    }

    /* --- 5. a discovery to stumble across --- */
    const discoveries: string[] = [];
    if (rng.bool(DAY_GENERATION.discoveryChance)) {
      const found = this.ctx.save.save.discoveries;
      const eligible = DISCOVERIES.filter(
        (d) =>
          !found.includes(d.id) &&
          (!d.seasons || d.seasons.includes(season)) &&
          (!d.weather || d.weather.includes(weather)),
      );
      if (eligible.length > 0) {
        const weights = eligible.map((d) => d.chance);
        discoveries.push(rng.pickWeighted(eligible, weights).id);
      }
    }

    /* --- 6. a warm line from a parent --- */
    const beats: DayPlan['beats'] = [];
    if (weather === 'rain') {
      beats.push({ phase: 'morning', actor: 'mother', textKey: 'speech.mother.rain' });
    } else if (weather === 'snow') {
      beats.push({ phase: 'morning', actor: 'father', textKey: 'speech.father.snow' });
    } else {
      beats.push({
        phase: 'morning',
        actor: rng.bool() ? 'mother' : 'father',
        textKey: rng.bool() ? 'speech.mother.goodmorning' : 'speech.father.hello',
      });
    }
    beats.push({ phase: 'evening', actor: 'mother', textKey: 'speech.mother.dinner' });

    return { day, season, weather, byPhase, beats, discoveries };
  }

  private isEligible(
    activity: ActivityDefinition,
    phase: DayPhase,
    season: Season,
    weather: Weather,
    premium: boolean,
    alreadyPlanned: Set<string>,
  ): boolean {
    if (alreadyPlanned.has(activity.id)) return false;
    if (FIXED_ACTIVITIES.has(activity.id)) return false;
    if (activity.weight <= 0) return false;
    if (!activity.phases.includes(phase)) return false;
    if (activity.seasons && !activity.seasons.includes(season)) return false;
    if (activity.weather && !activity.weather.includes(weather)) return false;
    if (activity.requiresPremium && !premium) return false;
    // Prerequisites must already be somewhere in today's plan.
    for (const required of activity.requiresActivities ?? []) {
      if (!alreadyPlanned.has(required)) return false;
    }
    return true;
  }

  private recentActivityIds(days: number): Set<string> {
    // The save keeps counts rather than per-day lists, so "recent" is
    // approximated from the most-completed activities. Good enough to stop the
    // same three chores appearing every single day, which is all it is for.
    const counts = this.ctx.save.save.completionCounts;
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, days * 2)
      .map(([id]) => id);
    return new Set(sorted);
  }

  private rollWeather(rng: Rng, season: Season): Weather {
    const table = WEATHER_TABLE[season] ?? WEATHER_TABLE.summer;
    const kinds = Object.keys(table) as Weather[];
    const weights = kinds.map((kind) => table[kind]);
    return rng.pickWeighted(kinds, weights);
  }
}

function emptyPhases(): Record<DayPhase, string[]> {
  return { morning: [], midday: [], afternoon: [], evening: [], night: [] };
}
