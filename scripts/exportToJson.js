// scripts/exportToJson.js
// Export SQLite database to JSON format for Drive storage

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../uhc_materials.db');
const OUTPUT_PATH = path.join(__dirname, '../changebot-export.json');

console.log('[export] Exporting SQLite database to JSON...');

try {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[export] Database not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });

  // Get all requests
  const requests = db.prepare('SELECT * FROM requests').all();

  // Find max ID for _nextId
  const maxId = requests.reduce((max, r) => Math.max(max, r.id), 0);

  const exportData = {
    requests: requests,
    _nextId: maxId + 1
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(exportData, null, 2));

  console.log(`[export] ✅ Exported ${requests.length} requests to ${OUTPUT_PATH}`);
  console.log(`[export] Next ID will be: ${exportData._nextId}`);

  db.close();

} catch (error) {
  console.error('[export] Error:', error.message);
  process.exit(1);
}
