import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EventStreamService, type AppEvent } from '../../core/events/event-stream.service.js';
import { I18nService } from '../../core/i18n/i18n.service.js';
import { TranslatePipe } from '../../core/i18n/translate.pipe.js';

// One line shown at a time, drained from a queue, so a burst of installs
// (queued/started/finished per package) never floods the status bar or
// overlaps with the next message.
const DISPLAY_DURATION_MS = 3_000;
// Bounds the worst case: 1 active + 5 queued at 3s/line is never more than
// ~18s stale, even for a compile that retried several missing
// packages/fonts in a row.
const QUEUE_CAP = 5;

const INSTALL_FONT_TYPES = new Set<AppEvent['type']>([
  'install.queued',
  'install.started',
  'install.finished',
  'install.failed',
  'font.resolving',
  'font.resolved',
  'font.failed',
]);

interface QueuedMessage {
  text: string;
  title: string;
}

function readName(payload: unknown, key: 'packageName' | 'fontName'): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

@Component({
  selector: 'app-status-bar',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (activeMessage(); as message) {
      <span id="status-bar-install" class="install" [title]="message.title">
        {{ message.text }}
        @if (pendingCount() > 0) {
          <span id="status-bar-install-pending" class="pending">+{{ pendingCount() }}</span>
        }
      </span>
    }
    <span class="r">
      <span id="status-bar-connection" class="status" [class.connected]="eventStream.connected()">
        {{ (eventStream.connected() ? 'status.connected' : 'status.disconnected') | t }}
      </span>
    </span>
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        flex: 1;
        gap: 18px;
        font-size: 12.5px;
      }
      .install {
        max-width: 38ch;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--muted);
      }
      .pending {
        margin-left: 6px;
      }
      .r {
        margin-left: auto;
        display: flex;
        gap: 18px;
      }
      .status {
        color: #999;
      }
      .status.connected {
        color: #2a7;
      }
    `,
  ],
})
export class StatusBarComponent implements OnInit {
  readonly projectId = input<string | null>(null);

  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly queue = signal<QueuedMessage[]>([]);
  protected readonly activeMessage = signal<QueuedMessage | null>(null);
  protected readonly pendingCount = computed(() => this.queue().length);

  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(public readonly eventStream: EventStreamService) {
    let previousProjectId = this.projectId();
    effect(() => {
      const current = this.projectId();
      if (current !== previousProjectId) {
        previousProjectId = current;
        this.clearForProjectChange();
      }
    });
  }

  ngOnInit(): void {
    this.eventStream.connect();
    this.eventStream.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      this.handleEvent(event);
    });
    this.destroyRef.onDestroy(() => {
      if (this.drainTimer) clearTimeout(this.drainTimer);
    });
  }

  private handleEvent(event: AppEvent): void {
    if (!INSTALL_FONT_TYPES.has(event.type)) return;
    const currentProject = this.projectId();
    if (currentProject && event.projectId && event.projectId !== currentProject) return;

    const message = this.toMessage(event);
    if (!message) return;

    this.queue.update((list) => [...list, message].slice(-QUEUE_CAP));
    this.pump();
  }

  private toMessage(event: AppEvent): QueuedMessage | null {
    const isFont = event.type.startsWith('font.');
    const name = readName(event.payload, isFont ? 'fontName' : 'packageName') ?? '?';
    const text = this.i18n.t(`status.${event.type}`, { name });
    const rawMessage =
      typeof event.payload === 'object' && event.payload !== null
        ? (event.payload as Record<string, unknown>)['message']
        : undefined;
    const title = typeof rawMessage === 'string' ? rawMessage : text;
    return { text, title };
  }

  private pump(): void {
    if (this.activeMessage() || this.drainTimer) return;
    const [next, ...rest] = this.queue();
    if (!next) return;
    this.queue.set(rest);
    this.activeMessage.set(next);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.activeMessage.set(null);
      this.pump();
    }, DISPLAY_DURATION_MS);
  }

  protected clearForProjectChange(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    this.queue.set([]);
    this.activeMessage.set(null);
  }
}
