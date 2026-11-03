export type EditorMode = 'tex' | 'md';

export interface TextSelection {
  from: number;
  to: number;
}

export interface EditResult {
  text: string;
  from: number;
  to: number;
  /** Selection to apply after the replacement, relative to the full new document. */
  selectionFrom: number;
  selectionTo: number;
}

/** Ports app.js's modeOf(): everything except .md/.bib is treated as tex. */
export function modeFor(path: string): EditorMode {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'md' ? 'md' : 'tex';
}

const CURSOR_MARKER = '\u2038'; // '‸'

/** Ports app.js's TPL table verbatim. */
export const TEMPLATES: Record<EditorMode, Record<string, string>> = {
  tex: {
    bold: `\\textbf{${CURSOR_MARKER}}`,
    italic: `\\textit{${CURSOR_MARKER}}`,
    ref: `\\ref{${CURSOR_MARKER}}`,
    cite: `\\cite{${CURSOR_MARKER}}`,
    ul: `\\begin{itemize}\n  \\item ${CURSOR_MARKER}\n\\end{itemize}`,
    ol: `\\begin{enumerate}\n  \\item ${CURSOR_MARKER}\n\\end{enumerate}`,
    inline: `$${CURSOR_MARKER}$`,
    display: `\\begin{equation}\n  ${CURSOR_MARKER}\n\\end{equation}`,
  },
  md: {
    bold: `**${CURSOR_MARKER}**`,
    italic: `*${CURSOR_MARKER}*`,
    ref: `[${CURSOR_MARKER}](#etykieta)`,
    cite: `[@${CURSOR_MARKER}]`,
    ul: `- ${CURSOR_MARKER}`,
    ol: `1. ${CURSOR_MARKER}`,
    inline: `$${CURSOR_MARKER}$`,
    display: `$$\n${CURSOR_MARKER}\n$$`,
  },
};

/** Ports app.js's pad(): block inserts start on their own line if the cursor sits mid-line. */
function pad(doc: string, from: number, to: number, block: boolean | undefined): [string, string] {
  if (!block) {
    return ['', ''];
  }
  const before = from > 0 && doc[from - 1] !== '\n' ? '\n' : '';
  const after = to < doc.length && doc[to] !== '\n' ? '\n' : '';
  return [before, after];
}

/** Ports app.js's insertRaw(). */
export function insertRaw(
  doc: string,
  sel: TextSelection,
  text: string,
  caret: number | null,
  block?: boolean,
): EditResult {
  const [padBefore, padAfter] = pad(doc, sel.from, sel.to, block);
  const inserted = padBefore + text + padAfter;
  const newText = doc.slice(0, sel.from) + inserted + doc.slice(sel.to);
  const caretPos = caret != null ? sel.from + padBefore.length + caret : sel.from + inserted.length;
  return {
    text: newText,
    from: sel.from,
    to: sel.to,
    selectionFrom: caretPos,
    selectionTo: caretPos,
  };
}

/** Ports app.js's insertTpl(): templates with a '‸' cursor marker wrap the current selection. */
export function insertTemplate(
  doc: string,
  sel: TextSelection,
  tpl: string,
  block?: boolean,
): EditResult {
  const markerIndex = tpl.indexOf(CURSOR_MARKER);
  if (markerIndex < 0) {
    return insertRaw(doc, sel, tpl, null, block);
  }
  const [padBefore, padAfter] = pad(doc, sel.from, sel.to, block);
  const before = padBefore + tpl.slice(0, markerIndex);
  const after = tpl.slice(markerIndex + 1) + padAfter;
  const selectedText = doc.slice(sel.from, sel.to);
  const newText = doc.slice(0, sel.from) + before + selectedText + after + doc.slice(sel.to);
  const selectionFrom = sel.from + before.length;
  const selectionTo = selectedText ? selectionFrom + selectedText.length : selectionFrom;
  return { text: newText, from: sel.from, to: sel.to, selectionFrom, selectionTo };
}

/** Ports app.js's insertLink(): href for tex, inline-link syntax for md. */
export function insertLink(doc: string, sel: TextSelection, mode: EditorMode): EditResult {
  const selectedText = doc.slice(sel.from, sel.to);
  if (mode === 'md') {
    return insertRaw(doc, sel, `[${selectedText}](url)`, selectedText.length + 3);
  }
  return insertRaw(doc, sel, `\\href{}{${selectedText}}`, 6);
}

