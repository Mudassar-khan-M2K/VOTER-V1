const express = require('express')
const path    = require('path')

const { sessions, qrStore, connectMongo, createSessionWithPairing, createSession, restoreAllSessions } = require('./handlers/session')
const { getStats } = require('./handlers/commands')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'web')))

// ══════════════════════════════
//  API ROUTES
// ══════════════════════════════

app.get('/api/stats', (req, res) => {
  const { totalVotes, totalReacts } = getStats()
  res.json({
    sessions : sessions.size,
    votes    : totalVotes,
    reacts   : totalReacts,
    numbers  : [...sessions.keys()]
  })
})

app.post('/api/pair', async (req, res) => {
  const { number } = req.body
  if (!number) return res.json({ error: 'Number is required' })

  const clean = number.replace(/\D/g, '')
  if (clean.length < 10) return res.json({ error: 'Enter a valid number with country code' })

  try {
    const code = await createSessionWithPairing(clean)
    res.json({ code })
  } catch (e) {
    console.error('[API] /pair error:', e.message)
    res.json({ error: e.message })
  }
})

app.post('/api/qr', async (req, res) => {
  const { number } = req.body
  if (!number) return res.json({ error: 'Number is required' })

  const clean = number.replace(/\D/g, '')
  if (clean.length < 10) return res.json({ error: 'Enter a valid number with country code' })

  if (sessions.has(clean)) return res.json({ error: 'Number already connected!' })

  try {
    qrStore.delete(clean)
    createSession(clean).catch(console.error)

    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (qrStore.has(clean)) break
    }

    const qr = qrStore.get(clean)
    if (qr) {
      res.json({ qr })
    } else {
      res.json({ error: 'QR not ready. Try again in a moment.' })
    }
  } catch (e) {
    console.error('[API] /qr error:', e.message)
    res.json({ error: e.message })
  }
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'))
})

// ══════════════════════════════
//  START
// ══════════════════════════════
const PORT = process.env.PORT || 3000

app.listen(PORT, async () => {
  console.log('╔══════════════════════════════╗')
  console.log('║   🗳️  VOTER BOT  v1.0         ║')
  console.log('╚══════════════════════════════╝')
  console.log(`🌐  Dashboard : http://localhost:${PORT}`)
  console.log(`👨‍💻  Dev       : Mudassar Khan — Mianwali, PK\n`)
  await connectMongo()        // ← pehle MongoDB connect
  await restoreAllSessions()  // ← phir sessions restore
})
