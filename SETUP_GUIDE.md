# 🪽 Elevate Bot — Full Setup Guide

> A complete beginner-friendly guide to get your bot running.

---

## What This Bot Does

| Feature | Description |
|---|---|
| 🎉 Welcome Card | Auto-posts a styled image card when someone joins |
| 📒 Trading Journal | `/journal log` — each member's trades stored in a private thread |
| 📅 Economic Calendar | Posts high-impact US events every Sunday at 7PM ET automatically |

---

## Step 1 — Create Your Bot on Discord

1. Go to **https://discord.com/developers/applications**
2. Click **"New Application"** → name it `Elevate Bot` → click **Create**
3. On the left sidebar click **"Bot"**
4. Click **"Reset Token"** → copy the token and save it somewhere safe *(this is your `BOT_TOKEN`)*
5. Scroll down and enable all three **Privileged Gateway Intents**:
   - ✅ Presence Intent
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Click **Save Changes**

---

## Step 2 — Invite the Bot to Your Server

1. On the left sidebar click **"OAuth2"** → **"URL Generator"**
2. Under **Scopes** check: `bot` and `applications.commands`
3. Under **Bot Permissions** check:
   - `Read Messages/View Channels`
   - `Send Messages`
   - `Embed Links`
   - `Attach Files`
   - `Manage Threads`
   - `Create Private Threads`
   - `Read Message History`
4. Copy the generated URL at the bottom → open it in your browser
5. Select your **Elevate** server → click **Authorize**

---

## Step 3 — Get Your IDs

You need to enable **Developer Mode** in Discord first:
- Discord Settings → Advanced → **Developer Mode** → ON

Then:
- **Guild ID**: Right-click your server name → **Copy Server ID**
- **Channel IDs**: Right-click any channel → **Copy Channel ID**

Create these 3 channels in your server if you haven't already:
| Channel | Purpose |
|---|---|
| `#welcome` | Where welcome cards are posted |
| `#trading-journal` | Where private journal threads live |
| `#economic-calendar` | Where the weekly calendar is posted |

---

## Step 4 — Install Node.js

1. Go to **https://nodejs.org**
2. Download the **LTS version** (the one that says "Recommended for most users")
3. Install it — just click through the installer
4. Open **Terminal** (Mac) or **Command Prompt** (Windows) and type:
   ```
   node --version
   ```
   You should see something like `v20.x.x` ✅

---

## Step 5 — Set Up the Bot Files

1. Download or unzip the bot folder you received
2. Add the **Elevate logo** (`logo.png`) to the `assets/` folder inside the bot folder
3. Find the file called `.env.example` and **rename it to `.env`**
4. Open `.env` with any text editor and fill it in:

```
BOT_TOKEN=paste_your_bot_token_here
GUILD_ID=paste_your_server_id_here
WELCOME_CHANNEL_ID=paste_welcome_channel_id
JOURNAL_CHANNEL_ID=paste_journal_channel_id
CALENDAR_CHANNEL_ID=paste_calendar_channel_id
```

---

## Step 6 — Install & Run

Open Terminal / Command Prompt **inside the bot folder**, then run:

```bash
# Install dependencies (only needed once)
npm install

# Start the bot
npm start
```

You should see:
```
✅ Elevate Bot online as Elevate Bot#1234
✅ Slash commands registered.
📅 Weekly calendar scheduled: Sunday 7PM ET
```

**Your bot is live!** 🎉

---

## Step 7 — Keep It Running (Free Hosting)

Since you don't want it running on your computer 24/7, use **Railway** (free):

1. Go to **https://railway.app** and sign up with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Push your bot folder to a GitHub repo first (or use Railway's file upload)
4. In Railway, go to your project → **Variables** → add all your `.env` values there
5. Railway will keep your bot running automatically 24/7 for free

> **Alternative free options**: Render.com, Fly.io

---

## Slash Commands Reference

| Command | What it does |
|---|---|
| `/journal log` | Log a new trade (pair, direction, result, P&L, notes) |
| `/journal view` | Get a link to your private journal thread |
| `/journal stats` | See your win rate, total P&L, best/worst trade |
| `/calendar` | Manually trigger the weekly calendar post (admin) |

---

## Folder Structure

```
elevate-bot/
├── index.js              ← Main bot file
├── welcomeCard.js        ← Welcome image generator
├── economicCalendar.js   ← Weekly calendar logic
├── journal.js            ← Trading journal commands
├── commands.js           ← Slash command definitions
├── package.json          ← Dependencies
├── .env                  ← Your secret tokens (never share this)
├── assets/
│   └── logo.png          ← Put your Elevate logo here
└── data/
    └── journals.json     ← Auto-created, stores all trade data
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Bot is online but doesn't respond | Make sure slash commands are registered — wait 1 min after first start |
| Welcome card not posting | Check `WELCOME_CHANNEL_ID` in `.env` is correct |
| Calendar not posting | Check `CALENDAR_CHANNEL_ID` and that the bot has Send Messages permission |
| `canvas` install error on Windows | Run `npm install --build-from-source canvas` or install Visual Studio Build Tools |
| Missing permissions error | Re-invite the bot using Step 2 with all permissions checked |

---

*Built for Elevate 🪽 — questions? DM your server admin.*
