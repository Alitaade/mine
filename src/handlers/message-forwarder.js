// ========================================
// MESSAGE FORWARDING SYSTEM
// ========================================

const { moment, getBuffer } = require("../utils/imports")
const { MessageUtils } = require("../utils/message-utils")

class MessageForwarder {
  // Fix for MessageForwarder.forwardDeletedMessage function
// Replace the existing forwardDeletedMessage method with this:

static async forwardDeletedMessage(XeonBotInc, message, yourNumber) {
  const formattedNumber = yourNumber.includes("@") ? yourNumber : `${yourNumber}@s.whatsapp.net`

  try {
    // Fix: Ensure message has proper key structure
    if (!message.key) {
      message.key = {
        id: message.id,
        remoteJid: message.from,
        fromMe: message.fromMe || false,
        participant: message.sender !== message.from ? message.sender : undefined
      }
    }
    
    // Fix: Ensure fromMe property exists
    if (message.key.fromMe === undefined) {
      message.key.fromMe = message.fromMe || false
      console.log("Added missing fromMe property to message key")
    }

    const messageInfo = MessageUtils.formatMessageInfo(message)
    const groupMetadata = messageInfo.isGroup ? await XeonBotInc.groupMetadata(message.from).catch(() => null) : null
    const groupName = messageInfo.isGroup && groupMetadata ? groupMetadata.subject : "Unknown Group"

    const sentIn = messageInfo.isGroup
      ? `in group (${groupName})`
      : messageInfo.isStatus
        ? "on status"
        : messageInfo.isChannel
          ? "in channel"
          : messageInfo.isChat
            ? "in chat"
            : "unknown source"

    const timestamp = moment.unix(message.timestamp).tz(global.location).format("hh:mm:ss A DD/MM/YYYY")
    const senderInfo = `🚫 *Deleted Message Detected* 🚫\n\n📍 *Sent in:* ${sentIn}\n🕒 *Timestamp:* ${timestamp}`

    const quotedMessage = {
      key: message.key,
      message: {
        conversation: message.content || message.media?.caption || "[No Content]",
      },
    }

    // Handle different message types
    if (message.media?.viewOnceMessageV2 || message.media?.viewOnce === true) {
      await this.forwardViewOnceMessage(XeonBotInc, message, formattedNumber, quotedMessage, timestamp)
    } else if (message.media) {
      await this.forwardMediaMessage(XeonBotInc, message, formattedNumber, quotedMessage, senderInfo)
    } else {
      await this.forwardTextMessage(XeonBotInc, message, formattedNumber, quotedMessage, senderInfo)
    }
  } catch (err) {
    console.error("Failed to forward message:", err.message)
  }
}
  static async forwardViewOnceMessage(XeonBotInc, message, formattedNumber, quotedMessage, timestamp) {
    try {
      const msg = message.media.imageMessage || message.media.videoMessage || message.media

      if (!msg || !msg.mediaKey || !(msg.mediaKey instanceof Uint8Array)) {
        console.error("Error: Media key is missing or not in correct format.")
        return
      }

      msg.mediaKey = Buffer.from(msg.mediaKey)
      const type = msg.mtype || (msg.imageMessage ? "imageMessage" : msg.videoMessage ? "videoMessage" : null)

      const { downloadContentFromMessage } = require("../utils/imports")
      const media = await downloadContentFromMessage(msg, type === "imageMessage" ? "image" : "video")
      let buffer = Buffer.from([])

      for await (const chunk of media) {
        buffer = Buffer.concat([buffer, chunk])
      }

      const senderName = message.pushName || "Unknown Sender"
      const caption = `🚨 *View Once Media Detected* 🚨\n\n📍 Sent by: ${senderName}\n🕒 *Time:* ${timestamp}`
      const mediaType = type === "imageMessage" ? "image" : "video"
      const captions = msg?.caption || "[No Caption]"

      await XeonBotInc.sendMessage(
        formattedNumber,
        {
          [mediaType]: buffer,
          caption: `${caption}\n💬 *Original Caption:*\n> ${captions}`,
          mimetype: type === "imageMessage" ? "image/jpeg" : "video/mp4",
        },
        { quoted: quotedMessage },
      )
    } catch (error) {
      console.error("Failed to forward view-once message:", error.message)
    }
  }

  static async forwardMediaMessage(XeonBotInc, message, formattedNumber, quotedMessage, senderInfo) {
    try {
      const buffer = await XeonBotInc.downloadMediaMessage(message.media)
      const caption = message.media.caption || "[No Caption]"
      const mediaType = message.mediaType

      if (["image", "video", "audio", "document", "sticker", "zip"].includes(mediaType)) {
        const payload = {
          caption: `${senderInfo}\n💬 *Original Caption:*\n> ${caption}`,
          mimetype: message.media.mimetype,
          fileName: message.media.fileName || "file",
        }

        if (mediaType === "zip" || mediaType === "document") {
          payload.document = buffer
          payload.mimetype = "application/zip"
          payload.fileName = message.media.fileName || "attachment.zip"
        } else {
          payload[mediaType] = buffer
        }

        await XeonBotInc.sendMessage(formattedNumber, payload, { quoted: quotedMessage })
      } else {
        console.warn(`Unsupported media type: ${mediaType}`)
      }
    } catch (error) {
      console.error("Failed to handle media message:", error.message)
    }
  }

  static async forwardTextMessage(XeonBotInc, message, formattedNumber, quotedMessage, senderInfo) {
    await XeonBotInc.sendMessage(
      formattedNumber,
      {
        text: `${senderInfo}\n💬 *Original Message:*\n> ${message.content || "_[No Content]_"}`,
      },
      { quoted: quotedMessage },
    )
  }
}

module.exports = { MessageForwarder }
