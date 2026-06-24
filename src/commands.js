const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const escrowCommand = new SlashCommandBuilder()
  .setName("escrow")
  .setDescription("Manage eqy PayPal escrow tickets")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Create a new escrow ticket")
      .addUserOption((opt) => opt.setName("seller").setDescription("Seller").setRequired(true))
      .addUserOption((opt) => opt.setName("buyer").setDescription("Buyer").setRequired(true))
      .addNumberOption((opt) => opt.setName("amount").setDescription("Trade amount").setRequired(true).setMinValue(1))
      .addStringOption((opt) => opt.setName("description").setDescription("Item or service").setRequired(true).setMaxLength(400))
  )
  .addSubcommand((sub) =>
    sub
      .setName("deposit")
      .setDescription("Submit the PayPal payment reference")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
      .addStringOption((opt) => opt.setName("paypal_transaction_id").setDescription("PayPal transaction ID").setRequired(true).setMaxLength(120))
  )
  .addSubcommand((sub) =>
    sub
      .setName("confirm_deposit")
      .setDescription("Staff: confirm received PayPal funds")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
  )
  .addSubcommand((sub) =>
    sub
      .setName("release")
      .setDescription("Buyer: request payout release")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
  )
  .addSubcommand((sub) =>
    sub
      .setName("confirm_payout")
      .setDescription("Staff: confirm PayPal payout to the seller")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
      .addStringOption((opt) => opt.setName("paypal_payout_id").setDescription("PayPal payout ID").setRequired(true).setMaxLength(120))
  )
  .addSubcommand((sub) =>
    sub
      .setName("dispute")
      .setDescription("Freeze the ticket and call staff")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
      .addStringOption((opt) => opt.setName("reason").setDescription("Dispute reason").setRequired(true).setMaxLength(500))
  )
  .addSubcommand((sub) =>
    sub
      .setName("cancel")
      .setDescription("Cancel an unfunded escrow")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
      .addStringOption((opt) => opt.setName("reason").setDescription("Cancel reason").setRequired(false).setMaxLength(300))
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Show ticket status")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
  )
  .addSubcommand((sub) =>
    sub
      .setName("help")
      .setDescription("Show a compact command guide")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(false).setMaxLength(20))
  )
  .addSubcommand((sub) =>
    sub
      .setName("metrics")
      .setDescription("Show MVP metrics")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const panelCommand = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("Staff: post the public report ticket panel")
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const botInfoCommand = new SlashCommandBuilder()
  .setName("botinfo")
  .setDescription("Staff: post the full eqy bot info message")
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const rulesCommand = new SlashCommandBuilder()
  .setName("rules")
  .setDescription("Staff: post eqy rules")
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const tosCommand = new SlashCommandBuilder()
  .setName("tos")
  .setDescription("Staff: post eqy terms and refund policy")
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const blacklistCommand = new SlashCommandBuilder()
  .setName("blacklist")
  .setDescription("Staff: manage risky users")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add or update a user blacklist entry")
      .addUserOption((opt) => opt.setName("user").setDescription("User").setRequired(true))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500))
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove a user from blacklist")
      .addUserOption((opt) => opt.setName("user").setDescription("User").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName("check")
      .setDescription("Check whether a user is blacklisted")
      .addUserOption((opt) => opt.setName("user").setDescription("User").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("List blacklist entries")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const profileCommand = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("Show an eqy user profile")
  .addUserOption((opt) => opt.setName("user").setDescription("User").setRequired(true));

const queueCommand = new SlashCommandBuilder()
  .setName("queue")
  .setDescription("Staff: show active escrow queue")
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const exportCommand = new SlashCommandBuilder()
  .setName("export")
  .setDescription("Staff: export a ticket audit file")
  .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const statusPanelCommand = new SlashCommandBuilder()
  .setName("statuspanel")
  .setDescription("Staff: post public eqy status stats")
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const verifyCommand = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Staff: post the captcha verification panel")
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const partnerPanelCommand = new SlashCommandBuilder()
  .setName("partnerpanel")
  .setDescription("Staff: post the partnership ticket panel")
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const boostRewardsCommand = new SlashCommandBuilder()
  .setName("boostreward")
  .setDescription("Staff: post the server boost rewards message")
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

const disputeCommand = new SlashCommandBuilder()
  .setName("dispute_admin")
  .setDescription("Staff: resolve dispute outcomes")
  .addSubcommand((sub) =>
    sub.setName("resolve")
      .setDescription("Resolve a dispute")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
      .addStringOption((opt) => opt.setName("winner").setDescription("Winner").setRequired(true).addChoices(
        { name: "buyer", value: "buyer" },
        { name: "seller", value: "seller" }
      ))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500))
  )
  .addSubcommand((sub) =>
    sub.setName("refund")
      .setDescription("Mark refund review outcome")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500))
  )
  .addSubcommand((sub) =>
    sub.setName("deny")
      .setDescription("Deny a dispute claim")
      .addStringOption((opt) => opt.setName("ticket_id").setDescription("eqy ticket ID").setRequired(true).setMaxLength(20))
      .addStringOption((opt) => opt.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

module.exports = [
  escrowCommand.toJSON(),
  panelCommand.toJSON(),
  botInfoCommand.toJSON(),
  rulesCommand.toJSON(),
  tosCommand.toJSON(),
  blacklistCommand.toJSON(),
  profileCommand.toJSON(),
  queueCommand.toJSON(),
  exportCommand.toJSON(),
  statusPanelCommand.toJSON(),
  verifyCommand.toJSON(),
  partnerPanelCommand.toJSON(),
  boostRewardsCommand.toJSON(),
  disputeCommand.toJSON()
];
