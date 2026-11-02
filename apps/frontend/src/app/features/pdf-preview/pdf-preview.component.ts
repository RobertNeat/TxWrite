import {
  Component,
  ElementRef,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
  input,
  signal,
} from '@angular/core';
import { ApiService } from '../../core/api/api.service.js';
import { TranslatePipe } from '../../core/i18n/translate.pipe.js';

type PdfDocumentProxy = import('pdfjs-dist').PDFDocumentProxy;
type PdfLoadingTask = import('pdfjs-dist').PDFDocumentLoadingTask;

let workerConfigured = false;

async function configureWorker(): Promise<typeof import('pdfjs-dist')> {
  const pdfjs = await import('pdfjs-dist');
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
    workerConfigured = true;
  }
  return pdfjs;
}

@Component({
  selector: 'app-pdf-preview',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div id="pdf-preview" class="pdf-preview">
      @if (error()) {
        <p id="pdf-preview-error" class="pdf-preview-error">{{ 'pdfPreview.error' | t }}</p>
      } @else if (!hasDocument()) {
        <p id="pdf-preview-empty">{{ 'pdfPreview.empty' | t }}</p>
      }
      <canvas id="pdf-preview-canvas" #canvas class="pdf-preview-canvas"></canvas>
    </div>
  `,
  styles: [
    `
      .pdf-preview {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
      }
      .pdf-preview-canvas {
        max-width: 100%;
        border: 1px solid #eee;
      }
      .pdf-preview-error {
        color: #c33;
      }
    `,
  ],
})
export class PdfPreviewComponent implements OnChanges, OnDestroy {
  private readonly api = inject(ApiService);

  readonly projectId = input.required<string>();
  readonly refreshToken = input<number>(0);

  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly hasDocument = signal(false);
  protected readonly error = signal(false);

  private loadingTask: PdfLoadingTask | null = null;
  private loadToken = 0;

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['projectId'] || changes['refreshToken']) {
      await this.loadPdf();
    }
  }

  private async loadPdf(): Promise<void> {
    const token = ++this.loadToken;
    const projectId = this.projectId();
    if (!projectId) {
      return;
    }
    try {
      const pdfjs = await configureWorker();
      const url = `${this.api.outputPdfUrl(projectId)}?t=${Date.now()}`;
      const loadingTask = pdfjs.getDocument({ url });
      const doc = await loadingTask.promise;
      if (token !== this.loadToken) {
        await loadingTask.destroy();
        return;
      }
      const previousTask = this.loadingTask;
      this.loadingTask = loadingTask;
      await previousTask?.destroy();
      this.error.set(false);
      this.hasDocument.set(true);
      await this.renderFirstPage(doc);
    } catch {
      if (token !== this.loadToken) {
        return;
      }
      this.error.set(true);
      this.hasDocument.set(false);
    }
  }

  private async renderFirstPage(doc: PdfDocumentProxy): Promise<void> {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = this.canvasRef.nativeElement;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
  }

  ngOnDestroy(): void {
    void this.loadingTask?.destroy();
  }
}
