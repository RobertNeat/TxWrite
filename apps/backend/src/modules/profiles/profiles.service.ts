import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service.js';
import type { Profile } from './profile.entity.js';

interface ProfileRow {
  id: string;
  display_name: string;
  user_id: string | null;
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

  create(displayName: string, userId: string): Profile {
    const id = randomUUID();
    this.database.db
      .prepare(
        'INSERT INTO profiles (id, display_name, user_id) VALUES (?, ?, ?)',
      )
      .run(id, displayName, userId);
    return this.findById(id, userId)!;
  }

  findAll(userId: string): Profile[] {
    const rows = this.database.db
      .prepare('SELECT * FROM profiles WHERE user_id = ? ORDER BY created_at')
      .all(userId) as unknown as ProfileRow[];
    return rows.map(toProfile);
  }

  findById(id: string, userId: string): Profile | undefined {
    const row = this.database.db
      .prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?')
      .get(id, userId) as unknown as ProfileRow | undefined;
    return row ? toProfile(row) : undefined;
  }

  /**
   * Deletes the profile and all projects it owns (DB rows only — file
   * cleanup is the controller's job via ProjectFilesService, kept out of
   * this service so its spec can keep using an in-memory DB without a real
   * DATA_DIR). Returns the deleted projects' ids so the controller knows
   * which working directories to remove from disk.
   */
  delete(id: string, userId: string): string[] {
    if (!this.findById(id, userId)) {
      throw new NotFoundException(`Profile ${id} not found`);
    }
    const projectRows = this.database.db
      .prepare('SELECT id FROM projects WHERE owner_profile_id = ?')
      .all(id) as unknown as { id: string }[];
    const projectIds = projectRows.map((row) => row.id);

    this.database.db.exec('BEGIN');
    try {
      this.database.db
        .prepare('DELETE FROM projects WHERE owner_profile_id = ?')
        .run(id);
      this.database.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
      this.database.db.exec('COMMIT');
    } catch (error) {
      this.database.db.exec('ROLLBACK');
      throw error;
    }
    return projectIds;
  }
}
