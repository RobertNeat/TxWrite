import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api/api.service.js';
import { TranslatePipe } from '../../core/i18n/translate.pipe.js';
import type { ProjectFileEntry } from '../../core/api/api.types.js';

@Component({
  selector: 'app-file-tree',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  template: `
    <div id="file-tree" class="file-tree">
      <ul id="file-tree-list" class="file-tree-list">
        @for (entry of sortedEntries(); track entry.path) {
          <li
            [id]="'file-tree-item-' + entry.path"
            class="file-tree-item"
            [class.selected]="entry.path === selectedPath()"
          >
            @if (entry.isDirectory) {
              <span [id]="'file-tree-dir-' + entry.path" class="file-tree-dir">{{
                entry.path
              }}</span>
            } @else {
              <button
                [id]="'file-tree-open-' + entry.path"
                type="button"
                class="file-tree-file"
                (click)="select(entry)"
              >
                {{ entry.path }}
              </button>
              <button [id]="'file-tree-rename-' + entry.path" type="button" (click)="rename(entry)">
                {{ 'fileTree.rename' | t }}
              </button>
              <button [id]="'file-tree-delete-' + entry.path" type="button" (click)="remove(entry)">
                {{ 'fileTree.delete' | t }}
              </button>
            }
          </li>
        }
      </ul>

      <form id="file-tree-create-form" (ngSubmit)="create()">
        <input id="file-tree-create-name" name="newPath" type="text" [(ngModel)]="newPath" />
        <button id="file-tree-create-submit" type="submit">
          {{ 'fileTree.new' | t }}
        </button>
      </form>
    </div>
  `,
  styles: [
    `
      .file-tree-list {
        list-style: none;
        padding: 0;
        margin: 0 0 0.5rem 0;
      }
      .file-tree-item {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .file-tree-item.selected .file-tree-file {
        font-weight: 600;
      }
      .file-tree-file {
        flex: 1;
        text-align: left;
      }
      .file-tree-dir {
        font-style: italic;
        color: #777;
      }
    `,
  ],
})
export class FileTreeComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly projectId = input.required<string>();
  readonly fileOpened = output<string | null>();

  protected readonly entries = signal<ProjectFileEntry[]>([]);
  protected readonly selectedPath = signal<string | null>(null);
  protected readonly sortedEntries = computed(() =>
    [...this.entries()].sort((a, b) => a.path.localeCompare(b.path)),
  );
  protected newPath = '';

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.entries.set(await this.api.listFiles(this.projectId()));
  }

  select(entry: ProjectFileEntry): void {
    this.selectedPath.set(entry.path);
    this.fileOpened.emit(entry.path);
  }

  async create(): Promise<void> {
    const path = this.newPath.trim();
    if (!path) {
      return;
    }
    await this.api.writeFile(this.projectId(), path, '');
    this.newPath = '';
    await this.refresh();
  }

  async rename(entry: ProjectFileEntry): Promise<void> {
    const to = globalThis.prompt?.(entry.path, entry.path)?.trim();
    if (!to || to === entry.path) {
      return;
    }
    await this.api.moveFile(this.projectId(), entry.path, to);
    if (this.selectedPath() === entry.path) {
      this.selectedPath.set(null);
      this.fileOpened.emit(null);
    }
    await this.refresh();
  }

  async remove(entry: ProjectFileEntry): Promise<void> {
    await this.api.deleteFile(this.projectId(), entry.path);
    if (this.selectedPath() === entry.path) {
      this.selectedPath.set(null);
      this.fileOpened.emit(null);
    }
    await this.refresh();
  }
}
