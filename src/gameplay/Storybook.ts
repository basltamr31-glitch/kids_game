/**
 * Photos of the day, for the storybook page at bedtime.
 *
 * When an activity finishes, the next rendered frame is copied into a small
 * JPEG: the child, the animal and the place, exactly as they looked. At the
 * end of the day three of them, spread across the day, become the pictures on
 * the goodnight page.
 *
 * Photos live in memory only. They are the story of today, not something to
 * keep: nothing is written to the save, and nothing leaves the device.
 */

export interface Snapshot {
  activityId: string;
  image: string;
}

const WIDTH = 320;
const HEIGHT = 200;
/** Enough for a full day; older ones drop out from the middle. */
const MAX_SHOTS = 14;

export class Storybook {
  private shots: Snapshot[] = [];
  private pending: { activityId: string; delay: number } | null = null;
  private canvas: HTMLCanvasElement | null = null;

  /** Asks for a photo shortly after now, once the reaction has played. */
  request(activityId: string, delay = 0.45): void {
    this.pending = { activityId, delay };
  }

  /** Counts down the pending photo. Returns true when it should be taken. */
  tick(dt: number): boolean {
    if (!this.pending) return false;
    this.pending.delay -= dt;
    return this.pending.delay <= 0;
  }

  /**
   * Copies the WebGL canvas. Must be called straight after render, in the
   * same task: the drawing buffer is not preserved past that.
   */
  capture(source: HTMLCanvasElement): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending || source.width === 0 || source.height === 0) return;
    try {
      this.canvas ??= document.createElement('canvas');
      const out = this.canvas;
      out.width = WIDTH;
      out.height = HEIGHT;
      const g = out.getContext('2d');
      if (!g) return;
      // Crop in on the middle of the screen, where the follow camera keeps
      // the child: the full frame at play distance makes them a speck.
      const zoom = 0.62;
      const scale = Math.max(WIDTH / (source.width * zoom), HEIGHT / (source.height * zoom));
      const w = WIDTH / scale;
      const h = HEIGHT / scale;
      g.drawImage(source, (source.width - w) / 2, (source.height - h) / 2, w, h, 0, 0, WIDTH, HEIGHT);
      const image = out.toDataURL('image/jpeg', 0.72);
      // A blank frame (context lost, nothing drawn yet) is not a memory.
      if (image.length < 2000) return;
      this.shots.push({ activityId: pending.activityId, image });
      if (this.shots.length > MAX_SHOTS) this.shots.splice(Math.floor(MAX_SHOTS / 2), 1);
    } catch {
      /* a photo is a nicety; never let it break the day */
    }
  }

  /** Up to `count` photos spread across the day, one per activity. */
  pick(count = 3): Snapshot[] {
    return pickSpread(this.shots, count);
  }

  clear(): void {
    this.shots = [];
    this.pending = null;
  }
}

/**
 * Chooses `count` items spread evenly from first to last, skipping repeats of
 * the same activity so the page does not show three pictures of one chore.
 */
export function pickSpread<T extends { activityId: string }>(items: T[], count: number): T[] {
  const unique: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.activityId)) continue;
    seen.add(item.activityId);
    unique.push(item);
  }
  if (unique.length <= count) return unique;
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    out.push(unique[Math.round((i * (unique.length - 1)) / (count - 1))]);
  }
  return out;
}
