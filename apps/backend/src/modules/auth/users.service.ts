import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service.js';
import type { User } from './user.entity.js';

interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  created_at: string;
}

interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
  password_hash: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  findById(id: string): User | undefined {
    const row = this.database.get<UserRow>(
      'SELECT * FROM users WHERE id = ?',
      id,
    );
    return row ? toUser(row) : undefined;
  }

  findByEmail(email: string): User | undefined {
    const row = this.database.get<UserRow>(
      'SELECT * FROM users WHERE email = ?',
      normalizeEmail(email),
    );
    return row ? toUser(row) : undefined;
  }

  findLocalIdentityByEmail(email: string): IdentityRow | undefined {
    return this.database.get<IdentityRow>(
      `SELECT ui.* FROM user_identities ui
       JOIN users u ON u.id = ui.user_id
       WHERE ui.provider = 'local' AND u.email = ?`,
      normalizeEmail(email),
    );
  }

  isFirstUser(): boolean {
    const row = this.database.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM users',
    );
    return row!.count === 0;
  }

  /**
   * Creates a user with a local (password) identity. If this is the first
   * user ever registered, adopts every pre-existing profile that has no
   * owner yet (profiles created before real auth existed) — see
   * docs/currentwork/plan.md for why this is an app-level decision rather
   * than part of the migration.
   */
  createLocal(email: string, passwordHash: string, displayName: string): User {
    const normalizedEmail = normalizeEmail(email);
    if (this.findByEmail(normalizedEmail)) {
      throw new ConflictException('Email already registered');
    }

    const adoptOrphanedProfiles = this.isFirstUser();
    const userId = randomUUID();
    this.database.transaction(() => {
      this.database.run(
        'INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)',
        userId,
        normalizedEmail,
        displayName,
      );
      this.database.run(
        `INSERT INTO user_identities (id, user_id, provider, provider_subject, password_hash)
         VALUES (?, ?, 'local', ?, ?)`,
        randomUUID(),
        userId,
        normalizedEmail,
        passwordHash,
      );
      if (adoptOrphanedProfiles) {
        this.database.run(
          'UPDATE profiles SET user_id = ? WHERE user_id IS NULL',
          userId,
        );
      }
    });
    return this.findById(userId)!;
  }
}
