const {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  MessageType
} = require("discord.js");
const config = require("./config");
const db = require("./db");
const { validateDescription } = require("./policy");
const paypal = require("./payments/paypal-manual");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const embedColor = 0xc9a45c;
const pendingProofs = new Map();
const recentBoostRewards = new Map();
const limits = {
  escrowStartDaily: 5,
  disputeDaily: 5,
  reportDaily: 3
};

const statusLabels = {
  pending: "pending deposit",
  deposit_submitted: "deposit submitted",
  funded: "funds confirmed",
  release_requested: "release requested",
  released: "released",
  disputed: "disputed",
  cancelled: "cancelled",
  refund_reviewed: "refund reviewed",
  dispute_denied: "dispute denied",
  dispute_resolved: "dispute resolved"
};

const brandFooter = "eqy - PayPal escrow, manual review";

function isParticipant(trade, userId) {
  return [trade.buyer_id, trade.seller_id, trade.creator_id].includes(userId);
}

function isModerator(interaction) {
  return interaction.member?.roles?.cache?.has(config.modRoleId);
}

async function sendLog(guild, channelId, payload) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel) await channel.send(payload);
}

async function denyStaffAction(interaction, action) {
  await sendLog(interaction.guild, config.confirmLogChannelId, {
    embeds: [
      new EmbedBuilder()
        .setColor(embedColor)
        .setTitle("Blocked staff action")
        .addFields(
          { name: "Action", value: action, inline: true },
          { name: "User", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Reason", value: `Missing staff role <@&${config.modRoleId}>.` }
        )
        .setTimestamp()
    ]
  });
  await interaction.reply({ content: "Only authorized staff can use this action.", flags: MessageFlags.Ephemeral });
}

function money(value, currency) {
  return `${Number(value).toFixed(2)} ${currency}`;
}

function feeFor(amount) {
  return Math.round((amount * config.feePercent / 100) * 100) / 100;
}

function ticketId(trade) {
  return trade.ticket_id || `EQY-${String(trade.id).padStart(6, "0")}`;
}

function hasRole(member, roleId) {
  return member?.roles?.cache?.has(roleId);
}

async function checkRateLimit(interaction, action, max) {
  const count = db.incrementRateLimit(interaction.user.id, action);
  if (count > max) {
    await interaction.reply({
      content: `Daily limit reached for ${action}. Contact staff if this is urgent.`,
      flags: MessageFlags.Ephemeral
    });
    return false;
  }
  return true;
}

function blacklistText(entry) {
  return [
    "**blacklist warning**",
    `User: <@${entry.user_id}>`,
    `Reason: ${entry.reason}`,
    `Added by: <@${entry.actor_id}>`
  ].join("\n");
}

function shortId(value) {
  if (!value) return "None";
  return value.length > 34 ? `${value.slice(0, 16)}...${value.slice(-8)}` : value;
}

function compactTradeEmbed(trade, title = "eqy escrow") {
  const total = trade.amount + trade.fee;
  return new EmbedBuilder()
    .setColor(embedColor)
    .setAuthor({ name: "eqy escrow" })
    .setTitle(`${title}`)
    .setDescription(`Ticket: \`${ticketId(trade)}\``)
    .addFields(
      { name: "Status", value: statusLabels[trade.status] || trade.status, inline: true },
      { name: "Buyer pays", value: money(total, trade.currency), inline: true },
      { name: "Seller receives", value: money(trade.amount, trade.currency), inline: true },
      { name: "Buyer", value: `<@${trade.buyer_id}>`, inline: true },
      { name: "Seller", value: `<@${trade.seller_id}>`, inline: true },
      { name: "Fee", value: `${money(trade.fee, trade.currency)} (${config.feePercent}%)`, inline: true }
    )
    .setFooter({ text: brandFooter })
    .setTimestamp(new Date(trade.updated_at || trade.created_at));
}

function logEmbed(title, trade, actor, extra = []) {
  const embed = compactTradeEmbed(trade, title)
    .setDescription([
      `Ticket: \`${ticketId(trade)}\``,
      actor ? `Action by: <@${actor.id}>` : null
    ].filter(Boolean).join("\n"));

  for (const field of extra) embed.addFields(field);
  return embed;
}

function ticketIntro(trade) {
  const total = trade.amount + trade.fee;
  return [
    `<@${trade.buyer_id}> <@${trade.seller_id}>`,
    "",
    "# eqy escrow",
    "",
    "**Keep your proof and ticket ID.**",
    "Staff support requires screenshots, PayPal references, chat history, and this ticket ID.",
    "",
    `Ticket: \`${ticketId(trade)}\``,
    `Item/service: ${trade.description}`,
    `Buyer pays: ${money(total, trade.currency)}`,
    `Seller receives: ${money(trade.amount, trade.currency)}`,
    `Fee: ${money(trade.fee, trade.currency)} (${config.feePercent}%)`,
    "",
    "**Workflow**",
    `1. Buyer pays: ${config.paypalVaultEmail}`,
    "2. Buyer clicks **Submit deposit**.",
    "3. Buyer uploads proof with **Add proof**.",
    "4. Staff confirms the PayPal deposit.",
    "5. Seller delivers inside this ticket.",
    "6. Buyer clicks **Release** after delivery.",
    "",
    "**Rules**",
    "The fee is charged once. Funds are not invested. Disputes are reviewed manually by staff."
  ].join("\n");
}

function helpText(trade) {
  const id = trade ? ticketId(trade) : "EQY-000001";
  return [
    "**eqy commands**",
    `Ticket: \`${id}\``,
    "",
    "`Submit deposit` - buyer submits PayPal reference",
    "`Add proof` - buyer/seller uploads evidence",
    "`Release` - buyer approves payout review",
    "`Dispute` - buyer/seller opens staff review",
    "`Review` - buyer/seller leaves feedback",
    "",
    `Staff: \`/escrow confirm_deposit ticket_id:${id}\``,
    `Staff: \`/escrow confirm_payout ticket_id:${id} paypal_payout_id:<id>\``
  ].join("\n");
}

function actionRows(trade) {
  const id = ticketId(trade);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`eqy:deposit:${id}`)
        .setLabel("Submit deposit")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`eqy:proof:${id}`)
        .setLabel("Add proof")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`eqy:release:${id}`)
        .setLabel("Release")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`eqy:dispute:${id}`)
        .setLabel("Dispute")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`eqy:review:${id}`)
        .setLabel("Review")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`eqy:refund:${id}`)
        .setLabel("Refund")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function depositModal(id) {
  return new ModalBuilder()
    .setCustomId(`eqy_modal:deposit:${id}`)
    .setTitle("Submit PayPal deposit")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("paypal_transaction_id")
          .setLabel("PayPal transaction ID")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(120)
          .setRequired(true)
      )
    );
}

function disputeModal(id) {
  return new ModalBuilder()
    .setCustomId(`eqy_modal:dispute:${id}`)
    .setTitle("Open dispute")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setRequired(true)
      )
    );
}

