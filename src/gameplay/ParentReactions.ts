import type { Vector3 } from 'three';
import type { FamilyAgent } from '../characters/FamilyAgent';
import type { GameContext } from '../core/GameContext';

/**
 * Mum and Dad paying attention to what the child is doing.
 *
 * Two beats, and deliberately only two. While the child is busy with something
 * nearby, the closest parent stops work and watches. When it is finished, they
 * react — loudly for a job that helped the family, quietly for play.
 *
 * The restraint is the design. A parent who cheers every single thing a
 * four-year-old does stops meaning anything by lunchtime, so the fixed daily
 * rhythm — getting up, getting dressed, brushing teeth — draws no reaction at
 * all, and play draws a smile rather than applause.
 */

/** Distance within which a parent notices what the child is up to. */
const NOTICE_RADIUS = 10;

/** Jobs that help the family, and earn a proper thank-you. */
const HELPFUL = new Set([
  'feedcow', 'feedsheep', 'feedchickens', 'watercow', 'milkcow', 'collecteggs',
  'bringmilk', 'helpcook', 'helpfence', 'sweepyard', 'waterplants',
  'pickvegetables', 'pickapples',
]);

/**
 * Private things a parent does not applaud.
 *
 * Being cheered for brushing your teeth is the kind of praise that teaches a
 * child the praise is automatic.
 */
const PRIVATE = new Set(['wakeup', 'getdressed', 'brushteeth', 'bedtime', 'breakfast', 'dinner']);

export class ParentReactions {
  private parents: Map<string, FamilyAgent>;
  private ctx: GameContext;
  private getChildPosition: () => Vector3;

  /** The parent currently watching, so the right one reacts at the end. */
  private watcher: FamilyAgent | null = null;
  private unsubscribe: Array<() => void> = [];

  constructor(
    ctx: GameContext,
    parents: Map<string, FamilyAgent>,
    getChildPosition: () => Vector3,
  ) {
    this.ctx = ctx;
    this.parents = parents;
    this.getChildPosition = getChildPosition;

    this.unsubscribe.push(
      ctx.bus.on('activity:started', ({ activityId }) => this.onStarted(activityId)),
      ctx.bus.on('activity:completed', ({ activityId }) => this.onCompleted(activityId)),
      ctx.bus.on('activity:cancelled', () => this.stopWatching()),
    );
  }

  private nearestParent(): FamilyAgent | null {
    const child = this.getChildPosition();
    let best: FamilyAgent | null = null;
    let bestDistance = NOTICE_RADIUS;
    for (const parent of this.parents.values()) {
      const distance = parent.position.distanceTo(child);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = parent;
      }
    }
    return best;
  }

  private onStarted(activityId: string): void {
    this.stopWatching();
    if (PRIVATE.has(activityId)) return;
    const parent = this.nearestParent();
    if (!parent) return;
    this.watcher = parent;
    parent.setWatching(true);
  }

  private onCompleted(activityId: string): void {
    // The parent who watched gets to react, even if the child has since walked
    // out of range — otherwise finishing a job by wandering off loses the
    // moment it was leading up to.
    const parent = this.watcher ?? this.nearestParent();
    this.stopWatching();
    if (!parent || PRIVATE.has(activityId)) return;

    const praise = HELPFUL.has(activityId);
    const family = praise ? 'thanks' : 'play';
    const key = `speech.${parent.role}.${family}`;
    parent.celebrate(praise ? 'praise' : 'interest', key);

    const line = parent.takeLine();
    if (!line) return;
    this.ctx.bus.emit('ui:speech', {
      actor: parent.role,
      textKey: this.ctx.loc.tVariant(line, Math.floor(Math.random() * 3)),
      duration: 2.6,
    });
    this.ctx.audio.playVoice('happy', true);
  }

  private stopWatching(): void {
    this.watcher?.setWatching(false);
    this.watcher = null;
  }

  dispose(): void {
    this.stopWatching();
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }
}
