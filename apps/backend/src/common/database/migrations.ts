import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  up: (db: DatabaseSync) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE profiles (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          owner_profile_id TEXT NOT NULL REFERENCES profiles(id),
          engine TEXT NOT NULL DEFAULT 'pdflatex',
          main_file TEXT NOT NULL DEFAULT 'main.tex',
          template_origin TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_projects_owner_profile_id ON projects(owner_profile_id);
      `);
    },
  },
  {
    // Real auth: a user owns many profiles. `user_identities` is
    // provider-agnostic (local password login is provider='local') so Google/
    // Keycloak OIDC can be added later without a schema change. `profiles.user_id`
    // is nullable because existing pre-auth profiles have no owner yet — the app
    // (not this migration) backfills them onto the first user who registers.
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE user_identities (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          provider_subject TEXT NOT NULL,
          password_hash TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (provider, provider_subject)
        );

        CREATE INDEX idx_user_identities_user_id ON user_identities(user_id);

        CREATE TABLE refresh_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL,
          family_id TEXT NOT NULL,
          revoked_at TEXT,
          replaced_by_id TEXT,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
        CREATE INDEX idx_refresh_tokens_family_id ON refresh_tokens(family_id);

        ALTER TABLE profiles ADD COLUMN user_id TEXT REFERENCES users(id);
        CREATE INDEX idx_profiles_user_id ON profiles(user_id);
      `);
    },
  },
];
