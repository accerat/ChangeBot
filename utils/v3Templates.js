// utils/v3Templates.js
// Utility to read V3DailyReportBot templates and project data

import { readFile } from 'fs/promises';
import { resolve, join } from 'path';

// Paths to V3DailyReportBot data files
// Use env var if set (for AWS), otherwise fall back to relative path (for local dev)
const V3_DATA_DIR = process.env.V3_DATA_DIR || resolve('../V3DailyReportBot/data');
const V3_STORE_PATH = join(V3_DATA_DIR, 'store.json');
const V3_TEMPLATES_PATH = join(V3_DATA_DIR, 'templates.json');

/**
 * Get project ID from V3 store by thread channel ID
 * @param {string} threadChannelId - Discord thread channel ID
 * @returns {Promise<number|null>} Project ID or null if not found
 */
export async function getV3ProjectId(threadChannelId) {
  try {
    const storeData = JSON.parse(await readFile(V3_STORE_PATH, 'utf8'));
    const project = (storeData.projects || []).find(
      p => p.thread_channel_id === threadChannelId
    );
    return project?.id || null;
  } catch (error) {
    console.error('[v3Templates] Error reading V3 store:', error);
    return null;
  }
}

/**
 * Get template body for a V3 project
 * @param {number} projectId - V3 project ID
 * @returns {Promise<string|null>} Template body or null if not found
 */
export async function getV3Template(projectId) {
  try {
    const templatesData = JSON.parse(await readFile(V3_TEMPLATES_PATH, 'utf8'));
    const template = templatesData.byProjectId?.[String(projectId)];

    if (!template) return null;

    // Template can be string or object with body property
    return typeof template === 'string' ? template : (template.body || null);
  } catch (error) {
    console.error('[v3Templates] Error reading V3 templates:', error);
    return null;
  }
}

/**
 * Parse door IDs from V3 template body
 * Extracts door numbers from format like "1️⃣ CMU - 106A (Return Storage) -"
 * @param {string} templateBody - Template text from V3
 * @returns {string[]} Array of door IDs (e.g., ["106A", "707A"])
 */
export function parseDoorIds(templateBody) {
  if (!templateBody) return [];

  const doors = [];
  const lines = templateBody.split(/\r?\n/);

  for (const line of lines) {
    // Match patterns like "CMU - 106A" or "GWB - 151E" or "DWG - 151A"
    const match = line.match(/(?:CMU|GWB|DWG)\s*-\s*([0-9]+[A-Z]?)/i);
    if (match && match[1]) {
      doors.push(match[1].toUpperCase());
    }
  }

  return doors;
}

/**
 * Get formatted door list for UHC materials modal
 * @param {string} threadChannelId - Discord thread channel ID
 * @returns {Promise<string>} Pre-formatted door list like "106A | \n707A | "
 */
export async function getFormattedDoorList(threadChannelId) {
  try {
    // Get project ID from V3 store
    const projectId = await getV3ProjectId(threadChannelId);
    if (!projectId) {
      console.log('[v3Templates] No V3 project found for thread:', threadChannelId);
      return '';
    }

    // Get template for this project
    const templateBody = await getV3Template(projectId);
    if (!templateBody) {
      console.log('[v3Templates] No template found for project:', projectId);
      return '';
    }

    // Parse door IDs from template
    const doorIds = parseDoorIds(templateBody);
    if (!doorIds.length) {
      console.log('[v3Templates] No doors found in template');
      return '';
    }

    // Format as "DoorID | " on each line
    return doorIds.map(doorId => `${doorId} | `).join('\n');
  } catch (error) {
    console.error('[v3Templates] Error getting formatted door list:', error);
    return '';
  }
}
