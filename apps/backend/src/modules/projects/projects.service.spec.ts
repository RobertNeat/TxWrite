import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ProjectsService } from './projects.service.js';

describe('ProjectsService', () => {
  let projects: ProjectsService;
  let profiles: ProfilesService;
  let ownerId: string;
  const userId = 'user-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        ProfilesService,
        DatabaseService,
        {
          provide: ConfigService,
          useValue: { get: () => ':memory:' },
        },
      ],
    }).compile();

    projects = module.get(ProjectsService);
    profiles = module.get(ProfilesService);
    const database = module.get(DatabaseService);
    database.db
      .prepare('INSERT INTO users (id, display_name) VALUES (?, ?)')
      .run(userId, 'Test User');
    database.db
      .prepare('INSERT INTO users (id, display_name) VALUES (?, ?)')
      .run('other-user', 'Other User');
    ownerId = profiles.create('Owner', userId).id;
  });

  it('creates a project with defaults', () => {
    const project = projects.create(
      { name: 'Paper', ownerProfileId: ownerId },
      userId,
    );
    expect(project.name).toBe('Paper');
    expect(project.engine).toBe('pdflatex');
    expect(project.mainFile).toBe('main.tex');
    expect(project.templateOrigin).toBeNull();
  });

  it('creates a project with an explicit engine and main file', () => {
    const project = projects.create(
      {
        name: 'Thesis',
        ownerProfileId: ownerId,
        engine: 'xelatex',
        mainFile: 'thesis.tex',
      },
      userId,
    );
    expect(project.engine).toBe('xelatex');
    expect(project.mainFile).toBe('thesis.tex');
  });

  it('throws when the owner profile does not exist', () => {
    expect(() =>
      projects.create({ name: 'Orphan', ownerProfileId: 'missing' }, userId),
    ).toThrow(NotFoundException);
  });

  it('throws when the owner profile belongs to another user', () => {
    expect(() =>
      projects.create(
        { name: 'Orphan', ownerProfileId: ownerId },
        'other-user',
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects an invalid engine on create', () => {
    expect(() =>
      projects.create(
        {
          name: 'Bad',
          ownerProfileId: ownerId,
          engine: 'sh; rm -rf /',
        },
        userId,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an unsafe main file on create', () => {
    expect(() =>
      projects.create(
        {
          name: 'Bad',
          ownerProfileId: ownerId,
          mainFile: '../outside.tex',
        },
        userId,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an invalid engine on update', () => {
    const project = projects.create(
      { name: 'Paper', ownerProfileId: ownerId },
      userId,
    );
    expect(() => projects.update(project.id, { engine: 'sh' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects an unsafe main file on update', () => {
    const project = projects.create(
      { name: 'Paper', ownerProfileId: ownerId },
      userId,
    );
    expect(() =>
      projects.update(project.id, { mainFile: '-pdflatex=evil.tex' }),
    ).toThrow(BadRequestException);
  });

  it('updates only the provided fields', () => {
    const project = projects.create(
      { name: 'Paper', ownerProfileId: ownerId },
      userId,
    );
    const updated = projects.update(project.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.engine).toBe(project.engine);
    expect(updated.updatedAt >= project.updatedAt).toBe(true);
  });

  it('throws NotFoundException for an unknown project on update', () => {
    expect(() => projects.update('missing', { name: 'x' })).toThrow(
      NotFoundException,
    );
  });

  it('deletes a project', () => {
    const project = projects.create(
      { name: 'Paper', ownerProfileId: ownerId },
      userId,
    );
    projects.delete(project.id);
    expect(projects.findById(project.id)).toBeUndefined();
  });

  it('throws NotFoundException for an unknown project on delete', () => {
    expect(() => projects.delete('missing')).toThrow(NotFoundException);
  });

  it('assertProjectAccess throws Forbidden for another user', () => {
    const project = projects.create(
      { name: 'Paper', ownerProfileId: ownerId },
      userId,
    );
    expect(() =>
      projects.assertProjectAccess(project.id, 'other-user'),
    ).toThrow(ForbiddenException);
  });
});