function reviewModal(id) {
  return new ModalBuilder()
    .setCustomId(`eqy_modal:review:${id}`)
    .setTitle("Leave a review")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("rating")
          .setLabel("Rating from 1 to 5")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(1)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("message")
          .setLabel("How was your experience?")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(700)
          .setRequired(true)
      )
    );
}

function refundModal(id) {
  return new ModalBuilder()
    .setCustomId(`eqy_modal:refund:${id}`)
    .setTitle("Request refund review")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Why should staff review a refund?")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(700)
          .setRequired(true)
      )
    );
}

function reportModal() {
  return new ModalBuilder()
    .setCustomId("eqy_modal:report")
    .setTitle("Open a report")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("target")
          .setLabel("User / PayPal / Discord ID")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(120)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("What happened?")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(800)
          .setRequired(true)
      )
    );
}

function supportModal() {
  return new ModalBuilder()
    .setCustomId("eqy_modal:support")
    .setTitle("Open support ticket")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("topic")
          .setLabel("What do you need help with?")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(120)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("details")
          .setLabel("Explain the problem")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(800)
          .setRequired(true)
      )
    );
}

function partnershipModal() {
  return new ModalBuilder()
    .setCustomId("eqy_modal:partnership")
    .setTitle("Partnership request")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("server")
          .setLabel("Server invite")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(120)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("members")
          .setLabel("Member count")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(40)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("details")
          .setLabel("Niche, offer, and reason")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(900)
          .setRequired(true)
      )
    );
}

function proofChecklistText() {
  return [
    "**Proof checklist**",
    "- ticket ID",
    "- PayPal transaction/payout IDs",
    "- payment screenshots",
    "- delivery screenshots",
    "- Discord user IDs",
    "- timeline of what happened",
    "",
    "Missing proof can limit staff action."
  ].join("\n");
}

function reportPanelText() {
  return [
    "# eqy reports",
    "",
    "Open a report ticket for scams, suspicious users, fake proof, unpaid deals, impersonation, or escrow abuse.",
    "",
    "**Before opening**",
    "Prepare screenshots, PayPal references, Discord IDs, ticket IDs, and a short timeline.",
    "",
    "Reports are reviewed manually. Missing proof can limit staff action."
  ].join("\n");
}

function supportPanelText() {
  return [
    "# eqy support",
    "",
    "Open a support ticket if you have a question or need help from staff.",
    "",
    "**What to include**",
    "- your question",
    "- what you need help with",
    "- the ticket ID, if your question is about an escrow ticket",
    "- screenshots or details only if they help staff understand the problem",
    "",
    "Please open one ticket per question and wait for staff to reply."
  ].join("\n");
}

function partnershipMessageText() {
  return [
    "# eqy partnership",
    "",
    "We are open to partnerships with serious Discord communities, marketplaces, and service servers.",
    "",
    "eqy provides a PayPal escrow system built to make trades safer between buyers and sellers. Our bot helps manage tickets, proof, disputes, reviews, refunds, blacklists, and staff logs in a clean and transparent way.",
    "",
    "**What we offer**",
    "- PayPal escrow ticket system",
    "- buyer/seller proof handling",
    "- dispute and report tickets",
    "- review system",
    "- blacklist and anti-scam tools",
    "- staff logs and transcripts",
    "- clean support workflow",
    "",
    "**What we look for**",
    "- active and trustworthy communities",
    "- clear server rules",
    "- no scam, fraud, or fake middleman activity",
    "- professional staff team",
    "- willingness to keep trades transparent and inside tickets",
    "",
    "**Partnership requirements**",
    "- your server must have an active community",
    "- your staff must be reachable",
    "- scam reports must be handled seriously",
    "- both sides must respect each other's rules and reputation",
    "",
    "If you are interested in partnering with eqy, open a ticket and include:",
    "- server invite",
    "- member count",
    "- server category/niche",
    "- why you want to partner",
    "- what you can offer",
    "",
    "We review every request manually.",
    "",
    "https://discord.gg/ezhweJxe3q"
  ].join("\n");
}

function partnershipPanelText() {
  return [
    "# eqy partnerships",
    "",
    "Open a partnership ticket if your community wants a safer PayPal trade workflow.",
    "",
    "Prepare your server invite, member count, niche, reason, and what your community can offer.",
    "",
    "Requests are reviewed manually."
  ].join("\n");
}

function boostRewardsText() {
  const rewardRole = config.boosterRewardRoleId ? `<@&${config.boosterRewardRoleId}>` : "booster reward role";
  return [
    "# eqy boost rewards",
    "",
    "Boost the server to support eqy and unlock the official booster reward.",
    "",
    "**Booster perks**",
    `- ${rewardRole}`,
    "- priority visibility in support queues",
    "- premium supporter badge inside the community",
    "- access to future booster-only perks, drops, and partner benefits",
    "- early access when new eqy features are released",
    "",
    "Join or share the server here: https://discord.gg/ezhweJxe3q",
    "",
    "**Important**",
    "Boost rewards never bypass escrow rules. Every trade still needs a ticket ID, PayPal references, proof, and staff review."
  ].join("\n");
}

function boostThanksText(member) {
  const rewardLine = config.boosterRewardRoleId ? `Reward role assigned: <@&${config.boosterRewardRoleId}>` : "Reward role: booster perks pending staff setup";
  return [
    `Thank you ${member} for boosting eqy!`,
    "",
    "# booster reward unlocked",
    rewardLine,
    "",
    "Your support helps eqy keep escrow tickets organized, staff alerts visible, and trade support faster for everyone.",
    "",
    "**Booster perks**",
    "- premium supporter visibility",
    "- priority attention when support queues are busy",
    "- access to future booster-only perks and drops",
    "- early visibility when new eqy features are released",
    "",
    "**Reminder**",
    `Booster rewards never bypass escrow rules. For any problem, ask for assistance in <#${config.supportPanelChannelId}>. Keep every trade inside tickets and always save ticket IDs, PayPal references, screenshots, and proof.`
  ].join("\n");
}

function boostEndedText(member) {
  return [
    "**booster reward ended**",
    `User: ${member}`,
    config.boosterRewardRoleId ? `Removed: <@&${config.boosterRewardRoleId}>` : "Reward role: not configured"
  ].join("\n");
}

function botInfoText() {
  return [
    "# eqy escrow bot",
    "",
    "eqy is a Discord PayPal escrow workflow for buyer and seller trades.",
    "",
    "**What eqy handles**",
    "- private escrow tickets",
    "- PayPal deposit and payout references",
    "- proof forwarding and audit logs",
    "- disputes, refunds, reports, and reviews",
    "- blacklist checks and staff-only controls",
    "- transcripts on ticket close",
    "",
    "**Trade flow**",
    "1. Use `/escrow start` in the escrow start channel.",
    "2. Buyer pays PayPal and clicks `Submit deposit`.",
    "3. Buyer uploads proof with `Add proof`.",
    "4. Staff confirms the deposit manually.",
    "5. Seller delivers inside the ticket.",
    "6. Buyer clicks `Release`.",
    "7. Staff confirms payout and closes the ticket.",
    "",
    `For reports or support, use <#${config.reportPanelChannelId}>. Always include proof and the ticket ID.`
  ].join("\n");
}

