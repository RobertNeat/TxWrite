import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnsafePathError } from '../../common/files/safe-path.js';
import { ProjectFilesService } from './project-files.service.js';

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
});
