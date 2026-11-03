import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { AppConfigModule } from './common/config/app-config.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { TemplatesModule } from './modules/templates/templates.module.js';
import { CompileModule } from './modules/compile/compile.module.js';
import { ResourceResolverModule } from './modules/resource-resolver/resource-resolver.module.js';
import { PrefetchWatcherModule } from './modules/prefetch-watcher/prefetch-watcher.module.js';
import { JobQueueModule } from './modules/job-queue/job-queue.module.js';

@Module({
  imports: [
    AppConfigModule,
    ServeStaticModule.forRoot({
      rootPath: join(import.meta.dirname, '..', 'public'),
      exclude: ['/api/{*splat}'],
      // Angular is a client-routed SPA — any non-API, non-asset path (e.g. a
      // direct load or refresh of /projects/:id) must still resolve to
      // index.html so the Angular router can take over.
      serveStaticOptions: { fallthrough: true },
    }),
    HealthModule,
    EventsModule,
    ProfilesModule,
    ProjectsModule,
    TemplatesModule,
    CompileModule,
    ResourceResolverModule,
    PrefetchWatcherModule,
    JobQueueModule,
  ],
})
export class AppModule {}
