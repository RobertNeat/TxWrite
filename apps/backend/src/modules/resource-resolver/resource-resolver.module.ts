import { Module } from '@nestjs/common';
import { JobQueueModule } from '../job-queue/job-queue.module.js';
import { EventsModule } from '../events/events.module.js';
import { PackageIndexService } from './package-index.service.js';
import { ResourceResolverService } from './resource-resolver.service.js';
import { FontResolverService } from './font-resolver.service.js';

@Module({
  imports: [JobQueueModule, EventsModule],
  providers: [
    PackageIndexService,
    ResourceResolverService,
    FontResolverService,
  ],
  exports: [PackageIndexService, ResourceResolverService, FontResolverService],
})
export class ResourceResolverModule {}
