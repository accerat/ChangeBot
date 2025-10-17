// index.js — ChangeBot (multi-type change request system)

import 'dotenv/config';
import cron from 'node-cron';
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionType,
  ChannelType,
} from 'discord.js';
import { initDatabase } from './db/schema.js';
import { CHANGE_TYPES, getChangeType } from './config/changeTypes.js';
import { triggerRegeneration } from './excel/generator.js';
import { syncToDrive, isDriveConfigured } from './excel/driveSync.js';

// -------- ENV --------
const {
  UHC_DISCORD_TOKEN,
  UHC_MISSING_MATERIALS_CHANNEL_ID,
  UHC_UHCMATERIALS_ROLE_ID,
  MLB_OFFICE_ROLE_ID,
  UHC_ALLOWED_FORUM_IDS = '1397268083642466374,1397270791175012453',
} = process.env;

function t(x) { return (x || '').trim(); }
const TOKEN = t(UHC_DISCORD_TOKEN);
const MISSING_CH_ID = t(UHC_MISSING_MATERIALS_CHANNEL_ID);
const MATERIALS_ROLE_ID = t(UHC_UHCMATERIALS_ROLE_ID);
const MLB_OFFICE_ID = t(MLB_OFFICE_ROLE_ID);
const ALLOWED_FORUMS = (UHC_ALLOWED_FORUM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN || !MISSING_CH_ID || !MATERIALS_ROLE_ID) {
  console.error('[config] Missing required env vars.');
  process.exit(1);
}

console.log('[boot] ChangeBot starting...');

// -------- DB --------
const db = initDatabase('./uhc_materials.db');

// -------- Client --------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once('ready', () => {
  console.log(`[ready] ChangeBot online as ${client.user.tag}`);
  console.log(`[ready] Loaded ${CHANGE_TYPES.length} change types: ${CHANGE_TYPES.map(t => t.id).join(', ')}`);
});
client.on('error', (e) => console.error('[client error]', e));

// -------- Helpers --------
function isInAllowedProjectThread(channel) {
  try {
    if (channel?.isThread?.()) {
      if (!ALLOWED_FORUMS.length) return true;
      return ALLOWED_FORUMS.includes(channel.parentId);
    }
    return false;
  } catch {
    return false;
  }
}

function hasMLBOfficeRole(member) {
  if (!MLB_OFFICE_ID) return true; // If not configured, allow everyone
  return member.roles.cache.has(MLB_OFFICE_ID);
}

// -------- Mention → Multi-Button --------
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;
    if (!isInAllowedProjectThread(msg.channel)) return;

    console.log('[mention] Bot mentioned in thread:', msg.channel.id);

    // Create button row with all change types
    const buttons = CHANGE_TYPES.map(type =>
      new ButtonBuilder()
        .setCustomId(`change_type:${type.id}`)
        .setLabel(type.label)
        .setStyle(type.buttonStyle || ButtonStyle.Primary)
    );

    const row = new ActionRowBuilder().addComponents(buttons);

    await msg.reply({
      content: 'What type of change would you like to submit?',
      components: [row],
    });
  } catch (e) {
    console.error('[mention handler]', e);
  }
});

