import {
  AfterViewInit,
  Component,
  ElementRef,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
  input,
} from '@angular/core';
import type { Extension } from '@codemirror/state';
import { ApiService } from '../../core/api/api.service.js';

const SAVE_DEBOUNCE_MS = 800;

export interface JumpTarget {
  path: string;
  line: number;
}

function languageExtensionFor(path: string): Promise<Extension> {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md' || ext === 'markdown') {
    return import('@codemirror/lang-markdown').then((m) => m.markdown());
  }
  if (ext === 'tex' || ext === 'sty' || ext === 'cls' || ext === 'bib') {
    return import('@codemirror/legacy-modes/mode/stex').then((m) =>
      import('@codemirror/language').then((l) => l.StreamLanguage.define(m.stexMath)),
    );
  }
  return Promise.resolve([]);
}

@Component({
  selector: 'app-editor',
  standalone: true,
  template: `<div id="editor-host" #host class="editor-host"></div>`,
  styles: [
    `
      :host,
      .editor-host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class EditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  private readonly api = inject(ApiService);

  readonly projectId = input.required<string>();
  readonly filePath = input<string | null>(null);
  readonly jumpTarget = input<JumpTarget | null>(null);

  @ViewChild('host', { static: true }) private host!: ElementRef<HTMLElement>;

  private view: import('@codemirror/view').EditorView | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private savePendingForPath: string | null = null;
  private viewReady: Promise<void> | null = null;
  private loadedPath: string | null = null;

  async ngAfterViewInit(): Promise<void> {
    this.viewReady = this.createView();
    await this.viewReady;
    await this.loadCurrentFile();
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (
      !this.viewReady ||
      !(changes['filePath'] || changes['jumpTarget'] || changes['projectId'])
    ) {
      return;
    }
    if (changes['projectId'] && !changes['projectId'].firstChange) {
      // A different project can have a file at the same path (e.g. both main.tex)
      // — loadCurrentFile() short-circuits on an unchanged path, so without this
      // reset it would keep showing the previous project's content.
      this.loadedPath = null;
    }
    await this.viewReady;
    await this.loadCurrentFile();
    await this.applyJumpTarget();
  }

  private async createView(): Promise<void> {
    const { EditorView, basicSetup } = await import('codemirror');
    const { EditorState } = await import('@codemirror/state');
    this.view = new EditorView({
      doc: '',
      extensions: [basicSetup, EditorState.readOnly.of(true)],
      parent: this.host.nativeElement,
    });
  }

  private async loadCurrentFile(): Promise<void> {
    const path = this.filePath();
    if (!this.view) {
      return;
    }
    if (!path) {
      await this.clear();
      return;
    }
    if (path === this.loadedPath) {
      return;
    }
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
      await this.save();
    }
    const [{ EditorState }, languageExtension] = await Promise.all([
      import('@codemirror/state'),
      languageExtensionFor(path),
    ]);
    const content = await this.api.readFile(this.projectId(), path);
    this.loadedPath = path;
    const { EditorView, basicSetup } = await import('codemirror');
    this.view.setState(
      EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          languageExtension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.scheduleSave(path);
            }
          }),
        ],
      }),
    );
  }

  private async applyJumpTarget(): Promise<void> {
    const target = this.jumpTarget();
    if (!target || !this.view) {
      return;
    }
    if (target.path !== this.filePath() || target.path !== this.loadedPath) {
      return;
    }
    const { EditorView } = await import('codemirror');
    const lineNumber = Math.min(Math.max(target.line, 1), this.view.state.doc.lines);
    const line = this.view.state.doc.line(lineNumber);
    this.view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    this.view.focus();
  }

  private async clear(): Promise<void> {
    if (!this.view || this.loadedPath === null) {
      return;
    }
    this.loadedPath = null;
    const { EditorState } = await import('@codemirror/state');
    this.view.setState(
      EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true)] }),
    );
  }

  private scheduleSave(path: string): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.savePendingForPath = path;
    this.saveTimeout = setTimeout(() => void this.save(), SAVE_DEBOUNCE_MS);
  }

  private async save(): Promise<void> {
    const path = this.savePendingForPath;
    if (!this.view || !path) {
      return;
    }
    this.savePendingForPath = null;
    await this.api.writeFile(this.projectId(), path, this.view.state.doc.toString());
  }

  ngOnDestroy(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      void this.save();
    }
    this.view?.destroy();
  }
}
