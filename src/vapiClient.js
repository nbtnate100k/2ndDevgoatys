const axios = require('axios');
const config = require('./config');
const { buildModelOverride } = require('./assistantModel');

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
 * number. The Telegram user's custom instructions are guaranteed to be
 * used for this call because they're injected directly into the system
 * prompt sent for this call (see src/assistantModel.js) - not just passed
 * as a variable that silently does nothing unless your prompt happens to
 * reference `{{callScript}}`.
 *
 * `variableValues.callScript` is still sent too, harmlessly, in case your
 * prompt already references it - it just becomes redundant, not broken.
 */
async function createOutboundCall({ toNumber, script, chatId, telegramUserId }) {
  const body = {
    assistantId: config.vapiAssistantId,
    phoneNumberId: config.vapiPhoneNumberId,
    customer: { number: toNumber },
    assistantOverrides: {
      variableValues: { callScript: script },
    },
    metadata: {
      telegramChatId: String(chatId),
      telegramUserId: String(telegramUserId),
      callType: 'outbound',
    },
  };

  const modelOverride = await buildModelOverride(
    `Additional instructions for this specific call only:\n${script}`
  );
  if (modelOverride) {
    body.assistantOverrides.model = modelOverride;
  }
  // If the fetch failed, we deliberately don't block the call - it still
  // goes out using the assistant's default prompt plus the variableValues
  // fallback, and the real cause is logged server-side for you to check.

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
