/**
 * Tiny DOM helpers.
 *
 * The UI is plain DOM on top of the WebGL canvas rather than a framework or
 * in-world 3D panels. That gives crisp text at every density for free, real
 * accessibility semantics, and native scrolling — all things a 3D-rendered UI
 * would have to reimplement badly.
 */

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('data-') || key.startsWith('aria-')) {
      node.setAttribute(key, String(value));
    } else if (key === 'style') node.setAttribute('style', String(value));
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * Attaches a tap handler that is safe for touch.
 *
 * `click` alone has a 300ms delay on some Android WebViews and fires after a
 * scroll; this listens to pointerup and verifies the pointer did not travel,
 * which is what makes buttons feel instant to a child.
 */
export function onTap(node: HTMLElement, handler: (event: PointerEvent) => void): () => void {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const down = (event: PointerEvent): void => {
    tracking = true;
    startX = event.clientX;
    startY = event.clientY;
  };
  const up = (event: PointerEvent): void => {
    if (!tracking) return;
    tracking = false;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 14) return;
    event.preventDefault();
    handler(event);
  };
  const cancel = (): void => {
    tracking = false;
  };

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);

  return () => {
    node.removeEventListener('pointerdown', down);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', cancel);
    node.removeEventListener('pointerleave', cancel);
  };
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Removes a node after an exit animation class has played. */
export function removeAnimated(node: HTMLElement, outClass: string, ms: number): void {
  node.classList.add(outClass);
  window.setTimeout(() => node.remove(), ms);
}
