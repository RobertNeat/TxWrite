import {
  Component,
  ElementRef,
  HostListener,
  Injector,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { placePopover } from '../../shared/popover-position.js';
import type { ProjectFileEntry } from '../../core/api/api.types.js';
import { ApiService } from '../../core/api/api.service.js';
import {
  HEADING_OPTIONS,
  SYMBOL_CATEGORIES,
  SYMBOL_CATEGORY_TABS,
  type SymbolEntry,
} from './toolbar.data.js';
import {
  MD_HEADING_PREFIX,
  TEMPLATES,
  applyHeading as applyHeadingEdit,
  insertFigure as insertFigureEdit,
  insertLink as insertLinkEdit,
  insertRaw as insertRawEdit,
  insertTable as insertTableEdit,
  insertTemplate as insertTemplateEdit,
  type EditorMode,
  type HeadingLevel,
} from './toolbar.model.js';

type MenuKey = 'heading' | 'math' | 'figure' | 'table' | 'list';

interface FigureMenuState {
  view: 'menu' | 'files';
}

export interface ToolbarEditorApi {
  applyEdit(
    compute: (doc: string, from: number, to: number) => ReturnType<typeof insertRawEdit>,
  ): void;
  undo(): void;
  redo(): void;
}

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.css',
})
export class ToolbarComponent {
  private readonly injector = inject(Injector);
  private readonly api = inject(ApiService);

  readonly projectId = input.required<string>();
  readonly mode = input<EditorMode>('tex');
  readonly headingLevel = input<HeadingLevel>('normal');
  readonly enabled = input<boolean>(false);
  readonly editorApi = input<ToolbarEditorApi | null>(null);

  readonly symbolsOpenChange = output<boolean>();
  readonly fileUploaded = output<void>();

  protected readonly headingOptions = HEADING_OPTIONS;
  protected readonly headingLabel = computed(
    () =>
      HEADING_OPTIONS.find((h) => h.level === this.headingLevel())?.label ??
      HEADING_OPTIONS[0].label,
  );
  protected readonly openMenu = signal<MenuKey | null>(null);
  protected readonly symbolsOpen = signal(false);

  protected readonly figureState = signal<FigureMenuState>({ view: 'menu' });
  protected readonly projectImages = signal<ProjectFileEntry[]>([]);

  protected readonly symbolQuery = signal('');
  protected readonly symbolCategory = signal(SYMBOL_CATEGORY_TABS[0][0]);
  protected readonly symbolCategoryTabs = SYMBOL_CATEGORY_TABS;
  protected readonly hoveredSymbolCommand = signal<string | null>(null);

  protected readonly visibleSymbols = computed<SymbolEntry[]>(() => {
    const query = this.symbolQuery().trim().toLowerCase();
    if (!query) {
      return SYMBOL_CATEGORIES[this.symbolCategory()];
    }
    const results: SymbolEntry[] = [];
    for (const [key, label] of SYMBOL_CATEGORY_TABS) {
      for (const entry of SYMBOL_CATEGORIES[key]) {
        const haystack = `${entry[0]} ${entry[1]} ${label}`.toLowerCase();
        if (haystack.includes(query)) {
          results.push(entry);
        }
      }
    }
    return results;
  });

  @ViewChild('headingBtn') private headingBtn?: ElementRef<HTMLElement>;
  @ViewChild('headingPop') private headingPop?: ElementRef<HTMLElement>;
  @ViewChild('mathBtn') private mathBtn?: ElementRef<HTMLElement>;
  @ViewChild('mathPop') private mathPop?: ElementRef<HTMLElement>;
  @ViewChild('figureBtn') private figureBtn?: ElementRef<HTMLElement>;
  @ViewChild('figurePop') private figurePop?: ElementRef<HTMLElement>;
  @ViewChild('tableBtn') private tableBtn?: ElementRef<HTMLElement>;
  @ViewChild('tablePop') private tablePop?: ElementRef<HTMLElement>;
  @ViewChild('listBtn') private listBtn?: ElementRef<HTMLElement>;
  @ViewChild('listPop') private listPop?: ElementRef<HTMLElement>;
  @ViewChild('uploadInput') private uploadInput?: ElementRef<HTMLInputElement>;

  protected readonly tableHover = signal<{ rows: number; cols: number }>({ rows: 0, cols: 0 });
  protected readonly tableGridCells = Array.from({ length: 100 }, (_, i) => ({
    row: Math.floor(i / 10) + 1,
    col: (i % 10) + 1,
  }));

  // ---------- menu open/close ----------

  toggleMenu(key: MenuKey): void {
    if (this.openMenu() === key) {
      this.closeMenus();
      return;
    }
    this.openMenu.set(key);
    if (key === 'figure') {
      this.figureState.set({ view: 'menu' });
    }
    if (key === 'table') {
      this.tableHover.set({ rows: 0, cols: 0 });
    }
    afterNextRender(() => this.positionOpenMenu(), { injector: this.injector });
  }

  private positionOpenMenu(): void {
    const key = this.openMenu();
    const pairs: [
      MenuKey,
      ElementRef<HTMLElement> | undefined,
      ElementRef<HTMLElement> | undefined,
    ][] = [
      ['heading', this.headingBtn, this.headingPop],
      ['math', this.mathBtn, this.mathPop],
      ['figure', this.figureBtn, this.figurePop],
      ['table', this.tableBtn, this.tablePop],
      ['list', this.listBtn, this.listPop],
    ];
    for (const [pairKey, btn, pop] of pairs) {
      if (pairKey === key && btn && pop) {
        placePopover(pop.nativeElement, btn.nativeElement, false, 'left');
      }
    }
  }

