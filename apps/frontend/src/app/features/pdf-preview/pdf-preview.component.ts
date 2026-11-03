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
  signal,
} from '@angular/core';
import { ApiService } from '../../core/api/api.service.js';
import { TranslatePipe } from '../../core/i18n/translate.pipe.js';
import type { CompileResult } from '../../core/api/api.types.js';
import type { JumpTarget } from '../editor/editor.component.js';
import { CompilePanelComponent } from '../compile-panel/compile-panel.component.js';

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
      </div>

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
            <span id="pv-log-count" class="cnt">{{ warningLabel() }}</span>
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
              [projectId]="projectId()"
              [isMarkdownProject]="isMarkdownProject()"
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

  readonly projectId = input.required<string>();
  readonly isMarkdownProject = input<boolean>(false);
  /** The file compile/preview/synctex should target — defaults to the project's mainFile when absent. */
  readonly compileTarget = input<string | undefined>(undefined);
  /** Flushes a pending debounced editor save before compiling, since compile reads from disk. */
  readonly flushEditorSave = input<(() => Promise<void>) | null>(null);
  readonly jumpToFile = output<JumpTarget>();

  @ViewChild('scroll', { static: true }) private scrollRef!: ElementRef<HTMLDivElement>;
  @ViewChild('pages', { static: true }) private pagesRef!: ElementRef<HTMLDivElement>;
  @ViewChild('pageInput') private pageInputRef?: ElementRef<HTMLInputElement>;

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

  protected readonly pageInputValue = () =>
    this.editingPageInput()
      ? String(this.currentPage())
      : `${this.currentPage()}/${this.pageCount()}`;

  protected readonly zoomLabel = () => `${Math.round(this.zoom() * 100)}%`;

  protected readonly warningLabel = () => {
    const count =
      this.lastResult()?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0;
    return count === 1 ? '1 ostrzeżenie' : `${count} ostrzeżenia`;
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
    if (changes['projectId'] || changes['compileTarget']) {
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
    try {
      await this.flushEditorSave()?.();
      const result = await this.api.compile(this.projectId(), this.compileTarget());
      this.lastResult.set(result);
      this.stale.set(false);
      if (!result.success) {
        this.logOpen.set(true);
      }
      if (result.pdfPath) {
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
      const url = this.api.outputPdfUrl(projectId, this.compileTarget(), Date.now());
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
    } catch {
      if (token !== this.loadToken) {
        return;
      }
      this.error.set(true);
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
    if (this.isMarkdownProject()) {
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
      .synctexEdit(this.projectId(), pageNumber, xPt, yPt, this.compileTarget())
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
