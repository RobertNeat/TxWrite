import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../common/database/database.service.js';
import { ProfilesService } from './profiles.service.js';

describe('ProfilesService', () => {
  let service: ProfilesService;

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
});
