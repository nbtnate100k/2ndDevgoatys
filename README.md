# Telegram → Vapi AI Call Bot (Outbound + Receptionist)

A Telegram bot with two call modes, both powered by [Vapi](https://vapi.ai)
using your existing Vapi assistant and Twilio phone number:

- **📞 AI Outbound Call** — collects a phone number and a custom script,
  shows a confirmation screen, and — only after you tap **Confirm** —
  places the call. Status updates, the final transcript, an AI summary,
  and a link to the recording are sent back to you automatically.
- **🧑‍💼 AI Receptionist / Transfer Call** — configures how your assistant
  answers *inbound* calls to your Twilio number: what business it
  represents, what it should help with, and when to transfer to a human.
  After each inbound call, you get a summary, the transcript up to the
  point of transfer (if any), and a recording link.

Each Telegram user's calls, phone numbers, scripts, transcripts,
recordings, and receptionist configuration are private to them —
`/history` only ever shows the calls that chat itself created.

> **One important limitation:** these env vars point at a single shared
> Vapi assistant and a single shared Twilio number. Outbound calls always
> work independently per user. The receptionist mode, however, can only
> have **one configuration active at a time** for that shared number —
> see "How the receptionist mode works" below.

---

## 1. What you need before you start

- **Node.js 18+** installed on your computer (for running it locally). Check with `node -v`.
- A **Telegram bot token** — message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`, follow the prompts, and copy the token it gives you.
- A **Vapi account** with:
  - An API key (Vapi Dashboard → API Keys)
  - A saved **Assistant** (Vapi Dashboard → Assistants) — copy its **Assistant ID**
  - A **phone number** imported from Twilio and linked to Vapi (Vapi Dashboard → Phone Numbers) — copy its **Phone Number ID**
- Your assistant's **system prompt** should include these two lines so the
  dynamic variables this bot sends actually get used:
  ```
  Follow these instructions for this specific call:
  {{callScript}}

  If you are acting as a receptionist: you are the AI assistant for
  {{businessName}}. Help callers with: {{helpTopics}}.
  {{transferInstructions}}
  ```
  (`callScript` only gets set on outbound calls; the other three only get
  set on inbound/receptionist calls — an unset variable simply renders
  blank, so one prompt can safely cover both modes.)
- A **[Railway](https://railway.app) account** (free to start) for 24/7 hosting.
- A **GitHub account** (Railway deploys most easily from a GitHub repo).

---

## 2. Install dependencies locally

Open a terminal in this project folder and run:

```bash
npm install
```

## 3. Configure your environment variables locally

Copy the example file:

```bash
cp .env.example .env
```

Open `.env` in a text editor and fill in:

```
TELEGRAM_BOT_TOKEN=123456:ABC-your-real-token
VAPI_API_KEY=your-vapi-api-key
VAPI_ASSISTANT_ID=your-assistant-id
VAPI_PHONE_NUMBER_ID=your-phone-number-id
```

Leave `PUBLIC_URL` and `VAPI_WEBHOOK_SECRET` blank for now — you'll fill
`PUBLIC_URL` in after your first Railway deploy (step 7).

**Never commit your real `.env` file.** `.gitignore` already excludes it.

## 4. Run the bot locally

```bash
npm start
```

You should see:

```
Webhook server listening on port 3000
Telegram bot started (long polling).
```

Open Telegram, find your bot, and send `/start`. You can walk through the
whole phone number → script → confirm flow locally — the call itself will
still go through Vapi. The only thing that won't fully work locally is the
**webhook** (status updates / transcript), because Vapi can't reach
`localhost`. That starts working once you deploy to Railway and set
`PUBLIC_URL` (steps 6–8).

---

## 5. Create your Railway project

1. Push this project to a **new GitHub repository** (see step 6).
2. Go to [railway.app](https://railway.app) and log in.
3. Click **New Project → Deploy from GitHub repo**.
4. Select the repository you just pushed.

## 6. Push this code to GitHub

From this project folder:

```bash
git init
git add .
git commit -m "Initial commit: Telegram Vapi call bot"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

(Create the empty repo on GitHub first if you haven't — github.com → New
repository — then use the URL it gives you above.)

If you connected the repo directly in step 5, Railway will already be
watching it and will redeploy automatically on every push to `main`.

## 7. Add environment variables to Railway

1. In your Railway project, click your service, then the **Variables** tab.
2. Add each of these (Raw Editor is fastest — paste them all at once):

```
TELEGRAM_BOT_TOKEN=your-real-token
VAPI_API_KEY=your-real-key
VAPI_ASSISTANT_ID=your-assistant-id
VAPI_PHONE_NUMBER_ID=your-phone-number-id
VAPI_WEBHOOK_SECRET=pick-any-long-random-string
```

Do **not** set `PORT` — Railway sets it automatically. Leave `PUBLIC_URL`
out for now; you'll add it in step 8 once you know your Railway domain.

## 8. Deploy and get your public Railway URL

1. Railway will build and deploy automatically (it detects `npm start` from
   `package.json`). Watch the **Deployments** tab until it shows "Success".
2. Go to the **Settings** tab of your service → **Networking** → click
   **Generate Domain**. Railway gives you a URL like:
   `https://your-app-name.up.railway.app`
3. Go back to **Variables**, add:
   ```
   PUBLIC_URL=https://your-app-name.up.railway.app
   ```
4. Railway will automatically redeploy with the new variable.

Visit `https://your-app-name.up.railway.app/health` in a browser — you
should see `{"ok":true}`. That confirms the webhook server is publicly
reachable.

## 9. Point Vapi's webhook at your bot

**For outbound calls:** nothing to configure — this bot sends a per-call
`server.url` override with every call it places (using `PUBLIC_URL`), so
every outbound call already tells Vapi to send events to
`https://your-app-name.up.railway.app/webhook/vapi`.

**For the AI Receptionist mode, this one-time setup is required** — inbound
calls aren't started by this bot, so Vapi needs to know in advance where to
ask "which assistant should handle this call?":

1. Vapi Dashboard → **Phone Numbers** → click your Twilio number.
2. Find the **Inbound Assistant** / **Assistant** field and **clear it /
   leave it blank**. (If an assistant is pinned here, Vapi will always use
   that one directly and will never ask your bot which config to use.)
3. Find **Server URL** (sometimes under an "Advanced" section) and set it to:
   `https://your-app-name.up.railway.app/webhook/vapi`
4. If you set `VAPI_WEBHOOK_SECRET` in step 7, also set that same value as
   the server secret/header in Vapi's settings so requests can be verified.
5. Save.

With the number's assistant left blank and the Server URL pointed at your
bot, every inbound call triggers an `assistant-request` event that this
bot answers instantly with whichever Telegram user's receptionist config
is currently **active** (see below).

## 10. Test a real outbound call

1. Open your bot in Telegram and send `/start`.
2. Tap **📞 AI Outbound Call**.
3. Enter a real phone number you can answer, with country code (e.g. `+15551234567`).
4. Enter a short test script, e.g. `You are calling to say a quick hello and confirm this test worked. Keep it under 20 seconds.`
5. Review the confirmation screen and tap **✅ Confirm Call**.
6. Answer the phone when it rings.

## 11. Test the AI Receptionist

1. Complete step 9 above first (blank inbound assistant + Server URL set) — this mode won't work without it.
2. In Telegram, send `/start` → tap **🧑‍💼 AI Receptionist / Transfer Call**.
3. Answer the four setup questions: business name, what the AI should help with, the transfer number, and when to transfer.
4. Tap **✅ Confirm & Activate**.
5. Call your Twilio number from another phone and talk to the AI receptionist.
6. If you picked a transfer trigger it should honor, ask for a human (or trigger whatever condition you configured) and confirm the call forwards.

## 12. Check that status updates and the transcript come back

**Outbound**, as the call progresses you should see, in order, roughly:

```
📞 Call initiated…
🔔 Phone is ringing…
✅ Call answered — the AI is on the line.
```

After you hang up, within a few seconds you should receive:

```
📋 Call Complete

Number: +15551234567
Status: Completed
Duration: 0m 18s
Ended reason: customer-ended-call

Transcript
AI: Hello, ...
...

AI Summary:
...
```

**Receptionist**, after the inbound call ends you should receive:

```
📋 Call Summary

Caller: +15551234567
Status: Transferred
Duration: 0m 42s
Ended reason: assistant-forwarded-call

Before-Transfer Transcript
AI: Thanks for calling ...
Caller: I'm having a problem with my sink...
AI: Okay, let me get a few details...

AI Summary:
...
```

Both modes are followed by a **▶️ Open recording** button if your
assistant has recording enabled.

Check `/history` afterward — it lists both call types, and each has a
**View transcript** button to pull the report back up any time.

---

## How the receptionist mode works (and its one limitation)

Inbound calls aren't started by this bot — a customer just dials your
Twilio number. To customize how the AI answers, this bot relies on Vapi's
`assistant-request` webhook: the instant your number rings, Vapi asks your
server "which assistant/config should handle this?" and your server
answers in real time with the active Telegram user's business name, help
topics, transfer number, and transfer instructions — all via dynamic
variables, never by editing your saved assistant.

Because you have **one shared Twilio number**, only one Telegram user's
receptionist config can be active at once. Activating a new one silently
replaces whichever was active before. If you need fully separate inbound
lines per user later, that means provisioning a separate Vapi phone number
per user and extending `store.js`'s active-config lookup to be keyed by
which number was called (`message.call.phoneNumberId`) instead of a single
global pointer — noted in the Roadmap section below.

---

## Troubleshooting

- **No status updates arrive at all**: double check `PUBLIC_URL` is set in
  Railway and matches your real Railway domain exactly (no trailing slash),
  then redeploy. Visit `/health` to confirm the server is reachable.
- **"Vapi couldn't place this call: ..."**: the message shown is exactly
  what Vapi's API returned — common causes are an invalid
  `VAPI_PHONE_NUMBER_ID`/`VAPI_ASSISTANT_ID`, insufficient Vapi credit, or
  a destination number your Twilio number isn't allowed to dial
  internationally.
- **Bot doesn't respond on Telegram**: check Railway's **Deployments →
  Logs** for a startup error (most often a missing/typo'd environment
  variable — the error message will name which one, never its value).
- **"No transcript available"**: this is expected and correct when a call
  wasn't answered, went to voicemail, or was busy.
- **Receptionist mode: calls still use the old assistant / no `/webhook/vapi`
  hit shows up**: almost always means step 9 wasn't done — the phone
  number still has an assistant pinned directly to it, so Vapi never asks
  your bot anything. Go back to Vapi Dashboard → Phone Numbers → your
  number and make sure the assistant field is genuinely blank.
- **Transfer never happens**: check the transfer trigger you picked isn't
  "Never transfer automatically", and check your assistant's system
  prompt actually includes `{{transferInstructions}}` somewhere so the AI
  knows the rule you configured.

---

## Railway-readiness checklist

This project already includes everything Railway needs to detect, build,
and run it correctly — you don't need to configure any of this yourself:

- `package.json` → `"start": "node server.js"` — Railway runs this via Nixpacks.
- `railway.json` → tells Railway to run `npm start`, health-check `/health`,
  and restart automatically on failure.
- `Procfile` → `web: npm start`, a fallback in case Nixpacks process
  detection is used instead of `railway.json`.
- `server.js` binds to `0.0.0.0` and reads the port from `process.env.PORT`
  (via `src/config.js`) — Railway assigns this port dynamically, so never
  hardcode a port number.
- `.gitignore` excludes `node_modules/`, `.env`, and `data/` so secrets and
  local state never get pushed to GitHub.

With these in place, steps 5–8 above (create project → push to GitHub →
add variables → deploy) are all you need to do.

## Project structure

```
railway.json          Railway build/deploy configuration
Procfile               Fallback process declaration for Railway
server.js            Entry point: starts Express + the Telegram bot
src/config.js         Loads & validates environment variables
src/bot.js            Telegram flow: menu, outbound calls, receptionist
                       setup wizard, /history, transcript re-viewing
src/session.js         In-memory "where is this chat in the flow" state
src/phone.js           Phone number validation / E.164 formatting
src/vapiClient.js      Calls the Vapi API to place outbound calls
                        (dynamic variables only - never touches `model`)
src/webhook.js          Receives Vapi call events; answers `assistant-request`
                         for inbound receptionist calls; messages the right user
src/format.js           Turns raw Vapi data into Telegram messages for
                         both outbound and receptionist call types
src/store.js            Persistence (JSON file): calls, per-chat receptionist
                         configs, and which one is currently active - swap
                         this out for a real database later without
                         touching anything else
data/                   Where store.js keeps its JSON file (gitignored)
```

## Roadmap: extending this later

The project is deliberately split so each of these can be added without a
rewrite:

- **Per-user inbound phone numbers**: today, one active receptionist
  config serves the single shared number. To give each Telegram user
  their own number, provision one Vapi phone number per user and change
  `store.js`'s single `activeReceptionistChatId` into a map keyed by
  `phoneNumberId` (available on the `assistant-request` payload as
  `message.phoneNumber.id` / `message.call.phoneNumberId`).
- **User accounts / bans**: extend `store.js` with a `users` table and add
  a check at the top of `bot.js`'s `confirm_call` handler.
- **Prepaid balances / per-minute billing**: Vapi's `end-of-call-report`
  webhook includes cost data — read it in `src/webhook.js`'s
  `handleEndOfCallReport` and debit the user's balance there.
- **Membership plans / free trials / call limits**: add a check before
  `createOutboundCall` is called in `src/bot.js`.
- **Admin dashboard**: `store.js`'s functions (`getCallsForChat`, etc.) can
  be reused behind a small authenticated Express route, or swapped for
  direct database queries once you migrate off the JSON file.
- **Payment processing**: add a webhook route alongside `/webhook/vapi` in
  `server.js` for your payment provider, and credit balances via the same
  `store.js` you're already using.

## Keeping it running 24/7

Railway keeps a deployed service running continuously and restarts it
automatically if it crashes. Nothing extra is required beyond deploying —
just make sure you're on a Railway plan with no sleep/idle timeout for
this service if you're on a free tier that pauses inactive services.
