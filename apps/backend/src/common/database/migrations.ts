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
];
