import { el, onTap, removeAnimated } from './dom';
import type { GameContext } from '../core/GameContext';
import { SKIN_TONES, HAIR_COLORS, OUTFIT_PRIMARY } from '../art/Palette';
import {
  DISCOVERIES,
  MILESTONES,
  heartsForHat,
  heartsForOutfit,
  nextMilestone,
  type Milestone,
} from '../content';
import { PRODUCT_FULL_GAME } from '../monetization/IStore';
import type { CharacterAppearance } from '../save/SaveSchema';
import type { DaySummary } from '../core/EventBus';
import type { QualityTier } from '../core/DeviceProfile';

/**
 * Modal screens.
 *
 * Each builder returns a detached element plus a `close` callback. UIRoot owns
 * the stack; screens never know about each other, which keeps the child flow
 * and the parent flow genuinely separate.
 */

export interface Screen {
  node: HTMLElement;
  /** Called when the screen is dismissed by any route. */
  onClose?: () => void;
}

function shell(
  ctx: GameContext,
  titleKey: string,
  body: HTMLElement[],
  options: { dismissable?: boolean; onDismiss?: () => void; side?: boolean } = {},
): HTMLElement {
  const card = el('div', { class: 'screen__card', role: 'dialog', 'aria-modal': 'true' }, [
    el('h2', { class: 'screen__title', text: ctx.loc.t(titleKey) }),
    ...body,
  ]);

  const screen = el('div', { class: options.side ? 'screen screen--side' : 'screen' }, [card]);

  if (options.dismissable !== false) {
    // Tapping the dim area closes — but only the dim area, not the card.
    onTap(screen, (event) => {
      if (event.target === screen) options.onDismiss?.();
    });
  }
  return screen;
}

/* ------------------------------------------------------------------ */
/* Character customization (first launch)                              */
/* ------------------------------------------------------------------ */

export function buildCustomizeScreen(
  ctx: GameContext,
  appearance: CharacterAppearance,
  onChange: (next: CharacterAppearance) => void,
  onDone: (final: CharacterAppearance) => void,
  /**
   * 'create' is first launch: who you are. 'wardrobe' is getting dressed:
   * only what you wear, and no changing your skin or who you are.
   */
  mode: 'create' | 'wardrobe' = 'create',
): Screen {
  const working: CharacterAppearance = { ...appearance };
  const hearts = ctx.save.save.hearts;

  const notify = (): void => onChange({ ...working });

  // Earned items are shown from the start with a lock and the heart count,
  // so a child can see what is coming. Tapping one says how many more.
  const lockedTap = (needed: number): void => {
    ctx.audio.play('error');
    ctx.bus.emit('ui:toast', {
      textKey: 'toast.locked',
      icon: '🔒',
      params: { hearts: Math.max(1, needed - hearts) },
    });
  };

  const presetRow = row(ctx, 'actor.child', [
    chips(
      [
        { label: ctx.loc.t('welcome.girl'), value: 'girl' },
        { label: ctx.loc.t('welcome.boy'), value: 'boy' },
      ],
      working.preset,
      (value) => {
        working.preset = value as 'girl' | 'boy';
        notify();
      },
    ),
  ]);

  const skinRow = row(ctx, 'welcome.skin', [
    swatches(SKIN_TONES, working.skinTone, (index) => {
      working.skinTone = index;
      hairPicker.refresh();
      notify();
    }),
  ]);

  const hairColorRow = row(ctx, 'welcome.haircolor', [
    swatches(HAIR_COLORS, working.hairColor, (index) => {
      working.hairColor = index;
      hairPicker.refresh();
      notify();
    }),
  ]);

  // Hair styles are drawn, not emoji: a pre-reader picks by shape, so the
  // picture has to be the haircut they will actually get, in their colours.
  const hairPicker = hairStyles(working, (style) => {
    working.hairStyle = style;
    notify();
  });
  const hairStyleRow = row(ctx, 'welcome.hair', [hairPicker.node]);

  const outfitRow = row(ctx, 'welcome.outfit', [
    swatches(
      OUTFIT_PRIMARY as unknown as string[],
      working.outfit,
      (index) => {
        working.outfit = index;
        notify();
      },
      { hearts, needed: heartsForOutfit, onLocked: lockedTap },
    ),
  ]);

  const hatRow = row(ctx, 'welcome.hat', [
    iconChoices(
      HAT_ICONS,
      working.hat ?? 0,
      (index) => {
        working.hat = index;
        notify();
      },
      { hearts, needed: heartsForHat, onLocked: lockedTap },
    ),
  ]);

  const startButton = el('button', {
    class: 'btn btn--primary btn--wide',
    text: ctx.loc.t('welcome.start'),
  });

  const rows =
    mode === 'wardrobe'
      ? [hairStyleRow, hairColorRow, outfitRow, hatRow]
      : // No hats on the first screen: none are earned yet, and a row of
        // locks is not the welcome a new player should get.
        [presetRow, skinRow, hairStyleRow, hairColorRow, outfitRow];
  if (mode === 'wardrobe') startButton.textContent = ctx.loc.t('wardrobe.done');

  const node = shell(
    ctx,
    mode === 'wardrobe' ? 'wardrobe.title' : 'welcome.title',
    [
      el('div', { class: 'customize' }, rows),
      el('div', { class: 'screen__actions' }, [startButton]),
    ],
    { dismissable: false, side: true },
  );

  onTap(startButton, () => {
    ctx.audio.play('confirm');
    onDone({ ...working });
  });

  return { node };
}

