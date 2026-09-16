import { Vector3 } from 'three';
import { el, onTap, clear, removeAnimated } from './dom';
import type { GameContext } from '../core/GameContext';
import type { InteractionSystem } from '../gameplay/InteractionSystem';
import type { DayDirector } from '../gameplay/DayDirector';
import type { CameraRig } from '../gameplay/CameraRig';
import { ACTIVITIES_BY_ID } from '../content';
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
  private projected = new Vector3();

  constructor(
    ctx: GameContext,
    refs: { director: DayDirector; interaction: InteractionSystem; camera: CameraRig },
    handlers: { onMenu: () => void; onBook: () => void },
  ) {
    this.ctx = ctx;
    this.director = refs.director;
    this.interaction = refs.interaction;
    this.camera = refs.camera;

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
      this.taskTitle.textContent = this.ctx.loc.t('hud.tasks');
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

    const remaining = this.director.remainingToday;
    if (remaining.length === 0) {
      this.taskList.appendChild(
        el('div', { class: 'task task--done' }, [
          el('span', { class: 'task__icon', text: '🌼' }),
          el('span', { class: 'task__label', text: this.ctx.loc.t('hud.notasks') }),
        ]),
      );
      return;
    }

    // Show a handful; a long scrollable list is noise for a four-year-old.
    const visible = remaining.slice(0, this.ctx.formFactor === 'phone' ? 4 : 6);
    visible.forEach((activity, index) => {
      const button = el(
        'button',
        {
          class: `task${index === 0 ? ' task--next' : ''}`,
          style: `animation-delay:${index * 45}ms`,
        },
        [
          el('span', { class: 'task__icon', text: activity.icon }),
          el('span', { class: 'task__label', text: this.ctx.loc.t(activity.titleKey) }),
        ],
      );
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
      this.taskList.appendChild(button);
    });
  }

  /* ---------------- floating prompt ---------------- */

  update(dt: number): void {
    this.updatePrompt();
    this.updateEmotes(dt);

    const hearts = this.ctx.save.save.hearts;
    if (hearts !== this.lastHearts) {
      this.lastHearts = hearts;
      this.heartsValue.textContent = String(hearts);
    }
  }

  private updatePrompt(): void {
    const prompt = this.interaction.activePrompt;
    if (!prompt) {
      this.promptNode.style.opacity = '0';
      return;
    }

    const activity = ACTIVITIES_BY_ID.get(prompt.activity.id);
    if (!activity) {
      this.promptNode.style.opacity = '0';
      return;
    }

    this.projected.copy(prompt.position);
    this.projected.y += this.interaction.promptHeight(activity.anchor);
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
    this.promptIcon.textContent = activity.icon;
    this.promptLabel.textContent = this.ctx.loc.t(activity.titleKey);
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

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }
}
