// index.js
require('dotenv').config();


// Remove White Spaces for Render, right after require('dotenv').config();
process.env.DISCORD_TOKEN = (process.env.DISCORD_TOKEN || '').trim();
process.env.CLIENT_ID     = (process.env.CLIENT_ID || '').trim();
process.env.GUILD_ID      = (process.env.GUILD_ID || '').trim();

// ---------------add keepalive http server ----------- //
// --- keepalive server for Render Web Service ---
// at top (only once)
const http = require('http');

// … after you create `client` …
const PORT = process.env.PORT || 10000;

// prevent double-binding on hot restarts / multiple imports
if (!global.__materialbot_http_server) {
  global.__materialbot_http_server = http
    .createServer((req, res) => {
      const ws = client?.ws;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        service: 'MaterialBot',
        env: {
          DISCORD_TOKEN: process.env.DISCORD_TOKEN ? 'set' : 'missing',
          CLIENT_ID: process.env.CLIENT_ID ? 'set' : 'missing',
          GUILD_ID: process.env.GUILD_ID ? 'set' : 'missing',
          MATERIAL_FORUM_CHANNEL_ID: process.env.MATERIAL_FORUM_CHANNEL_ID ? 'set' : 'missing'
        },
        discord: {
          logged_in_as: client?.user ? `${client.user.tag} (${client.user.id})` : null,
          ws_status: client?.ws?.status ?? null,
          ws_status_name: ({0:'ready',1:'connecting',2:'reconnecting',3:'disconnected',4:'idle',5:'nearly',6:'identifying',7:'resuming'})[client?.ws?.status] ?? String(client?.ws?.status),
          ws_ping_ms: client?.ws?.ping ?? null,
          guilds: client?.guilds?.cache?.size ?? 0
        },
        uptime_ms: Math.round(process.uptime() * 1000)
      }));
    })
    .listen(PORT, () => console.log('HTTP keepalive listening on', PORT));
}

// ---------------END add keepalive http server END ----------- //
// -------- add bot id embed in token ---------------- //
function tokenBotId(token) {
  try {
    const first = String(token || '').split('.')[0];
    // Discord uses URL-safe base64 for the first segment
    const b64 = first.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

const RAW_TOKEN = (process.env.DISCORD_TOKEN || '').trim();
const TOKEN_BOT_ID = tokenBotId(RAW_TOKEN);

console.log('[idcheck] token_bot_id =', TOKEN_BOT_ID);
console.log('[idcheck] CLIENT_ID    =', (process.env.CLIENT_ID || '').trim());

// -------- END add bot id embed in token END ---------------- //



// ---- DIAGNOSTICS: process-level logging ----
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err?.stack || err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack || err);
});
process.on('SIGTERM', () => { console.warn('[signal] SIGTERM received'); });
process.on('SIGINT', () => { console.warn('[signal] SIGINT received'); });

const startedAt = Date.now();

const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  Routes,
  REST,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db = require('./db/client');
const { parseCityState } = require('./utils/parseLocationFromTitle');
const { orderSummaryEmbed, suppliersEmbed, jumpButtons, controlButtons } = require('./utils/embeds');
const { scheduleReminders } = require('./reminders/scheduler');
const googleSuppliers = require('./suppliers/google');
const osmSuppliers = require('./suppliers/osm');



// ----- ENV -----
const DISCORD_TOKEN             = process.env.DISCORD_TOKEN;
const CLIENT_ID                 = process.env.CLIENT_ID;
const GUILD_ID                  = process.env.GUILD_ID;
const OPS_MATERIALS_ROLE_ID     = process.env.OPS_MATERIALS_ROLE_ID;
const EXEC_TEAM_ROLE_ID         = process.env.EXEC_TEAM_ROLE_ID;
const MATERIAL_FORUM_CHANNEL_ID = process.env.MATERIAL_FORUM_CHANNEL_ID;
const SUPPLIER_RADIUS_MILES     = Number(process.env.SUPPLIER_RADIUS_MILES || 50);

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env'); process.exit(1);
}
if (!CLIENT_ID || !GUILD_ID || !MATERIAL_FORUM_CHANNEL_ID || !OPS_MATERIALS_ROLE_ID || !EXEC_TEAM_ROLE_ID) {
  console.warn('One or more IDs missing in .env — double-check before prod.');
}

