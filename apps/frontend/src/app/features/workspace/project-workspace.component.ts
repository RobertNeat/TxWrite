import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/api/api.service.js';
import type { CompileResult } from '../../core/api/api.types.js';
import { FileTreeComponent } from '../file-tree/file-tree.component.js';
import { EditorComponent, type JumpTarget } from '../editor/editor.component.js';
import { CompilePanelComponent } from '../compile-panel/compile-panel.component.js';
import { PdfPreviewComponent } from '../pdf-preview/pdf-preview.component.js';

@Component({
  selector: 'app-project-workspace',
  standalone: true,
  imports: [FileTreeComponent, EditorComponent, CompilePanelComponent, PdfPreviewComponent],
  template: `
    <div id="project-workspace" class="project-workspace">
      <aside id="file-tree-pane" class="file-tree-pane">
        <app-file-tree [projectId]="projectId()" (fileOpened)="openFile($event)" />
      </aside>
      <main id="editor-pane" class="editor-pane">
        <app-editor
          [projectId]="projectId()"
          [filePath]="selectedPath()"
          [jumpTarget]="jumpTarget()"
        />
      </main>
      <aside id="compile-pdf-pane" class="compile-pdf-pane">
        <app-compile-panel
          [projectId]="projectId()"
          [isMarkdownProject]="isMarkdownProject()"
          (jumpToFile)="jumpToFile($event)"
          (compiled)="onCompiled($event)"
        />
        <div id="pdf-preview-pane" class="pdf-preview-pane">
          <app-pdf-preview [projectId]="projectId()" [refreshToken]="pdfRefreshToken()" />
        </div>
      </aside>
    </div>
  `,
  styles: [
    `
      .project-workspace {
        display: grid;
        grid-template-columns: 220px 1fr 360px;
        height: 100%;
        min-height: 0;
      }
      .file-tree-pane,
      .compile-pdf-pane {
        overflow: auto;
        padding: 0.5rem;
        border-right: 1px solid #eee;
      }
      .compile-pdf-pane {
        border-right: none;
        border-left: 1px solid #eee;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .editor-pane {
        min-width: 0;
        overflow: auto;
      }
    `,
  ],
})
export class ProjectWorkspaceComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);

  protected readonly projectId = signal('');
  protected readonly selectedPath = signal<string | null>(null);
  protected readonly jumpTarget = signal<JumpTarget | null>(null);
  protected readonly isMarkdownProject = signal(false);
  protected readonly pdfRefreshToken = signal(0);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('projectId') ?? '';
    this.projectId.set(id);
    if (id) {
      const project = await this.api.getProject(id);
      this.isMarkdownProject.set(project.mainFile?.toLowerCase().endsWith('.md') ?? false);
    }
  }

  openFile(path: string | null): void {
    this.selectedPath.set(path);
    this.jumpTarget.set(null);
  }

  jumpToFile(target: JumpTarget): void {
    this.selectedPath.set(target.path);
    this.jumpTarget.set(target);
  }

  onCompiled(result: CompileResult): void {
    if (result.pdfPath) {
      this.pdfRefreshToken.update((n) => n + 1);
    }
  }
}
