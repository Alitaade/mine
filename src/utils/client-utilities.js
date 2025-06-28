// ========================================
// ENHANCED UTILITY METHODS SYSTEM
// ========================================

const {
  fs,
  path,
  axios,
  FileType,
  jidDecode,
  PhoneNumber,
  downloadContentFromMessage,
  generateForwardMessageContent,
  generateWAMessageFromContent,
  generateWAMessage,
  areJidsSameUser,
  proto,
  getBuffer,
  getSizeMedia,
  imageToWebp,
  videoToWebp,
  writeExifImg,
  writeExifVid,
  toPTT,
  toAudio,
} = require("./imports")

class ClientUtilities {
  static addUtilityMethods(XeonBotInc) {
    this.addCoreUtilities(XeonBotInc)
    this.addMediaUtilities(XeonBotInc)
    this.addMessageUtilities(XeonBotInc)
    this.addAdvancedUtilities(XeonBotInc)
  }

  static addCoreUtilities(XeonBotInc) {
    XeonBotInc.decodeJid = (jid) => {
      if (!jid) return jid
      if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {}
        return (decode.user && decode.server && decode.user + "@" + decode.server) || jid
      } else return jid
    }

    XeonBotInc.getName = async (jid, withoutContact = false) => {
      try {
        const id = XeonBotInc.decodeJid(jid)
        const { store } = require("./store-manager")
        withoutContact = XeonBotInc.withoutContact || withoutContact
        let v

        if (id.endsWith("@g.us")) {
          v = store.contacts[id] || {}
          if (!(v.name || v.subject)) {
            try {
              // Try user-specific cache first
              const { multiUserGroupCache } = require("../core/connection-manager")
              v = multiUserGroupCache.getGroupMetadata(XeonBotInc.userId, id)
              if (!v) {
                v = await XeonBotInc.groupMetadata(id)
              }
            } catch (err) {
              v = {}
            }
          }

          let groupName = v.name || v.subject
          if (!groupName) {
            try {
              groupName = PhoneNumber("+" + id.replace("@g.us", "")).getNumber("international")
            } catch (phoneErr) {
              groupName = `Group-${id.split("@")[0].slice(-8)}`
            }
          }
          return groupName
        } else if (id.endsWith("@lid")) {
          v = store.contacts[id] || {}
          if (v.name) return v.name
          if (v.notify) return v.notify
          if (v.verifiedName) return v.verifiedName

          const lidId = id.split("@")[0]
          return `Business-${lidId.slice(-8)}`
        } else {
          v =
            id === "0@s.whatsapp.net"
              ? { id, name: "WhatsApp" }
              : id === XeonBotInc.decodeJid(XeonBotInc.user.id)
                ? XeonBotInc.user
                : store.contacts[id] || {}

          let name = (withoutContact ? "" : v.name) || v.subject || v.verifiedName

          if (!name) {
            try {
              if (id.includes("@s.whatsapp.net")) {
                const phoneNumber = jid.replace("@s.whatsapp.net", "")
                if (/^\d+$/.test(phoneNumber)) {
                  name = PhoneNumber("+" + phoneNumber).getNumber("international")
                }
              }
            } catch (phoneError) {
              name = "+" + jid.replace("@s.whatsapp.net", "")
            }
          }

          return name || `User-${id.split("@")[0].slice(-8)}`
        }
      } catch (error) {
        console.error(`Error in getName for ${jid}:`, error.message)
        const id = XeonBotInc.decodeJid(jid)
        const fallbackId = id.split("@")[0]

        if (id.endsWith("@lid")) {
          return `Business-${fallbackId.slice(-8)}`
        } else if (id.endsWith("@g.us")) {
          return `Group-${fallbackId.slice(-8)}`
        }
        return fallbackId || "Unknown User"
      }
    }

    XeonBotInc.public = true

