import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { EventsModule } from '../events/events.module.js';
import { ResourceResolverModule } from '../resource-resolver/resource-resolver.module.js';
import { CompileController } from './compile.controller.js';
import { CompileService } from './compile.service.js';
import { CompileQueueService } from './compile-queue.service.js';
import { CompileRunnerService } from './compile-runner.service.js';
import { SvgConverterService } from './svg-converter.service.js';
import { PandocConverterService } from './pandoc-converter.service.js';
import { SynctexService } from './synctex.service.js';
import { ExportService } from './export.service.js';

@Module({
  imports: [ProjectsModule, EventsModule, ResourceResolverModule],
  controllers: [CompileController],
  providers: [
    CompileService,
    CompileQueueService,
    CompileRunnerService,
    SvgConverterService,
    PandocConverterService,
    SynctexService,
    ExportService,
  ],
})
export class CompileModule {}
