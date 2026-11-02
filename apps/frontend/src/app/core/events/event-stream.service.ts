import { Injectable, OnDestroy, signal } from '@angular/core';
import type { AppEvent } from '../api/api.types.js';

export type { AppEvent };

const MAX_EVENTS = 200;

@Injectable({ providedIn: 'root' })
export class EventStreamService implements OnDestroy {
  private source: EventSource | null = null;

  readonly lastEvent = signal<AppEvent | null>(null);
  readonly events = signal<AppEvent[]>([]);
  readonly connected = signal(false);

  connect(): void {
    if (this.source || typeof EventSource === 'undefined') {
      return;
    }
    this.source = new EventSource('/api/events');
    this.source.onopen = () => this.connected.set(true);
    this.source.onerror = () => this.connected.set(false);
    this.source.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AppEvent;
      this.lastEvent.set(event);
      this.events.update((list) => [...list.slice(-(MAX_EVENTS - 1)), event]);
    };
  }

  ngOnDestroy(): void {
    this.source?.close();
    this.source = null;
  }
}
