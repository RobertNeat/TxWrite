export interface CompileDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
}

export interface MissingFile {
  fileName: string;
}

export interface ParsedLog {
  success: boolean;
  diagnostics: CompileDiagnostic[];
  missingFiles: MissingFile[];
}

// Matches `-file-line-error` output: "<file>:<line>: <message>".
const FILE_LINE_ERROR = /^(.+?):(\d+): (.+)$/;

// Matches "! LaTeX Error: File `foo.sty' not found." (and bare "File `foo.sty' not found"
// text from other engines/contexts) — this form has no file:line prefix.
const MISSING_FILE = /File [`']([^'`]+)' not found/;

// Matches tikz's "I did not find the tikz library 'cd'." error (architecture.md
// section 6.2's own tikzlibrarycd.code.tex example). With max_print_line set wide
// enough (compile-runner.service.ts sets 10000), this stays on one physical line
// alongside the file:line prefix; without it, TeX's default ~79-column wrap can
// split it mid-message onto the next line at an arbitrary point — checked for in
// both places. Captures the first (TikZ-native) of the two candidate filenames
// tikz reports; package resolution only needs one.
const TIKZ_LIBRARY_ERROR =
  /Package tikz Error: I did not find the tikz library/;
const TIKZ_LIBRARY_FILENAME = /files named (\S+\.code\.tex)/;

// Matches "! LaTeX Error: ..." / "! Undefined control sequence." style bare "!" errors
// that don't have a file:line prefix (e.g. emergency stops before TeX knows a location).
const BARE_ERROR = /^! (.+)$/;

/**
 * Parses a latexmk/*latex log (compiled with -file-line-error -interaction=nonstopmode)
 * into structured diagnostics. Built from real logs captured against the pinned
 * toolchain, not an assumed format — see __fixtures__/*.log.
 */
export function parseCompileLog(log: string, pdfProduced: boolean): ParsedLog {
  const diagnostics: CompileDiagnostic[] = [];
  const missingFiles: MissingFile[] = [];
  const seenMissingFiles = new Set<string>();

  const lines = log.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const missingFileMatch = MISSING_FILE.exec(line);
    if (missingFileMatch) {
      const fileName = missingFileMatch[1];
      if (!seenMissingFiles.has(fileName)) {
        seenMissingFiles.add(fileName);
        missingFiles.push({ fileName });
      }
      diagnostics.push({ severity: 'error', message: line.trim() });
      continue;
    }

    const fileLineMatch = FILE_LINE_ERROR.exec(line);
    if (fileLineMatch) {
      diagnostics.push({
        severity: 'error',
        file: fileLineMatch[1],
        line: Number(fileLineMatch[2]),
        message: fileLineMatch[3],
      });

      // tikz's "library not found" error names the candidate filenames
      // (tikzlibrarycd.code.tex, pgflibrarycd.code.tex) in the same message
      // when max_print_line is wide enough not to wrap it; check the next
      // physical line too in case it still wrapped.
      if (TIKZ_LIBRARY_ERROR.test(fileLineMatch[3])) {
        const filenameMatch =
          TIKZ_LIBRARY_FILENAME.exec(fileLineMatch[3]) ??
          TIKZ_LIBRARY_FILENAME.exec(lines[i + 1] ?? '');
        if (filenameMatch) {
          const fileName = filenameMatch[1];
          if (!seenMissingFiles.has(fileName)) {
            seenMissingFiles.add(fileName);
            missingFiles.push({ fileName });
          }
        }
      }
      continue;
    }

    const bareErrorMatch = BARE_ERROR.exec(line);
    if (bareErrorMatch) {
      diagnostics.push({ severity: 'error', message: bareErrorMatch[1] });
    }
  }

  return {
    success: pdfProduced && diagnostics.length === 0,
    diagnostics,
    missingFiles,
  };
}
