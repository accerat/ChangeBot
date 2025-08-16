// index.js — UHCmaterialbot (mention flow; single-field modal; forum-aware posting)

import 'dotenv/config';
import http from 'http';
import express from 'express';
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

// show me the discord token at startup
console.log('[boot]', {
  botTag: client?.user?.tag ?? 'starting…',
  envTokenTail: (process.env.DISCORD_TOKEN || process.env.UHC_DISCORD_TOKEN || '').slice(-8),
});
client.once('ready', () => {
  console.log('[ready]', {
    botTag: client.user.tag,
    botId: client.user.id,
  });
});
// -------- ENV --------
const {
  UHC_DISCORD_TOKEN,
  UHC_MISSING_MATERIALS_CHANNEL_ID,
  UHC_UHCMATERIALS_ROLE_ID,
  UHC_ALLOWED_FORUM_IDS = '1397268083642466374,1397270791175012453',
  PORT = 10000,
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

// -------- Keepalive /health --------
const app = express();
// Return 200 for HEAD /health (no body)
app.head('/health', (_req, res) => {
  res.status(200).end();
});

// Optional: also 200 for HEAD /
app.head('/', (_req, res) => {
  res.status(200).end();
});

// Keep GET / as 200 too (optional but handy)
app.get('/', (_req, res) => {
  res.status(200).send('ok');
});

// Existing GET /health (leave as-is or keep it minimal)
app.get('/health', (_req, res) => {
  // Avoid heavy work here; UptimeRobot just needs a 200
  res.status(200).json({
    service: 'UHCmaterialbot',
    logged_in_as: client.user ? `${client.user.tag} (${client.user.id})` : null,
    guilds: client.guilds?.cache?.size ?? 0,
    ws_status: client.ws?.status ?? null,
    ws_ping_ms: client.ws?.ping ?? null,
  });
});

http.createServer(app).listen(PORT, () => console.log('HTTP keepalive listening on', PORT));

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

function openRequestModal(interaction) {
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
    if (msg.author.bot) return;
    if (!msg.mentions.has(client.user)) return;
    if (!isInAllowedProjectThread(msg.channel)) return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('uhc_open_modal')
        .setLabel('Open Doors Form') // short label
        .setStyle(ButtonStyle.Primary)
    );

    await msg.reply({
      content: 'Let’s file a UHC materials request. Click the button to open the form.',
      components: [row],
    });
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
        await openRequestModal(interaction);
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