function rulesText() {
  return [
    "# eqy rules",
    "",
    "1. Keep all escrow communication inside the ticket.",
    "2. Always save proof, screenshots, PayPal references, and the ticket ID.",
    "3. Do not release funds before checking delivery.",
    "4. Do not fake proof, edit receipts, impersonate staff, or pressure users.",
    "5. Staff decisions require available proof and ticket history.",
    "6. Trades involving illegal, unsafe, or prohibited items can be refused.",
    "7. Abuse of reports or disputes can lead to denial of service."
  ].join("\n");
}

function tosText() {
  return [
    "# eqy terms",
    "",
    "eqy is a Discord workflow for PayPal escrow coordination. PayPal payments and payouts are manually verified by staff.",
    "",
    "**Refunds**",
    "- refunds are reviewed case by case",
    "- refunds require proof and ticket history",
    "- missing proof can limit staff action",
    "- PayPal fees, chargebacks, holds, or account limits are outside bot control",
    "",
    "**Disputes**",
    "Staff may freeze a ticket, request more proof, deny a claim, or close a report if evidence is insufficient.",
    "",
    "Using eqy means you agree to keep proof, follow staff instructions, and avoid off-ticket deals."
  ].join("\n");
}

function panelRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("eqy:report")
        .setLabel("Open report")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function supportRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("eqy:support")
        .setLabel("Open support")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function partnershipRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("eqy:partnership")
        .setLabel("Open partnership")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

const captchaWords = ["secure", "trade", "proof", "ticket", "escrow", "trust", "verify", "seller"];

function verifyPanelText() {
  return [
    "# eqy verification",
    "",
    "Click the button below and type the requested word.",
    "Once completed, you will receive the verified role.",
    "",
    "This helps reduce bots and low-effort abuse."
  ].join("\n");
}

function verifyRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("eqy:verify")
        .setLabel("Verify")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function verifyModal(word) {
  return new ModalBuilder()
    .setCustomId(`eqy_modal:verify:${word}`)
    .setTitle("eqy verification")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("answer")
          .setLabel(`Type this word: ${word}`)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(30)
          .setRequired(true)
      )
    );
}

async function createSupportTicket(guild, opener, title, body, kind, trade = null, categoryId = config.disputeCategoryId) {
  const safeName = `${kind}-${opener.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 80);
  const channel = await guild.channels.create({
    name: safeName,
    type: ChannelType.GuildText,
    parent: categoryId,
    topic: trade ? `${kind} for ${ticketId(trade)}` : `${kind} by ${opener.id}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: opener.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
      },
      {
        id: config.modRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageChannels]
      }
    ]
  });

  await channel.send([
    `<@${opener.id}> <@&${config.modRoleId}>`,
    "",
    `# ${title}`,
    trade ? `Ticket ID: ${ticketId(trade)}` : null,
    "",
    body,
    "",
    proofChecklistText(),
    "",
    "**Staff commands**",
    "`!close`",
    "`!dm @user reason`"
  ].filter(Boolean).join("\n"));

  await sendLog(guild, config.disputeLogChannelId, {
    content: [
      `**${kind} ticket created**`,
      `Channel: ${channel}`,
      `Opened by: <@${opener.id}>`,
      trade ? `Escrow ticket: ${ticketId(trade)}` : null,
      `Title: ${title}`
    ].filter(Boolean).join("\n")
  });

  return channel;
}

async function getTradeOrReply(interaction, id) {
  const trade = db.getTrade(id);
  if (!trade) {
    await interaction.reply({ content: "Ticket not found.", flags: MessageFlags.Ephemeral });
    return null;
  }
  if (!isParticipant(trade, interaction.user.id) && !isModerator(interaction)) {
    await interaction.reply({ content: "You cannot access this ticket.", flags: MessageFlags.Ephemeral });
    return null;
  }
  return trade;
}

function setPendingProof(userId, channelId, ticket, type = "other") {
  const key = `${userId}:${channelId}`;
  pendingProofs.set(key, { ticket, type, expiresAt: Date.now() + 10 * 60 * 1000 });
}

function takePendingProof(userId, channelId) {
  const key = `${userId}:${channelId}`;
  const pending = pendingProofs.get(key);
  if (!pending) return null;
  if (pending.expiresAt < Date.now()) {
    pendingProofs.delete(key);
    return null;
  }
  pendingProofs.delete(key);
  return pending;
}