// ----- DISCORD CLIENT -----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// ---- DIAGNOSTICS: tiny HTTP server with health ----

function safeBool(x){ return x ? 'set' : 'missing'; }

function buildStatus() {
  const now = Date.now();
  const upMs = now - startedAt;

  // Safe snapshot of important flags (no secrets)
  const envBrief = {
    DISCORD_TOKEN: safeBool(process.env.DISCORD_TOKEN),
    CLIENT_ID: safeBool(process.env.CLIENT_ID),
    GUILD_ID: safeBool(process.env.GUILD_ID),
    MATERIAL_FORUM_CHANNEL_ID: safeBool(process.env.MATERIAL_FORUM_CHANNEL_ID)
  };

  const gateway = client.ws?.status ?? 'unknown';
  const ping = client.ws?.ping ?? null;

  return {
    service: 'MaterialBot',
    pid: process.pid,
    uptime_ms: upMs,
    uptime_s: Math.round(upMs / 1000),
    started_at_iso: new Date(startedAt).toISOString(),
    env: envBrief,
    discord: {
      logged_in_as: client.user ? `${client.user.tag} (${client.user.id})` : null,
      ws_status: gateway, // 'ready' | 'connecting' | 'reconnecting' | 'idle' (discord.js v14 statuses)
      ws_ping_ms: ping,
      guilds: client.guilds?.cache?.size ?? 0
    },
    memory: process.memoryUsage(),
  };
}

// ai asked me to remove
//  const server = http.createServer((req, res) => {
//  if (req.url === '/health' || req.url === '/healthz') {
//    const st = buildStatus();
//    const ok = (st.discord.ws_status === 'ready' && !!st.discord.logged_in_as);
//    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
//    return res.end(JSON.stringify(st));
//  }
//  if (req.url === '/ping') {
//    res.writeHead(200, { 'Content-Type': 'text/plain' });
//    return res.end('pong');
//  }
  // lightweight text index
//  res.writeHead(200, { 'Content-Type': 'text/plain' });
//  res.end('MaterialBot diagnostics: /health | /healthz | /ping');
//});

//server.listen(PORT, () => {
//  console.log(`HTTP keepalive listening on ${PORT}`);
//});

// --------------------------- DIAGNOSTICS: tiny HTTP server with health END ---- //
// ---- DIAGNOSTICS: discord client + REST logging ----
client.on('ready', () => {
  console.log(`[ready] Logged in as ${client.user.tag} (${client.user.id})`);
});

client.on('error', (e) => console.error('[client error]', e));
client.on('shardError', (e, id) => console.error(`[shard error] shard=${id}`, e));
client.on('shardDisconnect', (event, id) =>
  console.warn(`[shard disconnect] shard=${id} code=${event?.code} reason=${event?.reason || ''}`)
);
client.on('shardReconnecting', (id) => console.warn(`[shard reconnecting] shard=${id}`));
client.on('shardResume', (id, replayed) => console.log(`[shard resume] shard=${id} events_replayed=${replayed}`));

// Interaction visibility (helps catch permission or command issues)
client.on('interactionCreate', (i) => {
  const kind = i.isChatInputCommand() ? 'slash' :
               i.isButton() ? 'button' :
               i.isModalSubmit() ? 'modal' : 'other';
  console.log(`[interaction] type=${kind} user=${i.user?.tag} channel=${i.channelId} guild=${i.guildId}`);
});

// REST rate limit (discord.js v14 exposes rest on client)
if (client.rest && client.rest.on) {
  client.rest.on('rateLimited', (info) => {
    console.warn('[rest rateLimited]', {
      timeout: info.timeout, limit: info.limit, method: info.method, route: info.route, bucket: info.bucket
    });
  });
}

// Heartbeat: log ping + gateway status every 60s so we can detect drops
//setInterval(() => {
//  const status = client.ws?.status ?? 'unknown';
//  const ping = client.ws?.ping ?? -1;
//  console.log(`[heartbeat] ws_status=${status} ping_ms=${ping} guilds=${client.guilds?.cache?.size ?? 0}`);
//}, 60_000);

