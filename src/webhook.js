const express = require('express');
const config = require('./config');
const store = require('./store');
const { formatStatusMessage, formatFinalReport, chunkMessage, buildTransferInstructions } = require('./format');
const { buildModelOverride } = require('./assistantModel');

function createWebhookRouter(bot) {
  const router = express.Router();

  router.post('/webhook/vapi', express.json({ limit: '2mb' }), async (req, res) => {
    // Optional shared-secret check. Set VAPI_WEBHOOK_SECRET and configure
    // the same value as a header in Vapi's Server URL settings to enable.
    if (config.vapiWebhookSecret) {
      const provided = req.headers['x-vapi-secret'];
      if (provided !== config.vapiWebhookSecret) {
        return res.status(401).json({ error: 'unauthorized' });
      }
    }

    const message = req.body?.message;

    // `assistant-request` is special: Vapi is asking us, in real time,
    // which assistant/config to use for an inbound call, and is waiting
    // on OUR response body (not just a 200 ack) before it can proceed.
    if (message?.type === 'assistant-request') {
      try {
        await handleAssistantRequest(res, message);
      } catch (err) {
        console.error('Error handling assistant-request:', err.message);
        if (!res.headersSent) {
          res.status(200).json({ assistantId: config.vapiAssistantId }); // safe fallback
        }
      }
      return;
    }

    // Every other event type: ack immediately, Vapi doesn't need to wait
    // for Telegram delivery.
    res.status(200).json({ received: true });

    try {
      await handleMessage(bot, message);
    } catch (err) {
      console.error('Error handling Vapi webhook:', err.message);
    }
  });

  return router;
}

/**
 * Inbound call arrives -> Vapi asks us which assistant + overrides to use.
 * We look up whichever Telegram chat currently has an ACTIVE receptionist
 * config and build the call around it. If nobody has activated a
 * receptionist, we fall back to the plain assistant with no overrides
 * rather than rejecting the call outright.
 */
async function handleAssistantRequest(res, message) {
  const activeChatId = store.getActiveReceptionistChatId();
  const cfg = activeChatId ? store.getReceptionistConfig(activeChatId) : null;

  if (!activeChatId || !cfg) {
    return res.status(200).json({ assistantId: config.vapiAssistantId });
  }

  const callerNumber = message.call?.customer?.number || 'Unknown';
  const callId = message.call?.id;
  const transferInstructions = buildTransferInstructions(cfg.transferTrigger, cfg.transferDetail);

  const overrides = {
    variableValues: {
      businessName: cfg.bizName,
      helpTopics: cfg.bizHelp,
      transferInstructions,
    },
    firstMessage: `Thanks for calling ${cfg.bizName}, this is an AI assistant. How can I help you today?`,
  };

  // Same reliability fix as outbound calls: don't just hope the saved
  // prompt references {{businessName}}/{{helpTopics}}/{{transferInstructions}}
  // - inject them directly into the real system prompt for this call.
  const modelOverride = await buildModelOverride(
    `You are the AI receptionist for ${cfg.bizName}. Help callers with: ${cfg.bizHelp}. ${transferInstructions}`
  );
  if (modelOverride) {
    overrides.model = modelOverride;
  }

  // Only give the assistant the ability to transfer at all if the chosen
  // trigger isn't "never" - this is a hard guarantee, not just a prompt
  // instruction, since forwardingPhoneNumber is what grants the
  // transferCall function in the first place.
  if (cfg.transferTrigger !== 'never' && cfg.transferNumber) {
    overrides.forwardingPhoneNumber = cfg.transferNumber;
  }

  if (config.publicUrl) {
    overrides.server = { url: `${config.publicUrl}/webhook/vapi` };
  }

  if (callId) {
    store.saveCall({
      callId,
      chatId: activeChatId,
      telegramUserId: null,
      callType: 'receptionist',
      toNumber: callerNumber, // the CALLER's number, for a receptionist call
      script: null,
      businessName: cfg.bizName,
      createdAt: new Date().toISOString(),
      lastStatus: 'in-progress',
      endedReason: null,
      transcript: null,
      summary: null,
      recordingUrl: null,
      durationSeconds: null,
      reportSent: false,
    });
  }

  return res.status(200).json({ assistantId: config.vapiAssistantId, assistantOverrides: overrides });
}

async function handleMessage(bot, message) {
  if (!message) return;

  const callId = message.call?.id || message.callId;
  if (!callId) return;

  // Only act on calls this bot itself placed/configured and is tracking.
  const record = store.getCall(callId);
  if (!record) return;

  if (message.type === 'status-update') {
    await handleStatusUpdate(bot, record, message);
  } else if (message.type === 'end-of-call-report') {
    await handleEndOfCallReport(bot, record, message);
  }
  // Other message types (partial transcripts, function-call, etc.) aren't
  // needed for this bot's feature set and are ignored.
}

async function handleStatusUpdate(bot, record, message) {
  const status = message.status;
  if (!status || record.lastStatus === status) return; // de-dupe

  const text = formatStatusMessage(status, message.endedReason);
  store.updateCall(record.callId, { lastStatus: status });
  if (text) await safeSend(bot, record.chatId, text);
}

async function handleEndOfCallReport(bot, record, message) {
  if (record.reportSent) return; // idempotency guard - only send once

  store.updateCall(record.callId, {
    reportSent: true,
    endedReason: message.endedReason || record.endedReason,
    transcript: message.transcript || null,
    summary: message.summary || null,
    recordingUrl:
      message.recordingUrl ||
      message.artifact?.recordingUrl ||
      message.artifact?.recording?.mono?.combinedUrl ||
      message.artifact?.stereoRecordingUrl ||
      null,
    durationSeconds:
      message.durationSeconds !== undefined ? message.durationSeconds : record.durationSeconds,
    endedAt: new Date().toISOString(),
  });

  const finalRecord = store.getCall(record.callId);
  const { text, recordingUrl } = formatFinalReport(finalRecord);

  for (const chunk of chunkMessage(text)) {
    await safeSend(bot, record.chatId, chunk);
  }

  if (recordingUrl) {
    try {
      await bot.telegram.sendMessage(record.chatId, '🎧 Recording of this call:', {
        reply_markup: { inline_keyboard: [[{ text: '▶️ Open recording', url: recordingUrl }]] },
      });
    } catch (err) {
      console.error('Failed to send recording link:', err.message);
    }
  }
}

async function safeSend(bot, chatId, text) {
  try {
    await bot.telegram.sendMessage(chatId, text);
  } catch (err) {
    console.error(`Failed to message chat ${chatId}:`, err.message);
  }
}

module.exports = { createWebhookRouter };
