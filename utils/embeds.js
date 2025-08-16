// utils/embeds.js
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

function orderSummaryEmbed({ requesterTag, items = [], needBy = null, notes = null, locationText = null }) {
  const descLines = items.map((it, i) => {
    const qty = it.quantity_value != null ? `${it.quantity_value}${it.quantity_unit ? ' ' + it.quantity_unit : ''}` : '';
    const note = it.notes ? ` — ${it.notes}` : '';
    return `**${i + 1}.** ${it.description}${qty ? ` (${qty})` : ''}${note}`;
  });

  if (notes) descLines.push(`\n**Order Notes:** ${notes}`);
  if (needBy) descLines.push(`**Need by:** <t:${Math.floor(new Date(needBy).getTime() / 1000)}:f>`);
  if (locationText) descLines.push(`**Location:** ${locationText}`);

  return new EmbedBuilder()
    .setTitle('Materials Request')
    .setDescription(descLines.join('\n'))
    .setFooter({ text: `Requested by ${requesterTag}` })
    .setTimestamp(new Date());
}

function suppliersEmbed({ city, state, suppliers = [] }) {
  const lines = suppliers.map(s => {
    const dist = s.distance_mi != null ? ` • ~${s.distance_mi.toFixed(1)} mi` : '';
    const phone = s.phone ? ` • ${s.phone}` : '';
    return `**${s.name}** — ${s.address || ''}${dist}${phone}`;
  });

  return new EmbedBuilder()
    .setTitle(`Nearby Suppliers (${city}, ${state})`)
    .setDescription(lines.length ? lines.join('\n') : '_No suppliers found_')
    .setTimestamp(new Date());
}

function jumpButtons({ projectUrl, forumUrl }) {
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Jump to Project Thread').setStyle(ButtonStyle.Link).setURL(projectUrl),
    new ButtonBuilder().setLabel('Jump to Materials Thread').setStyle(ButtonStyle.Link).setURL(forumUrl)
  );
  return [buttons];
}

function controlButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mat_mark_filled').setLabel('Mark Filled').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('mat_mark_in_progress').setLabel('Mark In Progress').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('mat_add_update').setLabel('Add Update').setStyle(ButtonStyle.Secondary)
    )
  ];
}

module.exports = { orderSummaryEmbed, suppliersEmbed, jumpButtons, controlButtons };
