import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.js';

/**
 * Guards the v3 backfill: the already-running production container has
 * real users created before email verification existed. If the migration
 * didn't mark them verified, the next deploy would lock everyone out.
 */
describe('migration v3 (email verification)', () => {
  it('backfills pre-existing users (migrated at v2) as verified', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');

    const v1AndV2 = migrations.filter((m) => m.version <= 2);
    for (const migration of v1AndV2) {
      migration.up(db);
    }
    db.prepare('INSERT INTO users (id, display_name) VALUES (?, ?)').run(
      'pre-existing-user',
      'Pre-existing',
    );

    const v3 = migrations.find((m) => m.version === 3)!;
    v3.up(db);

    const row = db
      .prepare('SELECT email_verified_at FROM users WHERE id = ?')
      .get('pre-existing-user') as { email_verified_at: string | null };
    expect(row.email_verified_at).not.toBeNull();
  });

  it('does not mark a brand-new post-migration user as verified', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');

    for (const migration of migrations) {
      migration.up(db);
    }
    db.prepare('INSERT INTO users (id, display_name) VALUES (?, ?)').run(
      'new-user',
      'New User',
    );

    const row = db
      .prepare('SELECT email_verified_at FROM users WHERE id = ?')
      .get('new-user') as { email_verified_at: string | null };
    expect(row.email_verified_at).toBeNull();
  });
});