function wsStatusName(s) {
  return ({0:'ready',1:'connecting',2:'reconnecting',3:'idle',4:'nearly',5:'disconnected'}[s]) ?? String(s);
}

// replace your heartbeat log line with:
const status = client.ws?.status ?? -1;
const ping = client.ws?.ping ?? -1;
console.log(`[heartbeat] ws_status=${wsStatusName(status)} ping_ms=${ping} guilds=${client.guilds?.cache?.size ?? 0}`);

// --------------------------------- DIAGNOSTICS: discord client + REST logging END ----//

// ----- SLASH COMMAND REGISTRATION -----
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName('materials')
      .setDescription('Start a materials request cart in this thread')
      .addStringOption(o => o.setName('need_by')
        .setDescription('When do you need these materials? (e.g., 2025-08-15 08:00)')
        .setRequired(false))
      .addStringOption(o => o.setName('notes')
        .setDescription('Order-level notes (optional)')
        .setRequired(false))
      .toJSON()
  ];

  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✓ Slash commands registered');
}

// ----- HELPERS -----
  // Starter Panel Buttons
function starterPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mat_start_add').setLabel('Add Item').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('mat_start_review').setLabel('Review / Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('mat_start_over').setLabel('Start Over').setStyle(ButtonStyle.Danger),
    )
  ];
}
function isProjectThread(channel) {
  if (!channel) return false;

  // If it's a thread (public or private), check its parent forum ID
  if (typeof channel.isThread === 'function' && channel.isThread()) {
    const parentId = channel.parentId;
    return (
      parentId === process.env.UHC_FORUM_ID ||
      parentId === process.env.NON_UHC_FORUM_ID
    );
  }

  // Not a thread (likely the forum index itself)
  return false;
}

function buildProjectJumpUrl(message) {
  // Works for both thread and forum threads; Discord deep-links to the message
  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

// Pull City, ST from thread title; allow override via modal later
function getThreadLocationMeta(thread) {
  const title = thread.name || thread?.parent?.name || '';
  const { city, state, locationText } = parseCityState(title);
  return { city, state, locationText, title };
}

function parseQuantity(qtyRaw) {
  if (!qtyRaw) return { quantity_value: null, quantity_unit: null };
  // Allow formats like "10", "10 pcs", "2.5 CY", "100 ft"
  const m = String(qtyRaw).trim().match(/^(\d+(?:\.\d+)?)\s*([A-Za-z%]+)?$/);
  if (!m) return { quantity_value: null, quantity_unit: null };
  return { quantity_value: parseFloat(m[1]), quantity_unit: m[2] || null };
}

// ----- CART UI (Modals) -----
async function openAddItemModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('mat_modal_additem')
    .setTitle('Add Material Item');

  const desc = new TextInputBuilder()
    .setCustomId('mat_desc')
    .setLabel('Material (name/spec/part #)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const qty = new TextInputBuilder()
    .setCustomId('mat_qty')
    .setLabel('Quantity (e.g., "2.5 CY", "10 pcs")')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  
  const notes = new TextInputBuilder()
    .setCustomId('mat_notes')
   .setLabel('Item notes (e.g. color, length, size)') // keep ≤ 45 chars
    .setPlaceholder('Color, length, special requirements, etc.')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);


  modal.addComponents(
    new ActionRowBuilder().addComponents(desc),
    new ActionRowBuilder().addComponents(qty),
    new ActionRowBuilder().addComponents(notes)
  );

  await interaction.showModal(modal);
}

