// External Libraries
const path = require("path")
const fs = require("fs")
const { performance } = require("perf_hooks")
const {
  saveAllMessages,
  loadMessages,
    testConnection,
  allMessages,
    deleteMessageById,
  createMessagesTable,
  processedDeletedMessages,
  initializeApp,
  saveDatabase,
  db,
  vote,
      findMessageById, 
   getAllMessages,
   deletedMessages,
  kuismath,
  pool,
  waitForData,
  ensureDataLoaded,
  isDataLoaded,
} = require("./database")
const { exec } = require("child_process")
const { pipeline } = require("stream")
const request = require("request")
const { search, downloadTrack, downloadAlbum } = require("@nechlophomeriaa/spotifydl")
const { promisify } = require("util")
const simple = require("./simple")
const { sinhalaSub } = require("mrnima-moviedl")
exports.pino = require("pino")
exports.simple = simple
exports.Boom = require("@hapi/boom")
exports.chalk = require("chalk")
exports.axios = require("axios")
exports.fs = require("fs")
exports.path = require("path")
exports.util = require("util")
exports.moment = require("moment-timezone")
exports.cron = require("node-cron")
exports.speed = require("performance-now")
exports._ = require("lodash")
exports.archiver = require("archiver")
exports.youtubedl = require("youtube-dl-exec")
exports.promisify = promisify
exports.https = require("https")
exports.sharp = require("sharp")
exports.sinhalaSub = sinhalaSub
exports.FileType = require("file-type")
exports.yargs = require("yargs/yargs")
exports.PhoneNumber = require("awesome-phonenumber")
exports.NodeCache = require("node-cache")
exports.readline = require("readline")
exports.dotenv = require("dotenv")
exports.search = search
exports.downloadTrack = downloadTrack
exports.downloadAlbum = downloadAlbum
exports.custom = "PAULCODE"
exports.querystring = require("querystring")
exports.chokidar = require("chokidar")
exports.moment = require("moment-timezone")
exports.speed = require("performance-now")
exports.exec = exec
exports.crypto = require("crypto")
exports.spawn = require("child_process")
exports.fetch = require("node-fetch")
exports.execSync = require("child_process")
const globalGroupCache = new Map()
exports.globalGroupCache = globalGroupCache
// Fix Baileys imports - using proper paths
const { default: makeWASocket } = require("baileys")
const { makeInMemoryStore } = require("baileys")
const {
  BufferJSON,
  delay,
  PHONENUMBER_MCC,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateForwardMessageContent,
  prepareWAMessageMedia,
  generateWAMessageFromContent,
  generateMessageID,
  downloadContentFromMessage,
  jidDecode,
  proto,
  Browsers,
  generateWAMessage,
  areJidsSameUser,
  generateWAMessageContent,
  jidNormalizedUser,
  getAggregateVotesInPollMessage,
    downloadMediaMessage,
    getContentType
} = require("baileys")
// Export Baileys functions
exports.XeonBotIncConnect = makeWASocket
exports.getContentType = getContentType
exports.downloadMediaMessage = downloadMediaMessage
exports.jidNormalizedUser = jidNormalizedUser
exports.getAggregateVotesInPollMessage = getAggregateVotesInPollMessage
exports.makeWASocket = makeWASocket
exports.BufferJSON = BufferJSON
exports.delay = delay
exports.pipeline = pipeline
exports.PHONENUMBER_MCC = PHONENUMBER_MCC
exports.makeCacheableSignalKeyStore = makeCacheableSignalKeyStore
exports.useMultiFileAuthState = useMultiFileAuthState
exports.DisconnectReason = DisconnectReason
exports.fetchLatestBaileysVersion = fetchLatestBaileysVersion
exports.generateForwardMessageContent = generateForwardMessageContent
exports.prepareWAMessageMedia = prepareWAMessageMedia
exports.generateWAMessageFromContent = generateWAMessageFromContent
exports.generateMessageID = generateMessageID
exports.downloadContentFromMessage = downloadContentFromMessage
exports.jidDecode = jidDecode
exports.proto = proto
exports.Browsers = Browsers
exports.generateWAMessage = generateWAMessage
exports.areJidsSameUser = areJidsSameUser
exports.generateWAMessageContent = generateWAMessageContent

