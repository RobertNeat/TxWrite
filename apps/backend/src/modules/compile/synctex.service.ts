import { Injectable, NotFoundException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { ProjectsService } from '../projects/projects.service.js';
import { CompileRunnerService } from './compile-runner.service.js';

export interface SynctexEditResult {
  path: string;
  line: number;
}

// Matches a `synctex edit` stdout block, e.g.:
// SyncTex result begin
// Output:.../main.pdf
// Page:1
// Input:/cache/work/<id>/main.tex
// Line:13
// Column:-1
// SyncTex result end
const INPUT_LINE = /^Input:(.+)$/m;
const LINE_LINE = /^Line:(\d+)$/m;

function parseSynctexEdit(
  stdout: string,
): { input: string; line: number } | null {
  const inputMatch = INPUT_LINE.exec(stdout);
  const lineMatch = LINE_LINE.exec(stdout);
  if (!inputMatch || !lineMatch) {
    return null;
  }
  return { input: inputMatch[1].trim(), line: Number(lineMatch[1]) };
}

@Injectable()
export class SynctexService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly compileRunner: CompileRunnerService,
  ) {}

  /**
   * Maps a PDF viewport click (page + PDF-point coordinates) back to a
   * project-relative source file + line, via `synctex edit`. Only trusts the
   * resolved path when it falls inside the project's own source directory —
   * the generated intermediate .tex for a Markdown project (or any stray
   * \input from outside the project) must never be exposed as if it were an
   * editable project file.
   */
  async edit(
    projectId: string,
    page: number,
    x: number,
    y: number,
    targetFile?: string,
  ): Promise<SynctexEditResult> {
    const project = this.projectsService.findByIdOrThrow(projectId);
    const pdfPath = this.compileRunner.outputPdfPath(
      projectId,
      targetFile ?? project.mainFile,
    );
    if (!existsSync(pdfPath)) {
      throw new NotFoundException('No compiled PDF for this project yet');
    }

    const stdout = await this.runSynctexEdit(page, x, y, pdfPath);
    const parsed = parseSynctexEdit(stdout);
    if (!parsed) {
      throw new NotFoundException('No source location for this position');
    }

    const projectDir = this.compileRunner.projectDir(projectId);
    const resolvedInput = isAbsolute(parsed.input)
      ? parsed.input
      : join(projectDir, parsed.input);
    const relativePath = relative(projectDir, resolvedInput);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new NotFoundException('Source location is outside the project');
    }

    return { path: relativePath.split('\\').join('/'), line: parsed.line };
  }

  private runSynctexEdit(
    page: number,
    x: number,
    y: number,
    pdfPath: string,
  ): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      execFile(
        'synctex',
        ['edit', '-o', `${page}:${x}:${y}:${pdfPath}`],
        (error, stdout) => {
          // synctex exits non-zero on a miss (click outside any mapped
          // region) as well as on a real error — treat both the same way
          // and let the caller's "no result parsed" check surface the miss.
          if (error && !stdout) {
            reject(error);
            return;
          }
          resolvePromise(stdout);
        },
      );
    });
  }
}
