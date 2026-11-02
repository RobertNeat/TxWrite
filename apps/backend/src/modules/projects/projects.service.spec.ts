import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ProjectsService } from './projects.service.js';

describe('ProjectsService', () => {
  let projects: ProjectsService;
  let profiles: ProfilesService;
  let ownerId: string;

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
    ownerId = profiles.create('Owner').id;
  });

  it('creates a project with defaults', () => {
    const project = projects.create({ name: 'Paper', ownerProfileId: ownerId });
    expect(project.name).toBe('Paper');
    expect(project.engine).toBe('pdflatex');
    expect(project.mainFile).toBe('main.tex');
    expect(project.templateOrigin).toBeNull();
  });

  it('creates a project with an explicit engine and main file', () => {
    const project = projects.create({
      name: 'Thesis',
      ownerProfileId: ownerId,
      engine: 'xelatex',
      mainFile: 'thesis.tex',
    });
    expect(project.engine).toBe('xelatex');
    expect(project.mainFile).toBe('thesis.tex');
  });

  it('throws when the owner profile does not exist', () => {
    expect(() =>
      projects.create({ name: 'Orphan', ownerProfileId: 'missing' }),
    ).toThrow();
  });

  it('updates only the provided fields', () => {
    const project = projects.create({ name: 'Paper', ownerProfileId: ownerId });
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
    const project = projects.create({ name: 'Paper', ownerProfileId: ownerId });
    projects.delete(project.id);
    expect(projects.findById(project.id)).toBeUndefined();
  });

  it('throws NotFoundException for an unknown project on delete', () => {
    expect(() => projects.delete('missing')).toThrow(NotFoundException);
  });
});
