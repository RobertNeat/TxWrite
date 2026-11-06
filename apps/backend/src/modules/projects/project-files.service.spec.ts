import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromBufferPromise } from 'yauzl';
import { UnsafePathError } from '../../common/files/safe-path.js';
import { ProjectFilesService } from './project-files.service.js';

async function readArchiveEntryNames(
  archive: NodeJS.ReadableStream,
): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of archive) {
    chunks.push(chunk as Buffer);
  }
  // fromBufferPromise always forces lazyEntries:true internally, so each
  // entry must be drained with readEntry() or 'end' never fires.
  const zip = await fromBufferPromise(Buffer.concat(chunks));
  const names: string[] = [];
  return new Promise((resolve, reject) => {
    zip.on('entry', (entry) => {
      names.push(entry.fileName);
      zip.readEntry();
    });
    zip.on('end', () => resolve(names));
    zip.on('error', reject);
    zip.readEntry();
  });
}

describe('ProjectFilesService', () => {
  let service: ProjectFilesService;
  let dataDir: string;
  let projectId: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'project-files-test-'));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectFilesService,
        { provide: ConfigService, useValue: { get: () => dataDir } },
      ],
    }).compile();

    service = module.get(ProjectFilesService);
    projectId = randomUUID();
    service.createProjectDir(projectId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('writes then reads a file', () => {
    service.writeFile(projectId, 'main.tex', Buffer.from('hello'));
    expect(service.readFile(projectId, 'main.tex').toString()).toBe('hello');
  });

  it('creates nested directories on write', () => {
    service.writeFile(projectId, 'images/figure.svg', Buffer.from('<svg/>'));
    expect(service.readFile(projectId, 'images/figure.svg').toString()).toBe(
      '<svg/>',
    );
  });

  it('throws NotFoundException reading a missing file', () => {
    expect(() => service.readFile(projectId, 'missing.tex')).toThrow(
      NotFoundException,
    );
  });

  it('deletes a file', () => {
    service.writeFile(projectId, 'main.tex', Buffer.from('hello'));
    service.deleteFile(projectId, 'main.tex');
    expect(() => service.readFile(projectId, 'main.tex')).toThrow(
      NotFoundException,
    );
  });

  it('rejects path traversal on write', () => {
    expect(() =>
      service.writeFile(projectId, '../escape.tex', Buffer.from('x')),
    ).toThrow(UnsafePathError);
  });

  it('rejects path traversal on read', () => {
    expect(() => service.readFile(projectId, '../../etc/passwd')).toThrow(
      UnsafePathError,
    );
  });

  it('rejects an invalid project id', () => {
    expect(() => service.projectDir('not-a-uuid')).toThrow();
  });

  describe('createDir', () => {
    it('creates an empty directory that listFiles reports', () => {
      service.createDir(projectId, 'images');
      expect(service.listFiles(projectId)).toEqual([
        { path: 'images', size: 0, isDirectory: true },
      ]);
    });

    it('creates intermediate directories', () => {
      service.createDir(projectId, 'a/b/c');
      const paths = service.listFiles(projectId).map((e) => e.path);
      expect(paths).toEqual(['a', 'a/b', 'a/b/c']);
    });

    it('throws ConflictException if the directory already exists', () => {
      service.createDir(projectId, 'images');
      expect(() => service.createDir(projectId, 'images')).toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException if a file already exists at that path', () => {
      service.writeFile(projectId, 'images', Buffer.from('x'));
      expect(() => service.createDir(projectId, 'images')).toThrow(
        ConflictException,
      );
    });

    it('rejects path traversal', () => {
      expect(() => service.createDir(projectId, '../escape')).toThrow(
        UnsafePathError,
      );
    });
  });

  describe('listFiles', () => {
    it('returns an empty array for a project with no files', () => {
      expect(service.listFiles(projectId)).toEqual([]);
    });

    it('lists files and directories recursively', () => {
      service.writeFile(projectId, 'main.tex', Buffer.from('x'));
      service.writeFile(projectId, 'images/figure.svg', Buffer.from('<svg/>'));

      const entries = service.listFiles(projectId);
      const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));

      expect(byPath['main.tex']).toMatchObject({
        isDirectory: false,
        size: 1,
      });
      expect(byPath['images']).toMatchObject({ isDirectory: true });
      expect(byPath['images/figure.svg']).toMatchObject({
        isDirectory: false,
        size: 6,
      });
    });

    it('skips a symlink that escapes the project root', () => {
      const outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
      const projectDir = service.projectDir(projectId);
      symlinkSync(outsideDir, join(projectDir, 'escape'), 'junction');
      service.writeFile(projectId, 'main.tex', Buffer.from('x'));

      const entries = service.listFiles(projectId);
      expect(entries.map((e) => e.path)).toEqual(['main.tex']);

      rmSync(outsideDir, { recursive: true, force: true });
    });
  });

  describe('createArchive', () => {
    it('includes files, nested files, and empty directories', async () => {
      service.writeFile(projectId, 'main.tex', Buffer.from('hello'));
      service.writeFile(projectId, 'images/figure.svg', Buffer.from('<svg/>'));
      service.createDir(projectId, 'empty');

      const names = await readArchiveEntryNames(
        service.createArchive(projectId),
      );

      expect(names).toEqual(
        expect.arrayContaining(['main.tex', 'images/figure.svg', 'empty/']),
      );
    });

    it('excludes a symlink that escapes the project root', async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
      const projectDir = service.projectDir(projectId);
      symlinkSync(outsideDir, join(projectDir, 'escape'), 'junction');
      service.writeFile(projectId, 'main.tex', Buffer.from('x'));

      const names = await readArchiveEntryNames(
        service.createArchive(projectId),
      );

      expect(names).toEqual(['main.tex']);
      rmSync(outsideDir, { recursive: true, force: true });
    });
  });

  describe('moveFile', () => {
    it('moves a file to a new path', () => {
      service.writeFile(projectId, 'old.tex', Buffer.from('hello'));
      service.moveFile(projectId, 'old.tex', 'new.tex');

      expect(service.readFile(projectId, 'new.tex').toString()).toBe('hello');
      expect(() => service.readFile(projectId, 'old.tex')).toThrow(
        NotFoundException,
      );
    });

    it('creates intermediate directories for the destination', () => {
      service.writeFile(projectId, 'main.tex', Buffer.from('x'));
      service.moveFile(projectId, 'main.tex', 'chapters/main.tex');
      expect(service.readFile(projectId, 'chapters/main.tex').toString()).toBe(
        'x',
      );
    });

    it('throws NotFoundException when the source does not exist', () => {
      expect(() => service.moveFile(projectId, 'missing.tex', 'x.tex')).toThrow(
        NotFoundException,
      );
    });

    it('rejects traversal in the from path', () => {
      service.writeFile(projectId, 'main.tex', Buffer.from('x'));
      expect(() => service.moveFile(projectId, '../main.tex', 'x.tex')).toThrow(
        UnsafePathError,
      );
    });

    it('rejects traversal in the to path', () => {
      service.writeFile(projectId, 'main.tex', Buffer.from('x'));
      expect(() => service.moveFile(projectId, 'main.tex', '../x.tex')).toThrow(
        UnsafePathError,
      );
    });
  });
});