// Custom store implementation instead of makeInMemoryStore
class SimpleStore {
  constructor(logger) {
    this.messages = {}
    this.contacts = {}
    this.groups = {}
    this.groupMetadata = {}
    this.logger = logger || console
  }

  async loadMessage(jid, id) {
    if (!this.messages[jid]) return null
    return this.messages[jid][id]
  }

  async saveMessage(message) {
    if (!message.key) return
    const jid = message.key.remoteJid
    const id = message.key.id

    if (!this.messages[jid]) this.messages[jid] = {}
    this.messages[jid][id] = message
  }

  bind(ev) {
    ev.on("messages.upsert", ({ messages }) => {
      for (const message of messages) {
        this.saveMessage(message)
      }
    })

    ev.on("contacts.update", (updates) => {
      for (const contact of updates) {
        if (!contact.id) continue
        this.contacts[contact.id] = {
          ...(this.contacts[contact.id] || {}),
          ...contact,
        }
      }
    })

    ev.on("contacts.upsert", (updates) => {
      for (const contact of updates) {
        if (!contact.id) continue
        this.contacts[contact.id] = {
          ...(contact || {}),
          isContact: true,
        }
      }
    })

    ev.on("groups.update", (updates) => {
      for (const update of updates) {
        if (!update.id) continue
        this.groups[update.id] = {
          ...(this.groups[update.id] || {}),
          ...update,
        }
      }
    })

    this.logger.info("Store bound to events")
  }

