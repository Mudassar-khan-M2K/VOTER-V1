const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  delay,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const { Boom } = require('@hapi/boom')
const pino = require('pino')
const fs = require('fs')
const path = require('path')
const qrcode = require('qrcode')
const { handleCommand } = require('./commands')

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions')
const logger = pino({ level: 'silent' })

// Global maps - exported so other files can read them
const sessions = new Map()   // number → sock
const qrStore  = new Map()   // number → base64 QR

// ── CREATE / RESTORE A SESSION ──
async function createSession(number) {
  if (sessions.has(number)) {
    console.log(`[SESSION] Already connected: ${number}`)
    return sessions.get(number)
  }

  const sessDir = path.join(SESSIONS_DIR, number)
  if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['VOTER Bot', 'Chrome', '20.0.04'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000,
    markOnlineOnConnect: false,
    syncFullHistory: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    // QR generated
    if (qr) {
      try {
        const base64 = await qrcode.toDataURL(qr)
        qrStore.set(number, base64)
        console.log(`[SESSION] QR ready: ${number}`)
      } catch (e) {
        console.error('[SESSION] QR error:', e.message)
      }
    }

    // Connected
    if (connection === 'open') {
      console.log(`[SESSION] ✅ Connected: ${number}`)
      sessions.set(number, sock)
      qrStore.delete(number)
    }

    // Disconnected
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode
      console.log(`[SESSION] ❌ Disconnected: ${number} code=${code}`)
      sessions.delete(number)

      if (code !== DisconnectReason.loggedOut) {
        console.log(`[SESSION] 🔄 Reconnecting: ${number}`)
        await delay(4000)
        createSession(number)
      } else {
        // Logged out — delete session files
        console.log(`[SESSION] 🚫 Logged out, removing: ${number}`)
        fs.rmSync(sessDir, { recursive: true, force: true })
      }
    }
  })

  // Listen for commands on every message
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      try {
        await handleCommand(msg, sock, sessions)
      } catch (e) {
        console.error('[SESSION] handleCommand error:', e.message)
      }
    }
  })

  sessions.set(number, sock)
  return sock
}

// ── PAIRING CODE FLOW ──
async function createSessionWithPairing(number) {
  if (sessions.has(number)) {
    throw new Error('Number already connected!')
  }

  const sessDir = path.join(SESSIONS_DIR, number)
  if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['VOTER Bot', 'Chrome', '20.0.04'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000,
    markOnlineOnConnect: false,
    syncFullHistory: false
  })

  sock.ev.on('creds.update', saveCreds)

  let pairCode = null
  let codeDone = false

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update

    // Request pairing code once
    if (!codeDone && !sock.authState.creds.registered) {
      codeDone = true
      await delay(1500)
      try {
        pairCode = await sock.requestPairingCode(number)
        console.log(`[SESSION] Pair code for ${number}: ${pairCode}`)
      } catch (e) {
        console.error('[SESSION] requestPairingCode error:', e.message)
      }
    }

    if (connection === 'open') {
      console.log(`[SESSION] ✅ Paired: ${number}`)
      sessions.set(number, sock)

      // Attach command listener after pairing
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return
        for (const msg of messages) {
          try {
            await handleCommand(msg, sock, sessions)
          } catch (e) {
            console.error('[SESSION] handleCommand error:', e.message)
          }
        }
      })
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode
      sessions.delete(number)
      if (code !== DisconnectReason.loggedOut) {
        await delay(4000)
        createSession(number)
      } else {
        fs.rmSync(sessDir, { recursive: true, force: true })
      }
    }
  })

  // Wait up to 20s for pairing code
  for (let i = 0; i < 40; i++) {
    await delay(500)
    if (pairCode) break
  }

  if (!pairCode) throw new Error('Could not generate pairing code. Try again.')
  return pairCode
}

// ── RESTORE ALL SAVED SESSIONS ON STARTUP ──
async function restoreAllSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true })
    return
  }

  const folders = fs.readdirSync(SESSIONS_DIR).filter(f =>
    fs.statSync(path.join(SESSIONS_DIR, f)).isDirectory()
  )

  console.log(`[SESSION] Restoring ${folders.length} session(s)...`)

  for (const num of folders) {
    try {
      await createSession(num)
      await delay(2500)
    } catch (e) {
      console.error(`[SESSION] Failed to restore ${num}:`, e.message)
    }
  }
}

module.exports = { sessions, qrStore, createSession, createSessionWithPairing, restoreAllSessions }
