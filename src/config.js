require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

module.exports = {
  discordToken: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId: required("DISCORD_GUILD_ID"),
  modRoleId: required("MOD_ROLE_ID"),
  startChannelId: process.env.START_CHANNEL_ID || "1518094288049668197",
  depositLogChannelId: process.env.DEPOSIT_LOG_CHANNEL_ID || "1518096297834577933",
  confirmLogChannelId: process.env.CONFIRM_LOG_CHANNEL_ID || "1518096340897239151",
  releaseLogChannelId: process.env.RELEASE_LOG_CHANNEL_ID || "1518096357926244473",
  reportPanelChannelId: process.env.REPORT_PANEL_CHANNEL_ID || "1518103260014317690",
  infoChannelId: process.env.INFO_CHANNEL_ID || "1518103260014317690",
  disputeCategoryId: process.env.DISPUTE_CATEGORY_ID || "1518107108086644736",
  proofChannelId: process.env.PROOF_CHANNEL_ID || "1518108981162151946",
  rulesChannelId: process.env.RULES_CHANNEL_ID || "1518109628427141292",
  reviewChannelId: process.env.REVIEW_CHANNEL_ID || "1518112916736577536",
  closeRoleId: process.env.CLOSE_ROLE_ID || "1518114972750844017",
  disputeLogChannelId: process.env.DISPUTE_LOG_CHANNEL_ID || "1518114776109027459",
  escrowOpenLogChannelId: process.env.ESCROW_OPEN_LOG_CHANNEL_ID || "1518116792541905006",
  escrowCloseLogChannelId: process.env.ESCROW_CLOSE_LOG_CHANNEL_ID || "1518116806760464456",
  verifyChannelId: process.env.VERIFY_CHANNEL_ID || "1518169243806339175",
  verifiedRoleId: process.env.VERIFIED_ROLE_ID || "1518169272290115725",
  partnershipPanelChannelId: process.env.PARTNERSHIP_PANEL_CHANNEL_ID || "1518173356493373510",
  partnershipCategoryId: process.env.PARTNERSHIP_CATEGORY_ID || "1518173746966433812",
  memberRoleId: process.env.MEMBER_ROLE_ID || "",
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || "",
  feePercent: numberEnv("FEE_PERCENT", 8),
  currency: process.env.CURRENCY || "EUR",
  paypalVaultEmail: required("PAYPAL_VAULT_EMAIL"),
  paymentMode: process.env.PAYMENT_MODE || "manual"
};
