import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrations } from './migrations.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: DatabaseSync;

  constructor(config: ConfigService) {
    const dataDir = config.get<string>('DATA_DIR', './.local-data/data');
    // ':memory:' is SQLite's own in-process-only database, used by tests so they
    // never touch the filesystem.
    const dbPath =
      dataDir === ':memory:' ? ':memory:' : join(dataDir, 'app.db');
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.runMigrations();
  }

  private runMigrations(): void {
    const { user_version: currentVersion } = this.db
      .prepare('PRAGMA user_version')
      .get() as { user_version: number };

    const pending = migrations
      .filter((m) => m.version > currentVersion)
      .sort((a, b) => a.version - b.version);

    for (const migration of pending) {
      this.db.exec('BEGIN');
      try {
        migration.up(this.db);
        this.db.exec(`PRAGMA user_version = ${migration.version}`);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  onModuleDestroy(): void {
    this.db.close();
  }
}
