import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/api/api.service.js';
import { I18nService } from '../../core/i18n/i18n.service.js';
import { TranslatePipe } from '../../core/i18n/translate.pipe.js';
import type { Project } from '../../core/api/api.types.js';

const ENGINES = ['pdflatex', 'xelatex', 'lualatex'] as const;

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  template: `
    <div id="project-list-page" class="project-list-page">
      <h1 id="project-list-title">{{ 'project.list' | t }}</h1>

      @if (projects().length === 0) {
        <p id="project-list-empty">{{ 'project.none' | t }}</p>
      }

      <ul id="project-list">
        @for (project of projects(); track project.id) {
          <li [id]="'project-list-item-' + project.id" class="project-list-item">
            <span [id]="'project-name-' + project.id">{{ project.name }}</span>
            <button [id]="'project-open-' + project.id" type="button" (click)="open(project)">
              {{ 'project.open' | t }}
            </button>
            <button [id]="'project-delete-' + project.id" type="button" (click)="remove(project)">
              {{ 'project.delete' | t }}
            </button>
          </li>
        }
      </ul>

      <form id="project-create-form" (ngSubmit)="create()">
        <input
          id="project-create-name"
          name="name"
          type="text"
          [(ngModel)]="newName"
          [placeholder]="'project.name' | t"
          required
        />
        <select id="project-create-engine" name="engine" [(ngModel)]="newEngine">
          @for (engine of engines; track engine) {
            <option [value]="engine">{{ engine }}</option>
          }
        </select>
        <input
          id="project-create-main-file"
          name="mainFile"
          type="text"
          [(ngModel)]="newMainFile"
          [placeholder]="'project.mainFile' | t"
        />
        <button id="project-create-submit" type="submit">
          {{ 'project.create' | t }}
        </button>
      </form>
    </div>
  `,
  styles: [
    `
      .project-list-page {
        padding: 2rem;
        max-width: 32rem;
        margin: 0 auto;
      }
      #project-list {
        list-style: none;
        padding: 0;
      }
      .project-list-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0;
      }
      .project-list-item span {
        flex: 1;
      }
    `,
  ],
})
export class ProjectListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  protected readonly engines = ENGINES;
  protected readonly projects = signal<Project[]>([]);
  protected newName = '';
  protected newEngine: (typeof ENGINES)[number] = 'pdflatex';
  protected newMainFile = '';

  private profileId = '';

  async ngOnInit(): Promise<void> {
    this.profileId = this.route.snapshot.paramMap.get('profileId') ?? '';
    const all = await this.api.listProjects();
    this.projects.set(all.filter((p) => p.ownerProfileId === this.profileId));
  }

  open(project: Project): void {
    void this.router.navigate(['/projects', project.id]);
  }

  async remove(project: Project): Promise<void> {
    await this.api.deleteProject(project.id);
    this.projects.update((list) => list.filter((p) => p.id !== project.id));
  }

  async create(): Promise<void> {
    const name = this.newName.trim();
    if (!name) {
      return;
    }
    const project = await this.api.createProject({
      name,
      ownerProfileId: this.profileId,
      engine: this.newEngine,
      mainFile: this.newMainFile.trim() || undefined,
    });
    this.newName = '';
    this.newMainFile = '';
    this.projects.update((list) => [...list, project]);
  }
}
