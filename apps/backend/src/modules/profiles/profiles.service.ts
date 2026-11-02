import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service.js';
import type { Profile } from './profile.entity.js';

interface ProfileRow {
  id: string;
  display_name: string;
  created_at: string;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

@Injectable()
export class ProfilesService {
  constructor(private readonly database: DatabaseService) {}

  create(displayName: string): Profile {
    const id = randomUUID();
    this.database.db
      .prepare('INSERT INTO profiles (id, display_name) VALUES (?, ?)')
      .run(id, displayName);
    return this.findById(id)!;
  }

  findAll(): Profile[] {
    const rows = this.database.db
      .prepare('SELECT * FROM profiles ORDER BY created_at')
      .all() as unknown as ProfileRow[];
    return rows.map(toProfile);
  }

  findById(id: string): Profile | undefined {
    const row = this.database.db
      .prepare('SELECT * FROM profiles WHERE id = ?')
      .get(id) as unknown as ProfileRow | undefined;
    return row ? toProfile(row) : undefined;
  }
}
