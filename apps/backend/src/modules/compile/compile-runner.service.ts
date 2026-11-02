import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseCompileLog, type ParsedLog } from './log-parser.js';
import { SvgConverterService } from './svg-converter.service.js';
import { PandocConverterService } from './pandoc-converter.service.js';
import {
  ENGINE_FLAGS,
  isValidEngine,
  isValidMainFile,
} from '../../common/compile-validation.js';

export interface CompileResult extends ParsedLog {
  log: string;
  pdfPath: string | null;
  timedOut: boolean;
}

@Injectable()
export class CompileRunnerService {
  private readonly cacheDir: string;
  private readonly dataDir: string;
  private readonly timeoutMs: number;

  constructor(
    config: ConfigService,
    private readonly svgConverter: SvgConverterService,
    private readonly pandocConverter: PandocConverterService,
  ) {
    this.cacheDir = config.get<string>('CACHE_DIR', './.local-data/cache');
    this.dataDir = config.get<string>('DATA_DIR', './.local-data/data');
    this.timeoutMs = Number(config.get('COMPILE_TIMEOUT_MS', 60000));
  }

  projectDir(projectId: string): string {
    return join(this.dataDir, 'projects', projectId);
  }

  workDir(projectId: string): string {
    return join(this.cacheDir, 'work', projectId);
  }

  /**
   * Runs a single latexmk pass. CWD must be the project directory so relative
   * \input{...} paths resolve; -outdir/-auxdir keep build artifacts in the
   * persistent per-project cache directory instead of /data. TEXINPUTS adds the
   * work directory to kpathsea's search path so generated inputs there (e.g.
   * rsvg-convert SVG->PDF output) are visible to \includegraphics even though CWD
   * is the project directory, not the work directory.
   *
   * If mainFile is Markdown, pandoc first converts it to an intermediate .tex in
   * the work directory (never invoking the LaTeX engine itself — architecture.md
   * section 5.2), which is then compiled through the exact same latexmk pipeline.
   * Pandoc writes \includegraphics paths relative to the Markdown source's own
   * location, so the same cwd/TEXINPUTS setup applies to both .tex and .md
   * projects. See docs/project_assumptons/architecture.md section 5.1.
   *
   * mainFile and engine are expected to already be validated (isValidMainFile /
   * isValidEngine) by the caller at project create/update time, since they
   * ultimately become part of a spawned command line — this is re-checked here as
   * a defensive second gate, not the only one.
   */
  async runOnce(
    projectId: string,
    mainFile: string,
    engine = 'pdflatex',
    options: { forceRebuild?: boolean } = {},
  ): Promise<CompileResult> {
    if (!isValidMainFile(mainFile)) {
      throw new Error(`Invalid main file: ${mainFile}`);
    }
    if (!isValidEngine(engine)) {
      throw new Error(`Invalid engine: ${engine}`);
    }

    const projectDir = this.projectDir(projectId);
    const workDir = this.workDir(projectId);
    mkdirSync(workDir, { recursive: true });

    await this.svgConverter.convertAll(projectDir, workDir);

    const isMarkdown = /\.md$/i.test(mainFile);
    const baseName = basename(mainFile).replace(/\.(tex|md)$/i, '');
    let texFileForLatexmk = mainFile;

    let pandocDiagnostic: string | null = null;
    if (isMarkdown) {
      const generatedTexPath = join(workDir, `${baseName}.tex`);
      try {
        await this.pandocConverter.convertToTex(
          projectDir,
          mainFile,
          generatedTexPath,
        );
        texFileForLatexmk = generatedTexPath;
      } catch (error) {
        pandocDiagnostic =
          error instanceof Error ? error.message : String(error);
      }
    }

    if (pandocDiagnostic) {
      return {
        success: false,
        diagnostics: [{ severity: 'error', message: pandocDiagnostic }],
        missingFiles: [],
        log: '',
        pdfPath: null,
        timedOut: false,
      };
    }

    const texinputs = `.:${workDir}//:`;
    const engineFlag = ENGINE_FLAGS[engine];

    const logPath = join(workDir, `${baseName}.log`);
    const pdfPath = join(workDir, `${baseName}.pdf`);
    // Record the .log's mtime (if any) *before* spawning, so a failure that never
    // touches it (verified: latexmk exits non-zero with no new .log when its main
    // file is missing) can be told apart from this run's own fresh log, instead of
    // silently reporting success/diagnostics from a stale previous compile.
    const logMtimeBefore = existsSync(logPath)
      ? statSync(logPath).mtimeMs
      : null;

    const { exitCode, timedOut, outputTail } = await this.spawnLatexmk(
      projectDir,
      workDir,
      texFileForLatexmk,
      texinputs,
      engineFlag,
      options.forceRebuild ?? false,
    );

    const logWasRefreshed =
      existsSync(logPath) &&
      (logMtimeBefore === null || statSync(logPath).mtimeMs > logMtimeBefore);

    if (!logWasRefreshed) {
      // latexmk can legitimately skip rebuilding and never touch the .log when
      // sources are unchanged since the last successful compile ("Nothing to
      // do" / "up-to-date", exit 0) — that is a real success, just not one that
      // produced a fresh log this run, so fall through to report the existing
      // PDF rather than treating it as a failure. A genuine failure before
      // latexmk gets far enough to write a log (e.g. missing main file) always
      // exits non-zero, so only that case is reported as an error here.
      const pdfProduced = existsSync(pdfPath);
      if (exitCode === 0 && !timedOut && pdfProduced) {
        const existingLog = existsSync(logPath)
          ? readFileSync(logPath, 'utf8')
          : '';
        return {
          success: true,
          diagnostics: [],
          missingFiles: [],
          log: existingLog,
          pdfPath,
          timedOut: false,
        };
      }

      return {
        success: false,
        diagnostics: outputTail
          ? [{ severity: 'error', message: outputTail }]
          : [],
        missingFiles: [],
        log: outputTail,
        pdfPath: null,
        timedOut,
      };
    }

    const log = readFileSync(logPath, 'utf8');
    const pdfProduced = existsSync(pdfPath);
    const parsed = parseCompileLog(log, pdfProduced);

    return {
      ...parsed,
      success: exitCode === 0 && !timedOut,
      log,
      pdfPath: pdfProduced ? pdfPath : null,
      timedOut,
    };
  }