async function openReviewModal(interaction, cart) {
  const modal = new ModalBuilder()
    .setCustomId('mat_modal_review')
    .setTitle('Review Order / Confirm Location');

  const itemsPreview = new TextInputBuilder()
    .setCustomId('mat_preview')
    .setLabel('Items (read-only)')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(cart.data.items.map((it, i) => `${i + 1}. ${it.description}${it.quantity_value ? ` (${it.quantity_value}${it.quantity_unit ? ' ' + it.quantity_unit : ''})` : ''}${it.notes ? ` — ${it.notes}` : ''}`).join('\n').slice(0, 4000) || 'No items yet')
    .setRequired(false);

  const needBy = new TextInputBuilder()
    .setCustomId('mat_needby')
    .setLabel('Need-by (e.g., 2025-08-15 08:00) optional')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue(cart.need_by ? cart.need_by : '');

  const loc = getThreadLocationMeta(interaction.channel);
  const locBox = new TextInputBuilder()
    .setCustomId('mat_loc')
    .setLabel('Location (City, ST) — edit if wrong')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(loc.locationText || '');

  modal.addComponents(
    new ActionRowBuilder().addComponents(itemsPreview),
    new ActionRowBuilder().addComponents(needBy),
    new ActionRowBuilder().addComponents(locBox)
  );

  await interaction.showModal(modal);
}

// ----- MESSAGE LISTENERS -----

client.on(Events.ClientReady, async () => {
  console.log(`✓ Logged in as ${client.user.tag}`);
  await registerCommands();
  scheduleReminders({ client, opsRoleId: OPS_MATERIALS_ROLE_ID, execTeamRoleId: EXEC_TEAM_ROLE_ID });
});

