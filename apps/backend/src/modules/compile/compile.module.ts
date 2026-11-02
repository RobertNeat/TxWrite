import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { EventsModule } from '../events/events.module.js';
import { CompileController } from './compile.controller.js';
import { CompileService } from './compile.service.js';
import { CompileQueueService } from './compile-queue.service.js';
import { CompileRunnerService } from './compile-runner.service.js';
import { SvgConverterService } from './svg-converter.service.js';
import { PandocConverterService } from './pandoc-converter.service.js';

@Module({
  imports: [ProjectsModule, EventsModule],
  controllers: [CompileController],
  providers: [
    CompileService,
    CompileQueueService,
    CompileRunnerService,
    SvgConverterService,
    PandocConverterService,
  ],
})
export class CompileModule {}
