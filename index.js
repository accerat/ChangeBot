// index.js — UHCmaterialbot (mention flow; single-field modal; forum-aware posting)

import 'dotenv/config';
import Database from 'better-sqlite3';
import cron from 'node-cron';
import {
  Client,
  GatewayIntentBits,
  Partials,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  InteractionType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from 'discord.js';
import { getFormattedDoorList } from './utils/v3Templates.js';

// -------- ENV --------
const {
  UHC_DISCORD_TOKEN,
  UHC_MISSING_MATERIALS_CHANNEL_ID,
  UHC_UHCMATERIALS_ROLE_ID,
  UHC_ALLOWED_FORUM_IDS = '1397268083642466374,1397270791175012453',
} = process.env;

function t(x) { return (x || '').trim(); }
const TOKEN = t(UHC_DISCORD_TOKEN);
const MISSING_CH_ID = t(UHC_MISSING_MATERIALS_CHANNEL_ID);
const MATERIALS_ROLE_ID = t(UHC_UHCMATERIALS_ROLE_ID);
const ALLOWED_FORUMS = (UHC_ALLOWED_FORUM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN || !MISSING_CH_ID || !MATERIALS_ROLE_ID) {
  console.error('[config] Missing one or more required env vars.');
  process.exit(1);
}

console.log('[boot] forum-aware UHCmaterialbot starting');

// -------- DB --------
const db = new Database('./uhc_materials.db');
db.exec(`
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  project_thread_id TEXT,
  project_title TEXT,
  requested_by TEXT NOT NULL,
  location TEXT,
  needed_by TEXT,
  items TEXT NOT NULL,     -- JSON (for this bot: [{door, materials}])
  notes TEXT,
  missing_channel_msg_id TEXT, -- stores created forum thread id when using forums
  created_at TEXT DEFAULT (datetime('now'))
);
`);

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
  console.log(`[ready] UHCmaterialbot online as ${client.user.tag}`);
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

function openRequestModal(interaction, defaultValue = '') {
  const modal = new ModalBuilder()
    .setCustomId('uhc_mat_modal')
    .setTitle('UHC Doors'); // <=45 chars

  const lines = new TextInputBuilder()
    .setCustomId('door_missing_lines')
    .setLabel('Door | Missing') // <=45 chars
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    // Keep placeholder <= ~100 chars to avoid string length errors
    .setPlaceholder('One per line: Door ID | Missing material(s). Ex: 102A | Closer arm + 4x #12 screws');

  // Pre-populate with V3 template data if available
  if (defaultValue) {
    lines.setValue(defaultValue);
  }

  modal.addComponents(new ActionRowBuilder().addComponents(lines));
  return interaction.showModal(modal); // return so caller can await/catch
}

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

// -------- Mention → Button --------
client.on('messageCreate', async (msg) => {
  try {
    console.log('[messageCreate] Message received from', msg.author.tag);

    if (msg.author.bot) {
      console.log('[messageCreate] Ignoring bot message');
      return;
    }

    if (!msg.mentions.has(client.user)) {
      console.log('[messageCreate] Bot not mentioned');
      return;
    }

    console.log('[messageCreate] Bot mentioned! Checking thread...');
    console.log('[messageCreate] Channel type:', msg.channel.type, 'Is thread?', msg.channel.isThread?.());
    console.log('[messageCreate] Parent ID:', msg.channel.parentId, 'Allowed forums:', ALLOWED_FORUMS);

    if (!isInAllowedProjectThread(msg.channel)) {
      console.log('[messageCreate] Not in allowed project thread, ignoring');
      return;
    }

    console.log('[messageCreate] In allowed thread! Fetching V3 template...');
    // Pre-fetch V3 template in background to check if available
    const doorList = await getFormattedDoorList(msg.channel.id);
    console.log('[messageCreate] Door list:', doorList ? `Found ${doorList.split('\n').length} doors` : 'None found');

    const buttonLabel = doorList ? 'Open Doors Form (Pre-filled)' : 'Open Doors Form';
    const contentMsg = doorList
      ? 'UHC materials request - I found door IDs from your project template. Click to open the pre-filled form.'
      : 'UHC materials request - Click the button to open the form.';

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('uhc_open_modal')
        .setLabel(buttonLabel) // short label
        .setStyle(ButtonStyle.Primary)
    );

    console.log('[messageCreate] Sending reply...');
    await msg.reply({
      content: contentMsg,
      components: [row],
    });
    console.log('[messageCreate] Reply sent successfully!');
  } catch (e) {
    console.error('[mention handler]', e);
  }
});

