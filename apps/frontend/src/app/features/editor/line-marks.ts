import { EditorView, GutterMarker, gutterLineClass } from '@codemirror/view';
import { RangeSet, StateEffect, StateField } from '@codemirror/state';

/**
 * Session-scoped "I want to edit this line" markers, toggled by clicking a
 * line number. Deliberately not a text decoration (no change to
 * .cm-content) — just a gutter-width visual flag, cheap to maintain.
 *
 * Storage is plain `line numbers per (projectId, path)` behind
 * LineMarkStore so a future milestone can swap the in-memory Map for a
 * backend-persisted store without touching the CodeMirror wiring below —
 * only loadMarks()/apply() need a new implementation.
 */
export interface LineMarkStore {
  loadMarks(key: string): number[];
  saveMarks(key: string, lines: number[]): void;
}

/** In-memory only: markers don't survive a page refresh, as requested. */
export class InMemoryLineMarkStore implements LineMarkStore {
  private readonly marksByKey = new Map<string, number[]>();

  loadMarks(key: string): number[] {
    return this.marksByKey.get(key) ?? [];
  }

  saveMarks(key: string, lines: number[]): void {
    if (lines.length === 0) {
      this.marksByKey.delete(key);
      return;
    }
    this.marksByKey.set(key, lines);
  }
}

const markedLineMarker = new (class extends GutterMarker {
  override elementClass = 'cm-line-mark';
})();

const hoveredLineMarker = new (class extends GutterMarker {
  override elementClass = 'cm-line-hover';
})();

export const toggleLineMark = StateEffect.define<number>(); // carries a line-start doc position
const setHoveredLine = StateEffect.define<number | null>(); // carries a line-start doc position, or null

const markedLinesField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let marks = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(toggleLineMark)) {
        continue;
      }
      const pos = effect.value;
      let alreadyMarked = false;
      marks.between(pos, pos, () => {
        alreadyMarked = true;
        return false;
      });
      marks = alreadyMarked
        ? marks.update({ filter: (from) => from !== pos })
        : marks.update({ add: [markedLineMarker.range(pos)] });
    }
    return marks;
  },
  provide: (field) => gutterLineClass.from(field),
});

const hoveredLineField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let hovered = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setHoveredLine)) {
        continue;
      }
      hovered =
        effect.value === null ? RangeSet.empty : RangeSet.of(hoveredLineMarker.range(effect.value));
    }
    return hovered;
  },
  provide: (field) => gutterLineClass.from(field),
});

/** Current marked-line start positions, for persisting before a file switch. */
export function getMarkedLines(view: EditorView): number[] {
  const lines: number[] = [];
  view.state.field(markedLinesField, false)?.between(0, view.state.doc.length, (from) => {
    lines.push(view.state.doc.lineAt(from).number);
  });
  return lines;
}

function markEffectsFor(view: EditorView, lineNumbers: number[]): StateEffect<number>[] {
  const docLines = view.state.doc.lines;
  return lineNumbers
    .filter((n) => n >= 1 && n <= docLines)
    .map((n) => toggleLineMark.of(view.state.doc.line(n).from));
}

/** Field + styling for the gutter line-mark feature. Call seedLineMarks() after creating the view to restore saved marks. */
export const lineMarksExtension = [
  markedLinesField,
  hoveredLineField,
  EditorView.theme({
    '.cm-gutters': { cursor: 'pointer' },
    // CodeMirror's default .cm-lineNumbers .cm-gutterElement only spans the
    // numeral's own width (min-width: 20px) — widen it to fill the gutter
    // column so the hover/mark highlight (and the visible click target)
    // covers the full cm-gutters width, not just the digits.
    '.cm-lineNumbers .cm-gutterElement': { width: '100%', boxSizing: 'border-box' },
    '.cm-line-hover': { backgroundColor: 'var(--tint)' },
    '.cm-line-mark': { backgroundColor: 'var(--tint2)', color: 'var(--navy)', fontWeight: '600' },
  }),
];

/** Restores previously saved marked lines onto a freshly created document state. */
export function seedLineMarks(view: EditorView, lineNumbers: number[]): void {
  const effects = markEffectsFor(view, lineNumbers);
  if (effects.length) {
    view.dispatch({ effects });
  }
}

/** Wires click-to-toggle and hover-highlight on the gutter, without touching .cm-content selection. */
export function attachLineMarkHandlers(view: EditorView): () => void {
  const onMouseDown = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (!target.closest('.cm-gutters')) {
      return;
    }
    // Only this specific clicked cell, not the whole .cm-foldGutter column
    // (whose aggregate textContent is non-empty as soon as ANY line in the
    // file has a fold arrow, which wrongly blocked clicks on every other
    // line's empty fold cell too).
    const foldCell = target.closest('.cm-foldGutter .cm-gutterElement');
    if (foldCell && foldCell.textContent?.trim()) {
      return; // let a fold-arrow click fold, don't also toggle the mark
    }
    const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
    event.preventDefault();
    view.dispatch({ effects: toggleLineMark.of(block.from) });
  };

  let lastHoveredLine = -1;
  const clearHover = (): void => {
    if (lastHoveredLine === -1) {
      return;
    }
    lastHoveredLine = -1;
    view.dispatch({ effects: setHoveredLine.of(null) });
  };
  const onMouseMove = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (!target.closest('.cm-gutters')) {
      // Moving from the gutter onto .cm-content (or anywhere else inside
      // scrollDOM) doesn't fire a gutter-specific mouseleave, so the stale
      // highlight would otherwise stick until the next gutter hover.
      clearHover();
      return;
    }
    const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
    if (block.from === lastHoveredLine) {
      return;
    }
    lastHoveredLine = block.from;
    view.dispatch({ effects: setHoveredLine.of(block.from) });
  };

  const onMouseLeave = (): void => clearHover();

  view.scrollDOM.addEventListener('mousedown', onMouseDown);
  view.scrollDOM.addEventListener('mousemove', onMouseMove);
  view.scrollDOM.addEventListener('mouseleave', onMouseLeave);

  return () => {
    view.scrollDOM.removeEventListener('mousedown', onMouseDown);
    view.scrollDOM.removeEventListener('mousemove', onMouseMove);
    view.scrollDOM.removeEventListener('mouseleave', onMouseLeave);
  };
}
