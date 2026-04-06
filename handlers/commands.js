const { delay } = require('@whiskeysockets/baileys')
const fs = require('fs')
const {
  detectPlatform,
  downloadYouTubeVideo,
  downloadYouTubeMP3,
  downloadTikTok,
  downloadInstagram,
  downloadPinterest,
  cleanup
} = require('./downloader')

let totalVotes  = 0
let totalReacts = 0

function getStats() {
  return { totalVotes, totalReacts }
}

const HELP_TEXT = `╔══════════════════════════╗
║   🗳️  *VOTER BOT*  v1.0   ║
╚══════════════════════════╝

*📋 COMMANDS LIST*

🗳️ *.poll* \`<link> <option>\`
_Vote on a channel poll_
_All sessions vote together!_

⚡ *.react* \`<link> <emoji>\`
_React to a channel post_
_Every account reacts instantly_

📥 *.dl* \`<link>\`
_Download from YouTube/TikTok_
_Instagram/Pinterest_

🎵 *.ytmp3* \`<youtube_link>\`
_YouTube video to MP3_

📊 *.status*
_See active sessions & stats_

🏓 *.ping*
_Check bot latency_

✅ *.alive*
_Full bot status info_

❓ *.help*
_Show this menu_

━━━━━━━━━━━━━━━━━━━━━━━━
👨‍💻 *Dev:* Mudassar Khan
📞 *Contact:* +92 305 5511844
📍 _Mianwali, Pakistan_
━━━━━━━━━━━━━━━━━━━━━━━━`

async function parseChannelLink(sock, link) {
  try {
    const url   = new URL(link)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 3 || parts[0] !== 'channel') return null

    const inviteCode = parts[1]
    const serverId   = parts[2]

    const meta = await sock.newsletterMetadata('invite', inviteCode)
    if (!meta?.id) return null

    return { newsletterJid: meta.id, serverId }
  } catch (e) {
    console.error('[CMD] parseChannelLink error:', e.message)
    return null
  }
}

