const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "escrow-db.json");

function now() {
  return new Date().toISOString();
}

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    writeDb({ nextTradeId: 1, nextEventId: 1, trades: [], events: [] });
  }
}

function readDb() {
  ensureDb();
  const data = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  data.trades ||= [];
  data.events ||= [];
  data.blacklist ||= [];
  data.rateLimits ||= [];
  data.nextTradeId ||= 1;
  data.nextEventId ||= 1;
  return data;
}

function writeDb(data) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const tmpPath = `${dbPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, dbPath);
}

function createTrade(input) {
  const data = readDb();
  const timestamp = now();
  const id = data.nextTradeId++;
  const trade = {
    id,
    ticket_id: `EQY-${String(id).padStart(6, "0")}`,
    guild_id: input.guildId,
    channel_id: input.channelId,
    thread_id: null,
    seller_id: input.sellerId,
    buyer_id: input.buyerId,
    creator_id: input.creatorId,
    amount: input.amount,
    fee: input.fee,
    fee_percent: input.feePercent,
    currency: input.currency,
    description: input.description,
    status: "pending",
    paypal_transaction_id: null,
    paypal_payout_id: null,
    dispute_reason: null,
    created_at: timestamp,
    funded_at: null,
    released_at: null,
    updated_at: timestamp
  };
  data.trades.push(trade);
  writeDb(data);
  return trade;
}

function getTrade(id) {
  const data = readDb();
  const normalized = String(id).trim().toUpperCase();
  return data.trades.find((trade) =>
    String(trade.id) === normalized ||
    String(trade.ticket_id || "").toUpperCase() === normalized
  ) || null;
}

function updateTrade(id, patch) {
  const data = readDb();
  const normalized = String(id).trim().toUpperCase();
  const index = data.trades.findIndex((trade) =>
    String(trade.id) === normalized ||
    String(trade.ticket_id || "").toUpperCase() === normalized
  );
  if (index === -1) return null;
  data.trades[index] = { ...data.trades[index], ...patch, updated_at: now() };
  writeDb(data);
  return data.trades[index];
}

function getTradeByThreadId(threadId) {
  const data = readDb();
  return data.trades.find((trade) => trade.thread_id === threadId) || null;
}

function getAllTrades() {
  return readDb().trades;
}

function addEvent(ticketRef, actorId, eventType, details = "") {
  const data = readDb();
  data.events.push({
    id: data.nextEventId++,
    ticket_ref: String(ticketRef),
    actor_id: actorId,
    event_type: eventType,
    details,
    created_at: now()
  });
  writeDb(data);
}

function getEvents(ticketRef = null) {
  const data = readDb();
  if (!ticketRef) return data.events;
  const normalized = String(ticketRef).trim().toUpperCase();
  return data.events.filter((event) => String(event.ticket_ref).toUpperCase() === normalized);
}

function addBlacklist(userId, reason, actorId) {
  const data = readDb();
  const timestamp = now();
  const existing = data.blacklist.find((entry) => entry.user_id === userId);
  if (existing) {
    existing.reason = reason;
    existing.actor_id = actorId;
    existing.updated_at = timestamp;
  } else {
    data.blacklist.push({
      user_id: userId,
      reason,
      actor_id: actorId,
      created_at: timestamp,
      updated_at: timestamp
    });
  }
  writeDb(data);
}

function removeBlacklist(userId) {
  const data = readDb();
  const before = data.blacklist.length;
  data.blacklist = data.blacklist.filter((entry) => entry.user_id !== userId);
  writeDb(data);
  return data.blacklist.length !== before;
}

function getBlacklist(userId) {
  return readDb().blacklist.find((entry) => entry.user_id === userId) || null;
}

function listBlacklist() {
  return readDb().blacklist;
}

function incrementRateLimit(userId, action) {
  const data = readDb();
  const day = new Date().toISOString().slice(0, 10);
  let entry = data.rateLimits.find((item) =>
    item.user_id === userId && item.action === action && item.day === day
  );
  if (!entry) {
    entry = { user_id: userId, action, day, count: 0 };
    data.rateLimits.push(entry);
  }
  entry.count += 1;
  writeDb(data);
  return entry.count;
}

function diffHours(start, end) {
  return (new Date(end).getTime() - new Date(start).getTime()) / 36e5;
}

function metrics() {
  const data = readDb();
  const completedTrades = data.trades.filter((trade) => trade.status === "released");
  const releaseDurations = completedTrades
    .filter((trade) => trade.funded_at && trade.released_at)
    .map((trade) => diffHours(trade.funded_at, trade.released_at));
  const avgReleaseHours = releaseDurations.length
    ? releaseDurations.reduce((sum, hours) => sum + hours, 0) / releaseDurations.length
    : null;

  return {
    completed: completedTrades.length,
    disputed: data.trades.filter((trade) => trade.status === "disputed").length,
    total: data.trades.length,
    avgReleaseHours
  };
}

module.exports = {
  createTrade,
  getTrade,
  getTradeByThreadId,
  getAllTrades,
  updateTrade,
  addEvent,
  getEvents,
  addBlacklist,
  removeBlacklist,
  getBlacklist,
  listBlacklist,
  incrementRateLimit,
  metrics,
  now
};