async function submitDeposit(interaction, id, txId) {
  const trade = await getTradeOrReply(interaction, id);
  if (!trade) return;
  if (interaction.user.id !== trade.buyer_id) {
    await interaction.reply({ content: "Only the buyer can submit the deposit.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (trade.status !== "pending") {
    await interaction.reply({ content: `Deposit cannot be submitted while status is ${statusLabels[trade.status] || trade.status}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const updated = db.updateTrade(id, { status: "deposit_submitted", paypal_transaction_id: txId });
  db.addEvent(ticketId(updated), interaction.user.id, "deposit_submitted", txId);
  setPendingProof(interaction.user.id, interaction.channelId, ticketId(updated));

  await sendLog(interaction.guild, config.depositLogChannelId, {
    content: `<@&${config.modRoleId}>`,
    embeds: [
      logEmbed("Deposit submitted", updated, interaction.user, [
        { name: "PayPal TX", value: shortId(txId), inline: true },
        { name: "Next step", value: "Verify PayPal, then use `/escrow confirm_deposit`." }
      ])
    ]
  });

  await interaction.reply({
    content: [
      `Deposit submitted for \`${ticketId(updated)}\`.`,
      "Send the screenshot in this ticket now. eqy will repost it cleanly as proof."
    ].join("\n"),
    embeds: [compactTradeEmbed(updated, "Deposit submitted")],
    flags: interaction.isModalSubmit() ? MessageFlags.Ephemeral : undefined
  });
}

async function openDispute(interaction, id, reason) {
  if (!(await checkRateLimit(interaction, "dispute", limits.disputeDaily))) return;
  const trade = await getTradeOrReply(interaction, id);
  if (!trade) return;
  if (!["deposit_submitted", "funded", "release_requested"].includes(trade.status)) {
    await interaction.reply({ content: `A dispute cannot be opened while status is ${statusLabels[trade.status] || trade.status}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const updated = db.updateTrade(id, { status: "disputed", dispute_reason: reason });
  db.addEvent(ticketId(updated), interaction.user.id, "disputed", reason);
  await sendLog(interaction.guild, config.releaseLogChannelId, {
    content: `<@&${config.modRoleId}>`,
    embeds: [
      logEmbed("Dispute opened", updated, interaction.user, [
        { name: "Reason", value: reason.slice(0, 300) }
      ])
    ]
  });
  const ticket = await createSupportTicket(
    interaction.guild,
    interaction.user,
    "Escrow dispute",
    [
      `Reason: ${reason}`,
      "",
      "Funds stay frozen until staff decides.",
      "Upload every relevant proof here."
    ].join("\n"),
    "dispute",
    updated
  );
  await interaction.reply({
    content: `Dispute opened for \`${ticketId(updated)}\`: ${ticket}`,
    flags: MessageFlags.Ephemeral
  });
}

async function requestRelease(interaction, id) {
  const trade = await getTradeOrReply(interaction, id);
  if (!trade) return;
  if (interaction.user.id !== trade.buyer_id) {
    await interaction.reply({ content: "Only the buyer can request release.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (trade.status !== "funded") {
    await interaction.reply({ content: `Release cannot be requested while status is ${statusLabels[trade.status] || trade.status}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const updated = db.updateTrade(id, { status: "release_requested" });
  db.addEvent(ticketId(updated), interaction.user.id, "release_requested", "Buyer approved delivery");
  await sendLog(interaction.guild, config.releaseLogChannelId, {
    content: `<@&${config.modRoleId}>`,
    embeds: [
      logEmbed("Release requested", updated, interaction.user, [
        { name: "Payout", value: paypal.payoutInstructions({ trade: updated }) }
      ])
    ]
  });
  await interaction.reply({
    content: `Release requested for \`${ticketId(updated)}\`. Staff will review payout.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleStart(interaction) {
  if (interaction.channelId !== config.startChannelId) {
    await interaction.reply({
      content: `Use this command in <#${config.startChannelId}>.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const seller = interaction.options.getUser("seller", true);
  const buyer = interaction.options.getUser("buyer", true);
  const amount = interaction.options.getNumber("amount", true);
  const description = interaction.options.getString("description", true);

  if (seller.bot || buyer.bot || seller.id === buyer.id) {
    await interaction.reply({ content: "Buyer and seller must be two different real users.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!(await checkRateLimit(interaction, "escrow_start", limits.escrowStartDaily))) return;

  const sellerBlacklisted = db.getBlacklist(seller.id);
  const buyerBlacklisted = db.getBlacklist(buyer.id);
  if (sellerBlacklisted || buyerBlacklisted) {
    await interaction.reply({
      content: [
        "This escrow cannot be created because a participant is blacklisted.",
        sellerBlacklisted ? blacklistText(sellerBlacklisted) : null,
        buyerBlacklisted ? blacklistText(buyerBlacklisted) : null
      ].filter(Boolean).join("\n\n"),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const policy = validateDescription(description);
  if (!policy.allowed) {
    await interaction.reply({
      content: `This trade is blocked by eqy policy. Matched terms: ${policy.matched.join(", ")}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const trade = db.createTrade({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    sellerId: seller.id,
    buyerId: buyer.id,
    creatorId: interaction.user.id,
    amount,
    fee: feeFor(amount),
    currency: config.currency,
    description
  });
  db.addEvent(ticketId(trade), interaction.user.id, "created", ticketId(trade));

  const thread = await interaction.channel.threads.create({
    name: ticketId(trade).toLowerCase(),
    type: ChannelType.PrivateThread,
    invitable: false,
    reason: `eqy escrow ${ticketId(trade)}`
  });
  await thread.members.add(seller.id);
  await thread.members.add(buyer.id);
  const updated = db.updateTrade(ticketId(trade), { thread_id: thread.id });

  await thread.send({
    content: ticketIntro(updated),
    embeds: [compactTradeEmbed(updated, "Ticket opened")],
    components: actionRows(updated)
  });
  await sendLog(interaction.guild, config.startChannelId, {
    embeds: [
      logEmbed("Ticket opened", updated, interaction.user, [
        { name: "Ticket", value: `${thread}`, inline: true },
        { name: "Description", value: updated.description.slice(0, 300) }
      ])
    ]
  });
  await sendLog(interaction.guild, config.escrowOpenLogChannelId, {
    content: [
      "**eqy audit**",
      "Event: escrow opened",
      `Ticket ID: ${ticketId(updated)}`,
      `Thread: ${thread}`,
      `Opened by: <@${interaction.user.id}>`,
      `Buyer: <@${updated.buyer_id}>`,
      `Seller: <@${updated.seller_id}>`,
      `Amount: ${money(updated.amount, updated.currency)}`
    ].join("\n")
  });
  await interaction.reply({ content: `Ticket \`${ticketId(updated)}\` created: ${thread}`, flags: MessageFlags.Ephemeral });
}

async function handleDeposit(interaction) {
  await submitDeposit(
    interaction,
    interaction.options.getString("ticket_id", true),
    interaction.options.getString("paypal_transaction_id", true)
  );
}

async function handleConfirmDeposit(interaction) {
  const id = interaction.options.getString("ticket_id", true);
  const trade = await getTradeOrReply(interaction, id);
  if (!trade) return;
  if (!isModerator(interaction)) {
    await denyStaffAction(interaction, "confirm_deposit");
    return;
  }
  if (trade.status !== "deposit_submitted") {
    await interaction.reply({ content: `Ticket must be deposit submitted. Current status: ${statusLabels[trade.status] || trade.status}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const updated = db.updateTrade(id, { status: "funded", funded_at: db.now() });
  db.addEvent(ticketId(updated), interaction.user.id, "funded", "PayPal deposit manually verified");
  await sendLog(interaction.guild, config.confirmLogChannelId, {
    embeds: [
      logEmbed("Deposit confirmed", updated, interaction.user, [
        { name: "Next", value: `<@${updated.seller_id}> can deliver.` }
      ])
    ]
  });
  await interaction.reply({
    content: `Deposit confirmed for \`${ticketId(updated)}\`. <@${updated.seller_id}> can deliver now.`
  });
}

async function handleRelease(interaction) {
  await requestRelease(interaction, interaction.options.getString("ticket_id", true));
}

async function handleConfirmPayout(interaction) {
  const id = interaction.options.getString("ticket_id", true);
  const payoutId = interaction.options.getString("paypal_payout_id", true);
  const trade = await getTradeOrReply(interaction, id);
  if (!trade) return;
  if (!isModerator(interaction)) {
    await denyStaffAction(interaction, "confirm_payout");
    return;
  }
  if (trade.status !== "release_requested") {
    await interaction.reply({ content: `Ticket must be release requested. Current status: ${statusLabels[trade.status] || trade.status}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const updated = db.updateTrade(id, { status: "released", paypal_payout_id: payoutId, released_at: db.now() });
  db.addEvent(ticketId(updated), interaction.user.id, "released", payoutId);
  await sendLog(interaction.guild, config.confirmLogChannelId, {
    embeds: [
      logEmbed("Payout confirmed", updated, interaction.user, [
        { name: "PayPal payout", value: shortId(payoutId), inline: true }
      ])
    ]
  });
  await sendLog(interaction.guild, config.releaseLogChannelId, {
    embeds: [logEmbed("Ticket completed", updated, interaction.user)]
  });
  await interaction.reply({
    content: `\`${ticketId(updated)}\` completed. Payout confirmed.`
  });
}

async function handleDispute(interaction) {
  await openDispute(
    interaction,
    interaction.options.getString("ticket_id", true),
    interaction.options.getString("reason", true)
  );
}

async function handleCancel(interaction) {
  const id = interaction.options.getString("ticket_id", true);
  const reason = interaction.options.getString("reason") || "No reason provided";
  const trade = await getTradeOrReply(interaction, id);
  if (!trade) return;
  if (!["pending", "deposit_submitted"].includes(trade.status)) {
    await interaction.reply({
      content: `This ticket cannot be cancelled while status is ${statusLabels[trade.status] || trade.status}. Open a dispute instead.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const updated = db.updateTrade(id, { status: "cancelled", dispute_reason: reason });
  db.addEvent(ticketId(updated), interaction.user.id, "cancelled", reason);
  await sendLog(interaction.guild, config.releaseLogChannelId, {
    embeds: [
      logEmbed("Ticket cancelled", updated, interaction.user, [
        { name: "Reason", value: reason.slice(0, 300) }
      ])
    ]
  });
  await interaction.reply({
    content: `\`${ticketId(updated)}\` cancelled.`
  });
}

async function handleStatus(interaction) {
  const id = interaction.options.getString("ticket_id", true);
  const trade = await getTradeOrReply(interaction, id);
  if (!trade) return;
  await interaction.reply({ embeds: [compactTradeEmbed(trade, "Ticket status")], flags: MessageFlags.Ephemeral });
}

async function handleHelp(interaction) {
  const id = interaction.options.getString("ticket_id");
  if (!id) {
    await interaction.reply({ content: helpText(null), flags: MessageFlags.Ephemeral });
    return;
  }
  const trade = await getTradeOrReply(interaction, id);
  if (!trade) return;
  await interaction.reply({ content: helpText(trade), flags: MessageFlags.Ephemeral });
}

async function handleMetrics(interaction) {
  if (!isModerator(interaction)) {
    await denyStaffAction(interaction, "metrics");
    return;
  }
  const data = db.metrics();
  const disputeRate = data.total ? ((data.disputed / data.total) * 100).toFixed(1) : "0.0";
  const avg = data.avgReleaseHours == null ? "n/a" : `${data.avgReleaseHours.toFixed(2)} hours`;
  await interaction.reply({
    content: [
      `Completed tickets: ${data.completed}`,
      `Average release time after funding: ${avg}`,
      `Open disputes: ${data.disputed}/${data.total} (${disputeRate}%)`
    ].join("\n"),
    flags: MessageFlags.Ephemeral
  });
}

async function handleButton(interaction) {
  const [, action, id] = interaction.customId.split(":");
  if (action === "verify") {
    const word = captchaWords[Math.floor(Math.random() * captchaWords.length)];
    await interaction.showModal(verifyModal(word));
    return;
  }

  if (action === "report") {
    await interaction.showModal(reportModal());
    return;
  }

  if (action === "support") {
    await interaction.showModal(supportModal());
    return;
  }

  if (action === "partnership") {
    await interaction.showModal(partnershipModal());
    return;
  }

  const trade = await getTradeOrReply(interaction, id);
  if (!trade) return;

  if (action === "deposit") {
    if (interaction.user.id !== trade.buyer_id) {
      await interaction.reply({ content: "Only the buyer can submit the deposit.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.showModal(depositModal(id));
    return;
  }

  if (action === "proof") {
    if (!isParticipant(trade, interaction.user.id)) {
      await interaction.reply({ content: "Only ticket participants can add proof.", flags: MessageFlags.Ephemeral });
      return;
    }
    setPendingProof(interaction.user.id, interaction.channelId, ticketId(trade), "proof");
    await interaction.reply({
      content: "Send the screenshot/photo in this ticket now. I will repost it cleanly in the proof channel.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (action === "release") {
    await requestRelease(interaction, id);
    return;
  }

  if (action === "dispute") {
    await interaction.showModal(disputeModal(id));
    return;
  }

  if (action === "review") {
    if (!isParticipant(trade, interaction.user.id)) {
      await interaction.reply({ content: "Only ticket participants can leave a review.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.showModal(reviewModal(id));
    return;
  }

  if (action === "refund") {
    if (interaction.user.id !== trade.buyer_id) {
      await interaction.reply({ content: "Only the buyer can request a refund review.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.showModal(refundModal(id));
  }
}

async function handleModal(interaction) {
  const [, action, id] = interaction.customId.split(":");
  if (action === "verify") {
    const expected = id;
    const answer = interaction.fields.getTextInputValue("answer").trim().toLowerCase();
    if (answer !== expected) {
      await interaction.reply({ content: "Wrong word. Try again.", flags: MessageFlags.Ephemeral });
      return;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: "Could not verify your member profile.", flags: MessageFlags.Ephemeral });
      return;
    }
    await member.roles.add(config.verifiedRoleId, "eqy captcha verification");
    await interaction.reply({ content: "Verified. You now have access.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "deposit") {
    await submitDeposit(interaction, id, interaction.fields.getTextInputValue("paypal_transaction_id"));
    return;
  }
  if (action === "dispute") {
    await openDispute(interaction, id, interaction.fields.getTextInputValue("reason"));
    return;
  }
  if (action === "report") {
    if (!(await checkRateLimit(interaction, "report", limits.reportDaily))) return;
    const target = interaction.fields.getTextInputValue("target");
    const reason = interaction.fields.getTextInputValue("reason");
    const channel = await createSupportTicket(
      interaction.guild,
      interaction.user,
      "User report",
      [
        `Reported: ${target}`,
        `Reason: ${reason}`,
        "",
        "Upload screenshots, IDs, payment references, and any related ticket ID."
      ].join("\n"),
      "report"
    );
    await interaction.reply({ content: `Report opened: ${channel}`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === "support") {
    if (!(await checkRateLimit(interaction, "report", limits.reportDaily))) return;
    const topic = interaction.fields.getTextInputValue("topic");
    const details = interaction.fields.getTextInputValue("details");
    const channel = await createSupportTicket(
      interaction.guild,
      interaction.user,
      "Support request",
      [
        `Topic: ${topic}`,
        "",
        details,
        "",
        "Staff will review this request and reply as soon as possible."
      ].join("\n"),
      "support"
    );
    await interaction.reply({ content: `Support ticket opened: ${channel}`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === "partnership") {
    const server = interaction.fields.getTextInputValue("server");
    const members = interaction.fields.getTextInputValue("members");
    const details = interaction.fields.getTextInputValue("details");
    const channel = await createSupportTicket(
      interaction.guild,
      interaction.user,
      "Partnership request",
      [
        `Server: ${server}`,
        `Members: ${members}`,
        "",
        details,
        "",
        "Staff will review this request manually."
      ].join("\n"),
      "partner",
      null,
      config.partnershipCategoryId
    );
    await interaction.reply({ content: `Partnership ticket opened: ${channel}`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === "review") {
    const trade = await getTradeOrReply(interaction, id);
    if (!trade) return;
    const ratingRaw = interaction.fields.getTextInputValue("rating").trim();
    const rating = Number(ratingRaw);
    const message = interaction.fields.getTextInputValue("message").trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      await interaction.reply({ content: "Rating must be a number from 1 to 5.", flags: MessageFlags.Ephemeral });
      return;
    }
    await sendLog(interaction.guild, config.reviewChannelId, {
      content: [
        "**eqy review**",
        `Ticket ID: ${ticketId(trade)}`,
        `User: <@${interaction.user.id}>`,
        `Rating: ${rating}/5`,
        "",
        message
      ].join("\n")
    });
    db.addEvent(ticketId(trade), interaction.user.id, "review", `${rating}/5 ${message}`);
    await interaction.reply({ content: "Review submitted. Thank you.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === "refund") {
    const trade = await getTradeOrReply(interaction, id);
    if (!trade) return;
    const reason = interaction.fields.getTextInputValue("reason");
    const channel = await createSupportTicket(
      interaction.guild,
      interaction.user,
      "Refund",
      [`Ticket ID: ${ticketId(trade)}`, `Reason: ${reason}`, "", "Staff will review proof and ticket history."].join("\n"),
      "refund",
      trade
    );
    await interaction.reply({ content: `Refund ticket opened: ${channel}`, flags: MessageFlags.Ephemeral });
  }
}

async function handleBlacklist(interaction) {
  if (!isModerator(interaction)) {
    await denyStaffAction(interaction, "blacklist");
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === "add") {
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    db.addBlacklist(user.id, reason, interaction.user.id);
    await interaction.reply({ content: `Blacklisted ${user}: ${reason}`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "remove") {
    const user = interaction.options.getUser("user", true);
    const removed = db.removeBlacklist(user.id);
    await interaction.reply({ content: removed ? `Removed ${user} from blacklist.` : `${user} was not blacklisted.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "check") {
    const user = interaction.options.getUser("user", true);
    const entry = db.getBlacklist(user.id);
    await interaction.reply({ content: entry ? blacklistText(entry) : `${user} is not blacklisted.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "list") {
    const entries = db.listBlacklist().slice(0, 20);
    await interaction.reply({
      content: entries.length
        ? entries.map((entry) => `<@${entry.user_id}> - ${entry.reason}`).join("\n")
        : "Blacklist is empty.",
      flags: MessageFlags.Ephemeral
    });
  }
}

function tradeLine(trade) {
  return `${ticketId(trade)} | ${statusLabels[trade.status] || trade.status} | <@${trade.buyer_id}> -> <@${trade.seller_id}> | ${money(trade.amount, trade.currency)}`;
}

async function handleProfile(interaction) {
  const user = interaction.options.getUser("user", true);
  const trades = db.getAllTrades().filter((trade) => trade.buyer_id === user.id || trade.seller_id === user.id);
  const completed = trades.filter((trade) => trade.status === "released").length;
  const disputed = trades.filter((trade) => trade.status === "disputed").length;
  const blacklist = db.getBlacklist(user.id);
  await interaction.reply({
    content: [
      "**eqy profile**",
      `User: ${user}`,
      `Completed: ${completed}`,
      `Disputes: ${disputed}`,
      `Total tickets: ${trades.length}`,
      `Blacklist: ${blacklist ? blacklist.reason : "no"}`,
      "",
      trades.slice(-5).map(tradeLine).join("\n") || "No recent tickets."
    ].join("\n"),
    flags: MessageFlags.Ephemeral
  });
}

async function handleQueue(interaction) {
  if (!isModerator(interaction)) return denyStaffAction(interaction, "queue");
  const active = db.getAllTrades().filter((trade) => !["released", "cancelled"].includes(trade.status));
  await interaction.reply({ content: ["**eqy queue**", "", active.slice(0, 25).map(tradeLine).join("\n") || "No active tickets."].join("\n"), flags: MessageFlags.Ephemeral });
}

async function handleExport(interaction) {
  if (!isModerator(interaction)) return denyStaffAction(interaction, "export");
  const id = interaction.options.getString("ticket_id", true);
  const trade = db.getTrade(id);
  if (!trade) return interaction.reply({ content: "Ticket not found.", flags: MessageFlags.Ephemeral });
  const events = db.getEvents(ticketId(trade));
  const text = [
    `eqy export ${ticketId(trade)}`,
    "",
    JSON.stringify(trade, null, 2),
    "",
    "events",
    ...events.map((event) => `[${event.created_at}] ${event.event_type} by ${event.actor_id}: ${event.details}`)
  ].join("\n");
  await interaction.reply({
    content: `Export ready for ${ticketId(trade)}.`,
    files: [{ attachment: Buffer.from(text, "utf8"), name: `export-${ticketId(trade)}.txt` }],
    flags: MessageFlags.Ephemeral
  });
}

async function handleStatusPanel(interaction) {
  if (!isModerator(interaction)) return denyStaffAction(interaction, "statuspanel");
  const trades = db.getAllTrades();
  const completed = trades.filter((trade) => trade.status === "released").length;
  const disputes = trades.filter((trade) => trade.status === "disputed").length;
  const ratings = db.getEvents().filter((event) => event.event_type === "review").map((event) => Number(String(event.details).split("/")[0])).filter(Boolean);
  const avg = ratings.length ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2) : "n/a";
  await interaction.reply({ content: ["**eqy status**", `Completed escrows: ${completed}`, `Open disputes: ${disputes}`, `Average rating: ${avg}`, `Total tickets: ${trades.length}`, "Bot: online"].join("\n") });
}

async function handleDisputeAdmin(interaction) {
  if (!isModerator(interaction)) return denyStaffAction(interaction, "dispute_admin");
  const sub = interaction.options.getSubcommand();
  const id = interaction.options.getString("ticket_id", true);
  const reason = interaction.options.getString("reason", true);
  const trade = db.getTrade(id);
  if (!trade) return interaction.reply({ content: "Ticket not found.", flags: MessageFlags.Ephemeral });
  const winner = sub === "resolve" ? interaction.options.getString("winner", true) : null;
  const status = sub === "refund" ? "refund_reviewed" : sub === "deny" ? "dispute_denied" : "dispute_resolved";
  const updated = db.updateTrade(id, { status, dispute_reason: reason });
  db.addEvent(ticketId(updated), interaction.user.id, status, winner ? `${winner}: ${reason}` : reason);
  await sendLog(interaction.guild, config.disputeLogChannelId, {
    content: ["**eqy audit**", "Event: dispute update", `Ticket ID: ${ticketId(updated)}`, `Status: ${statusLabels[status] || status}`, winner ? `Winner: ${winner}` : null, `Staff: <@${interaction.user.id}>`, `Reason: ${reason}`].filter(Boolean).join("\n")
  });
  await interaction.reply({ content: `\`${ticketId(updated)}\` marked as ${statusLabels[status] || status}.` });
}

async function runReminders() {
  const trades = db.getAllTrades();
  const nowMs = Date.now();
  for (const trade of trades) {
    if (!trade.thread_id || ["released", "cancelled", "disputed"].includes(trade.status)) continue;
    const updatedMs = new Date(trade.updated_at || trade.created_at).getTime();
    const ageHours = (nowMs - updatedMs) / 36e5;
    const reminders = trade.reminders || {};
    let key = null;
    let message = null;

    if (trade.status === "pending" && ageHours >= 24 && !reminders.pending24) {
      key = "pending24";
      message = `Reminder for ${ticketId(trade)}: deposit is still pending. Keep proof and ticket ID ready.`;
    }
    if (trade.status === "funded" && ageHours >= 48 && !reminders.funded48) {
      key = "funded48";
      message = `Reminder for ${ticketId(trade)}: deposit is confirmed, but release is still pending.`;
    }
    if (trade.status === "release_requested" && ageHours >= 12 && !reminders.release12) {
      key = "release12";
      message = `Reminder for ${ticketId(trade)}: payout confirmation is still pending.`;
    }

    if (!key || !message) continue;
    const channel = await client.channels.fetch(trade.thread_id).catch(() => null);
    if (channel) await channel.send(message).catch(() => null);
    db.updateTrade(ticketId(trade), { reminders: { ...reminders, [key]: db.now() } });
  }
}

async function postToChannel(interaction, channelId, content, components = []) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isModerator(interaction)) {
    await sendLog(interaction.guild, config.confirmLogChannelId, {
      embeds: [
        new EmbedBuilder()
          .setColor(embedColor)
          .setTitle("Blocked staff action")
          .addFields(
            { name: "Action", value: interaction.commandName, inline: true },
            { name: "User", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Reason", value: `Missing staff role <@&${config.modRoleId}>.` }
          )
          .setTimestamp()
      ]
    });
    await interaction.editReply({ content: "Only authorized staff can use this action." });
    return;
  }

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await interaction.editReply({ content: "Target channel not found. Check the configured channel ID." });
    return;
  }

  const sent = await channel.send({ content, components }).catch((error) => {
    console.error(`Failed to post ${interaction.commandName} in ${channelId}:`, error);
    return null;
  });

  if (!sent) {
    await interaction.editReply({ content: `I could not post in ${channel}. Check bot permissions for that channel.` });
    return;
  }

  await interaction.editReply({ content: `Posted in ${channel}.` });
}

async function buildTranscript(channel) {
  const messages = [];
  let before;
  while (messages.length < 500) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
  }
  return messages
    .reverse()
    .map((msg) => {
      const files = msg.attachments.size
        ? ` attachments: ${[...msg.attachments.values()].map((att) => att.url).join(", ")}`
        : "";
      return `[${msg.createdAt.toISOString()}] ${msg.author.tag}: ${msg.content || ""}${files}`;
    })
    .join("\n");
}

async function sendTranscript(message) {
  const transcript = await buildTranscript(message.channel);
  const filename = `transcript-${message.channel.id}.txt`;
  const buffer = Buffer.from(transcript || "No messages captured.", "utf8");
  const trade = message.channel.isThread() ? db.getTradeByThreadId(message.channel.id) : null;

  await sendLog(message.guild, config.escrowCloseLogChannelId, {
    content: [
      "**transcript saved**",
      `Channel: #${message.channel.name}`,
      trade ? `Ticket ID: ${ticketId(trade)}` : null
    ].filter(Boolean).join("\n"),
    files: [{ attachment: buffer, name: filename }]
  });

  if (trade) {
    const buyer = await client.users.fetch(trade.buyer_id).catch(() => null);
    const seller = await client.users.fetch(trade.seller_id).catch(() => null);
    const dmContent = [
      "**eqy transcript**",
      `Ticket ID: ${ticketId(trade)}`,
      `Channel: #${message.channel.name}`
    ].join("\n");
    for (const user of [buyer, seller]) {
      if (user) {
        await user.send({
          content: dmContent,
          files: [{ attachment: buffer, name: filename }]
        }).catch(() => null);
      }
    }
  }
}

async function handlePrefixCommand(message) {
  const canClose = message.member?.roles?.cache?.has(config.modRoleId) ||
    message.member?.roles?.cache?.has(config.closeRoleId);
  const isStaff = message.member?.roles?.cache?.has(config.modRoleId);

  if (message.content.trim() === "!close") {
    if (!canClose) return;
    const channelName = message.channel.name;
    const channelId = message.channel.id;
    await sendLog(message.guild, config.escrowCloseLogChannelId, {
      content: [
        "**eqy audit**",
        "Event: ticket closed",
        `Channel: #${channelName}`,
        `Channel ID: ${channelId}`,
        `Closed by: <@${message.author.id}>`
      ].join("\n")
    });
    await sendTranscript(message);
    await message.channel.send("Closing ticket. Transcript is being saved.");
    setTimeout(() => {
      message.channel.delete("eqy ticket closed").catch(() => null);
    }, 1500);
    return;
  }

  if (message.content.startsWith("!note ")) {
    if (!isStaff) return;
    const note = message.content.slice("!note ".length).trim();
    if (!note) {
      await message.reply("Usage: `!note text`");
      return;
    }
    await sendLog(message.guild, config.disputeLogChannelId, {
      content: [
        "**eqy audit**",
        "Event: staff note",
        `Channel: ${message.channel}`,
        `Staff: <@${message.author.id}>`,
        "",
        note
      ].join("\n")
    });
    await message.reply("Note saved.");
    return;
  }

  if (message.content.startsWith("!dm ")) {
    if (!isStaff) return;
    const user = message.mentions.users.first();
    const reason = message.content.replace(/^!dm\s+<@!?\d+>\s*/i, "").trim();
    if (!user || !reason) {
      await message.reply("Usage: `!dm @user reason`");
      return;
    }
    await user.send([
      "**eqy support**",
      "",
      `You were tagged in a ticket in ${message.guild.name}.`,
      `Channel: ${message.channel}`,
      `Message: ${reason}`
    ].join("\n")).catch(async () => {
      await message.reply("I could not DM that user.");
    });
    await message.reply(`DM sent to ${user}.`);
    return;
  }

  if (message.content.trim() === "!partnership desc") {
    if (!isStaff) return;
    await message.channel.send(partnershipMessageText());
  }
}

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: "protected PayPal trades", type: ActivityType.Watching }],
    status: "online"
  });
  setInterval(() => {
    runReminders().catch(console.error);
  }, 15 * 60 * 1000);
  runReminders().catch(console.error);
});

function welcomeText(member) {
  return [
    `Welcome ${member}.`,
    "",
    "# eqy quick start",
    `Escrow: use \`/escrow start\` in <#${config.startChannelId}>.`,
    `Reports/support: open a ticket in <#${config.reportPanelChannelId}>.`,
    `Verification: complete captcha in <#${config.verifyChannelId}>.`,
    `Rules: read <#${config.rulesChannelId}> before trading.`,
    "",
    "Keep your ticket ID, PayPal references, screenshots, and proof."
  ].join("\n");
}

function boostDmText() {
  return [
    "# thank you for boosting eqy",
    "",
    "Thanks for supporting the eqy community with your server boost.",
    config.boosterRewardRoleId ? `Your booster role is now active: <@&${config.boosterRewardRoleId}>` : "Staff will finish booster reward setup soon.",
    "",
    "What this means:",
    "- your booster reward is active while your boost remains active",
    "- you get premium supporter visibility in the server",
    "- you may receive future booster-only perks, drops, or early feature access",
    "",
    "Useful links:",
    "Discord server: https://discord.gg/ezhweJxe3q",
    `Start escrow: <#${config.startChannelId}>`,
    `Support/report tickets: <#${config.reportPanelChannelId}>`,
    `Rules: <#${config.rulesChannelId}>`,
    "",
    "Reminder: booster rewards do not bypass escrow rules. For every trade, keep the ticket ID, PayPal references, screenshots, and proof."
  ].join("\n");
}

async function awardBoostReward(member, sourceChannel = null) {
  const lastReward = recentBoostRewards.get(member.id) || 0;
  if (Date.now() - lastReward < 15_000) return;
  recentBoostRewards.set(member.id, Date.now());

  if (config.boosterRewardRoleId) {
    await member.roles.add(config.boosterRewardRoleId, "eqy server boost reward").catch((error) => {
      console.error(`Failed to assign booster reward role ${config.boosterRewardRoleId} to ${member.user.tag}:`, error);
    });
  }

  const fallbackChannelId = config.boostLogChannelId || config.welcomeChannelId || member.guild.systemChannelId || config.infoChannelId;
  const channel = sourceChannel || await member.guild.channels.fetch(fallbackChannelId).catch(() => null);
  if (channel) {
    await channel.send(boostThanksText(member)).catch((error) => {
      console.error(`Failed to send boost reward message in ${channel.id}:`, error);
    });
  } else {
    console.error(`Boost reward channel not found. Tried: ${fallbackChannelId}`);
  }

  await member.send(boostDmText()).catch((error) => {
    console.error(`Could not DM booster ${member.user.tag}. The user may have DMs closed:`, error);
  });
}

client.on("guildMemberAdd", async (member) => {
  if (config.memberRoleId) {
    await member.roles.add(config.memberRoleId, "eqy auto member role").catch((error) => {
      console.error(`Failed to assign member role ${config.memberRoleId} to ${member.user.tag}:`, error);
    });
  }

  const channelId = config.welcomeChannelId || member.guild.systemChannelId || config.infoChannelId;
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (channel) {
    await channel.send(welcomeText(member)).catch((error) => {
      console.error(`Failed to send welcome message in ${channelId}:`, error);
    });
  } else {
    console.error(`Welcome channel not found. Tried: ${channelId}`);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const startedBoosting = !oldMember.premiumSince && newMember.premiumSince;
  const stoppedBoosting = oldMember.premiumSince && !newMember.premiumSince;
  if (!startedBoosting && !stoppedBoosting) return;

  if (startedBoosting) {
    await awardBoostReward(newMember);
  }

  if (stoppedBoosting) {
    if (config.boosterRewardRoleId) {
      await newMember.roles.remove(config.boosterRewardRoleId, "eqy server boost ended").catch((error) => {
        console.error(`Failed to remove booster reward role ${config.boosterRewardRoleId} from ${newMember.user.tag}:`, error);
      });
    }

    const channelId = config.boostLogChannelId || config.infoChannelId;
    const channel = await newMember.guild.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.send(boostEndedText(newMember)).catch((error) => {
        console.error(`Failed to send boost ended log in ${channelId}:`, error);
      });
    }
  }
});

client.on("messageCreate", async (message) => {
  if (!message.guild) return;

  const boostMessageTypes = new Set([
    MessageType.GuildBoost,
    MessageType.GuildBoostTier1,
    MessageType.GuildBoostTier2,
    MessageType.GuildBoostTier3
  ]);
  if (boostMessageTypes.has(message.type) && message.member) {
    await awardBoostReward(message.member, message.channel);
    return;
  }

  if (message.author.bot) return;

  if (message.content.startsWith("!")) {
    await handlePrefixCommand(message);
    return;
  }

  if (!message.channel?.isThread() || !message.attachments.size) return;

  const pending = takePendingProof(message.author.id, message.channelId);
  if (!pending) return;
  const trade = db.getTrade(pending.ticket);
  if (!trade || !isParticipant(trade, message.author.id)) return;

  const files = [...message.attachments.values()].map((attachment) => attachment.url);
  await message.channel.send(`Proof added for \`${ticketId(trade)}\`. Staff can review it in <#${config.proofChannelId}>.`);
  await sendLog(message.guild, config.proofChannelId, {
    content: [
      "**eqy proof**",
      `Ticket ID: ${ticketId(trade)}`,
      `User: <@${message.author.id}>`,
      `Type: ${pending.type}`,
      `Files: ${files.length}`
    ].join("\n"),
    files
  });
  await message.delete().catch(() => null);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId.startsWith("eqy:")) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("eqy_modal:")) {
      await handleModal(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "panel") {
      await postToChannel(interaction, config.reportPanelChannelId, reportPanelText(), panelRow());
      return;
    }
    if (interaction.commandName === "supportpanel") {
      await postToChannel(interaction, config.supportPanelChannelId, supportPanelText(), supportRow());
      return;
    }
    if (interaction.commandName === "botinfo") {
      await postToChannel(interaction, config.infoChannelId, botInfoText());
      return;
    }
    if (interaction.commandName === "rules") {
      await postToChannel(interaction, config.rulesChannelId, rulesText());
      return;
    }
    if (interaction.commandName === "tos") {
      await postToChannel(interaction, config.infoChannelId, tosText());
      return;
    }
    if (interaction.commandName === "blacklist") {
      await handleBlacklist(interaction);
      return;
    }
    if (interaction.commandName === "profile") {
      await handleProfile(interaction);
      return;
    }
    if (interaction.commandName === "queue") {
      await handleQueue(interaction);
      return;
    }
    if (interaction.commandName === "export") {
      await handleExport(interaction);
      return;
    }
    if (interaction.commandName === "statuspanel") {
      await handleStatusPanel(interaction);
      return;
    }
    if (interaction.commandName === "verify") {
      await postToChannel(interaction, config.verifyChannelId, verifyPanelText(), verifyRow());
      return;
    }
    if (interaction.commandName === "partnerpanel") {
      await postToChannel(interaction, config.partnershipPanelChannelId, partnershipPanelText(), partnershipRow());
      return;
    }
    if (interaction.commandName === "boostreward") {
      await postToChannel(interaction, config.boostRewardChannelId, boostRewardsText());
      return;
    }
    if (interaction.commandName === "dispute_admin") {
      await handleDisputeAdmin(interaction);
      return;
    }

    if (interaction.commandName !== "escrow") return;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "start") await handleStart(interaction);
    if (subcommand === "deposit") await handleDeposit(interaction);
    if (subcommand === "confirm_deposit") await handleConfirmDeposit(interaction);
    if (subcommand === "release") await handleRelease(interaction);
    if (subcommand === "confirm_payout") await handleConfirmPayout(interaction);
    if (subcommand === "dispute") await handleDispute(interaction);
    if (subcommand === "cancel") await handleCancel(interaction);
    if (subcommand === "status") await handleStatus(interaction);
    if (subcommand === "help") await handleHelp(interaction);
    if (subcommand === "metrics") await handleMetrics(interaction);
  } catch (error) {
    console.error(error);
    const payload = { content: "Internal escrow error.", flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  }
});

client.login(config.discordToken);


