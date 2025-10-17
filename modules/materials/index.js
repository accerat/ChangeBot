// modules/materials/index.js
// Materials change request module

import { ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } from 'discord.js';
import { getFormattedDoorList } from '../../utils/v3Templates.js';

export const id = 'materials';
export const label = 'Missing Materials';
export const buttonStyle = ButtonStyle.Primary;
export const poPrefix = 'MATERIAL';
export const supportsV3Prefill = true;

/**
 * Build modal for materials request
 * @param {Interaction} interaction - Discord interaction
 * @param {string} prefillData - Pre-filled door list from V3 templates (optional)
 * @returns {Modal} Discord modal
 */
export function buildModal(interaction, prefillData = '') {
  const modal = new ModalBuilder()
    .setCustomId(`change_modal:${id}`)
    .setTitle('UHC Doors');

  const lines = new TextInputBuilder()
    .setCustomId('door_missing_lines')
    .setLabel('Door | Missing')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder('One per line: Door ID | Missing material(s). Ex: 102A | Closer arm + 4x #12 screws');

  if (prefillData) {
    lines.setValue(prefillData);
  }

  modal.addComponents(new ActionRowBuilder().addComponents(lines));
  return modal;
}

/**
 * Parse modal submission
 * @param {Interaction} interaction - Modal submit interaction
 * @returns {object} Parsed data
 */
export function parseSubmission(interaction) {
  const raw = interaction.fields.getTextInputValue('door_missing_lines') || '';
  const entries = parseDoorLines(raw);

  if (!entries.length) {
    throw new Error('Please enter at least one line like: `102A | Closer arm + screws`');
  }

  return { entries };
}

/**
 * Format embed for posting
 * @param {object} data - Parsed submission data
 * @param {string} poNumber - PO number
 * @param {string} userId - Requesting user ID
 * @returns {Embed} Discord embed
 */
export function formatEmbed(data, poNumber, userId) {
  const list = data.entries
    .map((e, i) => `${i + 1}. **${e.door}** — ${e.materials}`)
    .join('\n')
    .slice(0, 4000);

  return new EmbedBuilder()
    .setTitle('🧱 UHC Materials (Doors)')
    .addFields(
      { name: 'PO Number', value: poNumber, inline: true },
      { name: 'Requested By', value: `<@${userId}>`, inline: true },
      { name: 'Items', value: list }
    )
    .setTimestamp(new Date());
}

/**
 * Get Excel columns for this change type
 * @returns {Array} Column definitions
 */
export function getExcelColumns() {
  return [
    { header: 'PO#', key: 'po_number', width: 15 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Project', key: 'project_title', width: 30 },
    { header: 'Requested By', key: 'requested_by', width: 20 },
    { header: 'Date', key: 'created_at', width: 12 },
    { header: 'Door ID', key: 'door_id', width: 10 },
    { header: 'Materials', key: 'materials', width: 50 },
    { header: 'Completed Date', key: 'completed_at', width: 12 },
    { header: 'Completed By', key: 'completed_by', width: 20 }
  ];
}

/**
 * Format data for Excel export
 * @param {object} request - Database request row
 * @param {string} poNumber - PO number
 * @returns {Array} Rows for Excel (one per door)
 */
export function formatForExcel(request, poNumber) {
  const data = JSON.parse(request.data);

  // Safety check - if no entries, return empty array
  if (!data.entries || !Array.isArray(data.entries)) {
    return [];
  }

  return data.entries.map(entry => ({
    po_number: poNumber,
    status: request.status,
    project_title: request.project_title || 'Unknown',
    requested_by: request.requested_by,
    created_at: request.created_at.split('T')[0], // Just date
    door_id: entry.door,
    materials: entry.materials,
    completed_at: request.completed_at ? request.completed_at.split('T')[0] : '',
    completed_by: request.completed_by || ''
  }));
}

/**
 * Get pre-fill data for this change type
 * @param {string} threadChannelId - Discord thread ID
 * @returns {Promise<string>} Pre-filled data or empty string
 */
export async function getPrefillData(threadChannelId) {
  if (!supportsV3Prefill) return '';
  return await getFormattedDoorList(threadChannelId);
}

// Helper function
function parseDoorLines(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const [door, materials] = line.split('|').map(s => (s || '').trim());
      return { door, materials };
    })
    .filter(e => e.door && e.materials);
}
