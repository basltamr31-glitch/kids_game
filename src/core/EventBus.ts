/**
 * Minimal typed publish/subscribe bus.
 *
 * Systems talk to each other through this rather than holding direct
 * references, which is what keeps gameplay / UI / audio decoupled enough that
 * any one of them can be replaced without touching the others.
 */

export type GameEvents = {
  /* --- lifecycle --- */
  'game:ready': void;
  'game:paused': boolean;

  /* --- day flow --- */
  'day:started': { day: number; phase: string };
  'day:phase-changed': { phase: string; previous: string };
  'day:ended': { day: number; summary: DaySummary };
  'day:task-list-changed': void;

  /* --- activities --- */
  'activity:offered': { activityId: string };
  'activity:started': { activityId: string };
  'activity:step': { activityId: string; step: number; total: number };
  'activity:completed': { activityId: string; rewards: RewardBundle };
  'activity:cancelled': { activityId: string };

  /* --- world --- */
  'weather:changed': { weather: string; season: string };
  'time:changed': { hour: number };
  'discovery:found': { id: string; category: string };

  /* --- player --- */
  'player:moved': { x: number; z: number };
  'inventory:changed': void;
  'emote': { actor: string; emote: string };

  /* --- ui --- */
  'ui:toast': { textKey: string; icon?: string; params?: Record<string, string | number> };
  'ui:speech': { actor: string; textKey: string; duration?: number };
  'ui:open': { screen: string };
  'ui:close': { screen: string };
  'ui:layout-changed': void;

  /* --- meta --- */
  'save:written': void;
  'entitlement:changed': { premium: boolean };
  'settings:changed': void;
  'locale:changed': { locale: string };
};

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event as string);
    if (!set) {
      set = new Set();
      this.handlers.set(event as string, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  once<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    const dispose = this.on(event, (payload) => {
      dispose();
      handler(payload);
    });
    return dispose;
  }

  off<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): void {
    this.handlers.get(event as string)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof GameEvents>(
    event: K,
    ...args: GameEvents[K] extends void ? [] : [GameEvents[K]]
  ): void {
    const set = this.handlers.get(event as string);
    if (!set) return;
    // Copy: handlers are allowed to unsubscribe themselves while dispatching.
    for (const handler of [...set]) {
      try {
        (handler as Handler<unknown>)(args[0]);
      } catch (error) {
        // One broken listener must never take the whole frame down.
        console.error(`[EventBus] handler for "${String(event)}" threw`, error);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export interface RewardBundle {
  hearts?: number;
  stickerId?: string;
  discoveryId?: string;
  items?: { id: string; count: number }[];
}

export interface DaySummary {
  day: number;
  tasksCompleted: number;
  tasksTotal: number;
  hearts: number;
  discoveries: string[];
  weather: string;
  season: string;
}
