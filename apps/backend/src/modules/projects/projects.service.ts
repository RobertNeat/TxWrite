import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { DatabaseService } from '../../common/database/database.service.js';
import {
  isValidEngine,
  isValidMainFile,
} from '../../common/compile-validation.js';
import type { Project } from './project.entity.js';

interface ProjectRow {
  id: string;
  name: string;
  owner_profile_id: string;
  engine: string;
  main_file: string;
  template_origin: string | null;
  created_at: string;
  updated_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    ownerProfileId: row.owner_profile_id,
    engine: row.engine,
    mainFile: row.main_file,
    templateOrigin: row.template_origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateProjectInput {
  name: string;
  ownerProfileId: string;
  engine?: string;
  mainFile?: string;
}

export interface UpdateProjectInput {
  name?: string;
  engine?: string;
  mainFile?: string;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly database: DatabaseService) {}

  /** Throws NotFound if the profile doesn't exist, Forbidden if it belongs to another user. */
  private assertOwnsProfile(profileId: string, userId: string): void {
    const row = this.database.get<{ user_id: string | null }>(
      'SELECT user_id FROM profiles WHERE id = ?',
      profileId,
    );
    if (!row) {
      throw new NotFoundException(`Profile ${profileId} not found`);
    }
    if (row.user_id !== userId) {
      throw new ForbiddenException('Profile belongs to another user');
    }
  }

  /** Used by every :projectId route (files, compile, export, synctex) to enforce ownership. */
  assertProjectAccess(projectId: string, userId: string): Project {
    const project = this.findByIdOrThrow(projectId);
    this.assertOwnsProfile(project.ownerProfileId, userId);
    return project;
  }

  create(input: CreateProjectInput, userId: string): Project {
    this.assertOwnsProfile(input.ownerProfileId, userId);
    const engine = input.engine ?? 'pdflatex';
    const mainFile = input.mainFile ?? 'main.tex';
    if (!isValidEngine(engine)) {
      throw new BadRequestException(`Invalid engine: ${engine}`);
    }
    if (!isValidMainFile(mainFile)) {
      throw new BadRequestException(`Invalid main file: ${mainFile}`);
    }

    const id = randomUUID();
    this.database.run(
      `INSERT INTO projects (id, name, owner_profile_id, engine, main_file)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.ownerProfileId,
      engine,
      mainFile,
    );
    return this.findByIdOrThrow(id);
  }

  findAll(userId: string): Project[] {
    return this.database
      .all<ProjectRow>(
        `SELECT p.* FROM projects p
         JOIN profiles pr ON pr.id = p.owner_profile_id
         WHERE pr.user_id = ?
         ORDER BY p.created_at`,
        userId,
      )
      .map(toProject);
  }

  findById(id: string): Project | undefined {
    const row = this.database.get<ProjectRow>(
      'SELECT * FROM projects WHERE id = ?',
      id,
    );
    return row ? toProject(row) : undefined;
  }

  findByIdOrThrow(id: string): Project {
    const project = this.findById(id);
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  // Explicit column whitelist — never build this from Object.keys(input),
  // which would let a column name come from caller-controlled input.
  private static readonly UPDATABLE_COLUMNS = {
    name: 'name',
    engine: 'engine',
    mainFile: 'main_file',
  } as const satisfies Record<keyof UpdateProjectInput, string>;

  update(id: string, input: UpdateProjectInput): Project {
    this.findByIdOrThrow(id);
    if (input.engine !== undefined && !isValidEngine(input.engine)) {
      throw new BadRequestException(`Invalid engine: ${input.engine}`);
    }
    if (input.mainFile !== undefined && !isValidMainFile(input.mainFile)) {
      throw new BadRequestException(`Invalid main file: ${input.mainFile}`);
    }

    const fields: string[] = [];
    const values: SQLInputValue[] = [];
    for (const key of Object.keys(
      ProjectsService.UPDATABLE_COLUMNS,
    ) as (keyof UpdateProjectInput)[]) {
      const value = input[key];
      if (value !== undefined) {
        fields.push(`${ProjectsService.UPDATABLE_COLUMNS[key]} = ?`);
        values.push(value);
      }
    }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(id);
      this.database.run(
        `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`,
        ...values,
      );
    }

    return this.findByIdOrThrow(id);
  }

  delete(id: string): void {
    this.findByIdOrThrow(id);
    this.database.run('DELETE FROM projects WHERE id = ?', id);
  }
}
