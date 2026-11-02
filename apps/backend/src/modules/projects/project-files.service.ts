import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveSafePath } from '../../common/files/safe-path.js';
import { isValidUuid } from '../../common/ids.js';

@Injectable()
export class ProjectFilesService {
  private readonly projectsRoot: string;

  constructor(config: ConfigService) {
    const dataDir = config.get<string>('DATA_DIR', './.local-data/data');
    this.projectsRoot = join(dataDir, 'projects');
  }

  projectDir(projectId: string): string {
    if (!isValidUuid(projectId)) {
      throw new Error(`Invalid project id: ${projectId}`);
    }
    return join(this.projectsRoot, projectId);
  }

  createProjectDir(projectId: string): void {
    mkdirSync(this.projectDir(projectId), { recursive: true });
  }

  deleteProjectDir(projectId: string): void {
    rmSync(this.projectDir(projectId), { recursive: true, force: true });
  }

  readFile(projectId: string, relativePath: string): Buffer {
    const path = resolveSafePath(this.projectDir(projectId), relativePath);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new NotFoundException(`File not found: ${relativePath}`);
    }
    return readFileSync(path);
  }

  writeFile(projectId: string, relativePath: string, content: Buffer): void {
    const path = resolveSafePath(this.projectDir(projectId), relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  deleteFile(projectId: string, relativePath: string): void {
    const path = resolveSafePath(this.projectDir(projectId), relativePath);
    if (!existsSync(path)) {
      throw new NotFoundException(`File not found: ${relativePath}`);
    }
    rmSync(path, { force: true });
  }
}
