import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from './env';
import { logger } from '../utils/logger';

let db: Database.Database;

/**
 * Initialize SQLite database with schema.
 * Creates data directory and tables if they don't exist.
 * Uses WAL mode for better concurrent read performance.
 */
export function initDatabase(): Database.Database {
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    logger.info('Created database directory', { path: dbDir });
  }

  db = new Database(config.dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      original_filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      overall_score REAL,
      issues_found INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_id TEXT NOT NULL,
      analyzer_name TEXT NOT NULL,
      passed INTEGER NOT NULL DEFAULT 1,
      confidence REAL,
      details TEXT,
      execution_time_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS image_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_id TEXT NOT NULL UNIQUE,
      file_hash TEXT NOT NULL,
      perceptual_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_images_status ON images(status);
    CREATE INDEX IF NOT EXISTS idx_images_file_hash ON images(file_hash);
    CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_image_id ON analysis_results(image_id);
    CREATE INDEX IF NOT EXISTS idx_hashes_file_hash ON image_hashes(file_hash);
    CREATE INDEX IF NOT EXISTS idx_hashes_perceptual ON image_hashes(perceptual_hash);
  `);

  logger.info('Database initialized successfully', { path: config.dbPath });
  return db;
}

/**
 * Get database instance. Throws if not initialized.
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close database connection gracefully.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    logger.info('Database connection closed');
  }
}
