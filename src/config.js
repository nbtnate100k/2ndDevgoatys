require('dotenv').config();

const REQUIRED_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'VAPI_API_KEY',
  'VAPI_ASSISTANT_ID',
  'VAPI_PHONE_NUMBER_ID',
];

function loadConfig() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key] || !process.env[key].trim());
  if (missing.length > 0) {
    // Intentionally do not print any env var VALUES here - only which keys
    // are missing - so secrets can never end up in logs.
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set them in your .env file (local) or in Railway -> Variables (production).'
    );
  }

  return {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    vapiApiKey: process.env.VAPI_API_KEY,
    vapiAssistantId: process.env.VAPI_ASSISTANT_ID,
    vapiPhoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
    vapiWebhookSecret: process.env.VAPI_WEBHOOK_SECRET || null,
    port: parseInt(process.env.PORT, 10) || 3000,
    // Strip any trailing slash so we can safely do `${publicUrl}/webhook/vapi`
    publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  };
}

module.exports = loadConfig();
