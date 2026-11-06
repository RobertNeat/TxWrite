import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Injector,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  afterNextRender,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ApiService } from '../../core/api/api.service.js';
import { TranslatePipe } from '../../core/i18n/translate.pipe.js';
import type { CompileResult } from '../../core/api/api.types.js';
import type { JumpTarget } from '../editor/editor.component.js';
import { CompilePanelComponent } from '../compile-panel/compile-panel.component.js';
import { pluralPl } from '../../shared/plural-pl.js';
import { placePopover } from '../../shared/popover-position.js';

/** Mockup's EXP list: PDF + pandoc-backed export formats + the whole-project ZIP, in display order. */
const EXPORT_FORMATS: {
  key: 'pdf' | 'md' | 'tex' | 'html' | 'docx' | 'zip';
  label: string;
  description: string;
  extension: string;
}[] = [
  { key: 'pdf', label: 'PDF', description: 'Skompilowany dokument', extension: '.pdf' },
  { key: 'md', label: 'Markdown', description: 'Konwersja przez Pandoc', extension: '.md' },
  {
    key: 'tex',
    label: 'LaTeX',
    description: 'Jeden plik z dołączonymi rozdziałami',
    extension: '.tex',
  },
  { key: 'html', label: 'HTML', description: 'Strona ze wzorami', extension: '.html' },
  { key: 'docx', label: 'Word', description: 'Dokument do dalszej edycji', extension: '.docx' },
  {
    key: 'zip',
    label: 'Projekt (ZIP)',
    description: 'Wszystkie pliki, w tym .sty i .cls',
    extension: '.zip',
  },
];
const LAST_EXPORT_FORMAT_KEY = 'editor.lastExportFormat';

type PdfDocumentProxy = import('pdfjs-dist').PDFDocumentProxy;
type PdfLoadingTask = import('pdfjs-dist').PDFDocumentLoadingTask;
type RenderTask = import('pdfjs-dist').RenderTask;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;
const FIT_MARGIN_PX = 80;
// 40% of the scroll container's height, matching app.js's page-under-cursor
// heuristic for which page counts as "current" while scrolling.
const CURRENT_PAGE_THRESHOLD = 0.4;

let workerConfigured = false;

async function configureWorker(): Promise<typeof import('pdfjs-dist')> {
  const pdfjs = await import('pdfjs-dist');
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
    workerConfigured = true;
  }
  return pdfjs;
}

interface RenderedPage {
  canvas: HTMLCanvasElement;
  viewportWidth: number;
  viewportHeight: number;
}

