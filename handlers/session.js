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

const sessions = new Map()
const qrStore  = new Map()

// ── CREATE / RESTORE A SESSION (QR flow) ──
async function createSession(number) {
  if (sessions.has(number)) {
    console.log(`[SESSION] Already connected: ${number}`)
    return sessions.get(number)
  }

  const sessDir = path.join(SESSIONS_DIR, number)
  if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessDir)
  const version = [2, 3000, 1015901307]

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '134.0.0'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 15000,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistory: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      try {
        const base64 = await qrcode.toDataURL(qr)
        qrStore.set(number, base64)
        console.log(`[SESSION] QR ready: ${number}`)
      } catch (e) {
        console.error('[SESSION] QR error:', e.message)
      }
    }

    if (connection === 'open') {
      console.log(`[SESSION] ✅ Connected: ${number}`)
      sessions.set(number, sock)
      qrStore.delete(number)
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode
      console.log(`[SESSION] ❌ Disconnected: ${number} code=${code}`)
      sessions.delete(number)

      if (code !== DisconnectReason.loggedOut) {
        console.log(`[SESSION] 🔄 Reconnecting: ${number}`)
        await delay(5000)
        createSession(number)
      } else {
        console.log(`[SESSION] 🚫 Logged out, removing: ${number}`)
        fs.rmSync(sessDir, { recursive: true, force: true })
      }
    }
  })

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
    throw new Error(`Number ${number} already connected!`)
  }

  const cleanNumber = number.replace(/[^0-9]/g, '')

  const sessDir = path.join(SESSIONS_DIR, cleanNumber)
  if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessDir)
  const version = [2, 3000, 1015901307]

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '134.0.0'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 15000,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistory: false
  })

  sock.ev.on('creds.update', saveCreds)

  let pairingCode = null
  let isPairingRequested = false

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (!isPairingRequested && !sock.authState.creds.registered && (qr || connection === 'connecting')) {
      isPairingRequested = true
      console.log(`[SESSION] Requesting pairing code for ${cleanNumber}`)

      await delay(5000)

      try {
        pairingCode = await sock.requestPairingCode(cleanNumber)
        console.log(`[SESSION] ✅ Pairing code for ${cleanNumber}: ${pairingCode}`)
      } catch (e) {
        console.error(`[SESSION] requestPairingCode failed:`, e.message)
        if (e.output?.statusCode === 428 || e.message.includes('Connection Closed')) {
          console.log('[SESSION] Retrying pairing after delay...')
          await delay(8000)
          isPairingRequested = false
        }
      }
    }

    if (connection === 'open') {
      console.log(`[SESSION] ✅ Paired: ${cleanNumber}`)
      sessions.set(cleanNumber, sock)
      qrStore.delete(cleanNumber)

      if (!sock.listeners('messages.upsert').length) {
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
          if (type !== 'notify') return
          for (const msg of messages) {
            try {
              await handleCommand(msg, sock, sessions)
            } catch (e) {
              console.error('[COMMAND] Error:', e.message)
            }
          }
        })
      }
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
      console.log(`[SESSION] Disconnected ${cleanNumber} | code=${statusCode}`)
      sessions.delete(cleanNumber)

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log(`[SESSION] 🔄 Reconnecting in 5s...`)
        await delay(5000)
        createSession(cleanNumber)
      } else {
        console.log(`[SESSION] 🚫 Logged out - cleaning session`)
        fs.rmSync(sessDir, { recursive: true, force: true })
      }
    }
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Pairing code timeout after 30s. Try again or use QR.'))
    }, 30000)

    const checkInterval = setInterval(() => {
      if (pairingCode) {
        clearTimeout(timeout)
        clearInterval(checkInterval)
        resolve(pairingCode)
      }
    }, 800)
  })
}

// ── RESTORE ALL SESSIONS ON STARTUP ──
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
