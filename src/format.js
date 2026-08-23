/** Maps a Vapi `status-update` status into the emoji-prefixed text we send. */
function formatStatusMessage(status, endedReason) {
  switch (status) {
    case 'queued':
    case 'scheduled':
      return '📞 Call initiated…';
    case 'ringing':
      return '🔔 Phone is ringing…';
    case 'in-progress':
      return '✅ Call answered — the AI is on the line.';
    case 'forwarding':
      return '🔁 Transferring the call to a human agent…';
    case 'ended':
      return describeEndedReason(endedReason);
    default:
      return null;
  }
}

function isNoAnswerReason(reason = '') {
  const r = String(reason).toLowerCase();
  return (
    r.includes('no-answer') ||
    r.includes('did-not-answer') ||
    r.includes('busy') ||
    r.includes('voicemail')
  );
}

function isTransferredReason(reason = '') {
  return String(reason).toLowerCase().includes('forwarded');
}

function describeEndedReason(reason = '') {
  const r = String(reason).toLowerCase();

  if (r.includes('busy')) return '📵 Busy — the line was busy.';
  if (r.includes('no-answer') || r.includes('did-not-answer')) {
    return '❌ No answer — the call was not picked up.';
  }
  if (r.includes('voicemail')) return '📼 The call went to voicemail.';
  if (isTransferredReason(r)) return '🔁 Call transferred to a human agent.';
  if (
    r.includes('failed') ||
    r.includes('error') ||
    r.includes('rejected') ||
    r.includes('unreachable') ||
    r.includes('invalid-number')
  ) {
    return `❌ Call failed (${reason}).`;
  }
  return `☎️ Call ended (${reason || 'completed'}).`;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return 'Unknown';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function humanizeStatus(record) {
  const reason = record.endedReason || '';
  if (isTransferredReason(reason)) return 'Transferred';
  if (isNoAnswerReason(reason)) {
    return record.callType === 'receptionist' ? 'Missed' : 'Not answered';
  }
  if (String(reason).toLowerCase().includes('failed') || String(reason).toLowerCase().includes('error')) {
    return 'Failed';
  }
  if (record.callType === 'receptionist' && !record.transcript) return 'Missed';
  return 'Completed';
}

/** Builds the final report text sent once end-of-call-report arrives.
 * Branches on record.callType so outbound calls and receptionist/inbound
 * calls each get labels that make sense for them. */
function formatFinalReport(record) {
  if (record.callType === 'receptionist') return formatReceptionistReport(record);
  return formatOutboundReport(record);
}

function formatOutboundReport(record) {
  const lines = [];
  lines.push('📋 Call Complete');
  lines.push('');
  lines.push(`Number: ${record.toNumber}`);
  lines.push(`Status: ${humanizeStatus(record)}`);
  if (record.durationSeconds !== null && record.durationSeconds !== undefined) {
    lines.push(`Duration: ${formatDuration(record.durationSeconds)}`);
  }
  if (record.endedReason) lines.push(`Ended reason: ${record.endedReason}`);
  lines.push('');
  appendTranscriptAndSummary(lines, record, 'Transcript');

  return { text: lines.join('\n'), recordingUrl: record.recordingUrl || null };
}

function formatReceptionistReport(record) {
  const lines = [];
  lines.push('📋 Call Summary');
  lines.push('');
  lines.push(`Caller: ${record.toNumber}`);
  lines.push(`Status: ${humanizeStatus(record)}`);
  if (record.durationSeconds !== null && record.durationSeconds !== undefined) {
    lines.push(`Duration: ${formatDuration(record.durationSeconds)}`);
  }
  if (record.endedReason) lines.push(`Ended reason: ${record.endedReason}`);
  lines.push('');

  const transcriptLabel = isTransferredReason(record.endedReason)
    ? 'Before-Transfer Transcript'
    : 'Transcript';
  appendTranscriptAndSummary(lines, record, transcriptLabel);

  return { text: lines.join('\n'), recordingUrl: record.recordingUrl || null };
}

function appendTranscriptAndSummary(lines, record, transcriptLabel) {
  const wasAnswered = !isNoAnswerReason(record.endedReason);

  if (record.transcript && record.transcript.trim()) {
    lines.push(transcriptLabel);
    lines.push(truncate(record.transcript.trim(), 12000));
  } else if (!wasAnswered) {
    lines.push('No transcript available — the call was not answered.');
  } else {
    lines.push('No transcript was returned for this call.');
  }

  if (record.summary && record.summary.trim()) {
    lines.push('');
    lines.push('AI Summary:');
    lines.push(truncate(record.summary.trim(), 1500));
  }
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (truncated)`;
}

/** Splits a long message into Telegram-safe chunks (<= 4096 chars each). */
function chunkMessage(text, maxLen = 3500) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let idx = remaining.lastIndexOf('\n', maxLen);
    if (idx <= 0) idx = maxLen;
    chunks.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Builds the sentence injected into the assistant's prompt via the
 * {{transferInstructions}} dynamic variable, based on the trigger the
 * Telegram user picked while configuring their receptionist. */
function buildTransferInstructions(trigger, detail) {
  switch (trigger) {
    case 'on_request':
      return 'Transfer to a human whenever the caller explicitly asks to speak with a person.';
    case 'after_info':
      return "First collect the caller's name, reason for calling, and a callback number, then transfer to a human.";
    case 'certain_issues':
      return `Only transfer to a human for these specific issues: ${detail}. Otherwise handle the call yourself and do not transfer.`;
    case 'never':
      return 'Do not transfer this call to a human under any circumstances, even if asked. Offer to take a detailed message instead.';
    default:
      return 'Use your judgement about when to transfer to a human.';
  }
}

module.exports = {
  formatStatusMessage,
  formatFinalReport,
  chunkMessage,
  buildTransferInstructions,
  isTransferredReason,
};
