# Excel Export & Google Drive Integration

## Overview

ChangeBot automatically generates Excel files for each change type and syncs them to Google Drive:
- **Missing-Materials-Changes.xlsx** - All materials requests
- **Schedule-Change-Changes.xlsx** - All schedule changes
- **Scope-Change-Changes.xlsx** - All scope changes

Files are regenerated automatically when:
- A new request is submitted
- A request status is updated

## Local Excel Files

Excel files are saved locally to `excel/output/` directory. These are generated even without Google Drive configured.

## Google Drive Setup (Optional)

To enable automatic Google Drive sync, follow these steps:

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Name it something like "ChangeBot Excel Sync"

### 2. Enable Google Drive API

1. In your project, go to **APIs & Services** > **Library**
2. Search for "Google Drive API"
3. Click **Enable**

### 3. Create Service Account

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **Service Account**
3. Name it "changebot-excel-sync"
4. Click **Create and Continue**
5. Skip the optional steps, click **Done**

### 4. Create Service Account Key

1. Click on the service account you just created
2. Go to **Keys** tab
3. Click **Add Key** > **Create new key**
4. Choose **JSON** format
5. Click **Create** - a JSON file will download

### 5. Upload Key to Server

Upload the downloaded JSON file to your server:

**AWS:**
```bash
# On your local machine
scp /path/to/downloaded-key.json ubuntu@your-server:/home/ubuntu/bots/ChangeBot/google-credentials.json

# OR manually create the file on AWS
nano ~/bots/ChangeBot/google-credentials.json
# Paste the JSON content
```

**Secure the file:**
```bash
chmod 600 ~/bots/ChangeBot/google-credentials.json
```

### 6. Create Google Drive Folder (Optional)

1. Go to [Google Drive](https://drive.google.com/)
2. Create a folder like "ChangeBot Excel Reports"
3. Get the folder ID from the URL: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`

### 7. Share Folder with Service Account

1. Right-click the folder > **Share**
2. Add the service account email (looks like: `changebot-excel-sync@your-project.iam.gserviceaccount.com`)
3. Give it **Editor** permissions

### 8. Configure Environment Variables

Add to `.env`:

```bash
# Required for Google Drive sync
GOOGLE_SERVICE_ACCOUNT_PATH=/home/ubuntu/bots/ChangeBot/google-credentials.json

# Optional - specific folder to upload to
GOOGLE_DRIVE_FOLDER_ID=your_folder_id_here

# Optional - file IDs for updating existing files (auto-populated on first upload)
# MATERIALS_EXCEL_DRIVE_ID=
# SCHEDULE_EXCEL_DRIVE_ID=
# SCOPE_EXCEL_DRIVE_ID=
```

### 9. Restart Bot

```bash
pm2 restart ChangeBot
pm2 logs ChangeBot --lines 50
```

## How It Works

### First Upload
- Bot creates new files in Google Drive
- Makes files publicly readable (anyone with link can view)
- Logs the file IDs - add these to `.env` for future updates

### Subsequent Updates
- If file IDs are configured in `.env`, bot **updates** the existing files
- This maintains the same shareable link (great for bookmarks!)
- If file IDs are not configured, bot creates new files each time

### Accessing Files

After first upload, check logs for Google Drive links:
```
[drive] ✅ Synced Missing-Materials-Changes.xlsx to Drive: https://docs.google.com/spreadsheets/d/FILE_ID/edit
```

You can bookmark these links or share them with your team.

## Troubleshooting

### "GOOGLE_SERVICE_ACCOUNT_PATH not configured"
- Add the path to your `.env` file
- Make sure the path is absolute (full path)

### "Service account file not found"
- Check the file path in `.env`
- Verify file exists: `ls -la ~/bots/ChangeBot/google-credentials.json`
- Check file permissions: `chmod 600 ~/bots/ChangeBot/google-credentials.json`

### "Permission denied" errors
- Make sure you shared the Drive folder with the service account email
- Give it Editor permissions, not just Viewer

### Files creating duplicates instead of updating
- Add the file IDs to `.env` (check logs for the IDs)
- Format: `MATERIALS_EXCEL_DRIVE_ID=actual_file_id_here`

## Manual Excel Generation

You can manually regenerate all Excel files:

```bash
cd ~/bots/ChangeBot
node test-excel.js
```

Files will be in `excel/output/` directory.