  closeMenus(): void {
    this.openMenu.set(null);
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.closeMenus();
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    this.closeMenus();
  }

  stop(event: Event): void {
    event.stopPropagation();
  }

  // ---------- simple actions ----------

  protected applyEdit(
    compute: (doc: string, from: number, to: number) => ReturnType<typeof insertRawEdit>,
  ): void {
    this.editorApi()?.applyEdit(compute);
  }

  undo(): void {
    this.editorApi()?.undo();
  }

  redo(): void {
    this.editorApi()?.redo();
  }

  bold(): void {
    this.applyEdit((doc, from, to) =>
      insertTemplateEdit(doc, { from, to }, TEMPLATES[this.mode()]['bold']),
    );
  }

  italic(): void {
    this.applyEdit((doc, from, to) =>
      insertTemplateEdit(doc, { from, to }, TEMPLATES[this.mode()]['italic']),
    );
  }

  insertLink(): void {
    this.applyEdit((doc, from, to) => insertLinkEdit(doc, { from, to }, this.mode()));
  }

  insertRef(): void {
    this.applyEdit((doc, from, to) =>
      insertTemplateEdit(doc, { from, to }, TEMPLATES[this.mode()]['ref']),
    );
  }

  insertCite(): void {
    this.applyEdit((doc, from, to) =>
      insertTemplateEdit(doc, { from, to }, TEMPLATES[this.mode()]['cite']),
    );
  }

  // ---------- heading menu ----------

  selectHeading(level: HeadingLevel): void {
    this.closeMenus();
    this.applyEdit((doc, from) => applyHeadingEdit(doc, from, this.mode(), level));
  }

  protected headingCommandHint(level: HeadingLevel): string | null {
    if (level === 'normal') {
      return null;
    }
    return this.mode() === 'md' ? MD_HEADING_PREFIX[level] : `\\${level}`;
  }

  // ---------- math menu ----------

  insertMath(kind: 'inline' | 'display'): void {
    this.closeMenus();
    this.applyEdit((doc, from, to) =>
      insertTemplateEdit(doc, { from, to }, TEMPLATES[this.mode()][kind], kind === 'display'),
    );
  }

  // ---------- list menu ----------

  insertList(kind: 'ul' | 'ol'): void {
    this.closeMenus();
    this.applyEdit((doc, from, to) =>
      insertTemplateEdit(doc, { from, to }, TEMPLATES[this.mode()][kind], true),
    );
  }

  // ---------- table grid ----------

  hoverTableCell(rows: number, cols: number): void {
    this.tableHover.set({ rows, cols });
  }

  selectTableCell(rows: number, cols: number): void {
    this.closeMenus();
    this.applyEdit((doc, from, to) => insertTableEdit(doc, { from, to }, this.mode(), rows, cols));
  }

  moveTableCell(event: KeyboardEvent, row: number, col: number): void {
    const deltas: Record<string, [number, number]> = {
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
    };
    const delta = deltas[event.key];
    if (!delta) {
      return;
    }
    event.preventDefault();
    const nextRow = Math.max(1, Math.min(10, row + delta[0]));
    const nextCol = Math.max(1, Math.min(10, col + delta[1]));
    const id = `tbl-cell-${nextRow}-${nextCol}`;
    document.getElementById(id)?.focus();
  }

  // ---------- figure menu ----------

  async openFigureFiles(): Promise<void> {
    const entries = await this.api.listFiles(this.projectId());
    this.projectImages.set(
      entries.filter((e) => !e.isDirectory && /\.(png|jpe?g|pdf|svg)$/i.test(e.path)),
    );
    this.figureState.set({ view: 'files' });
    afterNextRender(() => this.positionOpenMenu(), { injector: this.injector });
  }

  backToFigureMenu(): void {
    this.figureState.set({ view: 'menu' });
    afterNextRender(() => this.positionOpenMenu(), { injector: this.injector });
  }

  selectFigurePath(path: string): void {
    this.closeMenus();
    this.applyEdit((doc, from, to) => insertFigureEdit(doc, { from, to }, this.mode(), path));
  }

  triggerUpload(): void {
    this.closeMenus();
    this.uploadInput?.nativeElement.click();
  }

  async onUploadFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    const path = `obrazy/${file.name}`;
    await this.api.writeFile(this.projectId(), path, file);
    this.fileUploaded.emit();
    this.applyEdit((doc, from, to) => insertFigureEdit(doc, { from, to }, this.mode(), path));
  }

  // ---------- symbols panel ----------

  toggleSymbols(): void {
    const next = !this.symbolsOpen();
    this.symbolsOpen.set(next);
    this.symbolsOpenChange.emit(next);
    if (next) {
      afterNextRender(() => document.getElementById('symbols-search')?.focus(), {
        injector: this.injector,
      });
    }
  }

  closeSymbols(): void {
    this.symbolsOpen.set(false);
    this.symbolsOpenChange.emit(false);
  }

  selectSymbolCategory(key: string): void {
    this.symbolQuery.set('');
    this.symbolCategory.set(key);
  }

  hoverSymbol(entry: SymbolEntry | null): void {
    this.hoveredSymbolCommand.set(entry ? entry[1] : null);
  }

  insertSymbol(entry: SymbolEntry): void {
    const insertText = entry[2] ?? `${entry[1]} `;
    this.applyEdit((doc, from, to) => insertTemplateEdit(doc, { from, to }, insertText));
  }
}
