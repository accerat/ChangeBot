// utils/driveStorage.js
// ARCHITECTURAL PRINCIPLE: Google Drive is the PRIMARY database
// Local files are NOT used - all reads/writes go directly to Drive

import { google } from 'googleapis';
import { Readable } from 'stream';

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

// File ID for the database JSON export in Drive
const DATABASE_JSON_DRIVE_ID = process.env.CHANGEBOT_DB_JSON_DRIVE_ID || null;

/**
 * Get authenticated Google Drive client
 */
async function getDriveClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('[drive-storage] OAuth2 credentials not configured in .env');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Download database JSON from Google Drive
 * @param {object} defaultData - Default database structure
 * @returns {Promise<object>} Parsed JSON data
 */
export async function loadDatabaseFromDrive(defaultData = {}) {
  try {
    const drive = await getDriveClient();
    const fileId = DATABASE_JSON_DRIVE_ID;

    if (!fileId) {
      console.warn('[drive-storage] No CHANGEBOT_DB_JSON_DRIVE_ID set in .env, returning default data');
      console.warn('[drive-storage] Set CHANGEBOT_DB_JSON_DRIVE_ID in .env');
      return defaultData;
    }

    // Download file from Drive
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media'
    }, { responseType: 'text' });

    const data = JSON.parse(response.data);
    console.log(`[drive-storage] ✅ Loaded database from Drive (${data.requests?.length || 0} requests)`);
    return data;

  } catch (error) {
    if (error.code === 404) {
      console.warn('[drive-storage] Database file not found in Drive, returning default data');
      return defaultData;
    }
    console.error('[drive-storage] Failed to load database:', error.message);
    throw error;
  }
}

/**
 * Save database JSON to Google Drive
 * @param {object} data - Database data to save
 * @returns {Promise<object>} Drive API response
 */
export async function saveDatabaseToDrive(data) {
  try {
    const drive = await getDriveClient();
    const fileId = DATABASE_JSON_DRIVE_ID;

    const jsonString = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(jsonString, 'utf8');

    const fileMetadata = {
      name: 'ChangeBot-database.json',
      mimeType: 'application/json'
    };

    if (!fileId && DRIVE_FOLDER_ID) {
      fileMetadata.parents = [DRIVE_FOLDER_ID];
    }

    const media = {
      mimeType: 'application/json',
      body: Readable.from([buffer])
    };

    let response;

    if (fileId) {
      // Update existing file
      response = await drive.files.update({
        fileId: fileId,
        media,
        fields: 'id, name, modifiedTime'
      });
      console.log(`[drive-storage] ✅ Saved database to Drive (${response.data.modifiedTime})`);
    } else {
      // Create new file
      response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, webViewLink'
      });
      console.log('[drive-storage] ✅ Created database in Drive');
      console.log(`[drive-storage] ⚠️ Add to .env: CHANGEBOT_DB_JSON_DRIVE_ID=${response.data.id}`);
    }

    return response.data;

  } catch (error) {
    console.error('[drive-storage] Failed to save database:', error.message);
    throw error;
  }
}

/**
 * Check if Drive storage is configured
 */
export function isDriveConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID &&
            process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
            process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
}
