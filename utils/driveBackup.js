// utils/driveBackup.js
// Auto-backup uhc_materials.db to Google Drive

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null;
const DB_FILE_DRIVE_ID = process.env.DATABASE_DRIVE_ID || null;
const DB_FILE_PATH = path.join(__dirname, '../uhc_materials.db');

/**
 * Get authenticated Google Drive client
 */
async function getDriveClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn('[drive-backup] OAuth2 not configured, skipping backup');
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Backup database to Google Drive
 */
export async function backupDatabase() {
  try {
    const drive = await getDriveClient();
    if (!drive) return; // Skip if not configured

    if (!fs.existsSync(DB_FILE_PATH)) {
      console.warn(`[drive-backup] Database not found: ${DB_FILE_PATH}`);
      return;
    }

    const fileMetadata = {
      name: 'ChangeBot-uhc_materials.db',
      mimeType: 'application/x-sqlite3'
    };

    if (!DB_FILE_DRIVE_ID && DRIVE_FOLDER_ID) {
      fileMetadata.parents = [DRIVE_FOLDER_ID];
    }

    const media = {
      mimeType: 'application/x-sqlite3',
      body: fs.createReadStream(DB_FILE_PATH)
    };

    let response;

    if (DB_FILE_DRIVE_ID) {
      // Update existing backup
      response = await drive.files.update({
        fileId: DB_FILE_DRIVE_ID,
        media,
        fields: 'id, name, modifiedTime'
      });
      console.log(`[drive-backup] ✅ Updated database backup (${response.data.modifiedTime})`);
    } else {
      // Create new backup
      response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, webViewLink'
      });

      console.log(`[drive-backup] ✅ Created database backup`);
      console.log(`[drive-backup] ⚠️ Add to .env: DATABASE_DRIVE_ID=${response.data.id}`);
    }

    return response.data;
  } catch (e) {
    console.error(`[drive-backup] Failed to backup database:`, e.message);
  }
}

/**
 * Check if Drive backup is configured
 */
export function isBackupConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID &&
            process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
            process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
}
