// db/schema.js
// Database schema with status tracking

import Database from 'better-sqlite3';

/**
 * Initialize database with updated schema
 * @param {string} dbPath - Path to SQLite database file
 * @returns {Database} Database instance
 */
export function initDatabase(dbPath) {
  const db = new Database(dbPath);

  // Create main requests table with type and status fields
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,                    -- 'materials', 'schedule', 'scope'
      status TEXT DEFAULT 'pending',         -- 'pending', 'in_progress', 'completed', 'cancelled'
      guild_id TEXT NOT NULL,
      project_thread_id TEXT,
      project_title TEXT,
      requested_by TEXT NOT NULL,
      data TEXT NOT NULL,                    -- JSON: module-specific data
      destination_msg_id TEXT,               -- Discord message/thread ID where posted
      completed_at TEXT,                     -- ISO timestamp when completed
      completed_by TEXT,                     -- User ID who marked complete
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrate existing data if needed
  migrateIfNeeded(db);

  return db;
}

/**
 * Migrate existing requests table if it doesn't have new fields
 * @param {Database} db - Database instance
 */
function migrateIfNeeded(db) {
  // Check if 'type' column exists
  const columns = db.prepare("PRAGMA table_info(requests)").all();
  const hasType = columns.some(col => col.name === 'type');
  const hasStatus = columns.some(col => col.name === 'status');

  if (!hasType || !hasStatus) {
    console.log('[migration] Migrating requests table to new schema...');

    // Rename old table
    db.exec(`ALTER TABLE requests RENAME TO requests_old;`);

    // Create new table with updated schema
    db.exec(`
      CREATE TABLE requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'materials',
        status TEXT DEFAULT 'pending',
        guild_id TEXT NOT NULL,
        project_thread_id TEXT,
        project_title TEXT,
        requested_by TEXT NOT NULL,
        data TEXT NOT NULL,
        destination_msg_id TEXT,
        completed_at TEXT,
        completed_by TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Migrate data from old table
    db.exec(`
      INSERT INTO requests (
        id, type, status, guild_id, project_thread_id, project_title,
        requested_by, data, destination_msg_id, created_at
      )
      SELECT
        id,
        'materials' as type,
        'pending' as status,
        guild_id,
        project_thread_id,
        project_title,
        requested_by,
        items as data,
        missing_channel_msg_id as destination_msg_id,
        created_at
      FROM requests_old;
    `);

    // Drop old table
    db.exec(`DROP TABLE requests_old;`);

    console.log('[migration] Migration complete!');
  }
}