// Slash command entrypoint
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ===== BUTTONS =====
    if (interaction.isButton()) {
      // Starter panel buttons
      if (interaction.customId === 'mat_start_add') {
        return openAddItemModal(interaction);
      }
      if (interaction.customId === 'mat_start_review') {
        const cart = db.getCart(interaction.channelId, interaction.user.id) || { data: { items: [] } };
        return openReviewModal(interaction, cart);
      }
      if (interaction.customId === 'mat_start_over') {
        db.clearCart(interaction.channelId, interaction.user.id);
        return interaction.reply({ content: 'Cart cleared. Mention me again to start fresh.', flags: 64  }); // 64 is the "EPHEMERAL" flag
      }

      // Status buttons
      if (interaction.customId === 'mat_mark_filled' || interaction.customId === 'mat_mark_in_progress') {
        const label = interaction.customId === 'mat_mark_filled' ? 'filled' : 'in_progress';
        const orderLink = db._db.prepare('SELECT * FROM forum_posts WHERE forum_thread_id=?').get(interaction.channelId);
        if (!orderLink) return interaction.reply({ content: 'No linked order found for this thread.', flags: 64  }); // 64 is the "EPHEMERAL" flag

        db.updateOrderStatus(orderLink.order_id, label);
        if (label === 'filled') db.stopReminders(orderLink.order_id);
        await interaction.reply({ content: `Status set to **${label.replace('_', ' ')}**.` });
        return;
      }

      // Add update button (opens modal)
      if (interaction.customId === 'mat_add_update') {
        const modal = new ModalBuilder().setCustomId('mat_modal_update').setTitle('Add Update to Order');
        const update = new TextInputBuilder().setCustomId('mat_update_text').setLabel('Update text').setStyle(TextInputStyle.Paragraph).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(update));
        return interaction.showModal(modal);
      }

      // Review panel buttons
      if (interaction.customId === 'mat_btn_add_more') {
        return openAddItemModal(interaction);
      }
      if (interaction.customId === 'mat_btn_start_over') {
        db.clearCart(interaction.channelId, interaction.user.id);
        return interaction.update({ content: 'Cart cleared. Start again with **/materials**.', embeds: [], components: [] });
      }
      if (interaction.customId === 'mat_btn_confirm_send') {
        await interaction.deferUpdate().catch(() => {});
        // Create order, create forum post, pin, supplier lookup, mirror links
        const thread = interaction.channel;
        const threadId = thread.id;
        const requesterId = interaction.user.id;

        const cart = db.getCart(threadId, requesterId);
        if (!cart || !cart.data?.items?.length) {
         try {
           await interaction.followUp({ content: 'No items in cart — nothing to send.', flags: 1 << 6 });
         } catch {}
         return;
        }


        const needBy = cart.need_by || null;
        const tMeta = db.getThread(threadId) || {};
        const locationText = tMeta.location_text || getThreadLocationMeta(thread).locationText || null;

        // Persist order + items
        const orderId = db.createOrderWithItems({
          threadId,
          requesterId,
          needBy,
          notes: cart.notes || null,
          items: cart.data.items
        });

        // Create the forum post
        // Compute sequential PO number per project thread
const existingCountRow = db._db.prepare('SELECT COUNT(*) AS c FROM forum_posts WHERE project_thread_id = ?').get(threadId);
const poNum = (existingCountRow?.c || 0) + 1;

// Create the forum post with numbered title
       const forum = await client.channels.fetch(MATERIAL_FORUM_CHANNEL_ID);
       const forumPost = await forum.threads.create({
         name: `${thread.name} - P.O.#${poNum} materials`,
         message: {
           content: `<@&${OPS_MATERIALS_ROLE_ID}> New materials request from <@${requesterId}>`,
           embeds: [
             orderSummaryEmbed({
               requesterTag: interaction.user.tag,
               items: cart.data.items,
               needBy,
               locationText
             })
           ]
         }
       });
        // Pin the forum post starter
        try {
          const firstMsg = await forumPost.fetchStarterMessage();
          await firstMsg.pin();
          db.linkForumPost({ orderId, forumChannelId: MATERIAL_FORUM_CHANNEL_ID, forumThreadId: forumPost.id, projectThreadId: threadId, pinned: 1 });
          db.recordMessageLink({
            orderId,
            sourceChannelId: threadId,
            sourceMessageId: 'REQUEST_ORIGIN',
            destChannelId: forumPost.id,
            destMessageId: firstMsg.id
          });
        } catch (e) {
          db.linkForumPost({ orderId, forumChannelId: MATERIAL_FORUM_CHANNEL_ID, forumThreadId: forumPost.id, projectThreadId: threadId, pinned: 0 });
        }

        // Post control buttons
        await forumPost.send({ components: controlButtons() });
          const projectUrl = `https://discord.com/channels/${interaction.guildId}/${threadId}`;
          const forumUrl   = `https://discord.com/channels/${interaction.guildId}/${forumPost.id}`;
          await forumPost.send({ components: jumpButtons({ projectUrl, forumUrl }) });

        // Supplier lookup: Google primary → OSM fallback (+ alert exec team on Google fail or 0 results)
let supplierBlock = null;
let used = 'google';

try {
  const loc = getThreadLocationMeta(thread);
  const city = tMeta.city || loc.city;
  const state = tMeta.state || loc.state;

  console.log('[SUPPLIERS] location parsed:', { city, state });

  if (!city || !state) {
    await forumPost.send({
      content: '⚠️ Could not detect **City, ST** from the project thread title. Edit location during **Review / Confirm** and resend.'
    });
  } else {
    try {
      console.log('[SUPPLIERS][google] searching for', city, state, 'radius', Number(SUPPLIER_RADIUS_MILES) || 50);
      const { suppliers } = await googleSuppliers.searchSuppliers({
        city,
        state,
        radiusMi: Number(SUPPLIER_RADIUS_MILES) || 50
      });
      console.log('[SUPPLIERS][google] results:', suppliers?.length || 0);
      supplierBlock = suppliers;

          // If Google returned 0 (google.js now throws, but double-guard anyway), fall back to OSM
      if (!supplierBlock || !supplierBlock.length) {
        used = 'osm';
        await forumPost.send({ content: `<@&${EXEC_TEAM_ROLE_ID}> Google returned no suppliers; falling back to OSM.` });
        const { suppliers: osmList } = await osmSuppliers.searchSuppliers({
          city,
          state,
          radiusMi: Number(SUPPLIER_RADIUS_MILES) || 50
            });
            supplierBlock = osmList;
          }
        } catch (ge) {
          console.error('Google supplier lookup error:', ge?.message || ge);
          used = 'osm';
          await forumPost.send({ content: `<@&${EXEC_TEAM_ROLE_ID}> Google Places lookup failed; falling back to OSM.` });
          const { suppliers } = await osmSuppliers.searchSuppliers({
            city,
            state,
            radiusMi: Number(SUPPLIER_RADIUS_MILES) || 50
          });
             console.log('[SUPPLIERS][osm] results:', suppliers?.length || 0);
              supplierBlock = suppliers;
           }
          }
        } catch (e) {
          console.error('[SUPPLIERS] unexpected error:', e?.message || e);
          }
// --------------- sort suppliers prior to sending -----------------//
if (supplierBlock && supplierBlock.length) {
  // highlight helpers (define ONCE)
  const isSherwin = (s) =>
    /sherwin/i.test(s.brand || '') || /sherwin/i.test(s.name || '');

  const isReadyMix = (s) =>
    s.type === 'ready_mix' ||
    /ready.?mix/i.test(s.brand || '') ||
    /ready.?mix/i.test(s.name || '');

  // priority: Sherwin (0) → Ready-Mix (1) → others (2), then by distance
  supplierBlock.sort((a, b) => {
    const pa = isSherwin(a) ? 0 : isReadyMix(a) ? 1 : 2;
    const pb = isSherwin(b) ? 0 : isReadyMix(b) ? 1 : 2;
    if (pa !== pb) return pa - pb;
    const da = a.distance_mi ?? Number.POSITIVE_INFINITY;
    const db = b.distance_mi ?? Number.POSITIVE_INFINITY;
    return da - db;
  });

  // decorate names for display
  const decorated = supplierBlock.map(s => {
    if (isSherwin(s)) return { ...s, name: `⭐ ${s.name}` };
    if (isReadyMix(s)) return { ...s, name: `🧱 ${s.name}` };
    return s;
  });

  const locShow = tMeta.city && tMeta.state
    ? { city: tMeta.city, state: tMeta.state }
    : getThreadLocationMeta(thread);

  await forumPost.send({
    embeds: [
      suppliersEmbed({
        city: locShow.city || 'Unknown',
        state: locShow.state || '--',
        suppliers: decorated
      })
    ]
  });
} else {
  await forumPost.send({
    content: 'ℹ️ No nearby suppliers were found within the configured radius. You can adjust the location via **Review / Confirm** and try again.'
  });
}
// --------------- end suppliers block -----------------//

        // Confirm back in project thread & pin
        const conf = await thread.send({ content: `✅ Materials request posted here: <#${forumPost.id}>` });
        try { await conf.pin(); } catch {}
        db.clearCart(threadId, requesterId);

        try {
  await interaction.followUp({
    content: `Sent! Your order is now tracked in <#${forumPost.id}> (${used.toUpperCase()} suppliers).`,
    flags: 1 << 6 // MessageFlags.Ephemeral
  });
} catch {}

      }
    }

    // ===== MODALS =====
    if (interaction.isModalSubmit()) {
      // Add item modal
      if (interaction.customId === 'mat_modal_additem') {
        const desc = interaction.fields.getTextInputValue('mat_desc');
        const qtyRaw = interaction.fields.getTextInputValue('mat_qty') || '';
        const notes = interaction.fields.getTextInputValue('mat_notes') || '';

        const { quantity_value, quantity_unit } = parseQuantity(qtyRaw);
        const threadId = interaction.channelId;
        const requesterId = interaction.user.id;

        const existing = db.getCart(threadId, requesterId) || { data: { items: [] } };
        existing.data.items.push({
          description: desc.trim(),
          quantity_value,
          quantity_unit,
          notes: notes.trim() || null
        });
        db.upsertCart({ threadId, requesterId, data: existing.data });

        return interaction.reply({
          content: `✅ Added **${desc}** ${quantity_value ? `(${quantity_value}${quantity_unit ? ' ' + quantity_unit : ''})` : ''}\nContinue to **click the buttons above** to add more, or press **Review / Confirm** to finish and send.`,
          flags: 64 // 64 is the "EPHEMERAL" flag
        });
      }

      // Review / confirm modal
      if (interaction.customId === 'mat_modal_review') {
        const needBy = interaction.fields.getTextInputValue('mat_needby') || null;
        const locText = interaction.fields.getTextInputValue('mat_loc') || '';
        const threadId = interaction.channelId;
        const requesterId = interaction.user.id;

        // Save location to threads table
        let city = null, state = null;
        const m = locText.match(/^\s*([A-Za-z .'-]+)\s*,\s*([A-Za-z]{2})\s*$/);
        if (m) { city = m[1].trim(); state = m[2].toUpperCase(); }

        db.upsertThread({
          threadId,
          projectTitle: interaction.channel.name || '',
          locationText: locText,
          city, state, lat: null, lng: null
        });

        const cart = db.getCart(threadId, requesterId);
        if (!cart || !cart.data?.items?.length) {
          return interaction.reply({ content: 'No items in cart. Add at least one item first.', flags: 64 }); // 64 is the "EPHEMERAL" flag 
        }
        db.upsertCart({ threadId, requesterId, needBy, data: cart.data });

        // Build a quick preview and ask to confirm
        const preview = orderSummaryEmbed({
          requesterTag: interaction.user.tag,
          items: cart.data.items,
          needBy,
          locationText: locText
        });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('mat_btn_confirm_send').setLabel('Confirm & Send').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('mat_btn_add_more').setLabel('Add More').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('mat_btn_start_over').setLabel('Start Over').setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({ content: 'Review your order:', embeds: [preview], components: [row], flags: 64 }); // 64 is the "EPHEMERAL" flag 
      }

      // Add update modal submission
      if (interaction.customId === 'mat_modal_update') {
        const text = interaction.fields.getTextInputValue('mat_update_text');
        const orderLink = db._db.prepare('SELECT * FROM forum_posts WHERE forum_thread_id=?').get(interaction.channelId);
        if (!orderLink) return interaction.reply({ content: 'No linked order found.', flags: 64  }); // 64 is the "EPHEMERAL" flag 

        const forumThread = await client.channels.fetch(orderLink.forum_thread_id).catch(() => null);
        if (!forumThread) return interaction.reply({ content: 'Forum thread not found.', flags: 64  }); // 64 is the "EPHEMERAL" flag 

        await forumThread.send({ content: text });
        return interaction.reply({ content: 'Update posted.', flags: 64  }); // 64 is the "EPHEMERAL" flag
      }
    }

    // ===== SLASH COMMAND =====
    if (interaction.isChatInputCommand() && interaction.commandName === 'materials') {
      const ch = interaction.channel;

      // If user is on the forum channel itself, nudge them
      if (ch.type === ChannelType.GuildForum) {
        return interaction.reply({
          content: 'You’re on the forum index. Open a specific project **thread/post** under this forum and run `/materials` there. (Discord only allows the modal in a thread.)',
          flags: 64 // 64 is the "EPHEMERAL" flag
        });
      }

      if (!isProjectThread(ch)) {
        return interaction.reply({
          content: 'Please run `/materials` inside a **project thread** under `uhc project reports` or `non uhc project reports`.',
          flags: 64 // 64 is the "EPHEMERAL" flag
        });
      }

      const needBy = interaction.options.getString('need_by') || null;
      const notes = interaction.options.getString('notes') || null;

      const init = db.getCart(interaction.channelId, interaction.user.id) || { data: { items: [] } };
      db.upsertCart({
        threadId: interaction.channelId,
        requesterId: interaction.user.id,
        needBy,
        notes,
        data: init.data
      });

      await interaction.reply({ content: 'Let’s build your order. Add your first item:', flags: 64  }); // 64 is the "EPHEMERAL" flag
      return openAddItemModal(interaction);
    }
  } catch (e) {
    console.error('Interaction error:', e);
    if (interaction.reply) {
      try { await interaction.reply({ content: 'Something went wrong. Try again.', flags: 64  });  // 64 is the "EPHEMERAL" flag
    } catch {}
    }
  }
});


