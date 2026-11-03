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
  output,
} from '@angular/core';
import type { Extension } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import { ApiService } from '../../core/api/api.service.js';
import {
  TEMPLATES,
  insertTemplate,
  type EditResult,
  type HeadingLevel,
  lineLevel,
  modeFor,
} from '../toolbar/toolbar.model.js';
import {
  InMemoryLineMarkStore,
  attachLineMarkHandlers,
  getMarkedLines,
  lineMarksExtension,
  seedLineMarks,
  type LineMarkStore,
} from './line-marks.js';

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
        min-height: 0;
        overflow: hidden;
      }

      .editor-host ::ng-deep .cm-editor {
        height: 100%;
      }

      .editor-host ::ng-deep .cm-scroller {
        overflow: auto;
      }
    `,
  ],
})
export class EditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  private readonly api = inject(ApiService);

  readonly projectId = input.required<string>();
  readonly filePath = input<string | null>(null);
  readonly jumpTarget = input<JumpTarget | null>(null);
  readonly contentChanged = output<{ path: string; content: string } | null>();
  readonly headingLevelChanged = output<HeadingLevel>();
  /** Fires only on a real edit (docChanged), unlike contentChanged which also fires on file load. */
  readonly docEdited = output<string>();

  @ViewChild('host', { static: true }) private host!: ElementRef<HTMLElement>;

  private view: import('@codemirror/view').EditorView | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private savePendingForPath: string | null = null;
  private viewReady: Promise<void> | null = null;
  private loadedPath: string | null = null;
  private detachLineMarkHandlers: (() => void) | null = null;
  // In-memory only (session-scoped line marks, cleared on refresh) — swap for a
  // backend-backed LineMarkStore in a future milestone without touching the
  // CodeMirror wiring in loadCurrentFile()/clear().
  private readonly lineMarkStore: LineMarkStore = new InMemoryLineMarkStore();

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
    const editorKeymap = await this.buildEditorKeymap();
    this.view = new EditorView({
      doc: '',
      extensions: [basicSetup, editorKeymap, EditorState.readOnly.of(true)],
      parent: this.host.nativeElement,
    });
    this.detachLineMarkHandlers = attachLineMarkHandlers(this.view);
  }

  /**
   * Ports app.js's Ctrl+S/Ctrl+B/Ctrl+I/Tab handling (keydown listener around
   * line 455) as real CodeMirror keybindings. Prec.highest so Mod-b/Mod-i win
   * over basicSetup's defaults (which don't bind them) and indentWithTab wins
   * over the default Tab behavior (inserting a focus-trapped indent, with
   * Escape releasing it — @codemirror/commands' built-in equivalent of the
   * mockup's textarea-specific "insertText two spaces" hack). Ctrl+S only
   * flushes the pending autosave and prevents Chrome's native save dialog —
   * the app already autosaves on every edit, so there's nothing else to do.
   */
  private async buildEditorKeymap(): Promise<Extension> {
    const [{ keymap }, { Prec }, { indentWithTab }] = await Promise.all([
      import('@codemirror/view'),
      import('@codemirror/state'),
      import('@codemirror/commands'),
    ]);
    const bindings: KeyBinding[] = [
      indentWithTab,
      {
        key: 'Mod-s',
        run: () => {
          void this.flushSave();
          return true;
        },
      },
      {
        key: 'Mod-b',
        run: () => {
          this.applyEdit((doc, from, to) =>
            insertTemplate(doc, { from, to }, TEMPLATES[this.currentMode()]['bold']),
          );
          return true;
        },
      },
      {
        key: 'Mod-i',
        run: () => {
          this.applyEdit((doc, from, to) =>
            insertTemplate(doc, { from, to }, TEMPLATES[this.currentMode()]['italic']),
          );
          return true;
        },
      },
    ];
    return Prec.highest(keymap.of(bindings));
  }

  private lineMarkKey(path: string): string {
    return `${this.projectId()}:${path}`;
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
    if (this.loadedPath) {
      this.lineMarkStore.saveMarks(this.lineMarkKey(this.loadedPath), getMarkedLines(this.view));
    }
    const [{ EditorState }, languageExtension, editorKeymap] = await Promise.all([
      import('@codemirror/state'),
      languageExtensionFor(path),
      this.buildEditorKeymap(),
    ]);
    const content = await this.api.readFile(this.projectId(), path);
    this.loadedPath = path;
    const { EditorView, basicSetup } = await import('codemirror');
    this.view.setState(
      EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          editorKeymap,
          languageExtension,
          lineMarksExtension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.scheduleSave(path);
              this.contentChanged.emit({ path, content: update.state.doc.toString() });
              this.docEdited.emit(path);
            }
            if (update.docChanged || update.selectionSet) {
              this.emitHeadingLevel(path);
            }
          }),
        ],
      }),
    );
    seedLineMarks(this.view, this.lineMarkStore.loadMarks(this.lineMarkKey(path)));
    this.contentChanged.emit({ path, content });
    this.emitHeadingLevel(path);
  }

  private emitHeadingLevel(path: string): void {
    if (!this.view) {
      return;
    }
    const doc = this.view.state.doc.toString();
    const pos = this.view.state.selection.main.head;
    this.headingLevelChanged.emit(lineLevel(doc, pos, modeFor(path)));
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
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    this.view.focus();
  }

  // ---------- public API for the formatting toolbar ----------

  /** Whether the toolbar should be enabled: a loaded text file, not the binary placeholder view. */
  isEditable(): boolean {
    return this.view !== null && this.loadedPath !== null;
  }

  currentMode(): 'tex' | 'md' {
    return modeFor(this.loadedPath ?? '');
  }

  /** Applies a pure (doc, selection) -> EditResult transform computed from the live document state. */
  applyEdit(
    compute: (doc: string, selectionFrom: number, selectionTo: number) => EditResult,
  ): void {
    if (!this.view || !this.loadedPath) {
      return;
    }
    const doc = this.view.state.doc.toString();
    const { main } = this.view.state.selection;
    const result = compute(doc, main.from, main.to);
    this.view.dispatch({
      changes: { from: 0, to: doc.length, insert: result.text },
      selection: { anchor: result.selectionFrom, head: result.selectionTo },
    });
    this.view.focus();
  }

  undo(): void {
    this.execHistoryCommand('undo');
  }

  redo(): void {
    this.execHistoryCommand('redo');
  }

  private execHistoryCommand(kind: 'undo' | 'redo'): void {
    if (!this.view) {
      return;
    }
    void import('@codemirror/commands').then((commands) => {
      if (!this.view) {
        return;
      }
      (kind === 'undo' ? commands.undo : commands.redo)(this.view);
      this.view.focus();
    });
  }

  focusEditor(): void {
    this.view?.focus();
  }

  /** Flushes a pending debounced save immediately — needed before compiling, which reads from disk. */
  async flushSave(): Promise<void> {
    if (!this.saveTimeout) {
      return;
    }
    clearTimeout(this.saveTimeout);
    this.saveTimeout = null;
    await this.save();
  }

  private async clear(): Promise<void> {
    if (!this.view || this.loadedPath === null) {
      return;
    }
    this.lineMarkStore.saveMarks(this.lineMarkKey(this.loadedPath), getMarkedLines(this.view));
    this.loadedPath = null;
    const { EditorState } = await import('@codemirror/state');
    this.view.setState(
      EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true)] }),
    );
    this.contentChanged.emit(null);
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
    this.detachLineMarkHandlers?.();
    this.view?.destroy();
  }
}
