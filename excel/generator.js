// excel/generator.js
// Generate Excel files for each change type
// ARCHITECTURAL PRINCIPLE: Uses Drive-based database

import ExcelJS from 'exceljs';
import { CHANGE_TYPES } from '../config/changeTypes.js';
import { initDatabase } from '../db/driveDatabase.js';
import path from 'path';
import fs from 'fs';

const OUTPUT_DIR = './excel/output';

/**
 * Ensure output directory exists
 */
function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

/**
 * Generate Excel file for a specific change type
 * @param {string} typeId - Change type ID (materials, schedule, scope)
 * @param {object} db - Database instance
 * @returns {Promise<string>} Path to generated Excel file
 */
export async function generateExcelForType(typeId, db) {
  const changeType = CHANGE_TYPES.find(t => t.id === typeId);
  if (!changeType) {
    throw new Error(`Unknown change type: ${typeId}`);
  }

  ensureOutputDir();

  // Get all requests for this type
  const requests = await db.prepare(`
    SELECT * FROM requests
    WHERE type = ?
    ORDER BY created_at DESC
  `).all(typeId);

  // Create workbook
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(changeType.label);

  // Get column definitions from module
  const columns = changeType.getExcelColumns();
  worksheet.columns = columns;

  // Style header row
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9D9D9' }
  };

  // Add data rows
  for (const request of requests) {
    const poNumber = `${changeType.poPrefix}-${String(request.id).padStart(4, '0')}`;
    const rows = changeType.formatForExcel(request, poNumber);

    for (const row of rows) {
      worksheet.addRow(row);
    }
  }

  // Auto-fit columns
  worksheet.columns.forEach(column => {
    if (!column.width) {
      let maxLength = 10;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        const length = cell.value ? cell.value.toString().length : 10;
        if (length > maxLength) {
          maxLength = length;
        }
      });
      column.width = Math.min(maxLength + 2, 50);
    }
  });

  // Save file
  const fileName = `${changeType.label.replace(/\s+/g, '-')}-Changes.xlsx`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  await workbook.xlsx.writeFile(filePath);
  console.log(`[excel] Generated ${fileName} with ${requests.length} requests`);

  return filePath;
}

/**
 * Generate Excel files for all change types
 * @returns {Promise<object>} Map of typeId -> filePath
 */
export async function generateAllExcels() {
  const db = initDatabase(); // Drive-based database (no local file)
  const results = {};

  for (const changeType of CHANGE_TYPES) {
    try {
      const filePath = await generateExcelForType(changeType.id, db);
      results[changeType.id] = filePath;
    } catch (e) {
      console.error(`[excel] Error generating ${changeType.id}:`, e);
      results[changeType.id] = null;
    }
  }

  return results;
}

/**
 * Trigger Excel regeneration (called after status updates or new requests)
 * @param {string} typeId - Change type that was updated (optional - regenerates all if not provided)
 */
export async function triggerRegeneration(typeId = null) {
  try {
    if (typeId) {
      const db = initDatabase(); // Drive-based database (no local file)
      const filePath = await generateExcelForType(typeId, db);
      console.log(`[excel] Regenerated ${typeId}: ${filePath}`);
      return { [typeId]: filePath };
    } else {
      return await generateAllExcels();
    }
  } catch (e) {
    console.error('[excel] Regeneration failed:', e);
    throw e;
  }
}
