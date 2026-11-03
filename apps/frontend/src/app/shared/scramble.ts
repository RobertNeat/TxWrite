const CHARS = 'abcdefghijklmnoprstuwyz0123456789';
const KEEP = ' -_.·';
const DURATION_MS = 850;

function randomChar(c: string): string {
  return KEEP.includes(c) ? c : CHARS[Math.floor(Math.random() * CHARS.length)];
}

/** Ports app.js's scramble(): reveals `el`'s text left-to-right with a brief randomized decode effect. */
export function scramble(el: HTMLElement, delayMs = 0): void {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const final = el.textContent ?? '';
  if (reducedMotion || !final) {
    return;
  }
  const chars = Array.from(final);
  const thresholds = chars.map((_, i) => (i / chars.length) * 0.55 + Math.random() * 0.45);
  el.textContent = chars.map(randomChar).join('');
  setTimeout(() => {
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) {
        start = now;
      }
      const progress = Math.min(1, (now - start) / DURATION_MS);
      el.textContent = chars
        .map((c, i) => (progress >= thresholds[i] ? c : randomChar(c)))
        .join('');
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = final;
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
