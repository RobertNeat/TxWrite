export interface CompileDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  /** The error/warning kind as TeX itself names it (e.g. "LaTeX Error", "Package tikz Error"), when the message has that form. */
  errorType?: string;
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

// TeX's own generic follow-up boilerplate after a real error has already been
// reported (with its own message, usually via FILE_LINE_ERROR/BARE_ERROR just
// above) — carries no information of its own (no file, no line, no specifics),
// so surfacing it as a second "diagnostic" just repeats "something went
// wrong" without saying what. Verified against a real compile's raw log:
// these appear as "! Emergency stop." and "! ==> Fatal error occurred, no
// output PDF file produced!" (the leading space before "==>" is real TeX
// output, not a formatting artifact here).
const GENERIC_FOLLOWUP = /^(Emergency stop\.|\s*==> Fatal error occurred,.*)$/;

// TeX/LaTeX's own convention for naming an error/warning kind: "<Type> Error: <detail>"
// or "<Type> Warning: <detail>" (e.g. "LaTeX Error: ...", "Package tikz Error: ...",
// "pdfTeX warning: ..."). Only messages that actually have this shape get split; a
// message like "Undefined control sequence." has no such prefix and is left as-is
// rather than guessing a type for it.
const ERROR_TYPE_PREFIX = /^(.+? (?:[Ee]rror|[Ww]arning)): (.+)$/;

function splitErrorType(message: string): {
  errorType?: string;
  message: string;
} {
  const match = ERROR_TYPE_PREFIX.exec(message);
  if (!match) {
    return { message };
  }
  return { errorType: match[1], message: match[2] };
}

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
      diagnostics.push({
        severity: 'error',
        ...splitErrorType(line.trim().replace(/^!\s*/, '')),
      });
      continue;
    }

    const fileLineMatch = FILE_LINE_ERROR.exec(line);
    if (fileLineMatch) {
      if (!GENERIC_FOLLOWUP.test(fileLineMatch[3])) {
        diagnostics.push({
          severity: 'error',
          file: fileLineMatch[1],
          line: Number(fileLineMatch[2]),
          ...splitErrorType(fileLineMatch[3]),
        });
      }

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
    if (bareErrorMatch && !GENERIC_FOLLOWUP.test(bareErrorMatch[1])) {
      diagnostics.push({
        severity: 'error',
        ...splitErrorType(bareErrorMatch[1]),
      });
    }
  }

  return {
    success: pdfProduced && diagnostics.length === 0,
    diagnostics,
    missingFiles,
  };
}
