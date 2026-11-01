import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export type AppEventType =
  | 'compile.started'
  | 'compile.finished'
  | 'install.queued'
  | 'install.started'
  | 'install.finished'
  | 'install.failed'
  | 'font.resolving'
  | 'font.resolved'
  | 'font.failed';

export interface AppEvent {
  type: AppEventType;
  projectId?: string;
  payload?: unknown;
  timestamp: string;
}

@Injectable()
export class EventBusService {
  private readonly subject = new Subject<AppEvent>();

  emit(event: Omit<AppEvent, 'timestamp'>): void {
    this.subject.next({ ...event, timestamp: new Date().toISOString() });
  }

  stream(): Observable<AppEvent> {
    return this.subject.asObservable();
  }
}
