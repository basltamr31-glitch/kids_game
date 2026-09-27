import { Vector3 } from 'three';
import { el, onTap, clear, removeAnimated } from './dom';
import type { GameContext } from '../core/GameContext';
import type { InteractionSystem } from '../gameplay/InteractionSystem';
import type { DayDirector } from '../gameplay/DayDirector';
import type { CameraRig } from '../gameplay/CameraRig';
import { rankSuggestions, suggestionHeading, type SuggestionContext } from '../gameplay/Suggestions';

import type { Weather } from '../save/SaveSchema';

/**
 * The in-game HUD.
 *
 * Deliberately sparse: a day chip, a heart count, a short task list, one menu
 * button, and the floating prompt over whatever is nearby. Everything else the
 * child needs to know is communicated by the world itself.
 */

const WEATHER_ICON: Record<Weather, string> = {
  sunny: '☀️',
  cloudy: '⛅',
  rain: '🌧️',
  snow: '❄️',
  fog: '🌫️',
};

interface FloatingEmote {
  node: HTMLElement;
  anchor: () => Vector3 | null;
  born: number;
}

export class Hud {
  readonly root: HTMLElement;

  private ctx: GameContext;
  private director: DayDirector;
  private interaction: InteractionSystem;
  private camera: CameraRig;

  private dayChip: HTMLElement;
  private weatherIcon: HTMLElement;
  private heartsChip: HTMLElement;
  private heartsValue: HTMLElement;
  private taskList: HTMLElement;
  private suggestionContext: () => SuggestionContext;
  private taskTitle: HTMLElement;
  private promptNode: HTMLElement;
  private promptIcon: HTMLElement;
  private promptLabel: HTMLElement;
  private toastLayer: HTMLElement;
  private speechLayer: HTMLElement;
  private emoteLayer: HTMLElement;

  private emotes: FloatingEmote[] = [];
  private activeSpeech: HTMLElement | null = null;
  private speechTimer: number | null = null;
  private lastHearts = 0;
  /** What the counter shows. Lags the save while hearts are in flight. */
  private shownHearts = 0;
  private heartsInFlight = 0;
  private visible = true;
  private projected = new Vector3();