@Component({
  selector: 'app-pdf-preview',
  standalone: true,
  imports: [TranslatePipe, CompilePanelComponent],
  template: `
    <div id="pdf-preview" class="pdf-preview">
      <div class="pv-bar" role="toolbar" aria-label="Podgląd PDF">
        <button
          id="pv-compile"
          class="btn btn-p"
          type="button"
          [disabled]="compiling()"
          [title]="'Kompiluj (Ctrl+Enter)'"
          (click)="compile()"
        >
          <svg class="ic" [class.spin]="compiling()" aria-hidden="true">
            <use [attr.href]="compiling() ? '#i-spin' : '#i-play'" />
          </svg>
          <span id="pv-compile-label">{{ compiling() ? 'Kompilacja…' : 'Kompiluj' }}</span>
          @if (stale() && !compiling()) {
            <span id="pv-stale-dot" class="sdot" title="Zmiany nieskompilowane"></span>
          }
        </button>
        <button
          id="pv-log-toggle"
          class="btn tgl"
          type="button"
          [attr.aria-pressed]="logOpen()"
          aria-controls="pv-logp"
          title="Logi kompilacji"
          (click)="logOpen.set(!logOpen())"
        >
          <svg class="ic" aria-hidden="true"><use href="#i-terminal" /></svg>
          Logi
        </button>
        <div class="pgn">
          <button
            id="pv-page-prev"
            class="ib"
            type="button"
            title="Poprzednia strona"
            aria-label="Poprzednia strona"
            [disabled]="!hasDocument()"
            (click)="goToPage(currentPage() - 1)"
          >
            <svg class="ic" aria-hidden="true"><use href="#i-chev-l" /></svg>
          </button>
          <input
            id="pv-page-input"
            #pageInput
            class="pg-in"
            inputmode="numeric"
            aria-label="Numer strony"
            [value]="pageInputValue()"
            [disabled]="!hasDocument()"
            (focus)="onPageInputFocus($event)"
            (blur)="onPageInputBlur()"
            (keydown)="onPageInputKeydown($event)"
          />
          <button
            id="pv-page-next"
            class="ib"
            type="button"
            title="Następna strona"
            aria-label="Następna strona"
            [disabled]="!hasDocument()"
            (click)="goToPage(currentPage() + 1)"
          >
            <svg class="ic" aria-hidden="true"><use href="#i-chev-r" /></svg>
          </button>
        </div>
        <span class="tsep" role="separator"></span>
        <button
          id="pv-zoom-out"
          class="ib"
          type="button"
          title="Pomniejsz"
          aria-label="Pomniejsz"
          [disabled]="!hasDocument()"
          (click)="setZoom(zoom() - ZOOM_STEP, true)"
        >
          <svg class="ic" aria-hidden="true"><use href="#i-minus" /></svg>
        </button>
        <span id="pv-zoom-label" class="zl">{{ zoomLabel() }}</span>
        <button
          id="pv-zoom-in"
          class="ib"
          type="button"
          title="Powiększ"
          aria-label="Powiększ"
          [disabled]="!hasDocument()"
          (click)="setZoom(zoom() + ZOOM_STEP, true)"
        >
          <svg class="ic" aria-hidden="true"><use href="#i-plus" /></svg>
        </button>
        <button
          id="pv-zoom-fit"
          class="ib"
          type="button"
          title="Dopasuj do szerokości"
          aria-label="Dopasuj do szerokości"
          [disabled]="!hasDocument()"
          (click)="fitWidth()"
        >
          <svg class="ic" aria-hidden="true"><use href="#i-fit" /></svg>
        </button>
        <span class="spacer"></span>
        <div class="split" id="split">
          <button
            id="exp-main"
            class="btn sp-main"
            type="button"
            [title]="'Eksportuj jako ' + currentExportFormat().label"
            (click)="runExport(currentExportFormat().key)"
          >
            <svg class="ic" aria-hidden="true"><use href="#i-download" /></svg>
            <span>Eksportuj</span>
          </button>
          <button
            id="exp-car"
            #expCar
            class="btn sp-car"
            type="button"
            aria-haspopup="menu"
            [attr.aria-expanded]="exportMenuOpen()"
            aria-controls="exp-pop"
            aria-label="Wybierz format eksportu"
            (click)="$event.stopPropagation(); toggleExportMenu()"
          >
            <svg class="ic sm" aria-hidden="true"><use href="#i-chev-d" /></svg>
          </button>
        </div>
      </div>

      @if (exportMenuOpen()) {
        <div id="exp-pop" #expPop class="pop exp-pop" role="menu" aria-label="Formaty eksportu">
          @for (format of exportFormats; track format.key) {
            @if (format.key === 'zip') {
              <div class="mi-sep" role="separator"></div>
            }
            <button
              [id]="'exp-item-' + format.key"
              class="mi"
              role="menuitemradio"
              type="button"
              [attr.aria-checked]="format.key === currentExportFormat().key"
              (click)="runExport(format.key); closeExportMenu()"
            >
              <b
                >{{ format.label }}
                @if (format.key === currentExportFormat().key) {
                  <svg class="ic" aria-hidden="true"><use href="#i-check" /></svg>
                }
              </b>
              <small>{{ format.description }}</small>
              <span class="ex">{{ format.extension }}</span>
            </button>
          }
        </div>
      }

      @if (exportToast()) {
        <div id="exp-toast" class="toast on" role="status" aria-live="polite">
          {{ exportToast() }}
        </div>
      }

      <div class="pv-scroll" #scroll (scroll)="onScroll()">
        @if (error()) {
          <p id="pdf-preview-error" class="pdf-preview-error">{{ 'pdfPreview.error' | t }}</p>
        } @else if (!hasDocument()) {
          <p id="pdf-preview-empty">{{ 'pdfPreview.empty' | t }}</p>
        }
        <div id="pdf-pages" #pages class="pdf-pages" [style.--z]="zoom()"></div>
      </div>

      @if (logOpen()) {
        <div id="pv-logp" class="logp">
          <div class="logp-h">
            <h3>Logi kompilacji</h3>
            <span id="pv-log-count" class="cnt">{{ errorCountLabel() }}</span>
            <span class="spacer"></span>
            <button
              id="pv-log-close"
              class="ib"
              type="button"
              title="Zamknij logi kompilacji"
              aria-label="Zamknij logi kompilacji"
              (click)="logOpen.set(false)"
            >
              <svg class="ic" aria-hidden="true"><use href="#i-close" /></svg>
            </button>
          </div>
          <div class="logp-b">
            <app-compile-panel
              [isMarkdownProject]="compiledIsMarkdown()"
              [result]="lastResult()"
              (jumpToFile)="jumpToFile.emit($event)"
            />
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './pdf-preview.component.css',
})
export class PdfPreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly injector = inject(Injector);

  readonly projectId = input.required<string>();
  /** Whether compileTarget() (the currently open file) is Markdown — used only to seed compiledIsMarkdown on load. */
  readonly isMarkdownProject = input<boolean>(false);
  /** The file compile/preview/synctex should target — defaults to the project's mainFile when absent. */
  readonly compileTarget = input<string | undefined>(undefined);
  /** Flushes a pending debounced editor save before compiling, since compile reads from disk. */
  readonly flushEditorSave = input<(() => Promise<void>) | null>(null);
  readonly jumpToFile = output<JumpTarget>();

  @ViewChild('scroll', { static: true }) private scrollRef!: ElementRef<HTMLDivElement>;
  @ViewChild('pages', { static: true }) private pagesRef!: ElementRef<HTMLDivElement>;
  @ViewChild('pageInput') private pageInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('expCar') private expCarRef?: ElementRef<HTMLElement>;
  @ViewChild('expPop') private expPopRef?: ElementRef<HTMLElement>;

  protected readonly ZOOM_STEP = ZOOM_STEP;
  protected readonly hasDocument = signal(false);
  protected readonly error = signal(false);
  protected readonly compiling = signal(false);
  protected readonly stale = signal(false);
  protected readonly logOpen = signal(false);
  protected readonly currentPage = signal(1);
  protected readonly pageCount = signal(0);
  protected readonly zoom = signal(1.1);
  protected readonly editingPageInput = signal(false);
  protected readonly lastResult = signal<CompileResult | null>(null);

  protected readonly exportFormats = EXPORT_FORMATS;
  protected readonly exportMenuOpen = signal(false);
  protected readonly exportToast = signal('');
  private readonly lastExportFormatKey = signal<(typeof EXPORT_FORMATS)[number]['key']>(
    (localStorage.getItem(LAST_EXPORT_FORMAT_KEY) as
      (typeof EXPORT_FORMATS)[number]['key'] | null) ?? 'pdf',
  );
  protected readonly currentExportFormat = () =>
    EXPORT_FORMATS.find((f) => f.key === this.lastExportFormatKey()) ?? EXPORT_FORMATS[0];
  private exportToastTimeout: ReturnType<typeof setTimeout> | null = null;
  /**
   * The file the currently-shown PDF/synctex actually belong to — decoupled
   * from compileTarget() (the editor's active tab), which changes on every
   * tab switch (including a jump from a double-click/diagnostic-jump into a
   * different file). Reloading the PDF on every such switch would try to load
   * a PDF for whatever file just became active, which usually doesn't exist.
   * Only set when a compile actually targeted that file.
   */
  private compiledTarget: string | undefined;
  /** Whether compiledTarget is Markdown — gates double-click-to-source and the log panel's generated-file note, so it must track what was actually compiled, not the currently open tab. */
  protected readonly compiledIsMarkdown = signal(false);

  private fit = true;
  private doc: PdfDocumentProxy | null = null;
  private loadingTask: PdfLoadingTask | null = null;
  private loadToken = 0;
  private renderToken = 0;
  private activeRenders: RenderTask[] = [];
  private pages: RenderedPage[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private suppressScrollTracking = false;
  private compileInFlight = false;
  private captureShortcut = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) {
      return;
    }
    // Capture phase + stopPropagation: basicSetup's default CodeMirror keymap
    // binds Mod-Enter to insertBlankLine, which would otherwise still fire
    // (inserting a blank line and marking the doc stale) since CodeMirror's
    // own keydown listener runs before a bubble-phase document listener does.
    event.preventDefault();
    event.stopPropagation();
    void this.compile();
  };

  protected readonly pageInputValue = () => {
    if (!this.hasDocument()) {
      return '';
    }
    return this.editingPageInput()
      ? String(this.currentPage())
      : `${this.currentPage()}/${this.pageCount()}`;
  };

  protected readonly zoomLabel = () => `${Math.round(this.zoom() * 100)}%`;

  protected readonly errorCountLabel = () => {
    const count = this.lastResult()?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
    return pluralPl(count, 'błąd', 'błędy', 'błędów');
  };

  ngAfterViewInit(): void {
    document.addEventListener('keydown', this.captureShortcut, true);
    this.resizeObserver = new ResizeObserver(() => {
      // Deferred to the next frame: calling fitWidth() synchronously inside
      // the observer callback (which can itself resize the observed element,
      // e.g. a scrollbar appearing/disappearing after a re-render) is what
      // triggers the browser's "ResizeObserver loop completed with
      // undelivered notifications" warning.
      requestAnimationFrame(() => {
        if (this.fit) {
          this.fitWidth();
        }
      });
    });
    this.resizeObserver.observe(this.scrollRef.nativeElement);
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['projectId']) {
      this.compiledTarget = this.compileTarget();
      this.compiledIsMarkdown.set(this.isMarkdownProject());
      await this.loadPdf();
    }
  }

  onPageInputFocus(event: FocusEvent): void {
    this.editingPageInput.set(true);
    (event.target as HTMLInputElement).select();
  }

  onPageInputBlur(): void {
    this.editingPageInput.set(false);
  }

  onPageInputKeydown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.goToPage(parseInt(input.value, 10));
      input.blur();
    } else if (event.key === 'Escape') {
      input.blur();
    }
  }

  goToPage(page: number): void {
    const target = Math.max(1, Math.min(this.pageCount(), page || 1));
    this.currentPage.set(target);
    const pageEl = this.pages[target - 1]?.canvas;
    if (!pageEl) {
      return;
    }
    this.suppressScrollTracking = true;
    pageEl.scrollIntoView({ block: 'start' });
    this.scrollRef.nativeElement.scrollTop -= 24;
    setTimeout(() => {
      this.suppressScrollTracking = false;
    }, 300);
  }

  onScroll(): void {
    if (this.suppressScrollTracking || this.pages.length === 0) {
      return;
    }
    const containerRect = this.scrollRef.nativeElement.getBoundingClientRect();
    let current = 1;
    this.pages.forEach((page, index) => {
      const top = page.canvas.getBoundingClientRect().top;
      if (top <= containerRect.top + containerRect.height * CURRENT_PAGE_THRESHOLD) {
        current = index + 1;
      }
    });
    this.currentPage.set(current);
  }

  setZoom(value: number, manual: boolean): void {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value * 100) / 100));
    if (manual) {
      this.fit = false;
    }
    // Guards against a resize<->refit feedback loop: fitWidth() re-measures
    // the container on every ResizeObserver tick, and re-rendering the pages
    // (even to the same zoom) can itself change the container's scrollbar/
    // content size, re-triggering the observer. Skip the no-op render.
    if (clamped === this.zoom()) {
      return;
    }
    this.zoom.set(clamped);
    void this.rerenderAtCurrentZoom();
  }

  fitWidth(): void {
    this.fit = true;
    const firstPage = this.pages[0];
    if (!firstPage) {
      return;
    }
    const containerWidth = this.scrollRef.nativeElement.clientWidth - FIT_MARGIN_PX;
    const unscaledWidth = firstPage.viewportWidth / this.zoom();
    this.setZoom(containerWidth / unscaledWidth, false);
  }

  async compile(): Promise<void> {
    if (this.compileInFlight) {
      return;
    }
    this.compileInFlight = true;
    this.compiling.set(true);
    // Captured once up front: compileTarget()/isMarkdownProject() track the
    // active editor tab, which can change mid-compile (e.g. the user switches
    // tabs while a slow compile is still running) — the compile and its
    // PDF/log result must stay pinned to whichever file this specific compile
    // actually targeted.
    const target = this.compileTarget();
    const targetIsMarkdown = this.isMarkdownProject();
    try {
      await this.flushEditorSave()?.();
      const result = await this.api.compile(this.projectId(), target);
      this.lastResult.set(result);
      this.stale.set(false);
      if (!result.success) {
        this.logOpen.set(true);
      }
      if (result.pdfPath) {
        this.compiledTarget = target;
        this.compiledIsMarkdown.set(targetIsMarkdown);
        await this.loadPdf();
      }
    } finally {
      this.compiling.set(false);
      this.compileInFlight = false;
    }
  }

  markStale(): void {
    if (!this.compiling()) {
      this.stale.set(true);
    }
  }

  // ---------- export (split button) ----------

  @HostListener('document:click')
  protected closeExportMenu(): void {
    this.exportMenuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected handleExportEscape(): void {
    this.closeExportMenu();
  }

  protected toggleExportMenu(): void {
    if (this.exportMenuOpen()) {
      this.closeExportMenu();
      return;
    }
    this.exportMenuOpen.set(true);
    afterNextRender(
      () => {
        if (this.expPopRef && this.expCarRef) {
          placePopover(this.expPopRef.nativeElement, this.expCarRef.nativeElement, false, 'right');
        }
      },
      { injector: this.injector },
    );
  }

  protected async runExport(key: (typeof EXPORT_FORMATS)[number]['key']): Promise<void> {
    this.lastExportFormatKey.set(key);
    localStorage.setItem(LAST_EXPORT_FORMAT_KEY, key);

    if (key === 'zip') {
      this.downloadUrl(this.api.exportZipUrl(this.projectId()));
      return;
    }
    if (key === 'pdf') {
      if (!this.hasDocument() || this.stale()) {
        await this.compile();
        if (!this.hasDocument()) {
          this.showExportToast('Kompilacja nie powiodła się — brak PDF do eksportu.');
          return;
        }
      }
      this.downloadUrl(this.api.outputPdfUrl(this.projectId(), this.compiledTarget, Date.now()));
      return;
    }

    try {
      await this.flushEditorSave()?.();
      const { blob, filename } = await this.api.exportDocument(
        this.projectId(),
        key,
        this.compileTarget(),
      );
      const url = URL.createObjectURL(blob);
      this.downloadUrl(url, filename);
      URL.revokeObjectURL(url);
    } catch {
      this.showExportToast(
        'Eksport nie powiódł się. Sprawdź, czy dokument kompiluje się poprawnie.',
      );
    }
  }

  private downloadUrl(url: string, filename?: string): void {
    const a = document.createElement('a');
    a.href = url;
    if (filename) {
      a.download = filename;
    }
    a.click();
  }

  private showExportToast(message: string): void {
    this.exportToast.set(message);
    if (this.exportToastTimeout) {
      clearTimeout(this.exportToastTimeout);
    }
    this.exportToastTimeout = setTimeout(() => this.exportToast.set(''), 3200);
  }

  private async loadPdf(): Promise<void> {
    const token = ++this.loadToken;
    const projectId = this.projectId();
    if (!projectId) {
      return;
    }
    const keepPage = this.currentPage();
    const keepZoom = this.fit ? null : this.zoom();
    try {
      const pdfjs = await configureWorker();
      const url = this.api.outputPdfUrl(projectId, this.compiledTarget, Date.now());
      const loadingTask = pdfjs.getDocument({ url });
      const doc = await loadingTask.promise;
      if (token !== this.loadToken) {
        await loadingTask.destroy();
        return;
      }
      const previousTask = this.loadingTask;
      this.loadingTask = loadingTask;
      this.doc = doc;
      await previousTask?.destroy();
      this.error.set(false);
      this.hasDocument.set(true);
      this.pageCount.set(doc.numPages);
      await this.renderAllPages(keepZoom ?? this.zoom());
      this.currentPage.set(Math.min(keepPage, doc.numPages));
      if (keepZoom === null) {
        this.fitWidth();
      } else {
        this.goToPage(this.currentPage());
      }
    } catch (err) {
      if (token !== this.loadToken) {
        return;
      }
      // A 404 means "never compiled yet" (output.pdf doesn't exist), not a
      // real load failure — confirmed empirically: pdf.js rejects with a
      // ResponseException carrying the HTTP status as `.status`. Show the
      // neutral empty state for that, the red error only for an actual
      // failure to load/parse an existing PDF.
      const status = (err as { status?: number } | null)?.status;
      this.error.set(status !== 404);
      this.hasDocument.set(false);
      this.pageCount.set(0);
    }
  }

  private async rerenderAtCurrentZoom(): Promise<void> {
    if (!this.doc) {
      return;
    }
    const keepPage = this.currentPage();
    await this.renderAllPages(this.zoom());
    this.goToPage(keepPage);
  }

  private async renderAllPages(zoom: number): Promise<void> {
    const doc = this.doc;
    if (!doc) {
      return;
    }
    const token = ++this.renderToken;
    this.activeRenders.forEach((task) => task.cancel());
    this.activeRenders = [];

    const container = this.pagesRef.nativeElement;
    container.innerHTML = '';
    this.pages = [];

    const dpr = window.devicePixelRatio || 1;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      if (token !== this.renderToken) {
        return;
      }
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: zoom });
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page';
      canvas.width = Math.round(viewport.width * dpr);
      canvas.height = Math.round(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.dataset['page'] = String(pageNumber);
      canvas.addEventListener('dblclick', (event) =>
        this.onPageDoubleClick(event, pageNumber, viewport.height),
      );
      container.appendChild(canvas);
      this.pages.push({ canvas, viewportWidth: viewport.width, viewportHeight: viewport.height });

      const context = canvas.getContext('2d');
      if (!context) {
        continue;
      }
      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
      });
      this.activeRenders.push(renderTask);
      try {
        await renderTask.promise;
      } catch {
        // Cancelled by a newer render (zoom change / recompile) — expected, not an error.
      }
    }
  }

  private onPageDoubleClick(event: MouseEvent, pageNumber: number, viewportHeightPx: number): void {
    if (this.compiledIsMarkdown()) {
      return;
    }
    const canvas = event.target as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const zoom = this.zoom();
    // PDF points: PDF.js viewport scale already maps 1 CSS px == `zoom` scaled
    // points at 72 DPI, and PDF y grows upward from the page's bottom edge.
    const xPt = (event.clientX - rect.left) / zoom;
    const yPt = (viewportHeightPx - (event.clientY - rect.top)) / zoom;
    void this.api
      .synctexEdit(this.projectId(), pageNumber, xPt, yPt, this.compiledTarget)
      .then((result) => this.jumpToFile.emit({ path: result.path, line: result.line }))
      .catch(() => {
        // No mapped source location for this click (e.g. generated/whitespace area) — ignore.
      });
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.captureShortcut, true);
    this.resizeObserver?.disconnect();
    this.activeRenders.forEach((task) => task.cancel());
    void this.loadingTask?.destroy();
  }
}