const HEADING_LEVELS = ['section', 'subsection', 'subsubsection', 'paragraph'] as const;
export type HeadingLevel = 'normal' | (typeof HEADING_LEVELS)[number];

export const MD_HEADING_PREFIX: Record<Exclude<HeadingLevel, 'normal'>, string> = {
  section: '#',
  subsection: '##',
  subsubsection: '###',
  paragraph: '####',
};

const TEX_HEADING_RE =
  /^(\s*)\\(section|subsection|subsubsection|paragraph|subparagraph)\*?\{(.*)\}\s*$/;

/** Ports app.js's lineBounds(): the full line (no trailing newline) containing `pos`. */
export function lineBounds(doc: string, pos: number): [number, number] {
  const lineStart = pos === 0 ? 0 : doc.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = doc.indexOf('\n', pos);
  if (lineEnd < 0) {
    lineEnd = doc.length;
  }
  return [lineStart, lineEnd];
}

/** Ports app.js's lineLevel(): the heading level of the line the cursor is on. */
export function lineLevel(doc: string, pos: number, mode: EditorMode): HeadingLevel {
  const [start, end] = lineBounds(doc, pos);
  const line = doc.slice(start, end);
  if (mode === 'md') {
    const m = /^\s*(#{1,6})\s/.exec(line);
    if (!m) {
      return 'normal';
    }
    const levels: HeadingLevel[] = [
      'section',
      'subsection',
      'subsubsection',
      'paragraph',
      'paragraph',
      'paragraph',
    ];
    return levels[m[1].length - 1];
  }
  const m = TEX_HEADING_RE.exec(line);
  if (!m) {
    return 'normal';
  }
  return m[2] === 'subparagraph' ? 'paragraph' : (m[2] as HeadingLevel);
}

/** Ports app.js's applyHeading(): rewrites only the cursor's line. */
export function applyHeading(
  doc: string,
  pos: number,
  mode: EditorMode,
  level: HeadingLevel,
): EditResult {
  const [lineStart, lineEnd] = lineBounds(doc, pos);
  const line = doc.slice(lineStart, lineEnd);
  let out: string;
  let inner: string;
  if (mode === 'md') {
    inner = line.replace(/^\s*#{1,6}\s+/, '');
    out = level === 'normal' ? inner : `${MD_HEADING_PREFIX[level]} ${inner}`;
  } else {
    const m = TEX_HEADING_RE.exec(line);
    inner = m ? m[3] : line.trim();
    out = level === 'normal' ? inner : `\\${level}{${inner}}`;
  }
  const newText = doc.slice(0, lineStart) + out + doc.slice(lineEnd);
  let caret = lineStart + out.length;
  if (mode !== 'md' && level !== 'normal' && !inner) {
    caret -= 1;
  }
  return { text: newText, from: lineStart, to: lineEnd, selectionFrom: caret, selectionTo: caret };
}

/** Ports app.js's insertTable(): tex uses the exact 4-space-indented template string. */
export function insertTable(
  doc: string,
  sel: TextSelection,
  mode: EditorMode,
  rows: number,
  cols: number,
): EditResult {
  if (mode === 'md') {
    const cell = (fill: string) => `|${Array(cols + 1).join(` ${fill} |`)}`;
    const head = cell(' ');
    const separator = `|${Array(cols + 1).join('---|')}`;
    const bodyRows: string[] = [head, separator];
    for (let r = 1; r < rows; r++) {
      bodyRows.push(cell(' '));
    }
    return insertRaw(doc, sel, bodyRows.join('\n'), null, true);
  }
  const row = `    ${Array(cols).fill(' ').join('&')} \\\\`;
  const bodyRows = Array(rows).fill(row);
  const table =
    `\\begin{table}\n    \\centering\n    \\begin{tabular}{${Array(cols + 1).join('c')}}\n` +
    `${bodyRows.join('\n')}\n    \\end{tabular}\n    \\caption{Caption}\n    \\label{tab:placeholder}\n\\end{table}`;
  return insertRaw(doc, sel, table, null, true);
}

/** Ports app.js's insertFigure(). */
export function insertFigure(
  doc: string,
  sel: TextSelection,
  mode: EditorMode,
  path: string,
): EditResult {
  if (mode === 'md') {
    return insertRaw(doc, sel, `![](${path})`, 2);
  }
  return insertRaw(
    doc,
    sel,
    `\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{${path}}\n  \\caption{Caption}\n  \\label{fig:placeholder}\n\\end{figure}`,
    null,
    true,
  );
}
