/**
 * Very small persistence layer: a single JSON file on disk.
 *
 * This is intentionally the ONLY module that touches storage. When you're
 * ready to add user accounts, balances, per-minute billing, plans, trials,
 * limits or bans, replace the internals of this file with real database
 * calls (e.g. Postgres) and every other module keeps working unchanged.
 *
 * NOTE ON RAILWAY: local disk on Railway is ephemeral across redeploys
 * unless you attach a Railway Volume mounted at this app's /data folder.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

let state = { calls: {}, usersByChat: {}, receptionistConfigs: {}, activeReceptionistChatId: null };
let writeQueue = Promise.resolve();

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  }
}

function load() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    state = {
      calls: parsed.calls || {},
      usersByChat: parsed.usersByChat || {},
      receptionistConfigs: parsed.receptionistConfigs || {},
      activeReceptionistChatId: parsed.activeReceptionistChatId || null,
    };
  } catch (err) {
    console.error('Failed to read data file, starting with a fresh store:', err.message);
    state = { calls: {}, usersByChat: {}, receptionistConfigs: {}, activeReceptionistChatId: null };
  }
}

function persist() {
  // Serialize writes so concurrent updates (e.g. two webhook events
  // arriving close together) never race and corrupt the file.
  writeQueue = writeQueue
    .then(() => fs.promises.writeFile(DATA_FILE, JSON.stringify(state, null, 2)))
    .catch((err) => console.error('Failed to persist data store:', err.message));
  return writeQueue;
}

load();

// ---------------------------------------------------------------------
// Calls (both outbound and receptionist/inbound)
// ---------------------------------------------------------------------

/** Save a newly created/started call, associated with the Telegram chat
 * that owns it (the one who confirmed the outbound call, or the one whose
 * receptionist config was active when an inbound call came in). */
function saveCall(callRecord) {
  state.calls[callRecord.callId] = callRecord;
  const chatKey = String(callRecord.chatId);
  if (!state.usersByChat[chatKey]) state.usersByChat[chatKey] = [];
  state.usersByChat[chatKey].unshift(callRecord.callId); // newest first
  return persist();
}

/** Patch fields on an existing call (status, transcript, recording, etc). */
function updateCall(callId, patch) {
  const existing = state.calls[callId];
  if (!existing) return null;
  state.calls[callId] = { ...existing, ...patch };
  persist();
  return state.calls[callId];
}

function getCall(callId) {
  return state.calls[callId] || null;
}

/** Most recent calls for one Telegram chat only - never another user's. */
function getCallsForChat(chatId, limit = 10) {
  const ids = state.usersByChat[String(chatId)] || [];
  return ids
    .slice(0, limit)
    .map((id) => state.calls[id])
    .filter(Boolean);
}

/** True only if this exact chat owns this call - used to gate transcript
 * re-viewing so nobody can view another user's call by guessing an id. */
function chatOwnsCall(chatId, callId) {
  const call = state.calls[callId];
  return !!call && String(call.chatId) === String(chatId);
}

// ---------------------------------------------------------------------
// Receptionist configuration
// ---------------------------------------------------------------------

/** Each Telegram chat has at most one saved receptionist config (their own,
 * private to them - never exposed to any other chat). */
function saveReceptionistConfig(chatId, cfg) {
  state.receptionistConfigs[String(chatId)] = cfg;
  return persist();
}

function getReceptionistConfig(chatId) {
  return state.receptionistConfigs[String(chatId)] || null;
}

/** Only one receptionist config can be "live" at a time, because there is
 * one shared Twilio/Vapi phone number. Activating one automatically
 * replaces whichever chat was previously active. */
function activateReceptionist(chatId) {
  state.activeReceptionistChatId = String(chatId);
  return persist();
}

function deactivateReceptionist() {
  state.activeReceptionistChatId = null;
  return persist();
}

function getActiveReceptionistChatId() {
  return state.activeReceptionistChatId;
}

module.exports = {
  saveCall,
  updateCall,
  getCall,
  getCallsForChat,
  chatOwnsCall,
  saveReceptionistConfig,
  getReceptionistConfig,
  activateReceptionist,
  deactivateReceptionist,
  getActiveReceptionistChatId,
};