  private spawnLatexmk(
    cwd: string,
    workDir: string,
    mainFile: string,
    texinputs: string,
    engineFlag: string,
    forceRebuild: boolean,
  ): Promise<{
    exitCode: number | null;
    timedOut: boolean;
    outputTail: string;
  }> {
    return new Promise((resolvePromise) => {
      const child = spawn(
        'latexmk',
        [
          '-norc',
          engineFlag,
          '-shell-restricted',
          `-outdir=${workDir}`,
          `-auxdir=${workDir}`,
          '-interaction=nonstopmode',
          '-file-line-error',
          // After a lazy package install, the source files haven't changed, so
          // latexmk may otherwise decide the existing output is already
          // up-to-date and skip rebuilding — even though the previous attempt
          // failed because the package was missing. -g forces a fresh pass on
          // a retry so the newly-installed package actually gets picked up.
          ...(forceRebuild ? ['-g'] : []),
          mainFile,
        ],
        {
          cwd,
          detached: true,
          // 'pipe' with nothing reading it deadlocks once the OS pipe buffer
          // fills (latexmk echoes the full transcript of every pass to stdout) —
          // verified: a document that prints ~300KB to stdout hung until the
          // timeout killed it. Drain both streams instead, keeping only a bounded
          // tail for diagnostics (the authoritative output is the .log file).
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            TEXINPUTS: texinputs,
            max_print_line: '10000',
          },
        },
      );

      // Drain both streams so the OS pipe buffer never fills and blocks the
      // child (latexmk echoes the full transcript of every pass to stdout) —
      // verified: a document that prints ~300KB to stdout hung until the
      // timeout killed it with nothing reading the pipe. Keep a bounded tail:
      // the .log file is the authoritative transcript when latexmk gets far
      // enough to write one, but when it fails before that (e.g. main file
      // missing), this tail is the only diagnostic available.
      const tail = new BoundedTail(8192);
      child.stdout?.on('data', (chunk: Buffer) => tail.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => tail.push(chunk));

      let settled = false;
      let timedOut = false;
      const timeout = setTimeout(() => {
        if (child.pid && !settled) {
          timedOut = true;
          try {
            // Negative pid signals the whole process group, killing latexmk's
            // spawned xelatex/pdflatex children too, not just the latexmk wrapper.
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // Process group may already be gone.
          }
        }
      }, this.timeoutMs);

      child.on('exit', (exitCode) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolvePromise({ exitCode, timedOut, outputTail: tail.toString() });
        }
      });

      child.on('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolvePromise({
            exitCode: null,
            timedOut,
            outputTail: tail.toString(),
          });
        }
      });
    });
  }
}

/** Keeps only the last `maxBytes` written, for a bounded diagnostic tail. */
class BoundedTail {
  private buffer = '';

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    if (this.buffer.length > this.maxBytes) {
      this.buffer = this.buffer.slice(-this.maxBytes);
    }
  }

  toString(): string {
    return this.buffer;
  }
}
