import { Controller, Sse } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { EventBusService } from './event-bus.service.js';

interface MessageEvent {
  data: string;
}

@Controller('events')
export class EventsController {
  constructor(private readonly eventBus: EventBusService) {}

  @Sse()
  stream(): Observable<MessageEvent> {
    return this.eventBus
      .stream()
      .pipe(map((event) => ({ data: JSON.stringify(event) })));
  }
}