  // Enhanced event binding with full WhatsApp integration
  bindEnhancedEvents(sock, store, groupCache, saveCreds) {
    //=====[ Setelah Pembaruan Koneksi ]========//
    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("contacts.update", (update) => {
      for (const contact of update) {
        const id = jidNormalizedUser(contact.id)
        if (store && store.contacts)
          store.contacts[id] = {
            ...(store.contacts?.[id] || {}),
            ...(contact || {}),
          }
      }
    })

    sock.ev.on("contacts.upsert", (update) => {
      for (const contact of update) {
        const id = jidNormalizedUser(contact.id)
        if (store && store.contacts) store.contacts[id] = { ...(contact || {}), isContact: true }
      }
    })

    sock.ev.on("groups.update", async (updates) => {
      for (const update of updates) {
        const id = update.id
        try {
          const metadata = await sock.groupMetadata(id)
          groupCache.set(id, metadata)
          if (store.groupMetadata[id]) {
            store.groupMetadata[id] = {
              ...(store.groupMetadata[id] || {}),
              ...(update || {}),
            }
          }
        } catch (error) {
          console.log(`Could not fetch group metadata for ${id}:`, error.message)
        }
      }
    })

    sock.ev.on("group-participants.update", ({ id, participants, action }) => {
      const metadata = store.groupMetadata[id]
      if (metadata) {
        groupCache.set(id, metadata)
        switch (action) {
          case "add":
          case "revoked_membership_requests":
            metadata.participants.push(
              ...participants.map((id) => ({
                id: jidNormalizedUser(id),
                admin: null,
              })),
            )
            break
          case "demote":
          case "promote":
            for (const participant of metadata.participants) {
              const participantId = jidNormalizedUser(participant.id)
              if (participants.includes(participantId)) {
                participant.admin = action === "promote" ? "admin" : null
              }
            }
            break
          case "remove":
            metadata.participants = metadata.participants.filter((p) => !participants.includes(jidNormalizedUser(p.id)))
            break
        }
      }
    })

    // getMessage function
    const getMessage = async (key) => {
      if (store) {
        const msg = await store.loadMessage(key.remoteJid, key.id)
        return msg
      }
      return {
        conversation: "BOT",
      }
    }

    // UPDATED: Store ALL messages for ALL users without filtering
    sock.ev.on("messages.upsert", async (cht) => {
      try {
        if (cht.messages.length === 0) return

        for (const chatUpdate of cht.messages) {
          if (!chatUpdate.message && !chatUpdate.key) continue

          const userId = chatUpdate.key.id

          // Store ALL messages - remove any filtering based on fromMe or other criteria
          await store.saveMessage(chatUpdate)

          // Also save to database using the new system
          if (typeof saveAllMessages !== "undefined") {
            const messageData = {
              id: chatUpdate.key.id,
              from: chatUpdate.key.remoteJid,
              sender: chatUpdate.key.participant || chatUpdate.key.remoteJid,
              timestamp: chatUpdate.messageTimestamp || Math.floor(Date.now() / 1000),
              sessionId: sock.sessionId || "unknown",
              userId: sock.userId || sock.user?.id || "unknown",
              content:
                chatUpdate.message?.conversation ||
                chatUpdate.message?.extendedTextMessage?.text ||
                chatUpdate.message?.imageMessage?.caption ||
                chatUpdate.message?.videoMessage?.caption ||
                "",
              media:
                chatUpdate.message?.imageMessage ||
                chatUpdate.message?.videoMessage ||
                chatUpdate.message?.audioMessage ||
                chatUpdate.message?.documentMessage ||
                null,
              mediaType: chatUpdate.message?.imageMessage
                ? "image"
                : chatUpdate.message?.videoMessage
                  ? "video"
                  : chatUpdate.message?.audioMessage
                    ? "audio"
                    : chatUpdate.message?.documentMessage
                      ? "document"
                      : null,
            }

            console.log(`📝 Storing message for session: ${messageData.sessionId}, user: ${messageData.userId}`)
            await saveAllMessages([messageData])
          }
        }
      } catch (error) {
        console.log("Error processing message:", error.message)
      }
    })

    sock.ev.on("messages.update", async (chatUpdate) => {
      try {
        for (const { key, update } of chatUpdate) {
          if (update.pollUpdates) {
            const pollCreation = await getMessage(key)
            if (pollCreation) {
              const pollUpdate = await getAggregateVotesInPollMessage({
                message: pollCreation?.message,
                pollUpdates: update.pollUpdates,
              })
              const toCmd = pollUpdate.filter((v) => v.voters.length !== 0)[0]?.name
              console.log(toCmd)

              // Assuming appenTextMessage is a function that needs to be defined elsewhere
              // For now, it's commented out as it's not declared
              // if (typeof appenTextMessage !== 'undefined') {
              //     await appenTextMessage(m, sock, toCmd, pollCreation);
              // }
              await sock.sendMessage(key.remoteJid, { delete: key })
            } else return false
            return
          }
        }
      } catch (error) {
        console.log("Error processing message update:", error.message)
      }
    })
  }
}

// Export the custom store instead of makeInMemoryStore
exports.SimpleStore = SimpleStore

// Export the custom store instead of makeInMemoryStore
exports.store = new SimpleStore(
  require("pino")().child({
    level: "silent",
    stream: "store",
  }),
)

