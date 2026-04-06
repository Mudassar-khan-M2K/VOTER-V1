const ytdl = require('@distube/ytdl-core')
const ffmpeg = require('fluent-ffmpeg')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')

ffmpeg.setFfmpegPath(ffmpegPath)

const TMP = path.join(__dirname, '..', 'tmp')
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })

// ── DETECT PLATFORM ──
function detectPlatform(url) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('tiktok.com')) return 'tiktok'
  if (url.includes('instagram.com')) return 'instagram'
  if (url.includes('pinterest.com') || url.includes('pin.it')) return 'pinterest'
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter'
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook'
  return null
}

// ── YOUTUBE VIDEO ──
async function downloadYouTubeVideo(url) {
  const info = await ytdl.getInfo(url)
  const title = info.videoDetails.title.replace(/[^\w\s]/gi, '').slice(0, 50)
  const filePath = path.join(TMP, `${Date.now()}_${title}.mp4`)

  return new Promise((resolve, reject) => {
    ytdl(url, { quality: 'highest', filter: 'videoandaudio' })
      .pipe(fs.createWriteStream(filePath))
      .on('finish', () => resolve({ filePath, title, duration: info.videoDetails.lengthSeconds }))
      .on('error', reject)
  })
}

// ── YOUTUBE MP3 ──
async function downloadYouTubeMP3(url) {
  const info = await ytdl.getInfo(url)
  const title = info.videoDetails.title.replace(/[^\w\s]/gi, '').slice(0, 50)
  const filePath = path.join(TMP, `${Date.now()}_${title}.mp3`)

  return new Promise((resolve, reject) => {
    const stream = ytdl(url, { quality: 'highestaudio', filter: 'audioonly' })
    ffmpeg(stream)
      .audioBitrate(128)
      .save(filePath)
      .on('end', () => resolve({ filePath, title, duration: info.videoDetails.lengthSeconds }))
      .on('error', reject)
  })
}

// ── TIKTOK ──
async function downloadTikTok(url) {
  const { Downloader } = require('@tobyg74/tiktok-api-dl')
  const result = await Downloader(url, { version: 'v1' })

  if (!result?.result?.video) throw new Error('Could not fetch TikTok video')

  const videoUrl = result.result.video[0]
  const filePath = path.join(TMP, `${Date.now()}_tiktok.mp4`)

  const res = await fetch(videoUrl)
  const buffer = await res.buffer()
  fs.writeFileSync(filePath, buffer)

  return { filePath, title: result.result.description || 'TikTok Video' }
}

// ── INSTAGRAM ──
async function downloadInstagram(url) {
  const { igdl } = require('instagram-url-direct')
  const result = await igdl(url)

  if (!result?.url?.length) throw new Error('Could not fetch Instagram media')

  const mediaUrl = result.url[0].url
  const ext = mediaUrl.includes('.mp4') ? 'mp4' : 'jpg'
  const filePath = path.join(TMP, `${Date.now()}_instagram.${ext}`)

  const res = await fetch(mediaUrl)
  const buffer = await res.buffer()
  fs.writeFileSync(filePath, buffer)

  return { filePath, title: 'Instagram Media', ext }
}

// ── PINTEREST ──
async function downloadPinterest(url) {
  const res = await fetch(`https://api.pinterest.com/v1/urls/agg?url=${encodeURIComponent(url)}`)
  // Simple fetch of image from Pinterest
  const pageRes = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  const html = await pageRes.text()
  const match = html.match(/"url":"(https:\/\/i\.pinimg\.com\/[^"]+\.jpg)"/)
  if (!match) throw new Error('Could not fetch Pinterest image')

  const imgUrl = match[1]
  const filePath = path.join(TMP, `${Date.now()}_pinterest.jpg`)
  const imgRes = await fetch(imgUrl)
  const buffer = await imgRes.buffer()
  fs.writeFileSync(filePath, buffer)

  return { filePath, title: 'Pinterest Image', ext: 'jpg' }
}

// ── CLEANUP TMP FILE ──
function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch (e) {}
}

module.exports = {
  detectPlatform,
  downloadYouTubeVideo,
  downloadYouTubeMP3,
  downloadTikTok,
  downloadInstagram,
  downloadPinterest,
  cleanup
}
