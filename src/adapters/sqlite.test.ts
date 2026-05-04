import Database from 'better-sqlite3';
import { runMigrations } from '../migrations/runner.js';
import { repositoryContract } from './contract.js';
import { createSqliteRepository } from './sqlite.js';

repositoryContract('sqlite', async () => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return createSqliteRepository(db);
});
