// modules/scope/index.js
// Scope change request module

import { ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } from 'discord.js';
import { getFormattedDoorList } from '../../utils/v3Templates.js';

export const id = 'scope';
export const label = 'Scope Change';
export const buttonStyle = ButtonStyle.Danger;
export const poPrefix = 'SCOPE';
export const supportsV3Prefill = true;

/**
 * Build modal for scope change request
 * @param {Interaction} interaction - Discord interaction
 * @param {string} prefillData - Pre-filled door list from V3 templates (optional)
 * @returns {Modal} Discord modal
 */
export function buildModal(interaction, prefillData = '') {
  const modal = new ModalBuilder()
    .setCustomId(`change_modal:${id}`)
    .setTitle('Scope Change Request');

  const doors = new TextInputBuilder()
    .setCustomId('affected_doors')
    .setLabel('Affected Doors (one per line)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder('102A\n707A\n151E');

  if (prefillData) {
    // Extract just door IDs from "106A | \n707A | " format
    const doorIds = prefillData.split('\n').map(line => line.split('|')[0].trim()).filter(Boolean).join('\n');
    doors.setValue(doorIds);
  }

  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description of Change')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder('Describe what work is being added or removed...');

  const timeImpact = new TextInputBuilder()
    .setCustomId('time_impact')
    .setLabel('Time Impact (days)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('e.g., "+5 days" or "-2 days"');

  modal.addComponents(
    new ActionRowBuilder().addComponents(doors),
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(timeImpact)
  );

  return modal;
}

/**
 * Parse modal submission
 * @param {Interaction} interaction - Modal submit interaction
 * @returns {object} Parsed data
 */
export function parseSubmission(interaction) {
  const affectedDoors = interaction.fields.getTextInputValue('affected_doors')?.trim() || '';
  const description = interaction.fields.getTextInputValue('description').trim();
  const timeImpact = interaction.fields.getTextInputValue('time_impact')?.trim() || '';

  if (!description) {
    throw new Error('Please provide a description of the scope change');
  }

  const doors = affectedDoors
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  return {
    affected_doors: doors,
    description,
    time_impact: timeImpact
  };
}

/**
 * Format embed for posting
 * @param {object} data - Parsed submission data
 * @param {string} poNumber - PO number
 * @param {string} userId - Requesting user ID
 * @returns {Embed} Discord embed
 */
export function formatEmbed(data, poNumber, userId) {
  const embed = new EmbedBuilder()
    .setTitle('🔧 Scope Change Request')
    .setColor(0xFF0000) // Red for scope changes
    .addFields(
      { name: 'PO Number', value: poNumber, inline: true },
      { name: 'Requested By', value: `<@${userId}>`, inline: true },
      { name: 'Description', value: data.description.slice(0, 1000) }
    )
    .setTimestamp(new Date());

  if (data.affected_doors.length > 0) {
    const doorList = data.affected_doors.slice(0, 20).join(', ');
    embed.addFields({ name: 'Affected Doors', value: doorList, inline: false });
  }

  if (data.time_impact) {
    embed.addFields({ name: 'Time Impact', value: data.time_impact, inline: true });
  }

  return embed;
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
    { header: 'Description', key: 'description', width: 50 },
    { header: 'Affected Doors', key: 'affected_doors', width: 30 },
    { header: 'Time Impact', key: 'time_impact', width: 15 },
    { header: 'Completed Date', key: 'completed_at', width: 12 },
    { header: 'Completed By', key: 'completed_by', width: 20 }
  ];
}

/**
 * Format data for Excel export
 * @param {object} request - Database request row
 * @param {string} poNumber - PO number
 * @returns {Array} Rows for Excel
 */
export function formatForExcel(request, poNumber) {
  const data = JSON.parse(request.data);
  return [{
    po_number: poNumber,
    status: request.status,
    project_title: request.project_title || 'Unknown',
    requested_by: request.requested_by,
    created_at: request.created_at.split('T')[0],
    description: data.description,
    affected_doors: data.affected_doors.join(', '),
    time_impact: data.time_impact || '',
    completed_at: request.completed_at ? request.completed_at.split('T')[0] : '',
    completed_by: request.completed_by || ''
  }];
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