function row(ctx: GameContext, labelKey: string, controls: HTMLElement[]): HTMLElement {
  return el('div', { class: 'customize__row' }, [
    el('span', { class: 'customize__label', text: ctx.loc.t(labelKey) }),
    ...controls,
  ]);
}

/**
 * The four haircuts as little portraits, redrawn in the chosen skin and hair
 * colour. Shapes follow `buildHair` in CharacterRig: short and tousled, a bob,
 * two ponytails, curls.
 */
function hairStyles(
  working: CharacterAppearance,
  onPick: (style: number) => void,
): { node: HTMLElement; refresh: () => void } {
  const container = el('div', { class: 'chips hairstyles' });
  const buttons: HTMLElement[] = [];
  const refresh = (): void => {
    const skin = SKIN_TONES[working.skinTone] ?? SKIN_TONES[0];
    const hair = HAIR_COLORS[working.hairColor] ?? HAIR_COLORS[0];
    buttons.forEach((button, style) => {
      button.innerHTML = hairSvg(style, skin, hair);
      button.setAttribute('aria-pressed', String(style === working.hairStyle % 4));
    });
  };
  for (let style = 0; style < 4; style++) {
    const button = el('button', { class: 'chip chip--portrait', 'aria-label': String(style + 1) });
    onTap(button, () => {
      working.hairStyle = style;
      refresh();
      onPick(style);
    });
    buttons.push(button);
    container.appendChild(button);
  }
  refresh();
  return { node: container, refresh };
}

function hairSvg(style: number, skin: string, hair: string): string {
  const face =
    `<circle cx="24" cy="26" r="13" fill="${skin}"/>` +
    `<circle cx="19.5" cy="27" r="1.6" fill="#3a2718"/><circle cx="28.5" cy="27" r="1.6" fill="#3a2718"/>` +
    `<path d="M20.5 32 q3.5 3 7 0" stroke="#3a2718" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
  let back = '';
  let front = '';
  switch (style) {
    case 0: // short, tousled, with a cowlick
      front =
        `<path d="M10.5 25 C10 12 20 9 25 10 C33 10 38.5 15 37.5 25 C35 20 30 18.5 26 19.5 C22 17.5 15 19 10.5 25Z" fill="${hair}"/>` +
        `<path d="M25 10.5 q2 -5 5 -5" stroke="${hair}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      break;
    case 1: // bob with a blunt fringe
      back = `<path d="M9 24 C9 11 39 11 39 24 L39.5 36 Q24 40 8.5 36Z" fill="${hair}"/>`;
      front = `<path d="M11 23 C11 13 37 13 37 23 L37 23.5 L11 23.5Z" fill="${hair}"/>`;
      break;
    case 2: // two high ponytails with red bobbles
      back =
        `<ellipse cx="7.5" cy="26" rx="4.2" ry="8" transform="rotate(22 7.5 26)" fill="${hair}"/>` +
        `<ellipse cx="40.5" cy="26" rx="4.2" ry="8" transform="rotate(-22 40.5 26)" fill="${hair}"/>`;
      front =
        `<path d="M11 24 C10.5 12.5 37.5 12.5 37 24 C33 19.5 28 18.5 24 20 C20 18.5 15 19.5 11 24Z" fill="${hair}"/>` +
        `<circle cx="11.2" cy="19" r="2.2" fill="#e0685f"/><circle cx="36.8" cy="19" r="2.2" fill="#e0685f"/>`;
      break;
    default: {
      // curls
      const puffs: string[] = [];
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        const x = 24 + Math.cos(a) * 13.5;
        const y = 24 + Math.sin(a) * 12;
        puffs.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.4" fill="${hair}"/>`);
      }
      front = puffs.join('') + `<circle cx="24" cy="14.5" r="6" fill="${hair}"/>`;
    }
  }
  return `<svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">${back}${face}${front}</svg>`;
}

