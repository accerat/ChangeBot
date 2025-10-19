// scripts/uploadToDrive.js
// Upload exported JSON to Google Drive

import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXPORT_PATH = path.join(__dirname, '../changebot-export.json');
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

async function uploadToDrive() {
  console.log('[upload] Uploading to Google Drive...');

  try {
    // Authenticate
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('OAuth2 credentials not configured in .env');
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Check if file exists
    if (!fs.existsSync(EXPORT_PATH)) {
      throw new Error(`Export file not found: ${EXPORT_PATH}`);
    }

    const fileMetadata = {
      name: 'ChangeBot-database.json',
      mimeType: 'application/json'
    };

    // Note: Not setting parents - file will be created in root
    // User can move it to folder manually if needed

    const media = {
      mimeType: 'application/json',
      body: fs.createReadStream(EXPORT_PATH)
    };

    // Create new file in Drive
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, name, webViewLink'
    });

    console.log(`[upload] ✅ Uploaded to Drive`);
    console.log(`[upload] File ID: ${response.data.id}`);
    console.log(`[upload] ⚠️ Add to .env: CHANGEBOT_DB_JSON_DRIVE_ID=${response.data.id}`);
    console.log(`[upload] View: ${response.data.webViewLink}`);

  } catch (error) {
    console.error('[upload] Error:', error.message);
    process.exit(1);
  }
}

uploadToDrive();