  constructor(
    ctx: GameContext,
    refs: {
      director: DayDirector;
      interaction: InteractionSystem;
      camera: CameraRig;
      /** Builds the "what shall we do?" context. Supplied by the game. */
      suggestionContext: () => SuggestionContext;
    },
    handlers: { onMenu: () => void; onBook: () => void },
  ) {
    this.ctx = ctx;
    this.director = refs.director;
    this.interaction = refs.interaction;
    this.camera = refs.camera;
    this.suggestionContext = refs.suggestionContext;

    this.weatherIcon = el('span', { class: 'daychip__weather', text: '☀️' });
    this.dayChip = el('div', { class: 'daychip' }, [
      this.weatherIcon,
      el('span', { class: 'daychip__text', text: '' }),
    ]);

    this.heartsValue = el('span', { text: '0' });
    this.heartsChip = el('div', { class: 'hearts', 'aria-live': 'polite' }, [
      el('span', { class: 'hearts__icon', text: '❤' }),
      this.heartsValue,
    ]);

    const bookButton = el('button', {
      class: 'btn btn--icon',
      text: '📖',
      'aria-label': ctx.loc.t('naturebook.title'),
    });
    onTap(bookButton, () => {
      ctx.audio.play('tap');
      handlers.onBook();
    });

    const menuButton = el('button', {
      class: 'btn btn--icon',
      text: '⚙️',
      'aria-label': ctx.loc.t('a11y.menu'),
    });
    onTap(menuButton, () => {
      ctx.audio.play('tap');
      handlers.onMenu();
    });

    this.taskTitle = el('div', { class: 'tasks__title', text: ctx.loc.t('hud.tasks') });
    this.taskList = el('div', { class: 'tasks', 'aria-label': ctx.loc.t('a11y.tasks') }, [
      this.taskTitle,
    ]);

    this.promptIcon = el('div', { class: 'prompt__bubble', text: '✋' });
    this.promptLabel = el('div', { class: 'prompt__label', text: '' });
    this.promptNode = el('div', { class: 'prompt', style: 'opacity:0' }, [
      this.promptIcon,
      el('div', { class: 'prompt__tail' }),
      this.promptLabel,
    ]);

    this.toastLayer = el('div', { class: 'toasts', 'aria-live': 'polite' });
    this.speechLayer = el('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    this.emoteLayer = el('div', { style: 'position:absolute;inset:0;pointer-events:none' });

    this.root = el('div', { class: 'hud' }, [
      el('div', { class: 'hud__topleft' }, [this.dayChip]),
      el('div', { class: 'hud__topright' }, [this.heartsChip, bookButton, menuButton]),
      this.taskList,
      this.promptNode,
      this.toastLayer,
      this.speechLayer,
      this.emoteLayer,
    ]);

    this.lastHearts = ctx.save.save.hearts;
    this.shownHearts = this.lastHearts;
    this.heartsValue.textContent = String(this.shownHearts);

    this.wireEvents();
    this.refreshDayChip();
    this.refreshTasks();
  }

  private wireEvents(): void {
    const bus = this.ctx.bus;

    bus.on('day:task-list-changed', () => this.refreshTasks());
    bus.on('day:started', () => {
      this.refreshDayChip();
      this.refreshTasks();
    });
    bus.on('day:phase-changed', () => this.refreshTasks());
    bus.on('weather:changed', () => this.refreshDayChip());
    bus.on('locale:changed', () => {
      // The heading is rewritten contextually by refreshTasks below.
      this.refreshDayChip();
      this.refreshTasks();
    });

    bus.on('activity:completed', () => {
      this.refreshTasks();
      this.pulseHearts();
    });

    bus.on('ui:toast', ({ textKey, icon, params }) => this.showToast(textKey, icon, params));
    bus.on('ui:speech', ({ actor, textKey, duration }) =>
      this.showSpeech(actor, textKey, duration ?? 2.6),
    );
    bus.on('emote', ({ actor, emote }) => this.showEmote(actor, emote));
    bus.on('discovery:found', ({ id }) => {
      this.showToast('toast.discovery', '🔎');
      void id;
    });
  }

  /* ---------------- chips ---------------- */

  private refreshDayChip(): void {
    const save = this.ctx.save.save;
    this.weatherIcon.textContent = WEATHER_ICON[save.weather] ?? '☀️';
    const text = this.dayChip.querySelector('.daychip__text');
    if (text) {
      text.textContent = `${this.ctx.loc.t('hud.day', { day: save.day })} · ${this.ctx.loc.t(
        `phase.${this.director.currentPhase}`,
      )}`;
    }
  }

  private pulseHearts(): void {
    this.heartsChip.classList.remove('pulse');
    // Force a reflow so the animation restarts on consecutive rewards.
    void this.heartsChip.offsetWidth;
    this.heartsChip.classList.add('pulse');
  }

  /* ---------------- task list ---------------- */

  refreshTasks(): void {
    clear(this.taskList);
    this.taskList.appendChild(this.taskTitle);
    this.refreshDayChip();

    // The heading asks rather than instructs, and the order reflects the moment
    // the child is standing in: the weather, where they are, and whether the
    // animals need anything. The activities themselves are unchanged, so every
    // suggestion is something they can actually walk over and do.
    const context = this.suggestionContext();
    this.taskTitle.textContent = this.ctx.loc.t(suggestionHeading(context));

    const remaining = rankSuggestions(this.director.remainingToday, context);
    if (remaining.length === 0) {
      this.taskList.appendChild(
        el('div', { class: 'task task--done' }, [
          el('span', { class: 'task__icon', text: '🌼' }),
          el('span', { class: 'task__label', text: this.ctx.loc.t('hud.notasks') }),
        ]),
      );
      return;
    }

    // One suggestion in words, the rest as pictures. Most players cannot read
    // yet, and six wide text buttons covered a third of the world the game is
    // about. The words are for the parent reading along; the icons are for the
    // child. A long list is noise for a four-year-old, so only a few show.
    const visible = remaining.slice(0, this.ctx.formFactor === 'phone' ? 4 : 5);
    const more = el('div', { class: 'tasks__more' });
    visible.forEach((activity, index) => {
      const title = this.ctx.loc.t(activity.titleKey);
      const button =
        index === 0
          ? el('button', { class: 'task task--next' }, [
              el('span', { class: 'task__icon', text: activity.icon }),
              el('span', { class: 'task__label', text: title }),
            ])
          : el('button', {
              class: 'task task--icon',
              style: `animation-delay:${index * 45}ms`,
              'aria-label': title,
              title,
              text: activity.icon,
            });
      onTap(button, () => {
        // Starting from the list is identical to tapping the world bubble: the
        // activity's first step walks the child there. Nothing teleports.
        // The anchor lookup is a guard — an animal that somehow has no position
        // should do nothing rather than start a script that cannot resolve.
        if (this.interaction.anchorPosition(activity.anchor)) {
          this.ctx.audio.play('tap');
          this.interaction.tryStart(activity);
        }
      });
      (index === 0 ? this.taskList : more).appendChild(button);
    });
    if (more.childElementCount > 0) this.taskList.appendChild(more);
  }

  /* ---------------- floating prompt ---------------- */

  update(dt: number): void {
    this.updatePrompt();
    this.updateEmotes(dt);

    // Hearts arrive from chores, from petting and from small physical jobs.
    // Watching the total rather than each source means every one of them
    // gets the same flight, and a new source cannot forget to animate.
    const hearts = this.ctx.save.save.hearts;
    if (hearts !== this.lastHearts) {
      const gained = hearts - this.lastHearts;
      this.lastHearts = hearts;
      if (gained > 0 && this.visible) this.launchHearts(gained);
    }
    if (this.heartsInFlight === 0 && this.shownHearts !== hearts) {
      this.shownHearts = hearts;
      this.heartsValue.textContent = String(hearts);
    }
  }

  /**
   * Hearts rise off the child and fly one by one into the counter, each
   * landing with a note a little higher than the last. The number ticks up as
   * they land, so the child sees where the reward came from and where it went.
   */
  private launchHearts(count: number): void {
    const child = this.interaction.anchorPosition('child');
    if (!child) return;
    this.projected.copy(child);
    this.projected.y += 1.3;
    this.projected.project(this.camera.camera);
    if (this.projected.z > 1) return;
    const fromX = (this.projected.x * 0.5 + 0.5) * window.innerWidth;
    const fromY = (-this.projected.y * 0.5 + 0.5) * window.innerHeight;

    const icon = this.heartsChip.querySelector('.hearts__icon') ?? this.heartsChip;
    const target = icon.getBoundingClientRect();
    const toX = target.left + target.width / 2;
    const toY = target.top + target.height / 2;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Past a handful they stop reading as individual hearts.
    const flights = Math.min(count, 5);
    for (let i = 0; i < flights; i++) {
      this.heartsInFlight += 1;
      // The last heart carries whatever is left, so the count always lands.
      const worth = i === flights - 1 ? count - (flights - 1) : 1;
      window.setTimeout(() => {
        const node = el('div', { class: 'heartfly', text: '❤' });
        this.emoteLayer.appendChild(node);
        const spread = (i - (flights - 1) / 2) * 34;
        // Up off the child first, then across: the apex stays below the
        // counter so a heart never leaves the top of the screen.
        const arcX = fromX + spread + (toX - fromX) * 0.25;
        const arcY = Math.max(toY + 24, fromY - 120 - i * 8);
        const land = (): void => {
          node.remove();
          this.heartsInFlight -= 1;
          this.shownHearts = Math.min(this.lastHearts, this.shownHearts + worth);
          this.heartsValue.textContent = String(this.shownHearts);
          this.pulseHearts();
          this.ctx.audio.play('tap', 1.25 + i * 0.14);
        };
        if (reduceMotion || typeof node.animate !== 'function') {
          land();
          return;
        }
        const animation = node.animate(
          [
            { transform: `translate(${fromX}px, ${fromY}px) scale(0.3)`, opacity: 0 },
            { transform: `translate(${fromX + spread * 0.6}px, ${fromY - 40}px) scale(1.25)`, opacity: 1, offset: 0.22 },
            { transform: `translate(${arcX}px, ${arcY}px) scale(1.05)`, opacity: 1, offset: 0.5 },
            { transform: `translate(${toX}px, ${toY}px) scale(0.55)`, opacity: 0.9 },
          ],
          { duration: 900, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'forwards' },
        );
        animation.onfinish = land;
        animation.oncancel = land;
      }, 250 + i * 130);
    }
  }

  private updatePrompt(): void {
    const prompt = this.interaction.activePrompt;
    if (!prompt) {
      this.promptNode.style.opacity = '0';
      return;
    }

    this.projected.copy(prompt.position);
    this.projected.y += prompt.bubbleHeight;
    this.projected.project(this.camera.camera);

    // Behind the camera: hide rather than draw a mirrored ghost.
    if (this.projected.z > 1) {
      this.promptNode.style.opacity = '0';
      return;
    }

    const x = (this.projected.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this.projected.y * 0.5 + 0.5) * window.innerHeight;

    this.promptNode.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    this.promptNode.style.opacity = '1';
    this.promptIcon.textContent = prompt.icon;
    this.promptLabel.textContent = this.ctx.loc.t(prompt.labelKey);
    // Physical interactions get a warmer ring than scheduled chores, so the
    // child can tell "this is a thing in the world" from "this is your list".
    this.promptNode.classList.toggle('prompt--object', prompt.source === 'interactable');
  }

  /* ---------------- transient feedback ---------------- */

  showToast(textKey: string, icon = '✨', params?: Record<string, string | number>): void {
    const node = el('div', { class: 'toast' }, [
      el('span', { class: 'toast__icon', text: icon }),
      el('span', { text: this.ctx.loc.t(textKey, params) }),
    ]);
    this.toastLayer.appendChild(node);
    // Keep at most three; more than that is a wall of text.
    while (this.toastLayer.children.length > 3) {
      this.toastLayer.firstElementChild?.remove();
    }
    window.setTimeout(() => removeAnimated(node, 'toast--out', 350), 2400);
  }

  showSpeech(actor: string, text: string, seconds: number): void {
    if (!this.ctx.save.settings.subtitles) return;

    if (this.activeSpeech) {
      this.activeSpeech.remove();
      this.activeSpeech = null;
    }
    if (this.speechTimer !== null) window.clearTimeout(this.speechTimer);

    const avatar = actor === 'father' ? '👨‍🌾' : actor === 'mother' ? '👩‍🌾' : '🧒';
    const nameKey =
      actor === 'father' ? 'actor.father' : actor === 'mother' ? 'actor.mother' : 'actor.child';

    const node = el('div', { class: 'speech' }, [
      el('span', { class: 'speech__avatar', text: avatar }),
      el('span', { class: 'speech__text' }, [
        el('span', { class: 'speech__name', text: this.ctx.loc.t(nameKey) }),
        document.createTextNode(text),
      ]),
    ]);

    this.speechLayer.appendChild(node);
    this.activeSpeech = node;
    this.speechTimer = window.setTimeout(() => {
      removeAnimated(node, 'speech--out', 300);
      if (this.activeSpeech === node) this.activeSpeech = null;
    }, seconds * 1000);
  }

  /** Floating emoji above a character or animal, tracked in screen space. */
  showEmote(actorId: string, emoji: string): void {
    const node = el('div', { class: 'emote', text: emoji });
    this.emoteLayer.appendChild(node);
    this.emotes.push({
      node,
      anchor: () => this.interaction.anchorPosition(actorId),
      born: performance.now(),
    });
    window.setTimeout(() => {
      node.remove();
      this.emotes = this.emotes.filter((e) => e.node !== node);
    }, 1600);
  }

  private updateEmotes(_dt: number): void {
    for (const emote of this.emotes) {
      const position = emote.anchor();
      if (!position) continue;
      this.projected.copy(position);
      this.projected.y += 1.9;
      this.projected.project(this.camera.camera);
      if (this.projected.z > 1) {
        emote.node.style.opacity = '0';
        continue;
      }
      const x = (this.projected.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-this.projected.y * 0.5 + 0.5) * window.innerHeight;
      emote.node.style.left = `${x}px`;
      emote.node.style.top = `${y}px`;
    }
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? '' : 'none';
  }
}
