require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const token = (process.env.DISCORD_TOKEN || '').trim();
console.log('[ping] token_tail=', token ? token.slice(-8) : 'MISSING');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('debug', (m) => console.log('[debug]', m));
client.on('error', (e) => console.error('[client error]', e));
client.on('shardError', (e) => console.error('[shard error]', e));

client.once('ready', () => {
  console.log('[ping] READY as', client.user.tag, client.user.id);
  console.log('[ping] guilds=', client.guilds.cache.size);
});

client.login(token).catch(e => console.error('[ping] LOGIN FAIL:', e?.message || e));