async function handleCommand(msg, _sock, sessions) {
  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    ''

  if (!body.startsWith('.')) return

  const from   = msg.key.remoteJid
  const sender = (msg.key.participant || msg.key.remoteJid || '').replace('@s.whatsapp.net', '')

  const respSock = sessions.get(sender) || _sock || [...sessions.values()][0]
  if (!respSock) return

  const parts = body.trim().split(/\s+/)
  const cmd   = parts[0].toLowerCase()

  console.log(`[CMD] ${cmd} | from: ${from}`)

  // ══════════════════
  // .help
  // ══════════════════
  if (cmd === '.help') {
    await respSock.sendMessage(from, { text: HELP_TEXT }, { quoted: msg })
    return
  }

  // ══════════════════
  // .ping
  // ══════════════════
  if (cmd === '.ping') {
    const t1 = Date.now()
    await respSock.sendMessage(from, { text: '🏓 *Pinging...*' }, { quoted: msg })
    const ms = Date.now() - t1
    await respSock.sendMessage(from, {
      text: `🏓 *Pong!*\n⚡ _Latency:_ *${ms}ms*\n✅ _VOTER is alive & kicking!_`
    }, { quoted: msg })
    return
  }

  // ══════════════════
  // .alive
  // ══════════════════
  if (cmd === '.alive') {
    const uptime = process.uptime()
    const hrs  = Math.floor(uptime / 3600)
    const mins = Math.floor((uptime % 3600) / 60)
    const secs = Math.floor(uptime % 60)
    await respSock.sendMessage(from, {
      text:
`✅ *VOTER BOT is ALIVE!* 🗳️

👥 *Active Sessions:* ${sessions.size}
🗳️ *Total Votes Cast:* ${totalVotes}
⚡ *Total Reactions:* ${totalReacts}
⏱️ *Uptime:* ${hrs}h ${mins}m ${secs}s

👨‍💻 *Dev:* Mudassar Khan
📞 _+92 305 5511844_`
    }, { quoted: msg })
    return
  }

  // ══════════════════
  // .status
  // ══════════════════
  if (cmd === '.status') {
    const nums = [...sessions.keys()]
      .map(n => `• +${n}`)
      .join('\n') || '_None yet_'

    await respSock.sendMessage(from, {
      text:
`📊 *VOTER BOT STATUS*

👥 *Sessions Online:* ${sessions.size}
🗳️ *Votes Cast:* ${totalVotes}
⚡ *Reacts Sent:* ${totalReacts}

*🔗 Connected Numbers:*
${nums}`
    }, { quoted: msg })
    return
  }

  // ══════════════════
  // .poll <link> <option>
  // ══════════════════
  if (cmd === '.poll') {
    const link   = parts[1]
    const option = parseInt(parts[2])

    if (!link || isNaN(option) || option < 1) {
      await respSock.sendMessage(from, {
        text:
`❌ *Wrong format!*

*Usage:*
\`.poll <channel_poll_link> <option_number>\`

*Example:*
\`.poll https://whatsapp.com/channel/xxx/yyy 2\``
      }, { quoted: msg })
      return
    }

    await respSock.sendMessage(from, {
      text: `⏳ *Starting vote...*\n🔗 _Fetching poll info from channel..._`
    }, { quoted: msg })

    const parsed = await parseChannelLink(respSock, link)

    if (!parsed) {
      await respSock.sendMessage(from, {
        text: `❌ *Could not fetch poll!*\n_Make sure the link is a valid WhatsApp channel poll link._`
      }, { quoted: msg })
      return
    }

    const { newsletterJid, serverId } = parsed
    const optionIndex   = option - 1
    const totalSessions = sessions.size
    const sockList      = [...sessions.values()]

    await respSock.sendMessage(from, {
      text: `✅ _Poll found!_\n🗳️ _Voting option *${option}* from *${totalSessions}* sessions..._\n⏱️ _5s delay between each_`
    })

    let voteCount = 0

    for (let i = 0; i < sockList.length; i++) {
      const s = sockList[i]
      try {
        await s.newsletterVotePoll(newsletterJid, serverId, [optionIndex])
        voteCount++
        totalVotes++
        console.log(`[CMD] Poll vote ${voteCount}/${totalSessions}`)
      } catch (e) {
        console.error(`[CMD] Poll vote error [session ${i}]:`, e.message)
      }
      if (i < sockList.length - 1) await delay(5000)
    }

    await respSock.sendMessage(from, {
      text:
`🗳️ *Voting Complete!*

✅ *Voted:* ${voteCount}/${totalSessions} sessions
🎯 *Option:* ${option}
⏱️ _5s delay used between each_

_Total votes ever: ${totalVotes}_`
    }, { quoted: msg })
    return
  }

  // ══════════════════
  // .react <link> <emoji>
  // ══════════════════
  if (cmd === '.react') {
    const link  = parts[1]
    const emoji = parts[2]

    if (!link || !emoji) {
      await respSock.sendMessage(from, {
        text:
`❌ *Wrong format!*

*Usage:*
\`.react <channel_post_link> <emoji>\`

*Example:*
\`.react https://whatsapp.com/channel/xxx/yyy 🔥\``
      }, { quoted: msg })
      return
    }

    await respSock.sendMessage(from, {
      text: `⏳ *Starting reactions...*\n🔗 _Fetching post from channel..._`
    }, { quoted: msg })

    const parsed = await parseChannelLink(respSock, link)

    if (!parsed) {
      await respSock.sendMessage(from, {
        text: `❌ *Could not fetch post!*\n_Make sure the link is a valid WhatsApp channel post link._`
      }, { quoted: msg })
      return
    }

    const { newsletterJid, serverId } = parsed
    const totalSessions = sessions.size
    const sockList      = [...sessions.values()]

    await respSock.sendMessage(from, {
      text: `✅ _Post found!_\n${emoji} _Reacting from *${totalSessions}* sessions..._\n⏱️ _5s delay between each_`
    })

    let reactCount = 0

    for (let i = 0; i < sockList.length; i++) {
      const s = sockList[i]
      try {
        await s.newsletterReactMessage(newsletterJid, serverId, emoji)
        reactCount++
        totalReacts++
        console.log(`[CMD] React ${reactCount}/${totalSessions}`)
      } catch (e) {
        console.error(`[CMD] React error [session ${i}]:`, e.message)
      }
      if (i < sockList.length - 1) await delay(5000)
    }

    await respSock.sendMessage(from, {
      text:
`⚡ *Reactions Done!*

✅ *Reacted:* ${reactCount}/${totalSessions} sessions
${emoji} *Emoji:* ${emoji}
⏱️ _5s delay used between each_

_Total reactions ever: ${totalReacts}_`
    }, { quoted: msg })
    return
  }

  // ══════════════════
  // .dl <any link>
  // ══════════════════
  if (cmd === '.dl') {
    const link = parts[1]

    if (!link) {
      await respSock.sendMessage(from, {
        text:
`❌ *Link do bhai!*

*Usage:* \`.dl <link>\`

*Supported:*
▶️ YouTube
🎵 TikTok
📸 Instagram
📌 Pinterest`
      }, { quoted: msg })
      return
    }

    const platform = detectPlatform(link)

    if (!platform) {
      await respSock.sendMessage(from, {
        text: `❌ *Platform support nahi hai!*\n_Supported: YouTube, TikTok, Instagram, Pinterest_`
      }, { quoted: msg })
      return
    }

    await respSock.sendMessage(from, {
      text: `⏳ *Downloading...*\n📥 _Platform detected: ${platform}_`
    }, { quoted: msg })

    try {
      let result

      if (platform === 'youtube')   result = await downloadYouTubeVideo(link)
      if (platform === 'tiktok')    result = await downloadTikTok(link)
      if (platform === 'instagram') result = await downloadInstagram(link)
      if (platform === 'pinterest') result = await downloadPinterest(link)

      const { filePath, title } = result
      const isVideo = filePath.endsWith('.mp4')

      if (isVideo) {
        await respSock.sendMessage(from, {
          video: fs.readFileSync(filePath),
          caption: `✅ *${title}*\n\n_Downloaded by VOTER Bot_ 🗳️`
        }, { quoted: msg })
      } else {
        await respSock.sendMessage(from, {
          image: fs.readFileSync(filePath),
          caption: `✅ *${title}*\n\n_Downloaded by VOTER Bot_ 🗳️`
        }, { quoted: msg })
      }

      cleanup(filePath)

    } catch (e) {
      console.error('[DL] Error:', e.message)
      await respSock.sendMessage(from, {
        text: `❌ *Download failed!*\n_${e.message}_`
      }, { quoted: msg })
    }
    return
  }

  // ══════════════════
  // .ytmp3 <yt link>
  // ══════════════════
  if (cmd === '.ytmp3') {
    const link = parts[1]

    if (!link) {
      await respSock.sendMessage(from, {
        text: `❌ *YouTube link do!*\n\n*Usage:* \`.ytmp3 <youtube_link>\``
      }, { quoted: msg })
      return
    }

    await respSock.sendMessage(from, {
      text: `⏳ *Converting to MP3...*\n🎵 _Please wait..._`
    }, { quoted: msg })

    try {
      const { filePath, title, duration } = await downloadYouTubeMP3(link)
      const mins = Math.floor(duration / 60)
      const secs = String(duration % 60).padStart(2, '0')

      await respSock.sendMessage(from, {
        audio: fs.readFileSync(filePath),
        mimetype: 'audio/mpeg',
        ptt: false
      }, { quoted: msg })

      await respSock.sendMessage(from, {
        text: `✅ *${title}*\n⏱️ _Duration: ${mins}:${secs}_\n\n_Downloaded by VOTER Bot_ 🗳️`
      })

      cleanup(filePath)

    } catch (e) {
      console.error('[YTMP3] Error:', e.message)
      await respSock.sendMessage(from, {
        text: `❌ *Failed!*\n_${e.message}_`
      }, { quoted: msg })
    }
    return
  }
}

module.exports = { handleCommand, getStats }
