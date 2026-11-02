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
  for (const line of lines) {
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
