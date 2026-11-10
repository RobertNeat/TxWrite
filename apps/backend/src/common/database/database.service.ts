import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
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

  /** Typed wrapper around `db.prepare(sql).get(...)` — callers supply the row shape instead of `as unknown as`. */
  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  /** Typed wrapper around `db.prepare(sql).all(...)`. */
  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /** Typed wrapper around `db.prepare(sql).run(...)`, for INSERT/UPDATE/DELETE. */
  run(sql: string, ...params: SQLInputValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  /**
   * Runs `fn` inside BEGIN/COMMIT, rolling back on throw. `fn` must be
   * synchronous — `node:sqlite` has no interleaved-transaction support, so an
   * awaited gap inside `fn` would let other callers run (and fail) against a
   * half-committed state, or nest a second BEGIN and throw outright. Nesting
   * calls (an outer `transaction()` whose `fn` calls `transaction()` again)
   * is rejected for the same reason.
   */
  transaction<T>(fn: () => T): T {
    if (this.db.isTransaction) {
      throw new Error(
        'transaction() called while a transaction is already open',
      );
    }
    this.db.exec('BEGIN');
    try {
      const result = fn();
      if (result instanceof Promise) {
        throw new Error('transaction() callback must be synchronous');
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private runMigrations(): void {
    const { user_version: currentVersion } = this.db
      .prepare('PRAGMA user_version')
      .get() as { user_version: number };

    const pending = migrations
      .filter((m) => m.version > currentVersion)
      .sort((a, b) => a.version - b.version);

    for (const migration of pending) {
      this.transaction(() => {
        migration.up(this.db);
        this.db.exec(`PRAGMA user_version = ${migration.version}`);
      });
    }
  }

  onModuleDestroy(): void {
    this.db.close();
  }
}
