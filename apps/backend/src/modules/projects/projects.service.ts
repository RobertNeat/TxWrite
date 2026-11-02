import {
  BadRequestException,
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

  create(input: CreateProjectInput): Project {
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

  findAll(): Project[] {
    const rows = this.database.db
      .prepare('SELECT * FROM projects ORDER BY created_at')
      .all() as unknown as ProjectRow[];
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
