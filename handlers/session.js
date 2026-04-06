const {
  default: makeWASocket,
  DisconnectReason,
  delay,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const { useMongoDBAuthState } = require('mongo-baileys')
const { MongoClient }         = require('mongodb')
const { Boom }                = require('@hapi/boom')
const pino                    = require('pino')
const qrcode                  = require('qrcode')
const { handleCommand }       = require('./commands')

const logger = pino({ level: 'silent' })

// Global maps
const sessions = new Map()  // number → sock
const qrStore  = new Map()  // number → base64 QR

// ── MONGODB CONNECTION ──
let mongoClient = null
let db          = null

async function connectMongo() {
  if (db) return db
  mongoClient = new MongoClient(process.env.MONGODB_URI)
  await mongoClient.connect()
  db = mongoClient.db('voterbot')
  console.log('[MONGO] ✅ Connected to MongoDB Atlas')
  return db
}

// ── GET MONGO COLLECTION FOR A NUMBER ──
async function getAuthCollection(number) {
  const database = await connectMongo()
  return database.collection(`session_${number}`)
}

// ── CREATE / RESTORE A SESSION ──
async function createSession(number) {
  if (sessions.has(number)) {
    console.log(`[SESSION] Already connected: ${number}`)
    return sessions.get(number)
  }

  const collection            = await getAuthCollection(number)
  const { state, saveCreds }  = await useMongoDBAuthState(collection)
  const { version }           = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth              : state,
    logger,
    printQRInTerminal : false,
    browser           : ['VOTER Bot', 'Chrome', '20.0.04'],
    connectTimeoutMs  : 60000,
    defaultQueryTimeoutMs : 0,
    keepAliveIntervalMs   : 10000,
    markOnlineOnConnect   : false,
    syncFullHistory       : false
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
        // Logged out — drop mongo collection
        console.log(`[SESSION] 🚫 Logged out, removing: ${number}`)
        const col = await getAuthCollection(number)
        await col.drop().catch(() => {})
      }
    }
  })

  // Listen for commands
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

  const collection            = await getAuthCollection(number)
  const { state, saveCreds }  = await useMongoDBAuthState(collection)
  const { version }           = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth              : state,
    logger,
    printQRInTerminal : false,
    browser           : ['VOTER Bot', 'Chrome', '20.0.04'],
    connectTimeoutMs  : 60000,
    defaultQueryTimeoutMs : 0,
    keepAliveIntervalMs   : 10000,
    markOnlineOnConnect   : false,
    syncFullHistory       : false
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
        const col = await getAuthCollection(number)
        await col.drop().catch(() => {})
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

// ── RESTORE ALL SESSIONS FROM MONGODB ON STARTUP ──
async function restoreAllSessions() {
  try {
    const database    = await connectMongo()
    const collections = await database.listCollections().toArray()
    const sessCols    = collections
      .map(c => c.name)
      .filter(n => n.startsWith('session_'))

    console.log(`[SESSION] Restoring ${sessCols.length} session(s) from MongoDB...`)

    for (const colName of sessCols) {
      const number = colName.replace('session_', '')
      try {
        await createSession(number)
        await delay(2500)
      } catch (e) {
        console.error(`[SESSION] Failed to restore ${number}:`, e.message)
      }
    }
  } catch (e) {
    console.error('[MONGO] restoreAllSessions error:', e.message)
  }
}

module.exports = { sessions, qrStore, createSession, createSessionWithPairing, restoreAllSessions }