// -------- Interactions --------
client.on('interactionCreate', async (interaction) => {
  try {
    // Change Type Button → Open Modal
    if (interaction.isButton() && interaction.customId.startsWith('change_type:')) {
      const typeId = interaction.customId.split(':')[1];
      const changeType = getChangeType(typeId);

      if (!changeType) {
        return interaction.reply({ content: '⚠️ Unknown change type.', ephemeral: true });
      }

      try {
        // Get pre-fill data if supported
        const prefillData = await changeType.getPrefillData(interaction.channelId);
        const modal = changeType.buildModal(interaction, prefillData);
        await interaction.showModal(modal);
      } catch (e) {
        console.error('[modal error]', e);
        return interaction.reply({ content: `⚠️ Could not open form: ${e?.message || e}`, ephemeral: true });
      }
      return;
    }

    // Modal Submit → Parse & Post
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('change_modal:')) {
      const typeId = interaction.customId.split(':')[1];
      const changeType = getChangeType(typeId);

      if (!changeType) {
        return interaction.reply({ content: '⚠️ Unknown change type.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        // Parse submission
        const parsedData = changeType.parseSubmission(interaction);

        // Insert to database first to get ID for PO number
        const insertStmt = db.prepare(`
          INSERT INTO requests (type, status, guild_id, project_thread_id, project_title, requested_by, data)
          VALUES (@type, @status, @guild_id, @project_thread_id, @project_title, @requested_by, @data)
        `);

        const result = insertStmt.run({
          type: typeId,
          status: 'pending',
          guild_id: interaction.guildId,
          project_thread_id: interaction.channelId,
          project_title: (interaction.channel && 'name' in interaction.channel) ? (interaction.channel.name || null) : null,
          requested_by: interaction.user.id,
          data: JSON.stringify(parsedData)
        });

        const rowId = result.lastInsertRowid;
        const poNumber = `${changeType.poPrefix}-${String(rowId).padStart(4, '0')}`;

        // Format embed
        const embed = changeType.formatEmbed(parsedData, poNumber, interaction.user.id);

        // Add description with mention
        embed.setDescription(`<@&${MATERIALS_ROLE_ID}>`);

        const linkBack = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}`;

        // Fetch destination channel
        const dest = await client.channels.fetch(MISSING_CH_ID);

        // Create status buttons
        const statusRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`status:in_progress:${rowId}`)
            .setLabel('Mark In Progress')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`status:completed:${rowId}`)
            .setLabel('Mark Complete')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`status:cancelled:${rowId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
        );

        // Post to destination
        if (dest?.type === ChannelType.GuildForum) {
          const baseName = interaction.channel?.name || changeType.label;
          const threadName = `${baseName} — ${poNumber}`.slice(0, 95);

          const thread = await dest.threads.create({
            name: threadName,
            message: {
              content: `<@&${MATERIALS_ROLE_ID}> → from: ${linkBack} — **${poNumber}**\n\n**Status:** 🟡 Pending`,
              embeds: [embed],
              components: [statusRow]
            },
          });

          db.prepare(`UPDATE requests SET destination_msg_id=@tid WHERE id=@rid`)
            .run({ tid: thread.id, rid: rowId });

          await interaction.editReply(`✅ Submitted to **${dest.name}** as **${poNumber}**`);
        } else if (dest?.isTextBased()) {
          const msg = await dest.send({
            content: `<@&${MATERIALS_ROLE_ID}> → from: ${linkBack} — **${poNumber}**\n\n**Status:** 🟡 Pending`,
            embeds: [embed],
            components: [statusRow]
          });

          db.prepare(`UPDATE requests SET destination_msg_id=@mid WHERE id=@rid`)
            .run({ mid: msg.id, rid: rowId });

          await interaction.editReply(`✅ Submitted as **${poNumber}**`);
        }

        // Trigger Excel regeneration in background
        triggerRegeneration(typeId).then(async (files) => {
          if (isDriveConfigured() && files[typeId]) {
            await syncToDrive(typeId, files[typeId]);
          }
        }).catch(e => console.error('[excel/drive]', e));

      } catch (e) {
        console.error('[submission error]', e);
        return interaction.editReply(`⚠️ Error: ${e?.message || e}`);
      }
      return;
    }

    // Status Button → Update Status
    if (interaction.isButton() && interaction.customId.startsWith('status:')) {
      const [_, newStatus, requestId] = interaction.customId.split(':');

      // Check MLB Office role
      if (!hasMLBOfficeRole(interaction.member)) {
        return interaction.reply({ content: '⚠️ Only MLB Office can update status.', ephemeral: true });
      }

      try {
        const now = new Date().toISOString();
        const updateStmt = db.prepare(`
          UPDATE requests
          SET status = @status, completed_at = @completed_at, completed_by = @completed_by
          WHERE id = @id
        `);

        updateStmt.run({
          status: newStatus,
          completed_at: (newStatus === 'completed' || newStatus === 'cancelled') ? now : null,
          completed_by: (newStatus === 'completed' || newStatus === 'cancelled') ? interaction.user.id : null,
          id: requestId
        });

        // Update message with new status
        const statusEmoji = {
          pending: '🟡',
          in_progress: '🔵',
          completed: '✅',
          cancelled: '⚫'
        }[newStatus] || '⚪';

        const statusText = newStatus.replace('_', ' ').toUpperCase();

        await interaction.update({
          content: interaction.message.content.replace(/\*\*Status:\*\* .+/, `**Status:** ${statusEmoji} ${statusText}`),
          embeds: interaction.message.embeds,
          components: interaction.message.components
        });

        console.log(`[status] Request ${requestId} → ${newStatus} by ${interaction.user.tag}`);

        // Trigger Excel regeneration in background
        const request = db.prepare(`SELECT type FROM requests WHERE id = ?`).get(requestId);
        if (request) {
          triggerRegeneration(request.type).then(async (files) => {
            if (isDriveConfigured() && files[request.type]) {
              await syncToDrive(request.type, files[request.type]);
            }
          }).catch(e => console.error('[excel/drive]', e));
        }
      } catch (e) {
        console.error('[status update error]', e);
        return interaction.reply({ content: `⚠️ Error updating status: ${e?.message || e}`, ephemeral: true });
      }
      return;
    }
  } catch (e) {
    console.error('[interaction error]', e);
    if (interaction?.isRepliable?.()) {
      try { await interaction.reply({ content: '⚠️ Error handling request.', ephemeral: true }); } catch {}
    }
  }
});

// -------- Reminders at 12:00 & 18:00 CT --------
cron.schedule('0 12,18 * * *', async () => {
  try {
    const dest = await client.channels.fetch(MISSING_CH_ID);
    if (dest?.type === ChannelType.GuildForum) return; // Skip for forums
    if (dest?.isTextBased()) {
      await dest.send(`⏰ Reminder: Please review open change requests. <@&${MATERIALS_ROLE_ID}>`);
    }
  } catch (e) {
    console.error('[reminder]', e);
  }
}, { timezone: 'America/Chicago' });

// -------- Login --------
client.login(TOKEN);
