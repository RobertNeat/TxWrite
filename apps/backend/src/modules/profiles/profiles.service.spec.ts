import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service.js';
import { ProfilesService } from './profiles.service.js';

describe('ProfilesService', () => {
  let service: ProfilesService;
  let database: DatabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilesService,
        DatabaseService,
        {
          provide: ConfigService,
          useValue: { get: () => ':memory:' },
        },
      ],
    }).compile();

    service = module.get(ProfilesService);
    database = module.get(DatabaseService);
  });

  it('creates and finds a profile', () => {
    const created = service.create('Robert');
    expect(created.displayName).toBe('Robert');
    expect(service.findById(created.id)).toEqual(created);
  });

  it('lists profiles in creation order', () => {
    const first = service.create('First');
    const second = service.create('Second');
    expect(service.findAll().map((p) => p.id)).toEqual([first.id, second.id]);
  });

  it('returns undefined for an unknown id', () => {
    expect(service.findById('does-not-exist')).toBeUndefined();
  });

  describe('delete', () => {
    function insertProject(ownerProfileId: string): string {
      const id = `${ownerProfileId}-project-${Math.random()}`;
      database.db
        .prepare(
          `INSERT INTO projects (id, name, owner_profile_id) VALUES (?, ?, ?)`,
        )
        .run(id, 'Test project', ownerProfileId);
      return id;
    }

    it('deletes the profile and returns the ids of its owned projects', () => {
      const profile = service.create('Doomed');
      const projectId = insertProject(profile.id);

      const deletedProjectIds = service.delete(profile.id);

      expect(deletedProjectIds).toEqual([projectId]);
      expect(service.findById(profile.id)).toBeUndefined();
    });

    it('does not touch other profiles or their projects', () => {
      const keep = service.create('Keep');
      const keepProjectId = insertProject(keep.id);
      const doomed = service.create('Doomed');
      insertProject(doomed.id);

      service.delete(doomed.id);

      expect(service.findById(keep.id)).toEqual(keep);
      const remaining = database.db
        .prepare('SELECT id FROM projects')
        .all() as unknown as { id: string }[];
      expect(remaining.map((r) => r.id)).toEqual([keepProjectId]);
    });

    it('throws NotFoundException for an unknown id', () => {
      expect(() => service.delete('does-not-exist')).toThrow(NotFoundException);
    });
  });
});
