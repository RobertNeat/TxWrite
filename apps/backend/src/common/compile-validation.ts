export const ENGINE_FLAGS: Record<string, string> = {
  pdflatex: '-pdf',
  xelatex: '-xelatex',
  lualatex: '-lualatex',
};

// Main file must be a plain basename-safe relative path ending in .tex/.md — no
// directory traversal, no path that could collide with latexmk's/pandoc's own
// "-foo" option parsing (a mainFile of "-pdflatex=..." must never reach a spawned
// command line unescaped).
const MAIN_FILE_PATTERN = /^[A-Za-z0-9_.-][A-Za-z0-9_./-]*\.(tex|md)$/i;

export function isValidMainFile(mainFile: string): boolean {
  return (
    MAIN_FILE_PATTERN.test(mainFile) &&
    !mainFile.includes('..') &&
    !mainFile.startsWith('-')
  );
}

export function isValidEngine(engine: string): boolean {
  return engine in ENGINE_FLAGS;
}
