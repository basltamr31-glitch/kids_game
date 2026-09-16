import { el } from './dom';
import { dismiss, type Screen } from './Screens';
import type { GameContext } from '../core/GameContext';

/**
 * Owns the DOM overlay: the HUD, the modal stack, and the bedtime fade.
 *
 * Exactly one modal is visible at a time. While any modal is open, world input
 * is suppressed — a child cannot accidentally drive the camera through a
 * settings panel.
 */
export class UIRoot {
  readonly element: HTMLElement;

  private stack: { screen: Screen; id: string }[] = [];
  private fade: HTMLElement;
  private hudSlot: HTMLElement;
  private modalSlot: HTMLElement;
  private onModalCountChanged: ((count: number) => void) | null = null;

  constructor(private ctx: GameContext, mount: HTMLElement) {
    this.hudSlot = el('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    this.modalSlot = el('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    this.fade = el('div', { class: 'fade' });

    const rotateHint = el('div', { class: 'rotate-hint' }, [
      el('div', {}, [
        el('span', { class: 'rotate-hint__icon', text: '📱' }),
        el('div', { text: ctx.loc.t('app.title') }),
      ]),
    ]);

    // pointer-events MUST be none here. `#ui-root > *` turns them back on for
    // direct children, and this element covers the whole screen — leaving it
    // interactive silently swallows every tap meant for the world.
    this.element = el('div', { style: 'position:absolute;inset:0;pointer-events:none' }, [
      this.hudSlot,
      this.modalSlot,
      this.fade,
      rotateHint,
    ]);
    mount.appendChild(this.element);

    // The bedtime fade is driven by an activity step.
    ctx.bus.on('ui:open', ({ screen }) => {
      if (screen === 'fade') this.setFade(true);
    });
  }

  setHud(node: HTMLElement): void {
    this.hudSlot.appendChild(node);
  }

  onModalChange(handler: (count: number) => void): void {
    this.onModalCountChanged = handler;
  }

  get modalCount(): number {
    return this.stack.length;
  }

  /** Pushes a modal. Returns an id that can be used to close it specifically. */
  push(screen: Screen, id = `screen-${this.stack.length}`): string {
    screen.node.style.pointerEvents = 'auto';
    this.modalSlot.appendChild(screen.node);
    this.modalSlot.style.pointerEvents = 'auto';
    this.stack.push({ screen, id });
    this.ctx.bus.emit('ui:open', { screen: id });
    this.onModalCountChanged?.(this.stack.length);
    return id;
  }

  /** Closes the topmost modal, or a specific one by id. */
  pop(id?: string): void {
    const index = id ? this.stack.findIndex((entry) => entry.id === id) : this.stack.length - 1;
    if (index < 0) return;

    const [entry] = this.stack.splice(index, 1);
    entry.screen.onClose?.();
    dismiss(entry.screen.node);

    if (this.stack.length === 0) this.modalSlot.style.pointerEvents = 'none';
    this.ctx.bus.emit('ui:close', { screen: entry.id });
    this.onModalCountChanged?.(this.stack.length);
  }

  popAll(): void {
    while (this.stack.length > 0) this.pop();
  }

  has(id: string): boolean {
    return this.stack.some((entry) => entry.id === id);
  }

  setFade(on: boolean): void {
    this.fade.classList.toggle('on', on);
  }

  dispose(): void {
    this.popAll();
    this.element.remove();
  }
}