interface LockRule {
  hearts: number;
  /** Hearts an option needs; 0 = free. */
  needed: (index: number) => number;
  onLocked: (needed: number) => void;
}

const HAT_ICONS = ['🙂', '👒', '🌼', '🧶', '👑'];

/** Big picture buttons, used for hats. Same lock rules as the swatches. */
function iconChoices(
  icons: readonly string[],
  selected: number,
  onPick: (index: number) => void,
  lock: LockRule,
): HTMLElement {
  const container = el('div', { class: 'chips' });
  icons.forEach((icon, index) => {
    const needed = lock.needed(index);
    const locked = needed > lock.hearts;
    const button = el('button', {
      class: `chip chip--portrait chip--icon${locked ? ' is-locked' : ''}`,
      'aria-pressed': String(index === selected),
      'aria-label': `${index + 1}`,
    }, [
      el('span', { text: icon }),
      locked ? el('span', { class: 'lock-badge', text: `❤${needed}` }) : null,
    ]);
    onTap(button, () => {
      if (locked) {
        lock.onLocked(needed);
        return;
      }
      container.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
      onPick(index);
    });
    container.appendChild(button);
  });
  return container;
}

function swatches(
  colors: readonly string[],
  selected: number,
  onPick: (index: number) => void,
  lock?: LockRule,
): HTMLElement {
  const container = el('div', { class: 'swatches' });
  colors.forEach((hex, index) => {
    const needed = lock?.needed(index) ?? 0;
    const locked = lock !== undefined && needed > lock.hearts;
    const button = el('button', {
      class: `swatch${locked ? ' is-locked' : ''}`,
      style: `background:${hex}`,
      'aria-pressed': String(index === selected),
      'aria-label': `${index + 1}`,
    }, locked ? [el('span', { class: 'lock-badge', text: `❤${needed}` })] : []);
    onTap(button, () => {
      if (locked) {
        lock.onLocked(needed);
        return;
      }
      container.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
      onPick(index);
    });
    container.appendChild(button);
  });
  return container;
}

function chips(
  options: { label: string; value: string }[],
  selected: string,
  onPick: (value: string) => void,
): HTMLElement {
  const container = el('div', { class: 'chips' });
  for (const option of options) {
    const button = el('button', {
      class: 'chip',
      text: option.label,
      'aria-pressed': String(option.value === selected),
    });
    onTap(button, () => {
      container.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
      onPick(option.value);
    });
    container.appendChild(button);
  }
  return container;
}

/* ------------------------------------------------------------------ */
/* Milestone                                                           */
/* ------------------------------------------------------------------ */

/**
 * "Something new!" — one card per milestone, played once. Wardrobe rewards
 * offer to try the new thing on straight away; farm rewards are already
 * standing in the world, with the camera looking at them.
 */
export function buildMilestoneScreen(
  ctx: GameContext,
  milestone: Milestone,
  handlers: { onTryOn?: () => void; onClose: () => void },
): Screen {
  const close = el('button', {
    class: `btn ${handlers.onTryOn ? '' : 'btn--primary '}btn--wide`,
    text: ctx.loc.t('milestone.ok'),
  });
  const actions: HTMLElement[] = [];
  if (handlers.onTryOn) {
    const tryOn = el('button', { class: 'btn btn--primary btn--wide', text: ctx.loc.t('milestone.tryon') });
    onTap(tryOn, () => {
      ctx.audio.play('confirm');
      handlers.onTryOn?.();
    });
    actions.push(tryOn);
  }
  actions.push(close);
  onTap(close, () => {
    ctx.audio.play('tap');
    handlers.onClose();
  });

  const node = shell(
    ctx,
    'milestone.title',
    [
      el('div', { class: 'milestone__icon', text: milestone.icon }),
      el('p', { class: 'screen__body milestone__text', text: ctx.loc.t(`milestone.${milestone.id}`) }),
      el('div', { class: 'screen__actions milestone__actions' }, actions),
    ],
    { dismissable: false },
  );
  node.classList.add('screen--celebrate');
  return { node };
}

/* ------------------------------------------------------------------ */
/* Title                                                               */
/* ------------------------------------------------------------------ */

/**
 * The first thing on screen at every launch.
 *
 * The world is already running behind it on a slow drift, so the title is a
 * window onto the valley rather than a menu in front of it. One button, the
 * size of a small hand. The first tap is also what browsers need before they
 * will play sound, so the game's music starts with the game.
 */
