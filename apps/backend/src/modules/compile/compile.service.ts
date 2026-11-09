import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectsService } from '../projects/projects.service.js';
import { EventBusService } from '../events/event-bus.service.js';
import { isValidMainFile } from '../../common/compile-validation.js';
import {
  ResourceResolverService,
  type InstallOutcome,
} from '../resource-resolver/resource-resolver.service.js';
import {
  FontResolverService,
  type FontResolutionOutcome,
} from '../resource-resolver/font-resolver.service.js';
import { CompileQueueService } from './compile-queue.service.js';
import {
  CompileRunnerService,
  type CompileResult,
} from './compile-runner.service.js';

export interface CompileResultWithInstalls extends CompileResult {
  installs: InstallOutcome[];
  fontResolutions: FontResolutionOutcome[];
}

@Injectable()
export class CompileService {
  private readonly retryBudgetMs: number;

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly compileQueue: CompileQueueService,
    private readonly compileRunner: CompileRunnerService,
    private readonly resourceResolver: ResourceResolverService,
    private readonly fontResolver: FontResolverService,
    private readonly eventBus: EventBusService,
    config: ConfigService,
  ) {
    this.retryBudgetMs = Number(config.get('COMPILE_RETRY_BUDGET_MS', 120000));
  }

  async compile(
    projectId: string,
    targetFile?: string,
  ): Promise<CompileResultWithInstalls> {
    const project = this.projectsService.findByIdOrThrow(projectId);
    const mainFile = this.resolveTargetFile(
      projectId,
      project.mainFile,
      targetFile,
    );

    return this.compileQueue.run(projectId, async () => {
      this.eventBus.emit({ type: 'compile.started', projectId });
      try {
        const result = await this.compileWithRetry(projectId, {
          mainFile,
          engine: project.engine,
        });
        this.eventBus.emit({
          type: 'compile.finished',
          projectId,
          payload: {
            success: result.success,
            timedOut: result.timedOut,
            diagnosticCount: result.diagnostics.length,
          },
        });
        return result;
      } catch (error) {
        this.eventBus.emit({
          type: 'compile.finished',
          projectId,
          payload: { success: false, timedOut: false, diagnosticCount: 0 },
        });
        throw error;
      }
    });
  }

  /**
   * Reactive retry loop (architecture.md section 5.3): on a missing-package
   * or missing-font error, resolve and install it, then retry. Capped by "no
   * new package/font resolved in the last iteration" or a time budget — not
   * a fixed iteration count, since a single template can need many packages
   * resolved one miss at a time (section 6.2). Each package/font is
   * attempted at most once per compile (section 6.7: stop retrying within one
   * compile), so one that resolves but still fails to install can't spin the
   * loop until the time budget runs out.
   */
  private async compileWithRetry(
    projectId: string,
    project: { mainFile: string; engine: string },
  ): Promise<CompileResultWithInstalls> {
    const deadline = Date.now() + this.retryBudgetMs;
    const attemptedFiles = new Set<string>();
    const attemptedFonts = new Set<string>();
    const installs: InstallOutcome[] = [];
    const fontResolutions: FontResolutionOutcome[] = [];

    let result = await this.compileRunner.runOnce(
      projectId,
      project.mainFile,
      project.engine,
    );

    while (!result.success && !result.timedOut && Date.now() < deadline) {
      const unattemptedFiles = result.missingFiles.filter(
        ({ fileName }) => !attemptedFiles.has(fileName),
      );
      const unattemptedFonts = result.missingFonts.filter(
        ({ fontName }) => !attemptedFonts.has(fontName),
      );
      if (unattemptedFiles.length === 0 && unattemptedFonts.length === 0) {
        break;
      }

      let resolvedAny = false;
      for (const { fileName } of unattemptedFiles) {
        attemptedFiles.add(fileName);
        const outcome = await this.resourceResolver.resolveAndInstall(
          fileName,
          projectId,
        );
        if (outcome) {
          installs.push(outcome);
          if (outcome.installed) {
            resolvedAny = true;
          }
        }
      }
      for (const { fontName } of unattemptedFonts) {
        attemptedFonts.add(fontName);
        const outcome = await this.fontResolver.resolveFont(
          fontName,
          projectId,
        );
        fontResolutions.push(outcome);
        if (outcome.resolved) {
          resolvedAny = true;
        }
      }

      if (!resolvedAny) {
        // Nothing new was resolved this iteration — every missing
        // file/font either isn't resolvable or failed to install. Retrying
        // would just reproduce the same error, so stop here.
        break;
      }

      // Force a fresh latexmk pass: sources are unchanged, so without -g
      // latexmk may consider the existing (failed) output "up to date" and
      // skip rebuilding even though something was just installed.
      result = await this.compileRunner.runOnce(
        projectId,
        project.mainFile,
        project.engine,
        { forceRebuild: true },
      );
    }

    return { ...result, installs, fontResolutions };
  }

  outputPdfPath(projectId: string, targetFile?: string): string {
    const project = this.projectsService.findByIdOrThrow(projectId);
    const mainFile = this.resolveTargetFile(
      projectId,
      project.mainFile,
      targetFile,
    );
    return this.compileRunner.outputPdfPath(projectId, mainFile);
  }

  /** Resolves ?file= (or the project's mainFile) for a given project, validated/existence-checked. */
  exportTargetFile(projectId: string, targetFile?: string): string {
    const project = this.projectsService.findByIdOrThrow(projectId);
    return this.resolveTargetFile(projectId, project.mainFile, targetFile);
  }

  /**
   * An explicit ?file= override lets the UI compile the file currently open
   * in the editor instead of always the project's configured main file (user
   * request: "powinien kompilowac się plik aktualnie otwarty jeśli ma
   * rozszerzenie tex albo md"). Falls back to project.mainFile when absent.
   * Validated the same way mainFile is (isValidMainFile) plus an existence
   * check against the project dir, since this one isn't vetted at project
   * create/update time like mainFile is. Also reused by export (UI overhaul)
   * so ?file= behaves identically across compile/output.pdf/synctex/export.
   */
  resolveTargetFile(
    projectId: string,
    projectMainFile: string,
    targetFile?: string,
  ): string {
    if (targetFile === undefined) {
      return projectMainFile;
    }
    if (!isValidMainFile(targetFile)) {
      throw new BadRequestException(`Invalid target file: ${targetFile}`);
    }
    const absolutePath = join(
      this.compileRunner.projectDir(projectId),
      targetFile,
    );
    if (!existsSync(absolutePath)) {
      throw new BadRequestException(`Target file not found: ${targetFile}`);
    }
    return targetFile;
  }
}
