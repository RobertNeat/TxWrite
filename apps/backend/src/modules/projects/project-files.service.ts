import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync,
  existsSync,
  statSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { resolveSafePath } from '../../common/files/safe-path.js';
import { isValidUuid } from '../../common/ids.js';

export interface ProjectFileEntry {
  path: string;
  size: number;
  isDirectory: boolean;
}

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

  moveFile(projectId: string, from: string, to: string): void {
    const projectDir = this.projectDir(projectId);
    const fromPath = resolveSafePath(projectDir, from);
    const toPath = resolveSafePath(projectDir, to);
    if (!existsSync(fromPath)) {
      throw new NotFoundException(`File not found: ${from}`);
    }
    mkdirSync(dirname(toPath), { recursive: true });
    renameSync(fromPath, toPath);
  }

  /**
   * Recursively lists every file and directory under the project root.
   * resolveSafePath only checks the *requested* path string for traversal
   * (`..`, absolute paths) — it does not protect against a symlink planted
   * inside the project (e.g. from an imported zip, later) whose *target*
   * resolves outside the project root. Each entry's real path is checked
   * against the project root's real path here, and anything that resolves
   * outside is skipped rather than listed or descended into.
   */
  listFiles(projectId: string): ProjectFileEntry[] {
    const projectDir = this.projectDir(projectId);
    if (!existsSync(projectDir)) {
      return [];
    }
    const realProjectDir = realpathSync(projectDir);
    const entries: ProjectFileEntry[] = [];
    this.walk(projectDir, realProjectDir, projectDir, entries);
    return entries;
  }

  private walk(
    dir: string,
    realProjectDir: string,
    projectDir: string,
    out: ProjectFileEntry[],
  ): void {
    for (const name of readdirSync(dir)) {
      const fullPath = join(dir, name);
      let realFullPath: string;
      try {
        realFullPath = realpathSync(fullPath);
      } catch {
        continue; // broken symlink or race with a concurrent delete
      }
      if (
        realFullPath !== realProjectDir &&
        !realFullPath.startsWith(realProjectDir + sep)
      ) {
        continue; // symlink escaping the project root
      }

      const stat = statSync(fullPath);
      const relPath = relative(projectDir, fullPath).split(sep).join('/');
      if (stat.isDirectory()) {
        out.push({ path: relPath, size: 0, isDirectory: true });
        this.walk(fullPath, realProjectDir, projectDir, out);
      } else if (stat.isFile()) {
        out.push({ path: relPath, size: stat.size, isDirectory: false });
      }
    }
  }
}
