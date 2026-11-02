import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FileTreeComponent } from '../file-tree/file-tree.component.js';
import { EditorComponent } from '../editor/editor.component.js';

@Component({
  selector: 'app-project-workspace',
  standalone: true,
  imports: [FileTreeComponent, EditorComponent],
  template: `
    <div id="project-workspace" class="project-workspace">
      <aside id="file-tree-pane" class="file-tree-pane">
        <app-file-tree [projectId]="projectId()" (fileOpened)="selectedPath.set($event)" />
      </aside>
      <main id="editor-pane" class="editor-pane">
        <app-editor [projectId]="projectId()" [filePath]="selectedPath()" />
      </main>
      <aside id="pdf-preview-pane" class="pdf-preview-pane">PDF preview (placeholder)</aside>
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
      .pdf-preview-pane {
        overflow: auto;
        padding: 0.5rem;
        border-right: 1px solid #eee;
      }
      .pdf-preview-pane {
        border-right: none;
        border-left: 1px solid #eee;
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

  protected readonly projectId = signal('');
  protected readonly selectedPath = signal<string | null>(null);

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
  }
}