export function buildTitleScreen(
  ctx: GameContext,
  info: { day: number; returning: boolean },
  onPlay: () => void,
): Screen {
  const play = el(
    'button',
    { class: 'title__play', 'aria-label': ctx.loc.t('title.play') },
    [el('span', { class: 'title__play-icon', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>' })],
  );

  const node = el('div', { class: 'title' }, [
    el('div', { class: 'title__logo' }, [
      el('span', { class: 'title__small', text: ctx.loc.t('title.little') }),
      el('span', { class: 'title__big', text: ctx.loc.t('title.alpinedays') }),
    ]),
    el('div', { class: 'title__tagline', text: ctx.loc.t('title.tagline') }),
    play,
    info.returning
      ? el('div', { class: 'title__day', text: ctx.loc.t('hud.day', { day: info.day }) })
      : null,
  ]);

  let done = false;
  onTap(play, () => {
    if (done) return;
    done = true;
    ctx.audio.play('confirm');
    ctx.platform.haptic('light');
    onPlay();
  });

  return { node };
}

/* ------------------------------------------------------------------ */
/* End of day                                                          */
/* ------------------------------------------------------------------ */

export function buildDayEndScreen(
  ctx: GameContext,
  summary: DaySummary,
  onNext: () => void,
  /** Photos taken during the day; see gameplay/Storybook.ts. */
  photos: { activityId: string; image: string; caption: string }[] = [],
): Screen {
  // The day as a storybook page: a few pictures of what you did, pinned at
  // slightly different angles like photos on a fridge.
  const storyRow = photos.length
    ? el(
        'div',
        { class: 'story' },
        photos.map((photo, index) =>
          el('figure', {
            class: 'story__photo',
            style: `--tilt:${[-4, 3, -2][index % 3]}deg;animation-delay:${200 + index * 220}ms`,
          }, [
            el('img', { src: photo.image, alt: photo.caption, draggable: 'false' }),
            el('figcaption', { text: photo.caption }),
          ]),
        ),
      )
    : null;

  const stats = el('div', { class: 'dayend__stats' }, [
    stat(String(summary.tasksCompleted), ctx.loc.t('dayend.tasks', { count: summary.tasksCompleted })),
    stat(String(summary.hearts), ctx.loc.t('hud.hearts', { count: summary.hearts })),
    stat(
      String(summary.discoveries.length),
      ctx.loc.t('dayend.discoveries', { count: summary.discoveries.length }),
    ),
  ]);

  const newStickers = ctx.save.save.stickers.slice(-4);
  const stickerRow = el(
    'div',
    { class: 'stickers' },
    newStickers.map((id, index) =>
      el('div', {
        class: 'sticker',
        text: STICKER_ICON[id] ?? '⭐',
        style: `animation-delay:${index * 90}ms`,
        'aria-label': ctx.loc.t(`sticker.${id}`),
      }),
    ),
  );

  const nextButton = el('button', {
    class: 'btn btn--primary btn--wide',
    text: ctx.loc.t('dayend.next', { day: summary.day + 1 }),
  });

  const node = shell(
    ctx,
    'dayend.title',
    [
      el('p', { class: 'screen__body', text: ctx.loc.t('dayend.goodnight') }),
      ...(storyRow ? [storyRow] : []),
      stats,
      stickerRow,
      el('div', { class: 'screen__actions' }, [nextButton]),
    ],
    { dismissable: false },
  );

  onTap(nextButton, () => {
    ctx.audio.play('confirm');
    onNext();
  });

  return { node };
}

const STICKER_ICON: Record<string, string> = {
  firstday: '🌄',
  animalfriend: '🐄',
  gardener: '🌱',
  explorer: '🧭',
  helper: '🤝',
  weekone: '📅',
  rainyday: '☔',
  firstsnow: '❄️',
  spring: '🌷',
  autumn: '🍂',
  winter: '⛄',
};

function stat(value: string, label: string): HTMLElement {
  return el('div', { class: 'dayend__stat' }, [
    el('span', { class: 'dayend__value', text: value }),
    el('span', { class: 'dayend__label', text: label }),
  ]);
}

/* ------------------------------------------------------------------ */
/* Nature book                                                         */
/* ------------------------------------------------------------------ */

const CATEGORY_HINT: Record<string, string> = { creature: '🐾', plant: '🌿', place: '⛰️' };

type BookTab = 'nature' | 'stickers' | 'rewards';

/**
 * The album: what the child has found, the stickers they have earned, and
 * the heart rewards on the way. Every page shows its empty frames too, since
 * a collection with visible gaps is what gives collecting a shape. The gaps
 * are hinted (a paw print for an animal, a leaf for a plant), never "???".
 */
export function buildNatureBookScreen(ctx: GameContext, onClose: () => void): Screen {
  const save = ctx.save.save;
  const body = el('div', { class: 'book__page' });
  const summary = el('p', { class: 'screen__body book__summary' });

  const entry = (icon: string, name: string, found: boolean, hint: string, tag?: string): HTMLElement =>
    el('div', { class: `book__entry${found ? '' : ' book__entry--locked'}` }, [
      el('span', { class: 'book__icon', text: found ? icon : hint }),
      el('span', { class: 'book__name', text: found ? name : '' }),
      tag ? el('span', { class: 'lock-badge', text: tag }) : null,
    ]);

  const pages: Record<BookTab, () => void> = {
    nature: () => {
      const found = save.discoveries;
      summary.textContent =
        found.length === 0
          ? ctx.loc.t('naturebook.empty')
          : ctx.loc.t('naturebook.found', { found: found.length, total: DISCOVERIES.length });
      body.replaceChildren(
        el('div', { class: 'book__grid' }, DISCOVERIES.map((d) =>
          entry(d.icon, ctx.loc.t(d.nameKey), found.includes(d.id), CATEGORY_HINT[d.category] ?? '❔'),
        )),
      );
    },
    stickers: () => {
      const ids = Object.keys(STICKER_ICON);
      const have = ids.filter((id) => save.stickers.includes(id)).length;
      summary.textContent = ctx.loc.t('naturebook.found', { found: have, total: ids.length });
      body.replaceChildren(
        el('div', { class: 'book__grid' }, ids.map((id) =>
          entry(STICKER_ICON[id], ctx.loc.t(`sticker.${id}`), save.stickers.includes(id), '⭐'),
        )),
      );
    },
    rewards: () => {
      const next = nextMilestone(save.hearts);
      summary.textContent = next
        ? ctx.loc.t('book.nextreward', { hearts: next.hearts - save.hearts })
        : ctx.loc.t('book.allrewards');
      // A path of rewards with a filling bar up to the next one.
      const previous = [...MILESTONES].reverse().find((m) => m.hearts <= save.hearts)?.hearts ?? 0;
      const progress = next ? (save.hearts - previous) / Math.max(1, next.hearts - previous) : 1;
      body.replaceChildren(
        el('div', { class: 'book__progress', role: 'progressbar', 'aria-valuenow': Math.round(progress * 100) }, [
          el('span', { class: 'book__progress-fill', style: `width:${Math.round(progress * 100)}%` }),
          el('span', { class: 'book__progress-label', text: next ? `❤ ${save.hearts} / ${next.hearts}` : `❤ ${save.hearts}` }),
        ]),
        el('div', { class: 'book__grid' }, MILESTONES.map((m) =>
          entry(m.icon, '', save.hearts >= m.hearts, m.icon, save.hearts >= m.hearts ? undefined : `❤${m.hearts}`),
        )),
      );
    },
  };

  const tabs = el('div', { class: 'book__tabs', role: 'tablist' });
  const tabDefs: [BookTab, string, string][] = [
    ['nature', '🦋', 'naturebook.title'],
    ['stickers', '⭐', 'book.stickers'],
    ['rewards', '❤️', 'book.rewards'],
  ];
  const select = (tab: BookTab): void => {
    tabs.querySelectorAll('.book__tab').forEach((t) =>
      t.setAttribute('aria-selected', String(t.getAttribute('data-tab') === tab)),
    );
    pages[tab]();
    body.scrollTop = 0;
  };
  for (const [tab, icon, key] of tabDefs) {
    const button = el('button', { class: 'book__tab', role: 'tab', 'data-tab': tab, 'aria-label': ctx.loc.t(key) }, [
      el('span', { class: 'book__tab-icon', text: icon }),
      el('span', { class: 'book__tab-label', text: ctx.loc.t(key) }),
    ]);
    onTap(button, () => {
      ctx.audio.play('tap');
      select(tab);
    });
    tabs.appendChild(button);
  }

  const closeButton = el('button', { class: 'btn btn--wide', text: ctx.loc.t('common.close') });

  const node = shell(ctx, 'book.title', [
    tabs,
    summary,
    body,
    el('div', { class: 'screen__actions' }, [closeButton]),
  ], { onDismiss: onClose });
  node.classList.add('screen--book');
  select('nature');

  onTap(closeButton, onClose);
  return { node };
}

/* ------------------------------------------------------------------ */
/* Parent gate                                                         */
/* ------------------------------------------------------------------ */

/**
 * The parent gate.
 *
 * A 3-second press-and-hold. This is deliberately NOT a maths question: those
 * are trivially solved by a 7-year-old and are hostile to a parent with poor
 * numeracy or a screen reader. A sustained hold is something a toddler does not
 * do by accident, is language-free, and takes a grown-up one unhurried moment.
 */
export function buildParentGateScreen(
  ctx: GameContext,
  onPass: () => void,
  onCancel: () => void,
): Screen {
  const HOLD_SECONDS = 3;

  const fill = el('div', { class: 'gate__fill' });
  const holdButton = el('button', { class: 'gate__hold' }, [
    fill,
    el('span', { class: 'gate__label', text: ctx.loc.t('parent.gate.hold') }),
  ]);

  let raf = 0;
  let startedAt = 0;
  let holding = false;

  const tick = (): void => {
    if (!holding) return;
    const progress = Math.min(1, (performance.now() - startedAt) / (HOLD_SECONDS * 1000));
    fill.style.transform = `scaleY(${progress})`;
    if (progress >= 1) {
      holding = false;
      ctx.audio.play('confirm');
      ctx.platform.haptic('success');
      onPass();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const start = (event: PointerEvent): void => {
    event.preventDefault();
    holding = true;
    startedAt = performance.now();
    ctx.platform.haptic('light');
    raf = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(raf);
    fill.style.transform = 'scaleY(0)';
  };

  holdButton.addEventListener('pointerdown', start);
  holdButton.addEventListener('pointerup', stop);
  holdButton.addEventListener('pointercancel', stop);
  holdButton.addEventListener('pointerleave', stop);

  const cancelButton = el('button', { class: 'btn', text: ctx.loc.t('common.cancel') });
  onTap(cancelButton, onCancel);

  const node = shell(ctx, 'parent.gate.title', [
    el('p', { class: 'screen__body', text: ctx.loc.t('parent.gate.instruction') }),
    el('div', { class: 'gate' }, [holdButton]),
    el('p', { class: 'footnote', text: ctx.loc.t('parent.gate.hint') }),
    el('div', { class: 'screen__actions' }, [cancelButton]),
  ], { onDismiss: onCancel });

  return {
    node,
    onClose: () => {
      holding = false;
      cancelAnimationFrame(raf);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Parent area                                                         */
/* ------------------------------------------------------------------ */

export interface ParentAreaHandlers {
  onClose: () => void;
  onOpenStore: () => void;
  onResetProgress: () => void;
  onQualityChange: (tier: QualityTier | null) => void;
  onLocaleChange: (locale: string) => void;
  onUiScaleChange: (scale: number) => void;
  appVersion: string;
  links: { privacy: string; terms: string; support: string };
}

export function buildParentAreaScreen(ctx: GameContext, handlers: ParentAreaHandlers): Screen {
  const settings = ctx.save.settings;

  /* --- sound --- */
  const soundGroup = group(ctx, 'parent.area.sound', [
    slider(ctx, 'parent.area.music', settings.musicVolume, (value) => {
      ctx.save.updateSettings((s) => {
        s.musicVolume = value;
      });
      ctx.audio.applySettings(ctx.save.settings);
    }),
    slider(ctx, 'parent.area.sfx', settings.sfxVolume, (value) => {
      ctx.save.updateSettings((s) => {
        s.sfxVolume = value;
      });
      ctx.audio.applySettings(ctx.save.settings);
      ctx.audio.play('tap');
    }),
    slider(ctx, 'parent.area.ambience', settings.ambienceVolume, (value) => {
      ctx.save.updateSettings((s) => {
        s.ambienceVolume = value;
      });
      ctx.audio.applySettings(ctx.save.settings);
    }),
    toggleRow(ctx, 'parent.area.haptics', settings.haptics, (value) => {
      ctx.save.updateSettings((s) => {
        s.haptics = value;
      });
      if (value) ctx.platform.haptic('light');
    }),
  ]);

  /* --- language --- */
  const languageChips = el('div', { class: 'chips' });
  for (const locale of ctx.loc.availableLocales) {
    const button = el('button', {
      class: 'chip',
      text: locale.nativeName,
      'aria-pressed': String(locale.code === ctx.loc.locale),
      lang: locale.code,
    });
    onTap(button, () => {
      languageChips
        .querySelectorAll('.chip')
        .forEach((c) => c.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
      handlers.onLocaleChange(locale.code);
    });
    languageChips.appendChild(button);
  }
  const languageGroup = group(ctx, 'parent.area.language', [
    el('div', { class: 'settings__row' }, [languageChips]),
  ]);

  /* --- display --- */
  const qualityOptions: { label: string; value: string }[] = [
    { label: ctx.loc.t('parent.area.quality.auto'), value: 'auto' },
    { label: ctx.loc.t('parent.area.quality.low'), value: 'low' },
    { label: ctx.loc.t('parent.area.quality.medium'), value: 'medium' },
    { label: ctx.loc.t('parent.area.quality.high'), value: 'high' },
  ];
  const qualityRow = el('div', { class: 'settings__row' }, [
    el('span', { class: 'settings__name', text: ctx.loc.t('parent.area.quality') }),
    chips(qualityOptions, settings.qualityOverride ?? 'auto', (value) => {
      handlers.onQualityChange(value === 'auto' ? null : (value as QualityTier));
    }),
  ]);

  const displayGroup = group(ctx, 'parent.area.quality', [
    qualityRow,
    slider(
      ctx,
      'parent.area.uiscale',
      (settings.uiScale - 0.85) / 0.5,
      (value) => {
        const scale = 0.85 + value * 0.5;
        ctx.save.updateSettings((s) => {
          s.uiScale = scale;
        });
        handlers.onUiScaleChange(scale);
      },
    ),
    toggleRow(ctx, 'parent.area.readaloud', settings.readAloud, (value) => {
      ctx.save.updateSettings((s) => {
        s.readAloud = value;
      });
      if (!value) ctx.platform.stopSpeaking();
    }),
    toggleRow(ctx, 'parent.area.subtitles', settings.subtitles, (value) => {
      ctx.save.updateSettings((s) => {
        s.subtitles = value;
      });
    }),
    toggleRow(ctx, 'parent.area.reducedmotion', settings.reducedMotion, (value) => {
      ctx.save.updateSettings((s) => {
        s.reducedMotion = value;
      });
      document.body.classList.toggle('reduced-motion', value);
    }),
  ]);

  /* --- purchase --- */
  const storeButton = el('button', {
    class: 'btn btn--primary btn--wide',
    text: ctx.entitlements.isPremium
      ? ctx.loc.t('store.owned')
      : ctx.loc.t('parent.area.store'),
    disabled: ctx.entitlements.isPremium,
  });
  onTap(storeButton, handlers.onOpenStore);

  /* --- links & danger zone --- */
  const links = el('div', { class: 'linkrow' }, [
    linkButton(ctx, 'parent.area.privacy', () => void ctx.platform.openExternal(handlers.links.privacy)),
    linkButton(ctx, 'parent.area.terms', () => void ctx.platform.openExternal(handlers.links.terms)),
    linkButton(ctx, 'parent.area.support', () => void ctx.platform.openExternal(handlers.links.support)),
  ]);

  const resetButton = el('button', { class: 'link', text: ctx.loc.t('parent.area.reset') });
  let resetArmed = false;
  onTap(resetButton, () => {
    if (!resetArmed) {
      // Two-step, in-place confirmation — no chance of a stray tap wiping a farm.
      resetArmed = true;
      resetButton.textContent = ctx.loc.t('parent.area.reset.confirm');
      resetButton.style.color = 'var(--red)';
      window.setTimeout(() => {
        if (!resetArmed) return;
        resetArmed = false;
        resetButton.textContent = ctx.loc.t('parent.area.reset');
        resetButton.style.color = '';
      }, 6000);
      return;
    }
    resetArmed = false;
    handlers.onResetProgress();
  });

  const closeButton = el('button', { class: 'btn btn--wide', text: ctx.loc.t('common.done') });
  onTap(closeButton, handlers.onClose);

  const node = shell(ctx, 'parent.area.title', [
    soundGroup,
    languageGroup,
    displayGroup,
    group(ctx, 'parent.area.store', [storeButton]),
    links,
    el('div', { class: 'linkrow' }, [resetButton]),
    el('p', { class: 'footnote', text: ctx.loc.t('parent.area.offline') }),
    el('p', {
      class: 'footnote',
      text: ctx.loc.t('parent.area.about', { version: handlers.appVersion }),
    }),
    el('div', { class: 'screen__actions' }, [closeButton]),
  ], { onDismiss: handlers.onClose });

  return { node };
}

function group(ctx: GameContext, headingKey: string, rows: HTMLElement[]): HTMLElement {
  return el('div', { class: 'settings__group' }, [
    el('div', { class: 'settings__heading', text: ctx.loc.t(headingKey) }),
    ...rows,
  ]);
}

function slider(
  ctx: GameContext,
  labelKey: string,
  value: number,
  onInput: (value: number) => void,
): HTMLElement {
  const input = el('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.05',
    value: String(value),
    'aria-label': ctx.loc.t(labelKey),
  });
  let lastFired = 0;
  input.addEventListener('input', () => {
    const now = performance.now();
    // Throttle: an audio setting change per pixel of drag is wasteful.
    if (now - lastFired < 60) return;
    lastFired = now;
    onInput(Number(input.value));
  });
  input.addEventListener('change', () => onInput(Number(input.value)));

  return el('div', { class: 'settings__row' }, [
    el('span', { class: 'settings__name', text: ctx.loc.t(labelKey) }),
    el('div', { class: 'settings__control' }, [input]),
  ]);
}

function toggleRow(
  ctx: GameContext,
  labelKey: string,
  value: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const button = el('button', {
    class: 'toggle',
    'aria-pressed': String(value),
    'aria-label': ctx.loc.t(labelKey),
  });
  let state = value;
  onTap(button, () => {
    state = !state;
    button.setAttribute('aria-pressed', String(state));
    onChange(state);
  });
  return el('div', { class: 'settings__row' }, [
    el('span', { class: 'settings__name', text: ctx.loc.t(labelKey) }),
    el('div', { class: 'settings__control' }, [button]),
  ]);
}

function linkButton(ctx: GameContext, labelKey: string, onClick: () => void): HTMLElement {
  const button = el('button', { class: 'link', text: ctx.loc.t(labelKey) });
  onTap(button, onClick);
  return button;
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export function buildStoreScreen(
  ctx: GameContext,
  price: string,
  handlers: { onClose: () => void; onBuy: () => void; onRestore: () => void },
): Screen {
  const features = [
    'store.feature.animals',
    'store.feature.areas',
    'store.feature.seasons',
    'store.feature.activities',
    'store.feature.customization',
  ];

  const buyButton = el('button', {
    class: 'btn btn--primary btn--wide',
    text: ctx.loc.t('store.buy'),
  });
  const restoreButton = el('button', { class: 'link', text: ctx.loc.t('store.restore') });
  const closeButton = el('button', { class: 'btn', text: ctx.loc.t('common.back') });

  onTap(buyButton, handlers.onBuy);
  onTap(restoreButton, handlers.onRestore);
  onTap(closeButton, handlers.onClose);

  const node = shell(ctx, 'store.title', [
    el('p', { class: 'screen__body', text: ctx.loc.t('store.body') }),
    el(
      'ul',
      { class: 'store__features' },
      features.map((key) => el('li', { class: 'store__feature', text: ctx.loc.t(key) })),
    ),
    el('div', { class: 'store__price', text: price }),
    buyButton,
    el('div', { class: 'linkrow' }, [restoreButton]),
    el('div', { class: 'screen__actions' }, [closeButton]),
  ], { onDismiss: handlers.onClose });

  return { node };
}

/** Shown when a child taps something premium. Never a hard sell. */
export function buildLockedScreen(
  ctx: GameContext,
  handlers: { onClose: () => void; onShowGrownUp: () => void },
): Screen {
  const closeButton = el('button', { class: 'btn btn--wide', text: ctx.loc.t('common.ok') });
  const askButton = el('button', { class: 'link', text: ctx.loc.t('locked.ask') });
  onTap(closeButton, handlers.onClose);
  onTap(askButton, handlers.onShowGrownUp);

  const node = shell(ctx, 'locked.title', [
    el('div', { class: 'screen__body', text: ctx.loc.t('locked.body') }),
    el('div', { class: 'screen__actions' }, [closeButton]),
    el('div', { class: 'linkrow' }, [askButton]),
  ], { onDismiss: handlers.onClose });

  return { node };
}

/** Simple confirm used by the DevStore so the purchase flow is exercised. */
export function buildConfirmScreen(
  ctx: GameContext,
  titleKey: string,
  bodyText: string,
  onResult: (confirmed: boolean) => void,
): Screen {
  const yes = el('button', { class: 'btn btn--primary', text: ctx.loc.t('common.yes') });
  const no = el('button', { class: 'btn', text: ctx.loc.t('common.cancel') });
  onTap(yes, () => onResult(true));
  onTap(no, () => onResult(false));

  const node = shell(ctx, titleKey, [
    el('p', { class: 'screen__body', text: bodyText }),
    el('div', { class: 'screen__actions' }, [no, yes]),
  ], { onDismiss: () => onResult(false) });

  return { node };
}

export function dismiss(node: HTMLElement): void {
  removeAnimated(node, 'screen--out', 240);
}

export { PRODUCT_FULL_GAME };
