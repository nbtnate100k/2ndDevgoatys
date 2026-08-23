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
 * Shared helper: fetches + briefly caches your Vapi assistant's REAL model
 * config (provider, model name, current messages), and builds a `model`
 * override that appends extra instructions to the existing system message
 * for one call only.
 *
 * Why this exists: `assistantOverrides.variableValues` only takes effect
 * if the assistant's saved prompt happens to reference that exact
 * `{{variableName}}` - if it doesn't, Vapi silently ignores it and the
 * call just uses whatever prompt is saved, with no error. Both the
 * outbound "script" feature and the receptionist "business config"
 * feature need to work reliably even if the dashboard prompt was never
 * set up with those placeholders, so both use this instead of relying on
 * variableValues alone.
 *
 * Sending a `model` override is safe here specifically because
 * provider/model are read from your own real assistant, never guessed or
 * left blank - that mismatch is what caused the original
 * "assistantOverrides.model.provider must be one of the following
 * values" error.
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cache = { data: null, fetchedAt: 0 };

async function getAssistantModelConfig() {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const { data } = await vapi.get(`/assistant/${config.vapiAssistantId}`);
    const model = data.model || {};

    if (!model.provider || !model.model) {
      console.error(
        'Vapi assistant response is missing model.provider/model.model - cannot safely build a model override, will fall back to variableValues only.'
      );
      return null;
    }

    const parsed = {
      provider: model.provider,
      model: model.model,
      messages: Array.isArray(model.messages) ? model.messages : [],
      temperature: model.temperature,
      maxTokens: model.maxTokens,
    };
    cache = { data: parsed, fetchedAt: now };
    return parsed;
  } catch (err) {
    const message = err.response?.data?.message || err.response?.data?.error || err.message;
    console.error('Failed to fetch assistant config for prompt injection:', message);
    return null;
  }
}

/** Appends `extraText` to the assistant's existing system message (or adds
 * one if it somehow doesn't have one) rather than replacing the whole
 * prompt - so the assistant's normal persona/instructions stay intact and
 * the extra instructions are layered on top, for this call only. */
function appendToSystemMessage(baseMessages, extraText) {
  const block = `\n\n${extraText}`;
  const messages = (Array.isArray(baseMessages) ? baseMessages : []).map((m) => ({ ...m }));
  const systemIndex = messages.findIndex((m) => m.role === 'system');

  if (systemIndex >= 0) {
    messages[systemIndex].content = `${messages[systemIndex].content || ''}${block}`;
  } else {
    messages.unshift({ role: 'system', content: extraText });
  }
  return messages;
}

/** Builds a full `model` override object ready to drop into
 * `assistantOverrides.model`, or null if the assistant config couldn't be
 * fetched (caller should fall back to variableValues-only in that case). */
async function buildModelOverride(extraInstructionText) {
  const assistantModel = await getAssistantModelConfig();
  if (!assistantModel) return null;

  const override = {
    provider: assistantModel.provider,
    model: assistantModel.model,
    messages: appendToSystemMessage(assistantModel.messages, extraInstructionText),
  };
  if (assistantModel.temperature !== undefined) override.temperature = assistantModel.temperature;
  if (assistantModel.maxTokens !== undefined) override.maxTokens = assistantModel.maxTokens;
  return override;
}

module.exports = { buildModelOverride };
