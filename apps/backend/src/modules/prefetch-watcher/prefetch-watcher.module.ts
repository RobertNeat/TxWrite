import { Module } from '@nestjs/common';
import { ResourceResolverModule } from '../resource-resolver/resource-resolver.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { PrefetchWatcherService } from './prefetch-watcher.service.js';
import { PrefetchWatcherController } from './prefetch-watcher.controller.js';

@Module({
  imports: [ResourceResolverModule, ProjectsModule],
  controllers: [PrefetchWatcherController],
  providers: [PrefetchWatcherService],
  exports: [PrefetchWatcherService],
})
export class PrefetchWatcherModule {}