    XeonBotInc.parseMention = (text = "") => {
      return [...text.matchAll(/@([0-9]{5,16}|0)/g)].map((v) => v[1] + "@s.whatsapp.net")
    }
  }

  static addMediaUtilities(XeonBotInc) {
    XeonBotInc.sendText = async (jid, text, quoted = "", options) => {
      const isGroup = jid.endsWith("@g.us")
      const { rateLimitManager } = require("../core/connection-manager")

      // Try fast track first
      const fastResult = await rateLimitManager.fastTrackMessage(async () => {
        return await XeonBotInc.sendMessage(jid, { text: text, ...options }, { quoted, ...options })
      })

      if (fastResult) {
        return fastResult
      }

      // Fallback to queue
      return new Promise((resolve, reject) => {
        const messageFunction = async () => {
          try {
            const result = await XeonBotInc.sendMessage(jid, { text: text, ...options }, { quoted, ...options })
            resolve(result)
          } catch (error) {
            reject(error)
          }
        }

        rateLimitManager.addToQueue(jid, messageFunction, isGroup)
      })
    }

    XeonBotInc.sendImage = async (jid, path, caption = "", quoted = "", options) => {
      const buffer = Buffer.isBuffer(path)
        ? path
        : /^data:.*?\/.*?;base64,/i.test(path)
          ? Buffer.from(path.split`,`[1], "base64")
          : /^https?:\/\//.test(path)
            ? await getBuffer(path)
            : fs.existsSync(path)
              ? fs.readFileSync(path)
              : Buffer.alloc(0)
      return await XeonBotInc.sendMessage(
        jid,
        {
          image: buffer,
          caption: caption,
          ...options,
        },
        {
          quoted,
        },
      )
    }

    XeonBotInc.sendVideo = async (jid, path, caption = "", quoted = "", gif = false, options) => {
      const buffer = Buffer.isBuffer(path)
        ? path
        : /^data:.*?\/.*?;base64,/i.test(path)
          ? Buffer.from(path.split`,`[1], "base64")
          : /^https?:\/\//.test(path)
            ? await getBuffer(path)
            : fs.existsSync(path)
              ? fs.readFileSync(path)
              : Buffer.alloc(0)
      return await XeonBotInc.sendMessage(
        jid,
        { video: buffer, caption: caption, gifPlayback: gif, ...options },
        { quoted },
      )
    }

    XeonBotInc.sendAudio = async (jid, path, quoted = "", ptt = false, options) => {
      const buffer = Buffer.isBuffer(path)
        ? path
        : /^data:.*?\/.*?;base64,/i.test(path)
          ? Buffer.from(path.split`,`[1], "base64")
          : /^https?:\/\//.test(path)
            ? await getBuffer(path)
            : fs.existsSync(path)
              ? fs.readFileSync(path)
              : Buffer.alloc(0)
      return await XeonBotInc.sendMessage(jid, { audio: buffer, ptt: ptt, ...options }, { quoted })
    }

    XeonBotInc.downloadMediaMessage = async (message) => {
      try {
        const mime = (message.msg || message).mimetype || ""
        const messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0]
        const stream = await downloadContentFromMessage(message, messageType)
        let buffer = Buffer.from([])

        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk])
        }

        return buffer
      } catch (error) {
        console.error("Error downloading media:", error)
        throw error
      }
    }

    XeonBotInc.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
      const quoted = message.msg ? message.msg : message
      const mime = (message.msg || message).mimetype || ""
      const messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0]
      const stream = await downloadContentFromMessage(quoted, messageType)

      const chunks = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      const buffer = Buffer.concat(chunks)
      const type = await FileType.fromBuffer(buffer)

      const trueFileName = attachExtension ? `${filename}.${type.ext}` : filename
      await fs.writeFileSync(trueFileName, buffer)
      return trueFileName
    }
  }

  static addMessageUtilities(XeonBotInc) {
    XeonBotInc.sendTextWithMentions = async (jid, text, quoted, options = {}) =>
      XeonBotInc.sendMessage(
        jid,
        {
          text: text,
          mentions: [...text.matchAll(/@(\d{0,16})/g)].map((v) => v[1] + "@s.whatsapp.net"),
          ...options,
        },
        {
          quoted,
        },
      )

    XeonBotInc.sendContact = async (jid, kon, quoted = "", opts = {}) => {
      const list = []
      for (const i of kon) {
        list.push({
          displayName: await XeonBotInc.getName(i),
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${await XeonBotInc.getName(i)}\nFN:${await XeonBotInc.getName(i)}\nitem1.TEL;waid=${i.split("@")[0]}:${i.split("@")[0]}\nitem1.X-ABLabel:Mobile\nEND:VCARD`,
        })
      }
      XeonBotInc.sendMessage(
        jid,
        { contacts: { displayName: `${list.length} Contact`, contacts: list }, ...opts },
        { quoted },
      )
    }

    XeonBotInc.sendPoll = (jid, name = "", values = [], selectableCount = 1) => {
      return XeonBotInc.sendMessage(jid, { poll: { name, values, selectableCount } })
    }

    XeonBotInc.copyNForward = async (jid, message, forceForward = false, options = {}) => {
      try {
        let vtype
        if (options.readViewOnce) {
          message.message =
            message.message && message.message.ephemeralMessage && message.message.ephemeralMessage.message
              ? message.message.ephemeralMessage.message
              : message.message || undefined
          vtype = Object.keys(message.message.viewOnceMessage.message)[0]
          delete (message.message && message.message.ignore ? message.message.ignore : message.message || undefined)
          delete message.message.viewOnceMessage.message[vtype].viewOnce
          message.message = {
            ...message.message.viewOnceMessage.message,
          }
        }

        const mtype = Object.keys(message.message)[0]
        const content = await generateForwardMessageContent(message, forceForward)
        const ctype = Object.keys(content)[0]
        let context = {}

        if (mtype != "conversation") context = message.message[mtype].contextInfo
        content[ctype].contextInfo = {
          ...context,
          ...content[ctype].contextInfo,
        }

        const waMessage = await generateWAMessageFromContent(
          jid,
          content,
          options
            ? {
                ...content[ctype],
                ...options,
                ...(options.contextInfo
                  ? {
                      contextInfo: {
                        ...content[ctype].contextInfo,
                        ...options.contextInfo,
                      },
                    }
                  : {}),
              }
            : {},
        )

        await XeonBotInc.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id })
        return waMessage
      } catch (error) {
        console.error("Error in copyNForward:", error)
        throw error
      }
    }

    XeonBotInc.cMod = (jid, copy, text = "", sender = XeonBotInc.user.id, options = {}) => {
      let mtype = Object.keys(copy.message)[0]
      const isEphemeral = mtype === "ephemeralMessage"
      if (isEphemeral) {
        mtype = Object.keys(copy.message.ephemeralMessage.message)[0]
      }
      const msg = isEphemeral ? copy.message.ephemeralMessage.message : copy.message
      const content = msg[mtype]
      if (typeof content === "string") msg[mtype] = text || content
      else if (content.caption) content.caption = text || content.caption
      else if (content.text) content.text = text || content.text
      if (typeof content !== "string")
        msg[mtype] = {
          ...content,
          ...options,
        }
      if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant
      else if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant
      if (copy.key.remoteJid.includes("@s.whatsapp.net")) sender = sender || copy.key.remoteJid
      else if (copy.key.remoteJid.includes("@broadcast")) sender = sender || copy.key.remoteJid
      copy.key.remoteJid = jid
      copy.key.fromMe = sender === XeonBotInc.user.id

      return proto.WebMessageInfo.fromObject(copy)
    }
  }

  static addAdvancedUtilities(XeonBotInc) {
    XeonBotInc.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
      const buff = Buffer.isBuffer(path)
        ? path
        : /^data:.*?\/.*?;base64,/i.test(path)
          ? Buffer.from(path.split`,`[1], "base64")
          : /^https?:\/\//.test(path)
            ? await getBuffer(path)
            : fs.existsSync(path)
              ? fs.readFileSync(path)
              : Buffer.alloc(0)
      let buffer
      if (options && (options.packname || options.author)) {
        buffer = await writeExifImg(buff, options)
      } else {
        buffer = await imageToWebp(buff)
      }
      await XeonBotInc.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted }).then((response) => {
        fs.unlinkSync(buffer)
        return response
      })
    }

    XeonBotInc.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
      const buff = Buffer.isBuffer(path)
        ? path
        : /^data:.*?\/.*?;base64,/i.test(path)
          ? Buffer.from(path.split`,`[1], "base64")
          : /^https?:\/\//.test(path)
            ? await getBuffer(path)
            : fs.existsSync(path)
              ? fs.readFileSync(path)
              : Buffer.alloc(0)
      let buffer
      if (options && (options.packname || options.author)) {
        buffer = await writeExifVid(buff, options)
      } else {
        buffer = await videoToWebp(buff)
      }
      await XeonBotInc.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted })
      return buffer
    }

    XeonBotInc.sendFileUrl = async (jid, url, caption, quoted, options = {}) => {
      let mime = ""
      const res = await axios.head(url)
      mime = res.headers["content-type"]
      if (mime.split("/")[1] === "gif") {
        return XeonBotInc.sendMessage(
          jid,
          { video: await getBuffer(url), caption: caption, gifPlayback: true, ...options },
          { quoted: quoted, ...options },
        )
      }
      const type = mime.split("/")[0] + "Message"
      if (mime === "application/pdf") {
        return XeonBotInc.sendMessage(
          jid,
          { document: await getBuffer(url), mimetype: "application/pdf", caption: caption, ...options },
          { quoted: quoted, ...options },
        )
      }
      if (mime.split("/")[0] === "image") {
        return XeonBotInc.sendMessage(
          jid,
          { image: await getBuffer(url), caption: caption, ...options },
          { quoted: quoted, ...options },
        )
      }
      if (mime.split("/")[0] === "video") {
        return XeonBotInc.sendMessage(
          jid,
          { video: await getBuffer(url), caption: caption, mimetype: "video/mp4", ...options },
          { quoted: quoted, ...options },
        )
      }
      if (mime.split("/")[0] === "audio") {
        return XeonBotInc.sendMessage(
          jid,
          { audio: await getBuffer(url), caption: caption, mimetype: "audio/mpeg", ...options },
          { quoted: quoted, ...options },
        )
      }
    }

    XeonBotInc.getFile = async (PATH, save) => {
      let res
      const data = Buffer.isBuffer(PATH)
        ? PATH
        : /^data:.*?\/.*?;base64,/i.test(PATH)
          ? Buffer.from(PATH.split`,`[1], "base64")
          : /^https?:\/\//.test(PATH)
            ? await (res = await getBuffer(PATH))
            : fs.existsSync(PATH)
              ? fs.readFileSync(PATH)
              : typeof PATH === "string"
                ? PATH
                : Buffer.alloc(0)
      const type = (await FileType.fromBuffer(data)) || {
        mime: "application/octet-stream",
        ext: ".bin",
      }
      const filename = path.join(__filename, "../src/" + new Date() * 1 + "." + type.ext)
      if (data && save) fs.promises.writeFile(filename, data)
      return {
        res,
        filename,
        size: await getSizeMedia(data),
        ...type,
        data,
      }
    }

    XeonBotInc.sendFile = async (jid, path, filename = "", caption = "", quoted, ptt = false, options = {}) => {
      const type = await XeonBotInc.getFile(path, true)
      let { res, data, filename: pathFile } = type

      if ((res && res.status !== 200) || data.length <= 65536) {
        try {
          throw {
            json: JSON.parse(data.toString()),
          }
        } catch (e) {
          if (e.json) throw e.json
        }
      }

      const opt = {
        filename,
      }

      if (quoted) opt.quoted = quoted
      if (!type) options.asDocument = true

      let mtype = "",
        mimetype = type.mime,
        convert

      if (/webp/.test(type.mime) || (/image/.test(type.mime) && options.asSticker)) mtype = "sticker"
      else if (/image/.test(type.mime) || (/webp/.test(type.mime) && options.asImage)) mtype = "image"
      else if (/video/.test(type.mime)) mtype = "video"
      else if (/audio/.test(type.mime)) {
        convert = await (ptt ? toPTT : toAudio)(data, type.ext)
        data = convert.data
        pathFile = convert.filename
        mtype = "audio"
        mimetype = "audio/ogg; codecs=opus"
      } else mtype = "document"

      if (options.asDocument) mtype = "document"

      delete options.asSticker
      delete options.asLocation
      delete options.asVideo
      delete options.asDocument
      delete options.asImage

      const message = { ...options, caption, ptt, [mtype]: { url: pathFile }, mimetype }
      let m

      try {
        m = await XeonBotInc.sendMessage(jid, message, { ...opt, ...options })
      } catch (e) {
        m = null
      } finally {
        if (!m) m = await XeonBotInc.sendMessage(jid, { ...message, [mtype]: data }, { ...opt, ...options })
        data = null
        return m
      }
    }

    XeonBotInc.sendMedia = async (jid, path, fileName = "", caption = "", quoted = "", options = {}) => {
      try {
        const types = await XeonBotInc.getFile(path, true)
        const { mime, ext, res, data, filename } = types

        if ((res && res.status !== 200) || data.length <= 65536) {
          try {
            throw { json: JSON.parse(data.toString()) }
          } catch (e) {
            if (e.json) throw e.json
          }
        }

        let type = "",
          mimetype = mime,
          pathFile = filename

        if (options.asDocument) type = "document"
        if (options.asSticker || /webp/.test(mime)) {
          const { writeExif } = require("./exif")
          const media = { mimetype: mime, data }
          pathFile = await writeExif(media, {
            packname: options.packname ? options.packname : global.packname,
            author: options.author ? options.author : global.author,
            categories: options.categories ? options.categories : [],
          })
          await fs.promises.unlink(filename)
          type = "sticker"
          mimetype = "image/webp"
        } else if (/image/.test(mime)) type = "image"
        else if (/video/.test(mime)) type = "video"
        else if (/audio/.test(mime)) type = "audio"
        else type = "document"

        await XeonBotInc.sendMessage(
          jid,
          {
            [type]: { url: pathFile },
            caption,
            mimetype,
            fileName,
            ...options,
          },
          { quoted, ...options },
        )

        return fs.promises.unlink(pathFile)
      } catch (error) {
        console.error("Error in sendMedia:", error)
        throw error
      }
    }

    XeonBotInc.appenTextMessage = async (text, chatUpdate) => {
      const messages = await generateWAMessage(
        chatUpdate[0].key.remoteJid,
        { text: text, mentions: chatUpdate[0].message.extendedTextMessage.contextInfo.mentionedJid },
        {
          userJid: XeonBotInc.user.id,
          quoted: chatUpdate[0],
        },
      )
      messages.key.fromMe = areJidsSameUser(XeonBotInc.user.id, chatUpdate[0].key.remoteJid)
      messages.key.id = chatUpdate[0].key.id
      messages.pushName = chatUpdate[0].pushName
      if (chatUpdate[0].isGroup) messages.participant = chatUpdate[0].sender
      const msg = {
        ...chatUpdate[0],
        messages: [messages],
        type: "append",
      }
      XeonBotInc.ev.emit("messages.upsert", msg)
    }
  }
}

module.exports = { ClientUtilities }
