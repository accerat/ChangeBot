// config/changeTypes.js
// Registry of all enabled change types

import { ButtonStyle } from 'discord.js';
import * as materials from '../modules/materials/index.js';
import * as schedule from '../modules/schedule/index.js';
import * as scope from '../modules/scope/index.js';

/**
 * Registry of all change types
 * Each module exports: { id, label, buttonStyle, poPrefix, buildModal, parseSubmission, formatEmbed }
 */
export const CHANGE_TYPES = [
  materials,
  schedule,
  scope
];

/**
 * Get change type module by ID
 * @param {string} typeId - Change type ID (e.g., 'materials')
 * @returns {object|null} Change type module or null
 */
export function getChangeType(typeId) {
  return CHANGE_TYPES.find(t => t.id === typeId) || null;
}

/**
 * Get all change type selection buttons for mention response
 * @returns {Array} Array of Discord button builders
 */
export function getSelectionButtons() {
  return CHANGE_TYPES.map(type => ({
    customId: `change_type:${type.id}`,
    label: type.label,
    style: type.buttonStyle || ButtonStyle.Primary
  }));
}
