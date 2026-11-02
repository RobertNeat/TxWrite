import { Injectable } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service.js';
import { EventBusService } from '../events/event-bus.service.js';
import { CompileQueueService } from './compile-queue.service.js';
import {
  CompileRunnerService,
  type CompileResult,
} from './compile-runner.service.js';

@Injectable()
export class CompileService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly compileQueue: CompileQueueService,
    private readonly compileRunner: CompileRunnerService,
    private readonly eventBus: EventBusService,
  ) {}

  async compile(projectId: string): Promise<CompileResult> {
    const project = this.projectsService.findByIdOrThrow(projectId);

    return this.compileQueue.run(projectId, async () => {
      this.eventBus.emit({ type: 'compile.started', projectId });
      try {
        const result = await this.compileRunner.runOnce(
          projectId,
          project.mainFile,
          project.engine,
        );
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

  outputPdfPath(projectId: string): string {
    const project = this.projectsService.findByIdOrThrow(projectId);
    const baseName = project.mainFile.replace(/\.(tex|md)$/i, '');
    return `${this.compileRunner.workDir(projectId)}/${baseName}.pdf`;
  }
}
