/**
 * Extracts TeX Live file references from source text (architecture.md
 * section 6.4 step 2): \usepackage/\RequirePackage -> .sty, \documentclass ->
 * .cls, \usetikzlibrary -> *.code.tex (tikz's own naming, matching the
 * TIKZ_LIBRARY_FILENAME convention in log-parser.ts), and \setmainfont/
 * \setsansfont/\setmonofont as font-name candidates (no file extension — the
 * resolver treats these as font names, not TeX Live files).
 *
 * Comments (unescaped `%` to end of line) are stripped first so a commented-out
 * \usepackage never queues an install.
 */

export interface ExtractedReferences {
  /** TeX Live files this project appears to need (e.g. "tikz-cd.sty"). */
  files: string[];
  /** Font names referenced via \setmainfont and friends. */
  fonts: string[];
}

const COMMENT_LINE = /(?<!\\)%.*$/gm;

const PACKAGE_COMMAND =
  /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]+)\}/g;
const DOCUMENTCLASS = /\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/g;
const TIKZ_LIBRARY = /\\usetikzlibrary\{([^}]+)\}/g;
const FONT_COMMAND = /\\set(?:main|sans|mono)font\{([^}]+)\}/g;

function splitNames(group: string): string[] {
  return group
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

export function extractReferences(source: string): ExtractedReferences {
  const stripped = source.replace(COMMENT_LINE, '');
  const files = new Set<string>();
  const fonts = new Set<string>();

  for (const match of stripped.matchAll(PACKAGE_COMMAND)) {
    for (const name of splitNames(match[1])) {
      files.add(`${name}.sty`);
    }
  }
  for (const match of stripped.matchAll(DOCUMENTCLASS)) {
    for (const name of splitNames(match[1])) {
      files.add(`${name}.cls`);
    }
  }
  for (const match of stripped.matchAll(TIKZ_LIBRARY)) {
    for (const name of splitNames(match[1])) {
      files.add(`tikzlibrary${name}.code.tex`);
    }
  }
  for (const match of stripped.matchAll(FONT_COMMAND)) {
    fonts.add(match[1].trim());
  }

  return { files: [...files], fonts: [...fonts] };
}
