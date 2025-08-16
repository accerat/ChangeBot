// reminders/scheduler.js
// Runs periodic checks to ping @OpsMaterials with 10-hour reminders and due-date context
// npm i node-cron
const cron = require('node-cron');
const db = require('../db/client');

function scheduleReminders({ client, opsRoleId, execTeamRoleId }) {
  // Every 10 minutes, check for due reminders
  cron.schedule('*/10 * * * *', async () => {
    try {
      const due = db.listDueReminders(50);
      for (const r of due) {
        const link = db.getForumPost(r.order_id);
        if (!link) { db.bumpReminder(r.id, r.frequency_hours || 10); continue; }

        const channel = await client.channels.fetch(link.forum_channel_id).catch(() => null);
        if (!channel) { db.bumpReminder(r.id, r.frequency_hours || 10); continue; }

        const thread = await channel.threads?.fetch(link.forum_thread_id).catch(() => null)
          || await client.channels.fetch(link.forum_thread_id).catch(() => null);
        if (!thread) { db.bumpReminder(r.id, r.frequency_hours || 10); continue; }

        const needByTxt = r.need_by ? `<t:${Math.floor(new Date(r.need_by).getTime()/1000)}:f>` : 'unspecified';
        const overdue = r.need_by && new Date(r.need_by) < new Date();

        const msg = overdue
          ? `<@&${opsRoleId}> **OVERDUE** materials request needs attention. Need-by: ${needByTxt}`
          : `<@&${opsRoleId}> Materials request pending. Need-by: ${needByTxt}`;

        await thread.send({ content: msg }).catch(() => null);
        db.bumpReminder(r.id, r.frequency_hours || 10);
      }
    } catch (e) {
      // Worst case: notify exec team once per run if something explodes
      try {
        const guild = client.guilds.cache.first();
        const sys = guild?.systemChannel || guild?.channels.cache.find(c => c.isTextBased?.());
        if (sys) await sys.send(`<@&${execTeamRoleId}> Reminder scheduler error: ${e.message.slice(0,180)}`);
      } catch {}
    }
  });
}

module.exports = { scheduleReminders };