// Custom Utilities and Libraries
exports.os = require("os")
exports.fsx = require("fs-extra")
exports.color = require("./color").color
exports.randomBytes = require("crypto").randomBytes
exports.gis = require("g-i-s")
exports.cheerio = require("cheerio")
exports.smsg = require("./myfunc").smsg
exports.isUrl = require("./myfunc").isUrl
exports.sleep = require("./myfunc").sleep
exports.getSizeMedia = require("./myfunc").getSizeMedia
exports.getBuffer = require("./myfunc").getBuffer
exports.delay = require("./myfunc").delay
exports.format = require("./myfunc").format
exports.logic = require("./myfunc").logic
exports.runtime = require("./myfunc").runtime
exports.pickRandom = require("./myfunc").pickRandom
exports.getGroupAdmins = require("./myfunc").getGroupAdmins
exports.formatp = require("./myfunc").formatp
exports.formatDate = require("./myfunc").formatDate
exports.getTime = require("./myfunc").getTime
exports.clockString = require("./myfunc").clockString
exports.msToDate = require("./myfunc").msToDate
exports.sort = require("./myfunc").sort
exports.ms = require("ms")
exports.toNumber = require("./myfunc").toNumber
exports.enumGetKey = require("./myfunc").enumGetKey
exports.fetchJson = require("./myfunc").fetchJson
exports.json = require("./myfunc").json
exports.generateProfilePicture = require("./myfunc").generateProfilePicture
exports.parseMention = require("./myfunc").parseMention
exports.getRandom = require("./myfunc").getRandom
exports.buffergif = require("./myfunc").buffergif
exports.GIFBufferToVideoBuffer = require("./myfunc").GIFBufferToVideoBuffer
exports.totalcase = require("./myfunc").totalcase
exports.drbx = require("./googleDriveUtil")
// File Uploads and Media Conversion
const pkg = require("imgur")
const { ImgurClient } = pkg
exports.uploadImage = require("./uploadImage")
exports.client = new ImgurClient({ clientId: "a0113354926015a" })
exports.videoProcessor = require("fluent-ffmpeg")
exports.ffmpegStatic = require("ffmpeg-static")
exports.ffmpegPath = require("ffmpeg-static")
exports.yts = require("yt-search")
exports.youtubedl = require("youtube-dl-exec")
exports.ImgurClient = require("imgur").ImgurClient
exports.myFFmpeg = require("fluent-ffmpeg")
exports.xdl = require("fluent-ffmpeg")
exports.ytdlCore = require("@distube/ytdl-core")
exports.ffmpeg = require("fluent-ffmpeg")
// Scrapers and Downloaders
exports.xvideosSearch = require("./scraper3.js").xvideosSearch
exports.xvideosdl = require("./scraper3.js").xvideosdl
exports.xnxxdl = require("./scraper3.js").xnxxdl
exports.xnxxSearch = require("./scraper3.js").xnxxSearch
exports.download = require("aptoide-scraper").download
exports.xeon_antispam = require("./antispam").xeon_antispam
exports.scp2 = require("./scraper2")

// Media Converters
exports.toAudio = require("./converter").toAudio
exports.toPTT = require("./converter").toPTT
exports.toVideo = require("./converter").toVideo
exports.ffmpeg = require("./converter").ffmpeg
exports.addExifAvatar = require("./converter").addExifAvatar
exports.webp2mp4File = require("./uploader").webp2mp4File
exports.floNime = require("./uploader").floNime
exports.TelegraPh = require("./uploader").TelegraPh
exports.imageToWebp = require("./exif").imageToWebp
exports.videoToWebp = require("./exif").videoToWebp
exports.writeExifImg = require("./exif").writeExifImg
exports.writeExifVid = require("./exif").writeExifVid

// Premium Features
exports.addPremiumUser = require("./premiun").addPremiumUser
exports.getPremiumExpired = require("./premiun").getPremiumExpired
exports.getPremiumPosition = require("./premiun").getPremiumPosition
exports.expiredPremiumCheck = require("./premiun").expiredPremiumCheck
exports.checkPremiumUser = require("./premiun").checkPremiumUser
exports.getAllPremiumUser = require("./premiun").getAllPremiumUser

// Response List
exports.addResponList = require("./list").addResponList
exports.delResponList = require("./list").delResponList
exports.isAlreadyResponList = require("./list").isAlreadyResponList
exports.isAlreadyResponListGroup = require("./list").isAlreadyResponListGroup
exports.sendResponList = require("./list").sendResponList
exports.updateResponList = require("./list").updateResponList
exports.getDataResponList = require("./list").getDataResponList

// Configuration & Data Files
exports.ntnsfw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "data", "function", "nsfw.json")))
exports.bad = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "data", "function", "badword.json")))
exports.premium = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "data", "role", "premium.json")))
exports.owner = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "data", "role", "owner.json")))
exports.xeonverifieduser = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "data", "role", "user.json")))

