// excel/driveSync.js
// Sync Excel files to Google Drive

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

// Google Drive folder ID where files will be stored
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

// Map to store file IDs for replacement (typeId -> driveFileId)
const FILE_ID_MAP = {
  materials: process.env.MATERIALS_EXCEL_DRIVE_ID || null,
  schedule: process.env.SCHEDULE_EXCEL_DRIVE_ID || null,
  scope: process.env.SCOPE_EXCEL_DRIVE_ID || null
};

/**
 * Get authenticated Google Drive client
 * @returns {Promise<object>} Google Drive API client
 */
async function getDriveClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('OAuth2 credentials not configured in .env (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN)');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost' // redirect URI (not used for refresh token flow)
  );

  // Set the refresh token
  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  return drive;
}

/**
 * Upload or update Excel file on Google Drive
 * @param {string} typeId - Change type ID
 * @param {string} filePath - Local file path
 * @returns {Promise<object>} Drive file metadata
 */
export async function syncToDrive(typeId, filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  try {
    const drive = await getDriveClient();
    const fileName = path.basename(filePath);
    const existingFileId = FILE_ID_MAP[typeId];

    const fileMetadata = {
      name: fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };

    if (!existingFileId && DRIVE_FOLDER_ID) {
      // Add to folder - REQUIRED for service accounts
      fileMetadata.parents = [DRIVE_FOLDER_ID];
      console.log(`[drive] Setting parent folder: ${DRIVE_FOLDER_ID}`);
    }

    const media = {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: fs.createReadStream(filePath)
    };

    let response;

    if (existingFileId) {
      // Update existing file (maintains same URL)
      console.log(`[drive] Updating existing file: ${fileName} (${existingFileId})`);
      response = await drive.files.update({
        fileId: existingFileId,
        media,
        fields: 'id, name, webViewLink'
      });
    } else {
      // Create new file
      console.log(`[drive] Creating new file: ${fileName}`);
      response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, webViewLink'
      });

      // Make file publicly readable (optional)
      try {
        await drive.permissions.create({
          fileId: response.data.id,
          requestBody: {
            role: 'reader',
            type: 'anyone'
          }
        });
        console.log(`[drive] Made ${fileName} publicly readable`);
      } catch (e) {
        console.warn('[drive] Could not set public permissions:', e.message);
      }

      // Update FILE_ID_MAP for future updates
      FILE_ID_MAP[typeId] = response.data.id;
      console.log(`[drive] 🔗 New file ID for ${typeId}: ${response.data.id}`);
      console.log(`[drive] ⚠️ Add this to .env: ${typeId.toUpperCase()}_EXCEL_DRIVE_ID=${response.data.id}`);
    }

    console.log(`[drive] ✅ Synced ${fileName} to Drive: ${response.data.webViewLink || response.data.id}`);
    return response.data;
  } catch (e) {
    console.error('[drive] Sync failed:', e.message);
    throw e;
  }
}

/**
 * Sync all Excel files to Google Drive
 * @param {object} filePaths - Map of typeId -> local file path
 * @returns {Promise<object>} Map of typeId -> Drive file metadata
 */
export async function syncAllToDrive(filePaths) {
  const results = {};

  for (const [typeId, filePath] of Object.entries(filePaths)) {
    if (!filePath) {
      console.warn(`[drive] Skipping ${typeId} - no file path`);
      continue;
    }

    try {
      results[typeId] = await syncToDrive(typeId, filePath);
    } catch (e) {
      console.error(`[drive] Failed to sync ${typeId}:`, e.message);
      results[typeId] = null;
    }
  }

  return results;
}

/**
 * Check if Google Drive is configured
 * @returns {boolean} True if Drive sync is available
 */
export function isDriveConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
}
