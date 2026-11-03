import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  OnInit,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service.js';
import { BrandComponent } from '../../shared/brand.component.js';
import { placePopover } from '../../shared/popover-position.js';
import type { Profile, Project } from '../../core/api/api.types.js';
import { FileTreeComponent } from '../file-tree/file-tree.component.js';
import { extensionOf, isTextFile, tagFor } from '../file-tree/file-tree.model.js';
import { EditorComponent, type JumpTarget } from '../editor/editor.component.js';
import { OutlineComponent } from '../outline/outline.component.js';
import { ToolbarComponent, type ToolbarEditorApi } from '../toolbar/toolbar.component.js';
import type { HeadingLevel } from '../toolbar/toolbar.model.js';
import { PdfPreviewComponent } from '../pdf-preview/pdf-preview.component.js';
import { StatusBarComponent } from '../status-bar/status-bar.component.js';

const SIDE_MIN = 240;
const SIDE_MAX = 520;
const EDITOR_MIN = 380;
const PREVIEW_MIN = 420;
const KEY_STEP = 32;

@Component({
  selector: 'app-project-workspace',
  standalone: true,
  imports: [
    FormsModule,
    BrandComponent,
    FileTreeComponent,
    EditorComponent,
    OutlineComponent,
    ToolbarComponent,
    PdfPreviewComponent,
    StatusBarComponent,
  ],
  templateUrl: './project-workspace.component.html',
  styleUrl: './project-workspace.component.css',
})
export class ProjectWorkspaceComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly tagFor = tagFor;

  protected readonly projectId = signal('');
  protected readonly project = signal<Project | null>(null);
  protected readonly profile = signal<Profile | null>(null);
  protected readonly profileWorkspaces = signal<Project[]>([]);
  protected readonly jumpTarget = signal<JumpTarget | null>(null);
  protected readonly editorContent = signal<{ path: string; content: string } | null>(null);
  protected readonly headingLevel = signal<HeadingLevel>('normal');
  protected readonly symbolsOpen = signal(false);
  protected readonly isMarkdownProject = signal(false);

  protected readonly workspacePopoverOpen = signal(false);
  protected workspaceQuery = '';

  // ---------- tabs ----------
  protected readonly openPaths = signal<string[]>([]);
  protected readonly activePath = signal<string | null>(null);

  // ---------- resizable panels (ported from app.js's mkResizer) ----------
  protected readonly sideWidth = signal(300);
  protected readonly editorWidth = signal<number | null>(null);

  @ViewChild('wsBtn') private wsBtn?: ElementRef<HTMLElement>;
  @ViewChild('wsPop') private wsPop?: ElementRef<HTMLElement>;
  @ViewChild('wsQuery') private wsQuery?: ElementRef<HTMLInputElement>;
  @ViewChild('mainGrid') private mainGrid?: ElementRef<HTMLElement>;
  @ViewChild('fileTree') private fileTree?: FileTreeComponent;
  @ViewChild('editor') private editor?: EditorComponent;
  @ViewChild('pdfPreview') private pdfPreview?: PdfPreviewComponent;

  protected readonly editorApi: ToolbarEditorApi = {
    applyEdit: (compute) => this.editor?.applyEdit(compute),
    undo: () => this.editor?.undo(),
    redo: () => this.editor?.redo(),
  };

  ngOnInit(): void {
    // Angular reuses this component instance when only the :projectId route
    // param changes (navigating workspace A -> B) — a one-shot ngOnInit load
    // from route.snapshot never re-runs on that second navigation. Subscribe
    // to paramMap instead so switching the working directory actually reloads.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      void this.loadProject(params.get('projectId') ?? '');
    });
  }

  private async loadProject(id: string): Promise<void> {
    this.projectId.set(id);
    if (!id) {
      return;
    }
    const project = await this.api.getProject(id);
    this.project.set(project);
    this.isMarkdownProject.set(project.mainFile?.toLowerCase().endsWith('.md') ?? false);
    this.openPaths.set(project.mainFile ? [project.mainFile] : []);
    this.activePath.set(project.mainFile || null);
    const [profiles, allProjects] = await Promise.all([
      this.api.listProfiles(),
      this.api.listProjects(),
    ]);
    this.profile.set(profiles.find((p) => p.id === project.ownerProfileId) ?? null);
    this.profileWorkspaces.set(
      allProjects.filter((p) => p.ownerProfileId === project.ownerProfileId),
    );
  }

  filteredWorkspaces(): Project[] {
    const q = this.workspaceQuery.trim().toLowerCase();
    if (!q) {
      return this.profileWorkspaces();
    }
    return this.profileWorkspaces().filter((p) => p.name.toLowerCase().includes(q));
  }

  toggleWorkspacePopover(): void {
    if (this.workspacePopoverOpen()) {
      this.closeWorkspacePopover();
      return;
    }
    this.workspaceQuery = '';
    this.workspacePopoverOpen.set(true);
    afterNextRender(
      () => {
        if (this.wsPop && this.wsBtn) {
          placePopover(this.wsPop.nativeElement, this.wsBtn.nativeElement, false);
        }
        this.wsQuery?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  closeWorkspacePopover(): void {
    this.workspacePopoverOpen.set(false);
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.closeWorkspacePopover();
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    this.closeWorkspacePopover();
  }

  switchWorkspace(target: Project): void {
    this.closeWorkspacePopover();
    if (target.id === this.projectId()) {
      return;
    }
    void this.router.navigate(['/projects', target.id]);
  }

  logout(): void {
    void this.router.navigate(['/']);
  }

  // ---------- file-tree toolbar buttons ----------

  newFile(): void {
    this.fileTree?.startNewFile();
  }

  newDir(): void {
    this.fileTree?.startNewDir();
  }

  onToolbarFileUploaded(): void {
    void this.fileTree?.refresh();
  }

  // ---------- tabs ----------

  openFile(path: string | null): void {
    if (!path) {
      return;
    }
    this.openPaths.update((paths) => (paths.includes(path) ? paths : [...paths, path]));
    this.activePath.set(path);
    this.jumpTarget.set(null);
  }

  activateTab(path: string): void {
    this.activePath.set(path);
    this.jumpTarget.set(null);
  }

  closeTab(path: string, event: MouseEvent): void {
    if (event.button !== undefined && event.button !== 0 && event.button !== 1) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    const paths = this.openPaths();
    if (paths.length === 1) {
      return;
    }
    const index = paths.indexOf(path);
    const next = paths.filter((p) => p !== path);
    this.openPaths.set(next);
    if (this.activePath() === path) {
      this.activePath.set(next[Math.max(0, index - 1)] ?? null);
    }
  }

  jumpToFile(target: JumpTarget): void {
    this.openFile(target.path);
    this.jumpTarget.set(target);
  }

  onEditorContentChanged(payload: { path: string; content: string } | null): void {
    this.editorContent.set(payload);
  }

  private static readonly STALE_EXTENSIONS = new Set(['tex', 'sty', 'cls', 'bib']);

  onDocEdited(path: string): void {
    if (ProjectWorkspaceComponent.STALE_EXTENSIONS.has(extensionOf(path))) {
      this.pdfPreview?.markStale();
    }
  }

  onHeadingLevelChanged(level: HeadingLevel): void {
    this.headingLevel.set(level);
  }

  protected readonly toolbarMode = computed<'tex' | 'md'>(() =>
    (this.activePath() ?? '').toLowerCase().endsWith('.md') ? 'md' : 'tex',
  );

  protected readonly toolbarEnabled = computed(() => {
    const path = this.activePath();
    return !!path && isTextFile(path);
  });

  /** Guards against the brief async window where the editor still holds the previous tab's payload. */
  protected readonly outlinePath = computed(() => {
    const payload = this.editorContent();
    return payload && payload.path === this.activePath() ? payload.path : null;
  });

  protected readonly outlineContent = computed(() => {
    const payload = this.editorContent();
    return payload && payload.path === this.activePath() ? payload.content : null;
  });

  jumpToOutlineTarget(target: JumpTarget): void {
    this.jumpTarget.set(target);
  }

  // ---------- resizable panels ----------

  private totalWidth(): number {
    return (this.mainGrid?.nativeElement.getBoundingClientRect().width ?? 0) - 12;
  }

  private clamp(): void {
    const total = this.totalWidth();
    this.sideWidth.set(Math.max(SIDE_MIN, Math.min(SIDE_MAX, this.sideWidth(), total - 800)));
    const edW = this.editorWidth();
    if (edW !== null) {
      this.editorWidth.set(
        Math.max(EDITOR_MIN, Math.min(total - this.sideWidth() - PREVIEW_MIN, edW)),
      );
    }
  }

  protected gridTemplateColumns(): string {
    const edW = this.editorWidth();
    return `${this.sideWidth()}px 6px ${edW === null ? 'minmax(0,1fr)' : `${edW}px`} 6px minmax(0,1fr)`;
  }

  private draggingResizer: 1 | 2 | null = null;

  startResize(which: 1 | 2, event: PointerEvent): void {
    this.draggingResizer = which;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  moveResize(which: 1 | 2, event: PointerEvent): void {
    if (this.draggingResizer !== which) {
      return;
    }
    const gridLeft = this.mainGrid?.nativeElement.getBoundingClientRect().left ?? 0;
    const x = event.clientX - gridLeft;
    if (which === 1) {
      this.sideWidth.set(x);
    } else {
      this.editorWidth.set(x - this.sideWidth() - 6);
    }
    this.clamp();
  }

  endResize(which: 1 | 2, event: PointerEvent): void {
    this.draggingResizer = null;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }

  keyResize(which: 1 | 2, event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -KEY_STEP : KEY_STEP;
    if (which === 1) {
      this.sideWidth.update((w) => w + delta);
    } else {
      this.editorWidth.update((w) => (w ?? this.estimateEditorWidth()) + delta);
    }
    this.clamp();
  }

  private estimateEditorWidth(): number {
    return this.totalWidth() - this.sideWidth() - PREVIEW_MIN;
  }
}