// Xeon Media
exports.VoiceNoteXeon = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "XeonMedia", "database", "xeonvn.json")))
exports.StickerXeon = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "XeonMedia", "database", "xeonsticker.json")),
)
exports.ImageXeon = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "XeonMedia", "database", "xeonimage.json")))
exports.DocXeon = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "XeonMedia", "database", "doc.json")))
exports.ApkXeon = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "XeonMedia", "database", "apk.json")))

// Xeon Text Data
exports.xeontext1 = require(path.join(__dirname, "..", "src", "data", "function", "XBug", "xeontext1")).xeontext1
exports.xeontext2 = require(path.join(__dirname, "..", "src", "data", "function", "XBug", "xeontext2")).xeontext2
exports.xeontext3 = require(path.join(__dirname, "..", "src", "data", "function", "XBug", "xeontext3")).xeontext3
exports.xeontext4 = require(path.join(__dirname, "..", "src", "data", "function", "XBug", "xeontext4")).xeontext4
exports.xeontext5 = require(path.join(__dirname, "..", "src", "data", "function", "XBug", "xeontext5")).xeontext5
exports.xeontext6 = require(path.join(__dirname, "..", "src", "data", "function", "XBug", "xeontext6")).xeontext6

// Files
exports.wkwk = fs.readFileSync(path.join(__dirname, "..", "src", "data", "function", "XBug", "x.mp3"))
exports.xsteek = fs.readFileSync(path.join(__dirname, "..", "src", "data", "function", "XBug", "x.webp"))
exports.db_respon_list = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "store", "list.json")))
// Other Constants
exports.lastUsed = 0
exports.more = String.fromCharCode(8206)
exports.readmore = exports.more.repeat(4001)

// Export using exports
exports.saveAllMessages = saveAllMessages
exports.loadMessages = loadMessages
exports.allMessages = allMessages
exports.pool = pool
exports.findMessageById = findMessageById 
 exports.getAllMessages = getAllMessages
 exports.deletedMessages = deletedMessages
exports.createMessagesTable = createMessagesTable
exports.processedDeletedMessages = processedDeletedMessages
exports.initializeApp = initializeApp
exports.saveDatabase = saveDatabase
exports.isDataLoaded = isDataLoaded
exports.ensureDataLoaded = ensureDataLoaded
exports.waitForData = waitForData
exports.db = db
exports.vote = vote
exports.testConnection = testConnection
exports.kuismath = kuismath
exports.performance = performance
exports.deleteMessageById = deleteMessageById
exports.tikdown = require("shaon-videos-downloader").tikdown
exports.ytdown = require("shaon-videos-downloader").ytdown
exports.twitterdown = require("shaon-videos-downloader").twitterdown
exports.request = request
exports.fbdown2 = require("shaon-videos-downloader").fbdown2
exports.GDLink = require("shaon-videos-downloader").GDLink
exports.capcut = require("shaon-videos-downloader").capcut
exports.likee = require("shaon-videos-downloader").likee
exports.threads = require("shaon-videos-downloader").threads
exports.ndown = require("shaon-videos-downloader").ndown
exports.alldown = require("shaon-videos-downloader").alldown
exports.key = "Nayan"
// Function to identify the platform based on URL
exports.geturl = (url) => {
  if (/tiktok\.com|vm\.tiktok/.test(url)) return "tiktok"
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube"
  if (/twitter\.com|x\.com/.test(url)) return "twitter"
  if (/facebook\.com|fb\.watch/.test(url)) return "facebook"
  if (/drive\.google\.com/.test(url)) return "gdrive"
  if (/capcut\.app/.test(url)) return "capcut"
  if (/likee\.video/.test(url)) return "likee"
  if (/threads\.net/.test(url)) return "threads"
  if (/instagram\.com/.test(url)) return "instagram"
  return "unknown"
}
exports.downloadvideo = require("./mediafire")
