import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
    const row = this.database.db
      .prepare('SELECT user_id FROM profiles WHERE id = ?')
      .get(profileId) as unknown as { user_id: string | null } | undefined;
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
    this.database.db
      .prepare(
        `INSERT INTO projects (id, name, owner_profile_id, engine, main_file)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.ownerProfileId, engine, mainFile);
    return this.findByIdOrThrow(id);
  }

  findAll(userId: string): Project[] {
    const rows = this.database.db
      .prepare(
        `SELECT p.* FROM projects p
         JOIN profiles pr ON pr.id = p.owner_profile_id
         WHERE pr.user_id = ?
         ORDER BY p.created_at`,
      )
      .all(userId) as unknown as ProjectRow[];
    return rows.map(toProject);
  }

  findById(id: string): Project | undefined {
    const row = this.database.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as unknown as ProjectRow | undefined;
    return row ? toProject(row) : undefined;
  }

  findByIdOrThrow(id: string): Project {
    const project = this.findById(id);
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  update(id: string, input: UpdateProjectInput): Project {
    this.findByIdOrThrow(id);
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      fields.push('name = ?');
      values.push(input.name);
    }
    if (input.engine !== undefined) {
      if (!isValidEngine(input.engine)) {
        throw new BadRequestException(`Invalid engine: ${input.engine}`);
      }
      fields.push('engine = ?');
      values.push(input.engine);
    }
    if (input.mainFile !== undefined) {
      if (!isValidMainFile(input.mainFile)) {
        throw new BadRequestException(`Invalid main file: ${input.mainFile}`);
      }
      fields.push('main_file = ?');
      values.push(input.mainFile);
    }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(id);
      this.database.db
        .prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`)
        .run(...(values as never[]));
    }

    return this.findByIdOrThrow(id);
  }

  delete(id: string): void {
    this.findByIdOrThrow(id);
    this.database.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
}