// -------- Interactions --------
client.on('interactionCreate', async (interaction) => {
  try {
    // Button → open modal
    if (interaction.isButton() && interaction.customId === 'uhc_open_modal') {
      try {
        // Fetch V3 template for this thread
        const doorList = await getFormattedDoorList(interaction.channelId);
        await openRequestModal(interaction, doorList);
      } catch (e) {
        console.error('[button→modal error]', e);
        return interaction.reply({ content: `⚠️ Could not open form: ${e?.message || e}`, ephemeral: true });
      }
      return;
    }

    // Modal submit → parse & post
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'uhc_mat_modal') {
      await interaction.deferReply({ ephemeral: true });

      const raw = interaction.fields.getTextInputValue('door_missing_lines') || '';
      const entries = parseDoorLines(raw);

      if (!entries.length) {
        return interaction.editReply('Please enter at least one line like: `102A | Closer arm + screws`');
      }

      // Build embed once
      const list = entries
        .map((e, i) => `${i + 1}. **${e.door}** — ${e.materials}`)
        .join('\n')
        .slice(0, 4000);

      const embed = new EmbedBuilder()
        .setTitle('🧱 UHC Materials (Doors)')
        .setDescription(`<@&${MATERIALS_ROLE_ID}>`)
        .addFields(
          { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Items', value: list }
        )
        .setTimestamp(new Date());

      const linkBack = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}`;

      // Fetch destination channel
      const dest = await client.channels.fetch(MISSING_CH_ID);

      // Insert DB row first to generate a sequential id we can use in the PO#
      const insertStmt = db.prepare(`
        INSERT INTO requests
          (guild_id, project_thread_id, project_title, requested_by, location, needed_by, items, notes, missing_channel_msg_id)
        VALUES
          (@guild_id, @project_thread_id, @project_title, @requested_by, @location, @needed_by, @items, @notes, @missing_channel_msg_id)
      `);

      const basePayload = {
        guild_id: interaction.guildId,
        project_thread_id: interaction.channelId,
        project_title: (interaction.channel && 'name' in interaction.channel) ? (interaction.channel.name || null) : null,
        requested_by: interaction.user.id,
        location: null,
        needed_by: null,
        items: JSON.stringify(entries), // [{door, materials}]
        notes: null,
        missing_channel_msg_id: null, // to be updated if we create a forum thread
      };

      const result = insertStmt.run(basePayload);
      const rowId = result.lastInsertRowid; // use this to mint a PO#
      const poNumber = `UHC-${String(rowId).padStart(4, '0')}`;

      // Post based on channel type
      if (dest?.type === ChannelType.GuildForum) {
        // Create a new forum thread, copying the current thread title and appending PO#
        const baseName = basePayload.project_title || 'UHC Materials';
        const threadName = `${baseName} — PO#${poNumber}`.slice(0, 95); // keep under Discord name limits

        const thread = await dest.threads.create({
          name: threadName,
          message: {
            content: `<@&${MATERIALS_ROLE_ID}> → from project thread: ${linkBack} — **PO#${poNumber}**`,
            embeds: [embed],
          },
          // appliedTags: [] // optionally apply forum tags here
        });

        // Update DB with the created thread id
        db.prepare(`UPDATE requests SET missing_channel_msg_id=@tid WHERE id=@rid`)
          .run({ tid: thread.id, rid: rowId });

        await interaction.editReply(`✅ Submitted to **${dest.name}** as a new thread (**PO#${poNumber}**) and notified @uhcmaterials.`);
      } else if (dest?.isTextBased()) {
        // Fallback: plain text channel
        const msg = await dest.send({
          content: `<@&${MATERIALS_ROLE_ID}> → from project thread: ${linkBack} — **PO#${poNumber}**`,
          embeds: [embed],
        });

        // Update DB with message id (we reuse the same column)
        db.prepare(`UPDATE requests SET missing_channel_msg_id=@mid WHERE id=@rid`)
          .run({ mid: msg.id, rid: rowId });

        await interaction.editReply('✅ Submitted to #missing-materials and notified @uhcmaterials.');
      } else {
        await interaction.editReply('Config error: target channel is neither text nor forum.');
      }
    }
  } catch (e) {
    console.error('[interaction error]', e);
    if (interaction?.isRepliable?.()) {
      try { await interaction.reply({ content: '⚠️ Error handling your request.', ephemeral: true }); } catch {}
    }
  }
});

// -------- Reminders at 12:00 & 18:00 America/Chicago --------
cron.schedule('0 12,18 * * *', async () => {
  try {
    const dest = await client.channels.fetch(MISSING_CH_ID);
    if (dest?.type === ChannelType.GuildForum) {
      // Forums can’t receive plain messages; post a daily summary thread title instead (optional).
      // You may want to skip or implement your own summary thread logic here.
      // For now, do nothing to avoid clutter.
      return;
    }
    if (dest?.isTextBased()) {
      await dest.send(`⏰ Reminder: Please review open requests. <@&${MATERIALS_ROLE_ID}>`);
    }
  } catch (e) {
    console.error('[reminder]', e);
  }
}, { timezone: 'America/Chicago' });

// -------- Login --------
client.login(TOKEN);