// Keyword trigger + @mention starter
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    // Mention-to-start flow (workers don't need slash commands)
    if (message.mentions.has(client.user)) {
      // If they're on a forum index (not inside a thread), nudge them
      if (message.channel.type === ChannelType.GuildForum) {
        await message.reply({
          content: 'Open a specific project **thread/post** under this forum and @ me there to start.',
          allowedMentions: { repliedUser: false, parse: [] }
        });
        return;
      }

      if (!isProjectThread(message.channel)) {
        await message.reply({
          content: 'Please @ me **inside a project thread** under `uhc project reports` or `non uhc project reports`.',
          allowedMentions: { repliedUser: false, parse: [] }
        });
        return;
      }

      // Ensure a cart exists for this user/thread
      const existing = db.getCart(message.channelId, message.author.id) || { data: { items: [] } };
      db.upsertCart({
        threadId: message.channelId,
        requesterId: message.author.id,
        data: existing.data
      });

      await message.reply({
        content: 'What do you need? Use the buttons below.',
        components: starterPanelComponents(),
        allowedMentions: { repliedUser: false, parse: [] }
      });
      return;
    }

    // Start flow on "materials:" keyword (optional legacy path)
    if (isProjectThread(message.channel) && message.content.trim().toLowerCase().startsWith('materials:')) {
      await message.reply({ content: 'Starting materials cart via modal. Check your pop-up.', allowedMentions: { repliedUser: false } });
      return;
    }

    // MIRRORING: If a message is posted in a forum thread linked to an order, mirror to project thread
    const link = db._db.prepare('SELECT * FROM forum_posts WHERE forum_thread_id=?').get(message.channelId);
    if (link && !message.system) {
      // Send to project thread, mention the requester
      const { order } = db.getOrder(link.order_id);
      const projectThread = await client.channels.fetch(link.project_thread_id).catch(() => null);
      if (projectThread) {
        const files = [];
        for (const att of message.attachments.values()) {
          files.push(new AttachmentBuilder(att.url, { name: att.name }));
        }
        const forwarded = await projectThread.send({
          content: `**Ops update:** ${message.content || ''}\n(Request by <@${order.requester_id}>)`,
          files
        }).catch(() => null);

        if (forwarded) {
          db.recordMessageLink({
            orderId: order.id,
            sourceChannelId: message.channelId,
            sourceMessageId: message.id,
            destChannelId: projectThread.id,
            destMessageId: forwarded.id
          });
        }
      }
    }
  } catch (e) {
    console.error('MessageCreate error:', e);
  }
});

