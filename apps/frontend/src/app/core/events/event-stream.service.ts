import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from '../auth/auth.service.js';
import type { AppEvent } from '../api/api.types.js';

export type { AppEvent };

const MAX_EVENTS = 200;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class EventStreamService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private source: EventSource | null = null;
  private reconnecting = false;
  private destroyed = false;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private readonly eventsSubject = new Subject<AppEvent>();

  readonly lastEvent = signal<AppEvent | null>(null);
  readonly events = signal<AppEvent[]>([]);
  readonly connected = signal(false);
  /** Push channel: every message, in order, never dropped by a signal update collapsing. */
  readonly events$ = this.eventsSubject.asObservable();

  connect(): void {
    if (this.source || typeof EventSource === 'undefined') {
      return;
    }
    this.destroyed = false;
    this.source = new EventSource('/api/events');
    this.source.onopen = () => {
      this.connected.set(true);
      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    };
    // EventSource exposes no status code on error — a 401 (expired
    // access-token cookie) looks identical to a plain network blip or the
    // dev server/backend restarting mid-save. It also never retries itself
    // after a 401 (browsers back off permanently on 4xx), so this probes
    // /me to tell the two apart: only a confirmed 401 triggers a refresh;
    // anything else (network error, 5xx) is a transient blip and just
    // reconnects with capped exponential backoff, matching what plain
    // EventSource already did before this project had auth at all.
    this.source.onerror = () => {
      this.connected.set(false);
      void this.reconnectAfterError();
    };
    this.source.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AppEvent;
      this.lastEvent.set(event);
      this.events.update((list) => [...list.slice(-(MAX_EVENTS - 1)), event]);
      this.eventsSubject.next(event);
    };
  }

  private async reconnectAfterError(): Promise<void> {
    if (this.reconnecting || this.destroyed) return;
    this.reconnecting = true;
    try {
      this.source?.close();
      this.source = null;

      let meResponse: Response | null = null;
      try {
        meResponse = await fetch('/api/auth/me');
      } catch {
        // network error — fall through to a plain backoff-and-retry below
      }

      if (meResponse?.status === 401) {
        const result = await this.auth.refreshOnce();
        if (result === 'unauthenticated' || this.destroyed) return;
      }

      const delay = this.reconnectDelayMs;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!this.destroyed) this.connect();
    } finally {
      this.reconnecting = false;
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.source?.close();
    this.source = null;
    this.eventsSubject.complete();
  }
}
