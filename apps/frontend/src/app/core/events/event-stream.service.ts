import { Injectable, OnDestroy, signal } from '@angular/core';
import type { AppEvent } from '../api/api.types.js';

export type { AppEvent };

@Injectable({ providedIn: 'root' })
export class EventStreamService implements OnDestroy {
  private source: EventSource | null = null;

  readonly lastEvent = signal<AppEvent | null>(null);
  readonly connected = signal(false);

  connect(): void {
    if (this.source || typeof EventSource === 'undefined') {
      return;
    }
    this.source = new EventSource('/api/events');
    this.source.onopen = () => this.connected.set(true);
    this.source.onerror = () => this.connected.set(false);
    this.source.onmessage = (message: MessageEvent<string>) => {
      this.lastEvent.set(JSON.parse(message.data) as AppEvent);
    };
  }

  ngOnDestroy(): void {
    this.source?.close();
    this.source = null;
  }
}
