/**
 * In-memory conversation state per Telegram chat - "where is this user in
 * a multi-step flow right now". Not persisted; that's what store.js is for.
 */

const crypto = require('crypto');

const STEPS = {
  IDLE: 'idle',

  // Outbound call flow
  AWAITING_PHONE: 'awaiting_phone',
  AWAITING_SCRIPT: 'awaiting_script',
  CONFIRM: 'confirm',
  PLACING_CALL: 'placing_call',

  // Receptionist configuration flow
  AWAITING_BIZ_NAME: 'awaiting_biz_name',
  AWAITING_BIZ_HELP: 'awaiting_biz_help',
  AWAITING_TRANSFER_NUMBER: 'awaiting_transfer_number',
  AWAITING_TRANSFER_DETAIL: 'awaiting_transfer_detail', // only for "certain issues"
  RECEPTIONIST_CONFIRM: 'receptionist_confirm',
  ACTIVATING: 'activating',
};

const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { step: STEPS.IDLE });
  }
  return sessions.get(chatId);
}

function resetSession(chatId) {
  sessions.set(chatId, { step: STEPS.IDLE });
}

/** A short random id embedded in Confirm/Cancel buttons to stop stale or
 * duplicate button presses from placing a second call / re-activating. */
function newRequestId() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = { getSession, resetSession, newRequestId, STEPS };
