const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const store = require('./store');
const { getSession, resetSession, newRequestId, STEPS } = require('./session');
const { validateAndFormatPhone } = require('./phone');
const { createOutboundCall } = require('./vapiClient');
const { formatFinalReport } = require('./format');

const TRANSFER_TRIGGER_LABELS = {
  on_request: 'Transfer whenever caller asks for a human',
  after_info: 'Transfer after collecting their information',
  certain_issues: 'Transfer only for certain issues',
  never: 'Never transfer automatically',
};

function createBot() {
  const bot = new Telegraf(config.telegramBotToken);

  // -----------------------------------------------------------------
  // Main menu
  // -----------------------------------------------------------------

  bot.start((ctx) => {
    resetSession(ctx.chat.id);
    return showMenu(ctx);
  });

  bot.command('cancel', (ctx) => {
    resetSession(ctx.chat.id);
    return ctx.reply('Cancelled. Send /start to see the menu again.');
  });

  bot.command('history', (ctx) => showHistory(ctx));

  bot.action('menu_history', async (ctx) => {
    await ctx.answerCbQuery();
    return showHistory(ctx);
  });

  bot.action('menu_outbound', async (ctx) => {
    await ctx.answerCbQuery();
    const session = getSession(ctx.chat.id);
    session.step = STEPS.AWAITING_PHONE;
    await ctx.reply(
      '📱 What phone number should the AI call?\nPlease include the country code, e.g. +1 555 123 4567.'
    );
  });

  bot.action('menu_receptionist', async (ctx) => {
    await ctx.answerCbQuery();
    return startReceptionistFlow(ctx);
  });

  // -----------------------------------------------------------------
  // Text input router - handles whichever step the chat is currently in
  // -----------------------------------------------------------------

  bot.on('text', async (ctx) => {
    const session = getSession(ctx.chat.id);
    const text = ctx.message.text.trim();

    switch (session.step) {
      case STEPS.AWAITING_PHONE:
        return handleOutboundPhone(ctx, session, text);
      case STEPS.AWAITING_SCRIPT:
        return handleOutboundScript(ctx, session, text);
      case STEPS.AWAITING_BIZ_NAME:
        return handleBizName(ctx, session, text);
      case STEPS.AWAITING_BIZ_HELP:
        return handleBizHelp(ctx, session, text);
      case STEPS.AWAITING_TRANSFER_NUMBER:
        return handleTransferNumber(ctx, session, text);
      case STEPS.AWAITING_TRANSFER_DETAIL:
        return handleTransferDetail(ctx, session, text);
      default:
        return ctx.reply('Send /start to see the menu, or /history for your past calls.');
    }
  });

  // -----------------------------------------------------------------
  // Outbound call flow
  // -----------------------------------------------------------------

  async function handleOutboundPhone(ctx, session, text) {
    const result = validateAndFormatPhone(text);
    if (!result.valid) return ctx.reply(`⚠️ ${result.error}`);

    session.phone = result.e164;
    session.step = STEPS.AWAITING_SCRIPT;
    return ctx.reply(
      `Got it: ${result.e164}\n\n📝 Now send the script or instructions you want the AI to follow on this call.`
    );
  }

  async function handleOutboundScript(ctx, session, text) {
    if (text.length < 3) return ctx.reply('Please send a bit more detail for the script.');
    if (text.length > 4000) {
      return ctx.reply('That script is a bit long (max 4000 characters). Please shorten it and resend.');
    }

    session.script = text;
    session.step = STEPS.CONFIRM;
    session.requestId = newRequestId();

    const preview = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    return ctx.reply(
      `Please confirm:\n\nPhone: ${session.phone}\nScript:\n${preview}\n\nPress Confirm to place the call.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm Call', `confirm_call:${session.requestId}`)],
        [Markup.button.callback('❌ Cancel', `cancel_flow:${session.requestId}`)],
      ])
    );
  }

  bot.action(/^confirm_call:(.+)$/, async (ctx) => {
    const requestId = ctx.match[1];
    const session = getSession(ctx.chat.id);

    if (session.step !== STEPS.CONFIRM || session.requestId !== requestId) {
      await ctx.answerCbQuery('This confirmation has expired.');
      return ctx.reply('That confirmation is no longer valid. Send /start to begin again.');
    }

    session.step = STEPS.PLACING_CALL; // guards against double taps
    await ctx.answerCbQuery('Placing your call…');
    await clearButtons(ctx);
    await ctx.reply('⏳ Placing your call…');

    const { phone, script } = session;
    const chatId = ctx.chat.id;
    const telegramUserId = ctx.from.id;

    const result = await createOutboundCall({ toNumber: phone, script, chatId, telegramUserId });

    if (!result.ok) {
      resetSession(chatId);
      return ctx.reply(`❌ Vapi couldn't place this call: ${result.error}`);
    }

    const call = result.call;
    await store.saveCall({
      callId: call.id,
      chatId,
      telegramUserId,
      callType: 'outbound',
      toNumber: phone,
      script,
      createdAt: new Date().toISOString(),
      lastStatus: call.status || 'queued',
      endedReason: null,
      transcript: null,
      summary: null,
      recordingUrl: null,
      durationSeconds: null,
      reportSent: false,
    });

    resetSession(chatId);
    return ctx.reply('📞 Call initiated! I will update you here as it progresses.');
  });

  // -----------------------------------------------------------------
  // Receptionist / transfer configuration flow
  // -----------------------------------------------------------------

  async function startReceptionistFlow(ctx) {
    const chatId = ctx.chat.id;
    const existing = store.getReceptionistConfig(chatId);

    if (existing) {
      const isActive = store.getActiveReceptionistChatId() === String(chatId);
      return ctx.reply(
        `You already have a saved receptionist setup:\n\n` +
          `Business: ${existing.bizName}\n` +
          `Helps with: ${existing.bizHelp}\n` +
          `Transfers to: ${existing.transferNumber}\n` +
          `When: ${TRANSFER_TRIGGER_LABELS[existing.transferTrigger] || existing.transferTrigger}\n\n` +
          (isActive ? '✅ This is currently ACTIVE on your number.' : '⚪ This is currently inactive.'),
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Activate This Config', `activate_receptionist:${newRequestId()}`)],
          [Markup.button.callback('🔁 Reconfigure', 'receptionist_reconfigure')],
        ])
      );
    }

    return beginReceptionistWizard(ctx);
  }

  bot.action('receptionist_reconfigure', async (ctx) => {
    await ctx.answerCbQuery();
    return beginReceptionistWizard(ctx);
  });

  function beginReceptionistWizard(ctx) {
    const session = getSession(ctx.chat.id);
    session.step = STEPS.AWAITING_BIZ_NAME;
    session.receptionistDraft = {};
    return ctx.reply('🏢 What business name should the AI use when answering calls?');
  }

  async function handleBizName(ctx, session, text) {
    session.receptionistDraft.bizName = text;
    session.step = STEPS.AWAITING_BIZ_HELP;
    return ctx.reply('🛠️ What should the AI help callers with? (e.g. booking appointments, answering FAQs, taking messages)');
  }

  async function handleBizHelp(ctx, session, text) {
    session.receptionistDraft.bizHelp = text;
    session.step = STEPS.AWAITING_TRANSFER_NUMBER;
    return ctx.reply(
      '☎️ What phone number should calls be transferred to when a human agent is needed?\n' +
        'Include the country code, e.g. +1 555 123 4567.'
    );
  }

  async function handleTransferNumber(ctx, session, text) {
    const result = validateAndFormatPhone(text);
    if (!result.valid) return ctx.reply(`⚠️ ${result.error}`);

    session.receptionistDraft.transferNumber = result.e164;
    session.step = STEPS.IDLE; // waiting on button choice next, not text
    return ctx.reply(
      '🔀 When should the AI transfer the caller?',
      Markup.inlineKeyboard([
        [Markup.button.callback(TRANSFER_TRIGGER_LABELS.on_request, 'trigger:on_request')],
        [Markup.button.callback(TRANSFER_TRIGGER_LABELS.after_info, 'trigger:after_info')],
        [Markup.button.callback(TRANSFER_TRIGGER_LABELS.certain_issues, 'trigger:certain_issues')],
        [Markup.button.callback(TRANSFER_TRIGGER_LABELS.never, 'trigger:never')],
      ])
    );
  }

  bot.action(/^trigger:(.+)$/, async (ctx) => {
    const trigger = ctx.match[1];
    const session = getSession(ctx.chat.id);
    if (!session.receptionistDraft) {
      await ctx.answerCbQuery('Please start over with the receptionist menu.');
      return;
    }

    await ctx.answerCbQuery();
    await clearButtons(ctx);
    session.receptionistDraft.transferTrigger = trigger;

    if (trigger === 'certain_issues') {
      session.step = STEPS.AWAITING_TRANSFER_DETAIL;
      return ctx.reply('📝 Which specific issues should trigger a transfer? Describe them briefly.');
    }

    return showReceptionistConfirm(ctx, session);
  });

  async function handleTransferDetail(ctx, session, text) {
    session.receptionistDraft.transferDetail = text;
    return showReceptionistConfirm(ctx, session);
  }

  function showReceptionistConfirm(ctx, session) {
    const d = session.receptionistDraft;
    session.step = STEPS.RECEPTIONIST_CONFIRM;
    session.requestId = newRequestId();

    const lines = [
      'Please confirm your receptionist setup:',
      '',
      `Business: ${d.bizName}`,
      `Helps with: ${d.bizHelp}`,
      `Transfers to: ${d.transferNumber}`,
      `When: ${TRANSFER_TRIGGER_LABELS[d.transferTrigger]}`,
    ];
    if (d.transferDetail) lines.push(`Issues: ${d.transferDetail}`);
    lines.push('', '⚠️ Activating this will replace any other receptionist setup currently active on your shared number.');

    return ctx.reply(
      lines.join('\n'),
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm & Activate', `save_and_activate:${session.requestId}`)],
        [Markup.button.callback('❌ Cancel', `cancel_flow:${session.requestId}`)],
      ])
    );
  }

  bot.action(/^save_and_activate:(.+)$/, async (ctx) => {
    const requestId = ctx.match[1];
    const session = getSession(ctx.chat.id);

    if (session.step !== STEPS.RECEPTIONIST_CONFIRM || session.requestId !== requestId) {
      await ctx.answerCbQuery('This confirmation has expired.');
      return ctx.reply('That confirmation is no longer valid. Send /start to begin again.');
    }

    session.step = STEPS.ACTIVATING; // guards against double taps
    await ctx.answerCbQuery('Activating…');
    await clearButtons(ctx);

    const chatId = ctx.chat.id;
    await store.saveReceptionistConfig(chatId, session.receptionistDraft);
    await store.activateReceptionist(chatId);

    resetSession(chatId);
    return ctx.reply(
      '✅ Your AI receptionist is now active on your shared number.\n' +
        "I'll message you here with a summary and transcript after each call."
    );
  });

  bot.action(/^activate_receptionist:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Activating…');
    const chatId = ctx.chat.id;
    await store.activateReceptionist(chatId);
    return ctx.reply('✅ Your saved receptionist setup is now active on your shared number.');
  });

  // -----------------------------------------------------------------
  // Cancel (shared by both flows)
  // -----------------------------------------------------------------

  bot.action(/^cancel_flow:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    resetSession(ctx.chat.id);
    await clearButtons(ctx);
    return ctx.reply('❌ Cancelled. Send /start to begin again.');
  });

  // -----------------------------------------------------------------
  // History
  // -----------------------------------------------------------------

  function showHistory(ctx) {
    const calls = store.getCallsForChat(ctx.chat.id, 10);
    if (calls.length === 0) {
      return ctx.reply("You haven't had any calls yet. Send /start to place or configure one.");
    }

    const lines = ['📜 Your recent calls:', ''];
    const buttons = [];

    calls.forEach((c, i) => {
      const when = new Date(c.createdAt).toLocaleString();
      const status = c.endedReason || c.lastStatus || 'pending';
      const duration =
        c.durationSeconds !== null && c.durationSeconds !== undefined
          ? `${Math.round(c.durationSeconds)}s`
          : '—';
      const typeLabel = c.callType === 'receptionist' ? '🧑‍💼 Receptionist' : '📞 Outbound';

      lines.push(`${i + 1}. ${typeLabel} — ${c.toNumber}`);
      lines.push(`   When: ${when}`);
      lines.push(`   Status: ${status}`);
      lines.push(`   Duration: ${duration}`);
      lines.push('');

      buttons.push([Markup.button.callback(`View #${i + 1} transcript`, `view_call:${c.callId}`)]);
    });

    return ctx.reply(lines.join('\n'), Markup.inlineKeyboard(buttons));
  }

  bot.action(/^view_call:(.+)$/, async (ctx) => {
    const callId = ctx.match[1];
    await ctx.answerCbQuery();

    // Ownership check - a chat can only ever view its OWN calls, even if
    // it somehow guessed another call's id.
    if (!store.chatOwnsCall(ctx.chat.id, callId)) {
      return ctx.reply("I couldn't find that call.");
    }

    const record = store.getCall(callId);
    if (!record.reportSent) {
      return ctx.reply(`This call hasn't ended yet. Current status: ${record.lastStatus || 'pending'}`);
    }

    const { text } = formatFinalReport(record);
    return ctx.reply(text);
  });

  // -----------------------------------------------------------------

  function showMenu(ctx) {
    return ctx.reply(
      '👋 Welcome! What type of call would you like to make?',
      Markup.inlineKeyboard([
        [Markup.button.callback('📞 AI Outbound Call', 'menu_outbound')],
        [Markup.button.callback('🧑‍💼 AI Receptionist / Transfer Call', 'menu_receptionist')],
        [Markup.button.callback('📋 Call History', 'menu_history')],
      ])
    );
  }

  async function clearButtons(ctx) {
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (_) {
      /* message may already be edited/gone - safe to ignore */
    }
  }

  bot.catch((err, ctx) => {
    console.error(`Telegraf error for update ${ctx.updateType}:`, err.message);
  });

  return bot;
}

module.exports = { createBot };
