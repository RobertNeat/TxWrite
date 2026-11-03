import { Component, computed, input, output } from '@angular/core';
import type { CompileDiagnostic, CompileResult } from '../../core/api/api.types.js';
import type { JumpTarget } from '../editor/editor.component.js';

function normalizeTexPath(file: string): string {
  return file.replace(/^\.\//, '');
}

/**
 * The log panel body. Per explicit user direction: errors only, no debug/
 * event noise, no section titles. A successful compile shows one short
 * confirmation line (not nothing — an empty panel left the user unsure
 * whether it had actually run). Each diagnostic renders as one line:
 * "[severity] line N -- file F -- message", with only "line N" clickable
 * (jumps to that line in the editor). `diagnostics` already excludes TeX's
 * own generic follow-up boilerplate ("Emergency stop.", "==> Fatal error
 * occurred...") at the parser level (log-parser.ts), not here — this
 * component never reformats or filters the real diagnostic text itself, only
 * lays out the already-structured fields (severity/file/line/message) it's
 * given.
 */
@Component({
  selector: 'app-compile-panel',
  standalone: true,
  template: `
    <div id="compile-panel" class="compile-panel">
      @if (result()?.success && diagnostics().length === 0) {
        <div id="compile-success" class="compile-success">
          <span class="compile-diagnostic-severity">[ok]</span>
          <span>Kompilacja zakończona powodzeniem</span>
        </div>
      }
      @if (isMarkdownProject() && diagnostics().length > 0) {
        <p id="compile-diagnostics-note" class="compile-note">
          Dotyczy wygenerowanego pliku .tex (projekt Markdown)
        </p>
      }
      @for (diagnostic of diagnostics(); track $index) {
        <div [id]="'compile-diagnostic-' + $index" class="compile-diagnostic">
          <span class="compile-diagnostic-severity">[{{ diagnostic.severity }}]</span>
          @if (diagnostic.line) {
            @if (diagnostic.file && !isMarkdownProject()) {
              <button
                [id]="'compile-diagnostic-jump-' + $index"
                type="button"
                class="compile-diagnostic-jump"
                (click)="jumpTo(diagnostic)"
              >
                line {{ diagnostic.line }}
              </button>
            } @else {
              <span>line {{ diagnostic.line }}</span>
            }
            <span class="compile-diagnostic-sep">--</span>
          }
          @if (diagnostic.file) {
            <span>file {{ diagnostic.file }}</span>
            <span class="compile-diagnostic-sep">--</span>
          }
          <span [id]="'compile-diagnostic-message-' + $index">{{ diagnostic.message }}</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .compile-panel {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 12px;
        font-family: var(--mono, ui-monospace, monospace);
        font-size: 12px;
        letter-spacing: normal;
        line-height: 1.4;
        color: #000;
        background: #fff;
      }
      .compile-note {
        margin: 0;
        font-size: 11px;
        color: var(--muted, #666);
      }
      .compile-success {
        display: flex;
        gap: 0.5em;
        color: #000;
      }
      .compile-diagnostic {
        display: flex;
        gap: 0.5em;
        flex-wrap: wrap;
        align-items: baseline;
        color: #000;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .compile-diagnostic-severity {
        opacity: 0.75;
      }
      .compile-diagnostic-sep {
        opacity: 0.5;
      }
      .compile-diagnostic-jump {
        font: inherit;
        color: inherit;
        background: none;
        border: 0;
        padding: 0;
        cursor: pointer;
      }
      .compile-diagnostic-jump:hover {
        text-decoration: underline;
      }
    `,
  ],
})
export class CompilePanelComponent {
  readonly isMarkdownProject = input<boolean>(false);
  readonly result = input<CompileResult | null>(null);
  readonly jumpToFile = output<JumpTarget>();

  protected readonly diagnostics = computed<CompileDiagnostic[]>(
    () => this.result()?.diagnostics ?? [],
  );

  jumpTo(diagnostic: CompileDiagnostic): void {
    if (!diagnostic.file || !diagnostic.line) {
      return;
    }
    this.jumpToFile.emit({ path: normalizeTexPath(diagnostic.file), line: diagnostic.line });
  }
}
