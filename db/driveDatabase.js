// db/driveDatabase.js
// ARCHITECTURAL PRINCIPLE: Google Drive is the PRIMARY database
// Local SQLite is NOT used - all reads/writes go directly to Drive

import { loadDatabaseFromDrive, saveDatabaseToDrive } from '../utils/driveStorage.js';

const defaultDatabase = {
  requests: [],
  _nextId: 1
};

/**
 * Load database from Drive
 * @returns {Promise<object>} Database state
 */
async function load() {
  return await loadDatabaseFromDrive(defaultDatabase);
}

/**
 * Save database to Drive
 * @param {object} db - Database state
 * @returns {Promise<object>} Saved database state
 */
async function save(db) {
  await saveDatabaseToDrive(db);
  return db;
}

/**
 * Initialize Drive-based database (replaces SQLite initDatabase)
 * @returns {object} Database API matching SQLite interface
 */
export function initDatabase() {
  console.log('[drive-db] Using Google Drive as primary database');

  // Return an API that matches the SQLite interface
  return {
    prepare: (sql) => {
      // Parse simple SQL statements and return a statement object
      return {
        run: async (params) => {
          const db = await load();

          // INSERT INTO requests
          if (sql.trim().startsWith('INSERT INTO requests')) {
            const newId = db._nextId || 1;
            const request = {
              id: newId,
              type: params.type,
              status: params.status || 'pending',
              guild_id: params.guild_id,
              project_thread_id: params.project_thread_id,
              project_title: params.project_title,
              requested_by: params.requested_by,
              data: params.data,
              destination_msg_id: params.destination_msg_id || null,
              completed_at: params.completed_at || null,
              completed_by: params.completed_by || null,
              created_at: new Date().toISOString()
            };

            db.requests = db.requests || [];
            db.requests.push(request);
            db._nextId = newId + 1;

            await save(db);

            return {
              lastInsertRowid: newId,
              changes: 1
            };
          }

          // UPDATE requests
          if (sql.trim().startsWith('UPDATE requests')) {
            // UPDATE requests SET destination_msg_id=@tid WHERE id=@rid
            if (sql.includes('destination_msg_id')) {
              const request = db.requests.find(r => r.id === parseInt(params.rid, 10));
              if (request) {
                request.destination_msg_id = params.tid || params.mid;
                await save(db);
                return { changes: 1 };
              }
              return { changes: 0 };
            }

            // UPDATE requests SET status = @status, completed_at = @completed_at, completed_by = @completed_by WHERE id = @id
            if (sql.includes('status')) {
              const request = db.requests.find(r => r.id === parseInt(params.id, 10));
              if (request) {
                request.status = params.status;
                request.completed_at = params.completed_at;
                request.completed_by = params.completed_by;
                await save(db);
                return { changes: 1 };
              }
              return { changes: 0 };
            }
          }

          return { changes: 0 };
        },

        get: async (id) => {
          const db = await load();

          // Convert id to number for comparison
          const numId = parseInt(id, 10);

          // SELECT type FROM requests WHERE id = ?
          if (sql.includes('SELECT type')) {
            return db.requests.find(r => r.id === numId) || null;
          }

          // SELECT * FROM requests WHERE ...
          return db.requests.find(r => r.id === numId) || null;
        },

        all: async (param) => {
          const db = await load();

          // SELECT * FROM requests WHERE type = ? ORDER BY created_at DESC
          if (sql.includes('WHERE type =')) {
            const filtered = (db.requests || []).filter(r => r.type === param);
            // Sort by created_at DESC
            return filtered.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
          }

          // Default: return all requests
          return db.requests || [];
        }
      };
    }
  };
}
