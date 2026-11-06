import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  createWriteStream,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, join, relative, sep } from 'node:path';
import { ZipArchive } from 'archiver';
import { fromBufferPromise } from 'yauzl';
import {
  resolveSafePath,
  UnsafePathError,
} from '../../common/files/safe-path.js';
import { isValidUuid } from '../../common/ids.js';

const IMPORT_MAX_ENTRIES = 2000;
const IMPORT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

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

  createDir(projectId: string, relativePath: string): void {
    const path = resolveSafePath(this.projectDir(projectId), relativePath);
    if (existsSync(path)) {
      throw new ConflictException(`Already exists: ${relativePath}`);
    }
    mkdirSync(path, { recursive: true });
  }

  deleteFile(projectId: string, relativePath: string): void {
    const path = resolveSafePath(this.projectDir(projectId), relativePath);
    if (!existsSync(path)) {
      throw new NotFoundException(`File not found: ${relativePath}`);
    }
    rmSync(path, { force: true, recursive: true });
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
   * Streams a ZIP of the whole project. Built from listFiles() rather than
   * archiver's own directory() walk so the symlink-confinement check there
   * (see its doc comment) also protects export — otherwise a symlink
   * planted inside the project could leak files from outside it into the
   * archive.
   */
  createArchive(projectId: string): ZipArchive {
    const projectDir = this.projectDir(projectId);
    const archive = new ZipArchive();
    for (const entry of this.listFiles(projectId)) {
      if (entry.isDirectory) {
        archive.append('', { name: `${entry.path}/` });
      } else {
        archive.file(join(projectDir, entry.path), { name: entry.path });
      }
    }
    void archive.finalize();
    return archive;
  }

  /**
   * Unpacks a ZIP buffer into an already-created, empty project directory.
   * Validates every entry (count, total size, path confinement) before
   * writing anything, so a rejected import never leaves a partial project
   * on disk. Entries are written as plain files/directories regardless of
   * their declared type — a "symlink" entry becomes an inert text file
   * rather than a real symlink, so an imported zip can never plant one that
   * later escapes the project root (see listFiles()'s symlink check).
   */
  async importArchive(projectId: string, zipBuffer: Buffer): Promise<void> {
    const projectDir = this.projectDir(projectId);

    let validation: { name: string; uncompressedSize: number }[];
    try {
      const probe = await fromBufferPromise(zipBuffer);
      validation = await this.readEntries(probe);
    } catch {
      throw new BadRequestException('Not a valid ZIP file');
    }

    if (validation.length > IMPORT_MAX_ENTRIES) {
      throw new BadRequestException(
        `ZIP has too many entries (max ${IMPORT_MAX_ENTRIES})`,
      );
    }
    const totalBytes = validation.reduce(
      (sum, e) => sum + e.uncompressedSize,
      0,
    );
    if (totalBytes > IMPORT_MAX_TOTAL_BYTES) {
      throw new BadRequestException(
        `ZIP is too large uncompressed (max ${IMPORT_MAX_TOTAL_BYTES} bytes)`,
      );
    }
    for (const entry of validation) {
      try {
        resolveSafePath(projectDir, entry.name);
      } catch (error) {
        if (error instanceof UnsafePathError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    }

    const zip = await fromBufferPromise(zipBuffer);
    for await (const entry of zip.eachEntry()) {
      const path = resolveSafePath(projectDir, entry.fileName);
      if (entry.fileName.endsWith('/')) {
        mkdirSync(path, { recursive: true });
        continue;
      }
      mkdirSync(dirname(path), { recursive: true });
      const readStream = await zip.openReadStreamPromise(entry);
      await pipeline(readStream, createWriteStream(path));
    }
  }

  private async readEntries(
    zip: Awaited<ReturnType<typeof fromBufferPromise>>,
  ): Promise<{ name: string; uncompressedSize: number }[]> {
    const entries: { name: string; uncompressedSize: number }[] = [];
    for await (const entry of zip.eachEntry()) {
      entries.push({
        name: entry.fileName,
        uncompressedSize: entry.uncompressedSize,
      });
    }
    return entries;
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
