import {
  Component,
  ElementRef,
  HostListener,
  OnChanges,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service.js';
import type { ProjectFileEntry } from '../../core/api/api.types.js';
import {
  type TreeNode,
  buildTree,
  findNode,
  findParent,
  subtreePaths,
  tagFor,
} from './file-tree.model.js';

type EditMode =
  | { kind: 'rename'; path: string }
  | { kind: 'new-file'; parentPath: string }
  | { kind: 'new-dir'; parentPath: string };

/** Flattened row for template rendering: a TreeNode plus its depth and expand state. */
interface TreeRow {
  node: TreeNode;
  depth: number;
}

@Component({
  selector: 'app-file-tree',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './file-tree.component.html',
  styleUrl: './file-tree.component.css',
})
export class FileTreeComponent implements OnChanges {
  private readonly api = inject(ApiService);

  readonly projectId = input.required<string>();
  readonly mainFile = input<string>('');
  readonly fileOpened = output<string | null>();

  protected readonly entries = signal<ProjectFileEntry[]>([]);
  protected readonly tree = computed(() => buildTree(this.entries()));
  protected readonly openDirs = signal<Set<string>>(new Set(['']));
  protected readonly selectedPath = signal<string>('');
  protected readonly edit = signal<EditMode | null>(null);
  protected editValue = '';

  protected readonly dragPath = signal<string | null>(null);
  protected readonly dropTargetPath = signal<string | null>(null);

  @ViewChild('editInput') private editInput?: ElementRef<HTMLInputElement>;

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['projectId']) {
      await this.refresh();
    }
  }

  async refresh(): Promise<void> {
    this.entries.set(await this.api.listFiles(this.projectId()));
  }

  protected tagFor = tagFor;

  protected isMainFile(path: string): boolean {
    return path === this.mainFile();
  }

  /** Each row optionally carries a trailing "new file/dir" input row for its directory, rendered inline. */
  protected rows(): (TreeRow | { newEntryParentPath: string; depth: number })[] {
    const out: (TreeRow | { newEntryParentPath: string; depth: number })[] = [];
    const open = this.openDirs();
    const edit = this.edit();
    const walk = (node: TreeNode, depth: number): void => {
      if (node.path !== '') {
        out.push({ node, depth });
      }
      const isOpenRoot = node.path === '' || open.has(node.path);
      if (node.isDirectory && isOpenRoot) {
        const childDepth = depth + (node.path === '' ? 0 : 1);
        if (edit && edit.kind !== 'rename' && edit.parentPath === node.path) {
          out.push({ newEntryParentPath: node.path, depth: childDepth });
        }
        for (const child of node.children) {
          walk(child, childDepth);
        }
      }
    };
    walk(this.tree(), 0);
    return out;
  }

  protected isNewEntryRow(
    row: TreeRow | { newEntryParentPath: string; depth: number },
  ): row is { newEntryParentPath: string; depth: number } {
    return 'newEntryParentPath' in row;
  }

  protected newEntryIsDir(): boolean {
    return this.edit()?.kind === 'new-dir';
  }

  protected isRenaming(path: string): boolean {
    const e = this.edit();
    return e?.kind === 'rename' && e.path === path;
  }

  protected currentDirPath(): string {
    const path = this.selectedPath();
    if (!path) {
      return '';
    }
    const node = findNode(this.tree(), path);
    if (node?.isDirectory) {
      return path;
    }
    return path.split('/').slice(0, -1).join('/');
  }

  // ---------- selection / navigation ----------

  selectBackground(): void {
    this.selectedPath.set('');
  }

  selectNode(node: TreeNode): void {
    this.selectedPath.set(node.path);
    if (node.isDirectory) {
      this.toggleDir(node.path);
    } else {
      this.fileOpened.emit(node.path);
    }
  }

  private toggleDir(path: string): void {
    this.openDirs.update((set) => {
      const next = new Set(set);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  // ---------- create / rename / delete ----------

  startNewFile(): void {
    const parentPath = this.currentDirPath();
    this.openDirs.update((set) => new Set(set).add(parentPath));
    this.edit.set({ kind: 'new-file', parentPath });
    this.focusEditInputSoon();
  }

  startNewDir(): void {
    const parentPath = this.currentDirPath();
    this.openDirs.update((set) => new Set(set).add(parentPath));
    this.edit.set({ kind: 'new-dir', parentPath });
    this.focusEditInputSoon();
  }

  startRename(node: TreeNode): void {
    this.edit.set({ kind: 'rename', path: node.path });
    this.editValue = node.name;
    this.focusEditInputSoon();
  }

  cancelEdit(): void {
    this.edit.set(null);
    this.editValue = '';
  }

  private focusEditInputSoon(): void {
    this.editValue = '';
    queueMicrotask(() => {
      setTimeout(() => this.editInput?.nativeElement.focus(), 0);
    });
  }

  private hasSibling(parentPath: string, name: string): boolean {
    const parent = findNode(this.tree(), parentPath);
    return (parent?.children ?? []).some((c) => c.name.toLowerCase() === name.toLowerCase());
  }

  async commitEdit(): Promise<void> {
    const mode = this.edit();
    const value = this.editValue.trim();
    if (!mode || !value) {
      this.edit.set(null);
      return;
    }
    if (/[\\/:*?"<>|]/.test(value)) {
      return;
    }

    if (mode.kind === 'rename') {
      const node = findNode(this.tree(), mode.path);
      if (!node) {
        this.edit.set(null);
        return;
      }
      const parentPath = mode.path.split('/').slice(0, -1).join('/');
      const to = parentPath ? `${parentPath}/${value}` : value;
      if (to !== mode.path) {
        await this.api.moveFile(this.projectId(), mode.path, to);
        if (this.selectedPath() === mode.path) {
          this.selectedPath.set(to);
        }
      }
      this.edit.set(null);
      await this.refresh();
      return;
    }

    const path = mode.parentPath ? `${mode.parentPath}/${value}` : value;
    if (mode.kind === 'new-dir') {
      if (this.hasSibling(mode.parentPath, value)) {
        return;
      }
      await this.api.createDir(this.projectId(), path);
      this.openDirs.update((set) => new Set(set).add(path));
    } else {
      const filePath = value.includes('.') ? path : `${path}.tex`;
      await this.api.writeFile(this.projectId(), filePath, '');
      this.selectedPath.set(filePath);
      this.fileOpened.emit(filePath);
    }
    this.edit.set(null);
    await this.refresh();
  }

  async deleteNode(node: TreeNode): Promise<void> {
    if (this.isMainFile(node.path)) {
      return;
    }
    await this.api.deleteFile(this.projectId(), node.path);
    if (this.selectedPath() === node.path) {
      this.selectedPath.set('');
      this.fileOpened.emit(null);
    }
    await this.refresh();
  }

  // ---------- drag & drop (move within tree) ----------

  handleDragStart(node: TreeNode, event: DragEvent): void {
    this.dragPath.set(node.path);
    event.dataTransfer?.setData('text/plain', node.path);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  handleDragEnd(): void {
    this.dragPath.set(null);
    this.dropTargetPath.set(null);
  }

  /**
   * Safety net for handleDragEnd(): dragend fires on the drag source, but if
   * the dragged row was re-rendered (tree refresh) mid-drag its listener is
   * detached and never fires, leaving the drop highlight stuck. Any dragend
   * anywhere in the document means the browser's drag operation is over.
   */
  @HostListener('document:dragend')
  handleDocumentDragEnd(): void {
    this.dragPath.set(null);
    this.dropTargetPath.set(null);
  }

  /** Clears the drop highlight when the pointer leaves the tree without dropping (external-file drag). */
  handleTreeDragLeave(event: DragEvent): void {
    const related = event.relatedTarget as Node | null;
    if (!related || !(event.currentTarget as HTMLElement).contains(related)) {
      this.dropTargetPath.set(null);
    }
  }

  handleDragOver(targetNode: TreeNode | null, event: DragEvent): void {
    const dragging = this.dragPath();
    const target = this.resolveDropTarget(targetNode);

    if (!dragging) {
      // External files dragged in from the OS — accept the drop (file list
      // isn't readable until the actual drop event, only dataTransfer.types).
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
        this.dropTargetPath.set(target);
      }
      return;
    }

    const draggedNode = findNode(this.tree(), dragging);
    if (!draggedNode) {
      return;
    }
    const draggedParent = findParent(this.tree(), dragging);
    const blocked =
      target === (draggedParent?.path ?? '') || subtreePaths(draggedNode).includes(target);
    if (blocked) {
      this.dropTargetPath.set(null);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dropTargetPath.set(target);
  }

  private resolveDropTarget(node: TreeNode | null): string {
    if (!node) {
      return '';
    }
    return node.isDirectory ? node.path : node.path.split('/').slice(0, -1).join('/');
  }

  async handleDrop(targetNode: TreeNode | null, event: DragEvent): Promise<void> {
    event.preventDefault();
    const target = this.dropTargetPath();
    this.dragPath.set(null);
    this.dropTargetPath.set(null);
    if (target === null) {
      return;
    }

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      await this.uploadFiles(files, target);
      return;
    }

    const dragging = event.dataTransfer?.getData('text/plain');
    if (!dragging) {
      return;
    }
    const name = dragging.split('/').pop() ?? dragging;
    const to = target ? `${target}/${name}` : name;
    if (to === dragging) {
      return;
    }
    await this.api.moveFile(this.projectId(), dragging, to);
    if (this.selectedPath() === dragging) {
      this.selectedPath.set(to);
    }
    await this.refresh();
  }

  /** Ports app.js's addFiles(): drops files from the OS straight into the target directory. */
  private async uploadFiles(files: FileList, targetDir: string): Promise<void> {
    const targetNode = findNode(this.tree(), targetDir);
    const existingNames = new Set((targetNode?.children ?? []).map((n) => n.name));
    await Promise.all(
      Array.from(files)
        .filter((file) => !existingNames.has(file.name))
        .map((file) => {
          const path = targetDir ? `${targetDir}/${file.name}` : file.name;
          return this.api.writeFile(this.projectId(), path, file);
        }),
    );
    this.openDirs.update((set) => new Set(set).add(targetDir));
    await this.refresh();
  }
}
