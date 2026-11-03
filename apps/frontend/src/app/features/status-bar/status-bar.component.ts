import { Component, OnInit, computed, input } from '@angular/core';
import { EventStreamService } from '../../core/events/event-stream.service.js';
import { TranslatePipe } from '../../core/i18n/translate.pipe.js';

const ENGINE_LABELS: Record<string, string> = {
  pdflatex: 'pdfLaTeX',
  xelatex: 'XeLaTeX',
  lualatex: 'LuaLaTeX',
};

@Component({
  selector: 'app-status-bar',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (engineLabel(); as label) {
      <span id="status-bar-engine">{{ label }}</span>
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
  readonly engine = input<string | null>(null);

  protected readonly engineLabel = computed(() => {
    const engine = this.engine();
    return engine ? (ENGINE_LABELS[engine] ?? engine) : null;
  });

  constructor(public readonly eventStream: EventStreamService) {}

  ngOnInit(): void {
    this.eventStream.connect();
  }
}
