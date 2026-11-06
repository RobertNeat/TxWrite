const CHARS = 'abcdefghijklmnoprstuwyz0123456789';
const KEEP = ' -_.·';
const DURATION_MS = 850;

function randomChar(c: string): string {
  return KEEP.includes(c) ? c : CHARS[Math.floor(Math.random() * CHARS.length)];
}

/**
 * Ports app.js's scramble(): reveals `el`'s text left-to-right with a brief randomized decode effect.
 *
 * Bug fixed: this used to assign `el.textContent`, which replaces the
 * element's Text node outright. Angular's `{{ }}` interpolation keeps a
 * reference to the original node, so once the scramble ran, every later
 * binding update (switching profiles, logging out) wrote to a node no
 * longer attached to the DOM and the UI went stale. Mutating the existing
 * Text node's `nodeValue` in place keeps Angular's reference valid.
 */
export function scramble(el: HTMLElement, delayMs = 0): void {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const textNode = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
  const final = textNode?.nodeValue ?? '';
  if (reducedMotion || !final || !textNode) {
    return;
  }
  const chars = Array.from(final);
  const thresholds = chars.map((_, i) => (i / chars.length) * 0.55 + Math.random() * 0.45);
  let lastWritten = chars.map(randomChar).join('');
  textNode.nodeValue = lastWritten;
  setTimeout(() => {
    let start: number | null = null;
    const step = (now: number) => {
      // Angular re-rendered the binding mid-animation (e.g. the profile
      // changed again) — stop so we don't stomp the newer value.
      if (textNode.nodeValue !== lastWritten) {
        return;
      }
      if (start === null) {
        start = now;
      }
      const progress = Math.min(1, (now - start) / DURATION_MS);
      lastWritten = chars.map((c, i) => (progress >= thresholds[i] ? c : randomChar(c))).join('');
      textNode.nodeValue = lastWritten;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        textNode.nodeValue = final;
      }
    };
    requestAnimationFrame(step);
  }, delayMs);
}

/** Ports app.js's animateTexts(): staggers scramble() across every `.t` element inside `root`. */
export function scrambleAll(root: HTMLElement, selector = '.t'): void {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
  elements.forEach((el, i) => scramble(el, i * 45));
}
