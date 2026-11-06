import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ZipArchive } from 'archiver';
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

  describe('importArchive', () => {
    async function bufferFromArchive(
      archive: NodeJS.ReadableStream,
    ): Promise<Buffer> {
      const chunks: Buffer[] = [];
      for await (const chunk of archive) {
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    }

    /**
     * archiver strips leading "/" and ".." segments from entry names, so a
     * zip-slip archive can't be built through the normal append() API.
     * Byte-patches a same-length placeholder name to a traversal path in
     * the produced zip instead — the CRC covers the entry data, not the
     * name, so the archive stays valid.
     */
    function patchEntryName(buf: Buffer, from: string, to: string): Buffer {
      if (from.length !== to.length) {
        throw new Error('patchEntryName requires same-length strings');
      }
      const patched = Buffer.from(buf);
      const needle = Buffer.from(from);
      const replacement = Buffer.from(to);
      let index = 0;
      let found = 0;
      while ((index = patched.indexOf(needle, index)) !== -1) {
        replacement.copy(patched, index);
        index += needle.length;
        found++;
      }
      if (found === 0) {
        throw new Error(`placeholder name not found in archive: ${from}`);
      }
      return patched;
    }

    it('round-trips an export into a new project, including an empty directory and a Polish filename', async () => {
      service.writeFile(projectId, 'main.tex', Buffer.from('hello'));
      service.writeFile(
        projectId,
        'rozdziały/rozdział.tex',
        Buffer.from('\\chapter{Wstep}'),
      );
      service.createDir(projectId, 'empty');
      const zipBuffer = await bufferFromArchive(
        service.createArchive(projectId),
      );

      const importedId = randomUUID();
      service.createProjectDir(importedId);
      await service.importArchive(importedId, zipBuffer);

      const entries = service.listFiles(importedId);
      const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
      expect(byPath['main.tex']).toMatchObject({ isDirectory: false });
      expect(byPath['rozdziały/rozdział.tex']).toMatchObject({
        isDirectory: false,
      });
      expect(byPath['empty']).toMatchObject({ isDirectory: true });
      expect(
        service.readFile(importedId, 'rozdziały/rozdział.tex').toString(),
      ).toBe('\\chapter{Wstep}');
    });

    it('rejects a traversal entry name and writes nothing outside the project', async () => {
      const a = new ZipArchive();
      a.append(Buffer.from('pwn'), { name: 'xx/evil.txt' });
      void a.finalize();
      const clean = await bufferFromArchive(a);
      const malicious = patchEntryName(clean, 'xx/evil.txt', '../evil.txt');

      const importedId = randomUUID();
      service.createProjectDir(importedId);

      await expect(
        service.importArchive(importedId, malicious),
      ).rejects.toThrow(BadRequestException);
      expect(service.listFiles(importedId)).toEqual([]);

      const outsidePath = join(
        dirname(service.projectDir(importedId)),
        'evil.txt',
      );
      expect(existsSync(outsidePath)).toBe(false);
    });

    it('rejects an absolute entry path', async () => {
      const a = new ZipArchive();
      a.append(Buffer.from('pwn'), { name: 'xxxxxxxxxxxxx' });
      void a.finalize();
      const clean = await bufferFromArchive(a);
      const malicious = patchEntryName(clean, 'xxxxxxxxxxxxx', '/etc/passwd_x');

      const importedId = randomUUID();
      service.createProjectDir(importedId);

      await expect(
        service.importArchive(importedId, malicious),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a ZIP with too many entries', async () => {
      const a = new ZipArchive();
      for (let i = 0; i < 2001; i++) {
        a.append(Buffer.from('x'), { name: `f${i}.txt` });
      }
      void a.finalize();
      const zipBuffer = await bufferFromArchive(a);

      const importedId = randomUUID();
      service.createProjectDir(importedId);

      await expect(
        service.importArchive(importedId, zipBuffer),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects garbage bytes that are not a valid ZIP', async () => {
      const importedId = randomUUID();
      service.createProjectDir(importedId);

      await expect(
        service.importArchive(importedId, Buffer.from('not a zip')),
      ).rejects.toThrow(BadRequestException);
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
