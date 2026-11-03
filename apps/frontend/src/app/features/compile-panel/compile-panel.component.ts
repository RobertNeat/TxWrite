import { Component, computed, inject, input, output } from '@angular/core';
import { EventStreamService } from '../../core/events/event-stream.service.js';
import { TranslatePipe } from '../../core/i18n/translate.pipe.js';
import type { AppEvent, CompileDiagnostic, CompileResult } from '../../core/api/api.types.js';
import type { JumpTarget } from '../editor/editor.component.js';

function describeEvent(event: AppEvent): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case 'compile.started':
      return 'compile.started';
    case 'compile.finished':
      return `compile.finished (success=${String(payload['success'])})`;
    case 'install.queued':
      return `install.queued: ${String(payload['packageName'])}`;
    case 'install.started':
      return `install.started: ${String(payload['packageName'])}`;
    case 'install.finished':
      return `install.finished: ${String(payload['packageName'])}`;
    case 'install.failed':
      return `install.failed: ${String(payload['packageName'])} — ${String(payload['message'])}`;
    default:
      return event.type;
  }
}

function normalizeTexPath(file: string): string {
  return file.replace(/^\.\//, '');
}

/**
 * The mockup's `#logp` panel body — diagnostics (with jump-to-source) and the
 * raw event log. Purely presentational: compile state (triggering a compile,
 * `compiling`/`lastResult`) lives in `PdfPreviewComponent` instead, since that
 * component (unlike this one, which only exists while the log panel is open)
 * stays alive across the whole compile — see plan.md's M6 fix notes for why
 * the compile button silently did nothing while the panel was closed when
 * this component used to own that state itself.
 */
@Component({
  selector: 'app-compile-panel',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div id="compile-panel" class="compile-panel">
      @if (result(); as result) {
        <p
          [id]="'compile-result-status'"
          class="compile-result"
          [class.success]="result.success"
          [class.failure]="!result.success"
        >
          {{ (result.success ? 'compile.success' : 'compile.failed') | t }}
        </p>
      }

      <h2 id="compile-diagnostics-title">{{ 'compile.diagnostics' | t }}</h2>
      @if (isMarkdownProject()) {
        <p id="compile-diagnostics-note" class="compile-note">
          {{ 'compile.generatedFileNote' | t }}
        </p>
      }
      @if (diagnostics().length === 0) {
        <p id="compile-diagnostics-empty">{{ 'compile.noDiagnostics' | t }}</p>
      } @else {
        <ul id="compile-diagnostics-list">
          @for (diagnostic of diagnostics(); track $index) {
            <li
              [id]="'compile-diagnostic-' + $index"
              class="compile-diagnostic"
              [class.error]="diagnostic.severity === 'error'"
              [class.warning]="diagnostic.severity === 'warning'"
            >
              @if (diagnostic.file && diagnostic.line && !isMarkdownProject()) {
                <button
                  [id]="'compile-diagnostic-jump-' + $index"
                  type="button"
                  class="compile-diagnostic-jump"
                  (click)="jumpTo(diagnostic)"
                >
                  {{ diagnostic.file }}:{{ diagnostic.line }}
                </button>
              } @else if (diagnostic.file && diagnostic.line) {
                <span
                  [id]="'compile-diagnostic-location-' + $index"
                  class="compile-diagnostic-location"
                >
                  {{ diagnostic.file }}:{{ diagnostic.line }}
                </span>
              }
              <span [id]="'compile-diagnostic-message-' + $index">{{ diagnostic.message }}</span>
            </li>
          }
        </ul>
      }

      <h2 id="compile-log-title">{{ 'compile.log' | t }}</h2>
      <ul id="compile-log-list" class="compile-log-list">
        @for (line of logLines(); track $index) {
          <li [id]="'compile-log-line-' + $index">{{ line }}</li>
        }
      </ul>
    </div>
  `,
  styles: [
    `
      .compile-panel {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 10px 12px;
      }
      .compile-result {
        font-weight: 600;
      }
      .compile-result.success {
        color: #2a7;
      }
      .compile-result.failure {
        color: #c33;
      }
      .compile-note {
        font-size: 0.8rem;
        color: #999;
      }
      #compile-diagnostics-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .compile-diagnostic {
        display: flex;
        gap: 0.4rem;
        font-size: 0.85rem;
      }
      .compile-diagnostic.error {
        color: #c33;
      }
      .compile-diagnostic.warning {
        color: #b80;
      }
      .compile-diagnostic-jump {
        font-family: monospace;
      }
      .compile-log-list {
        list-style: none;
        padding: 0;
        margin: 0;
        font-family: monospace;
        font-size: 0.75rem;
        overflow: auto;
      }
    `,
  ],
})
export class CompilePanelComponent {
  private readonly eventStream = inject(EventStreamService);

  readonly projectId = input.required<string>();
  readonly isMarkdownProject = input<boolean>(false);
  readonly result = input<CompileResult | null>(null);
  readonly jumpToFile = output<JumpTarget>();

  protected readonly diagnostics = computed<CompileDiagnostic[]>(
    () => this.result()?.diagnostics ?? [],
  );

  readonly warningCount = computed(
    () => this.diagnostics().filter((d) => d.severity === 'warning').length,
  );

  protected readonly logLines = computed(() =>
    this.eventStream
      .events()
      .filter((event) => event.projectId === this.projectId())
      .map(describeEvent),
  );

  constructor() {
    this.eventStream.connect();
  }

  jumpTo(diagnostic: CompileDiagnostic): void {
    if (!diagnostic.file || !diagnostic.line) {
      return;
    }
    this.jumpToFile.emit({ path: normalizeTexPath(diagnostic.file), line: diagnostic.line });
  }
}
