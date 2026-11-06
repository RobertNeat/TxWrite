import { Controller, Sse } from '@nestjs/common';
import { filter, map, Observable } from 'rxjs';
import { EventBusService } from './event-bus.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';

interface MessageEvent {
  data: string;
}

@Controller('events')
export class EventsController {
  constructor(
    private readonly eventBus: EventBusService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Sse()
  stream(@CurrentUserId() userId: string): Observable<MessageEvent> {
    return this.eventBus.stream().pipe(
      filter((event) => {
        // Events without a projectId (none currently exist, but defensively
        // keep them out rather than broadcast to everyone) and events for
        // projects this user doesn't own are dropped before they reach the
        // client — otherwise one user would see another's compile status.
        if (!event.projectId) return false;
        try {
          this.projectsService.assertProjectAccess(event.projectId, userId);
          return true;
        } catch {
          return false;
        }
      }),
      map((event) => ({ data: JSON.stringify(event) })),
    );
  }
}
