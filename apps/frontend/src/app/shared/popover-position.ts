export type PopoverAlign = 'left' | 'right';

/** Ports app.js's place(): positions a fixed popover against its trigger button, flipping above when it would overflow the viewport bottom. */
export function placePopover(
  pop: HTMLElement,
  btn: HTMLElement,
  matchWidth: boolean,
  align: PopoverAlign = matchWidth ? 'left' : 'right',
): void {
  const rect = btn.getBoundingClientRect();
  if (matchWidth) {
    pop.style.width = `${rect.width}px`;
  }
  const width = pop.offsetWidth;
  const left = Math.max(
    8,
    Math.min(window.innerWidth - width - 8, align === 'right' ? rect.right - width : rect.left),
  );
  let top = rect.bottom + 6;
  const height = pop.offsetHeight;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}
