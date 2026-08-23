const axios = require('axios');
const config = require('./config');

const vapi = axios.create({
  baseURL: 'https://api.vapi.ai',
  headers: {
    Authorization: `Bearer ${config.vapiApiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

/**
 * Places an outbound call using your existing saved assistant and phone
 * number, passing the Telegram user's custom instructions as a DYNAMIC
 * VARIABLE only. We deliberately never send `assistantOverrides.model` -
 * touching `model` at all requires Vapi to fully re-validate the model
 * block (provider, model name, etc.), which is what caused the
 * "assistantOverrides.model.provider must be one of the following values"
 * error. Your assistant's own model configuration is left completely
 * untouched, for every call, for every user.
 *
 * Your assistant's system prompt should include a line like:
 *   Follow these instructions for this specific call:
 *   {{callScript}}
 */
async function createOutboundCall({ toNumber, script, chatId, telegramUserId }) {
  const body = {
    assistantId: config.vapiAssistantId,
    phoneNumberId: config.vapiPhoneNumberId,
    customer: { number: toNumber },
    assistantOverrides: {
      variableValues: { callScript: script },
    },
    // Informational only, for cross-referencing in the Vapi dashboard.
    // Our own store.js is the source of truth for which Telegram chat
    // owns which call.
    metadata: {
      telegramChatId: String(chatId),
      telegramUserId: String(telegramUserId),
      callType: 'outbound',
    },
  };

  if (config.publicUrl) {
    body.assistantOverrides.server = { url: `${config.publicUrl}/webhook/vapi` };
  }

  try {
    const { data } = await vapi.post('/call', body);
    return { ok: true, call: data };
  } catch (err) {
    return { ok: false, error: extractVapiError(err) };
  }
}

/** Extracts a safe, human-readable error message - never headers or keys. */
function extractVapiError(err) {
  const data = err.response?.data;
  const message = data?.message || data?.error || err.message || 'Unknown error contacting Vapi.';
  return Array.isArray(message) ? message.join(' ') : String(message);
}

module.exports = { createOutboundCall };
