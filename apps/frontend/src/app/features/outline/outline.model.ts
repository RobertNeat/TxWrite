import { isTextFile } from '../file-tree/file-tree.model.js';

export interface OutlineItem {
  lv: number;
  t: string;
  ln: number;
}

type Mode = 'md' | 'bib' | 'tex';

function modeOf(path: string): Mode {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md') return 'md';
  if (ext === 'bib') return 'bib';
  return 'tex';
}

const TEX_HEADING_LEVEL: Record<string, number> = {
  part: 0,
  chapter: 0,
  section: 0,
  subsection: 1,
  subsubsection: 2,
  paragraph: 3,
};

/** Ports app.js's renderOutline(): current-document-only section list, no cross-file references. */
export function buildOutline(path: string, content: string): OutlineItem[] {
  if (!isTextFile(path)) {
    return [];
  }
  const mode = modeOf(path);
  const items: OutlineItem[] = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (mode === 'md') {
      const m = /^(#{1,6}) (.+)/.exec(line);
      if (m) {
        items.push({ lv: m[1].length - 1, t: m[2], ln: i + 1 });
      }
      return;
    }
    if (mode === 'tex') {
      const m = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\{([^}]*)\}/.exec(
        line,
      );
      if (m) {
        items.push({ lv: TEX_HEADING_LEVEL[m[1]], t: m[2], ln: i + 1 });
      } else if (/\\begin\{abstract\}/.test(line)) {
        items.push({ lv: 0, t: 'Streszczenie', ln: i + 1 });
      } else if (/\\printbibliography/.test(line)) {
        items.push({ lv: 0, t: 'Literatura', ln: i + 1 });
      }
    }
  });
  return items;
}