// ---------deep gateway logs ---------------- // 
client.on('debug', (m) => {
  // very verbose; helps pinpoint handshake stage
  // You can filter if it’s too chatty
if (
  typeof m === 'string' &&
  (m.includes('Connecting to') || m.includes('IDENTIFY') || m.includes('READY') || m.includes('Heartbeat'))
) {
  console.log('[debug]', m);
}
});


client.on('shardReady', (id, unavailable) =>
  console.log(`[shardReady] shard=${id} unavailable=${unavailable?.size || 0}`)
);
client.on('shardReconnecting', (id) =>
  console.log(`[shardReconnecting] shard=${id}`)
);
client.on('shardError', (e, id) =>
  console.error(`[shardError] shard=${id}`, e)
);

// Safety: log status if READY hasn’t arrived in 45s
setTimeout(() => {
  const s = client.ws?.status;
  console.warn('[watchdog] still not ready after 45s:', { ws_status: s, name: ( {0:'ready',1:'connecting',2:'reconnecting',3:'idle',4:'nearly',5:'disconnected'}[s] || s ) });
}, 45_000);

// ************************* END deep gateway logs ************************* END //

// ************************* END deep gateway logs ************************* END //

// --- REST token sanity check (single, clean) ---
(async () => {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const me = await rest.get(Routes.user()); // GET /users/@me
    console.log('[rest check] OK /users/@me →', { id: me.id, username: me.username });
  } catch (e) {
    console.error('[rest check] FAIL /users/@me →', e?.status ?? '', e?.message || e);
  }
})();

// ----- LOGIN -----
function tokenTail(t) { return t ? t.slice(-8) : 'missing'; }
console.log(`[login] starting… token_tail=${tokenTail(DISCORD_TOKEN)}`);

client.login(DISCORD_TOKEN)
  .then(() => console.log('[login] success — awaiting ready event'))
  .catch(err => {
    console.error('[login] FAILED:', err?.message || err);
    setInterval(() => console.error('[login] still failed, check DISCORD_TOKEN env on Render'), 30_000);
  });
