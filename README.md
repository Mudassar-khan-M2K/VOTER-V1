# VOTER-V1
VOTER - Multi-Session WhatsApp Poll &amp; Reaction Bot by Mudassar Khan
## What is VOTER?
VOTER is a multi-session WhatsApp bot that lets your group
of friends coordinate votes on channel polls and reactions
on channel posts — all from a single command.

---

## 📁 Project Structure

voter-bot/
├── index.js              → Main server (Express + API routes)
├── package.json          → Dependencies
├── Procfile              → Heroku deployment
├── .gitignore
├── sessions/             → Auto-created. Stores each user's
│   └── .gitkeep            WhatsApp session files
├── handlers/
│   ├── session.js        → Session create / restore / pair / QR
│   └── commands.js       → All bot commands logic
└── web/
    └── index.html        → Web dashboard UI

---

## ⚙️ Installation

1. Extract the ZIP
2. Open folder in terminal
3. Run:

   npm install

4. Start the bot:

   npm start

5. Open browser:

   http://localhost:3000

---

## 🔗 How to Connect Your WhatsApp

### Method 1 — Pairing Code (Recommended)
1. Go to dashboard → Enter your number with country code
   Example: 923001234567
2. Click "Get Pairing Code"
3. Open WhatsApp on your phone
4. Go to: ⋮ Menu → Linked Devices → Link a Device
5. Tap "Link with phone number"
6. Enter the code shown on dashboard
7. Done! ✅

### Method 2 — QR Code
1. Go to dashboard → Switch to QR tab
2. Enter your number → Click "Generate QR"
3. Scan with WhatsApp → Linked Devices
4. Done! ✅

---

## 📋 Commands

All commands work from anywhere:
- Your own DM with the bot
- Any group
- Anyone's personal chat

.poll <channel_poll_link> <option_number>
   Vote on a WhatsApp channel poll.
   ALL connected sessions vote on that option.
   5 second delay between each vote.
   Example: .poll https://whatsapp.com/channel/xxx/yyy 2

.react <channel_post_link> <emoji>
   React to a WhatsApp channel post.
   ALL sessions react with that emoji.
   Example: .react https://whatsapp.com/channel/xxx/yyy 🔥

.status
   Shows how many sessions are active + stats.

.ping
   Check if bot is alive + response latency.

.alive
   Full bot status: sessions, votes, reactions, uptime.

.help
   Shows command menu inside WhatsApp.

---

## 🚀 Deploy to Heroku

1. Make sure Heroku CLI is installed
2. Run these commands:

   git init
   git add .
   git commit -m "VOTER Bot v1.0"
   heroku create your-voter-bot
   git push heroku main

3. Open:

   heroku open

⚠️ NOTE: Heroku free tier clears the filesystem on restart.
Sessions will disconnect after each dyno restart.
For persistent sessions, use a paid dyno or add
Heroku Postgres / Redis for session storage.

---

## 📦 Dependencies

- @whiskeysockets/baileys  → WhatsApp Web API
- express                  → Web server
- pino                     → Logger
- qrcode                   → QR code generator
- @hapi/boom               → Error handling

---

## 👨‍💻 Developer

Name    : Mudassar Khan
Contact : +923216046022
Location: Mianwali, Pakistan
GitHub  : Mudassar-khan-M2K

---

## ⚠️ Disclaimer

This bot uses Baileys which is an unofficial WhatsApp Web API.
Use responsibly. Do not spam.
