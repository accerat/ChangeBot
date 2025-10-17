// modules/schedule/index.js
// Schedule change request module

import { ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } from 'discord.js';

export const id = 'schedule';
export const label = 'Schedule Change';
export const buttonStyle = ButtonStyle.Secondary;
export const poPrefix = 'SCHEDULE';
export const supportsV3Prefill = false;

/**
 * Build modal for schedule change request
 * @param {Interaction} interaction - Discord interaction
 * @param {string} prefillData - Pre-filled data (not used for schedule)
 * @returns {Modal} Discord modal
 */
export function buildModal(interaction, prefillData = '') {
  const modal = new ModalBuilder()
    .setCustomId(`change_modal:${id}`)
    .setTitle('Schedule Change Request');

  const oldDate = new TextInputBuilder()
    .setCustomId('old_date')
    .setLabel('Current/Old Date')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('MM/DD/YYYY');

  const newDate = new TextInputBuilder()
    .setCustomId('new_date')
    .setLabel('New/Proposed Date')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('MM/DD/YYYY');

  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for Change')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder('Explain why the schedule is changing...');

  const timeImpact = new TextInputBuilder()
    .setCustomId('time_impact')
    .setLabel('Time Impact (days delayed/advanced)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('e.g., "+3 days" or "-2 days"');

  modal.addComponents(
    new ActionRowBuilder().addComponents(oldDate),
    new ActionRowBuilder().addComponents(newDate),
    new ActionRowBuilder().addComponents(reason),
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
  const oldDate = interaction.fields.getTextInputValue('old_date').trim();
  const newDate = interaction.fields.getTextInputValue('new_date').trim();
  const reason = interaction.fields.getTextInputValue('reason').trim();
  const timeImpact = interaction.fields.getTextInputValue('time_impact')?.trim() || '';

  if (!oldDate || !newDate || !reason) {
    throw new Error('Please fill in all required fields');
  }

  return {
    old_date: oldDate,
    new_date: newDate,
    reason,
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
    .setTitle('📅 Schedule Change Request')
    .addFields(
      { name: 'PO Number', value: poNumber, inline: true },
      { name: 'Requested By', value: `<@${userId}>`, inline: true },
      { name: 'Current Date', value: data.old_date, inline: true },
      { name: 'New Date', value: data.new_date, inline: true },
      { name: 'Reason', value: data.reason.slice(0, 1000) }
    )
    .setTimestamp(new Date());

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
    { header: 'Old Date', key: 'old_date', width: 12 },
    { header: 'New Date', key: 'new_date', width: 12 },
    { header: 'Reason', key: 'reason', width: 40 },
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
    old_date: data.old_date,
    new_date: data.new_date,
    reason: data.reason,
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
  return ''; // Schedule changes don't support pre-fill
}
