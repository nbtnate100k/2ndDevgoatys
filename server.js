const express = require('express');
const config = require('./src/config'); // validates required env vars, throws early if missing
const { createBot } = require('./src/bot');
const { createWebhookRouter } = require('./src/webhook');

const app = express();
const bot = createBot();

// Simple root + health check routes so Railway (and you) can confirm the
// service is alive.
app.get('/', (req, res) => res.status(200).send('Telegram-Vapi bot is running.'));
app.get('/health', (req, res) => res.status(200).json({ ok: true }));

// The one public route Vapi needs: where it sends call events.
app.use(createWebhookRouter(bot));

// Bind to 0.0.0.0 (all interfaces) - required for Railway's health checks
// and public routing to reach this process, not just "localhost".
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Webhook server listening on port ${config.port}`);
});

bot
  .launch()
  .then(() => console.log('Telegram bot started (long polling).'))
  .catch((err) => {
    console.error('Failed to start Telegram bot:', err.message);
    process.exit(1);
  });

// Graceful shutdown so Railway restarts/redeploys don't leave the bot in a
// half-stopped state.
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
