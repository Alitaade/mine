// ========================================
// MESSAGE UTILITIES
// ========================================

const { moment, proto, store } = require("./imports")
const { TimeManager } = require("./time-manager")

class MessageUtils {
  static async getMessage(key) {
    if (store) {
      const msg = await store.loadMessage(key.remoteJid, key.id)
      return msg?.message
    }
    return { conversation: "Cheems Bot Here!" }
  }

  static getMediaType(message) {
    if (message.imageMessage) return "image"
    if (message.videoMessage) return "video"
    if (message.audioMessage) return "audio"
    if (message.documentMessage) {
      return message.documentMessage.fileName?.endsWith(".zip") ? "zip" : "document"
    }
    if (message.stickerMessage) return "sticker"
    if (message.viewOnceMessageV2) {
      const viewOnceMsg = message.viewOnceMessageV2.message
      if (viewOnceMsg.imageMessage) return "image"
      if (viewOnceMsg.videoMessage) return "video"
      if (viewOnceMsg.documentMessage) return "document"
      if (viewOnceMsg.audioMessage) return "audio"
    }
    return null
  }

  static formatMessageInfo(message) {
    const isGroup = message.from.endsWith("@g.us")
    const isChat = message.from.endsWith("@s.whatsapp.net")
    const isStatus = message.from.endsWith("@broadcast")
    const isChannel = message.from.endsWith("@newsletter")

    return {
      isGroup,
      isChat,
      isStatus,
      isChannel,
      sourceType: isGroup ? "group" : isStatus ? "status" : isChannel ? "channel" : isChat ? "chat" : "unknown",
    }
  }

  // Extract content from protocol messages
  static extractProtocolMessageContent(protocolMessage, allMessages) {
    try {
      if (protocolMessage.type === 0) {
        // Delete message
        const deletedMessageId = protocolMessage.key?.id
        if (deletedMessageId) {
          // Find the original message in our database
          const originalMessage = allMessages.find((msg) => msg.id === deletedMessageId)
          if (originalMessage) {
            return {
              content: originalMessage.content || "[Deleted Message]",
              media: originalMessage.media,
              mediaType: originalMessage.mediaType,
              isDeleted: true,
              originalMessage: originalMessage,
            }
          }
        }
      }
      return null
    } catch (error) {
      console.error("Error extracting protocol message content:", error.message)
      return null
    }
  }

  // Extract message content from decoded message
  static extractMessageContent(message) {
    if (message.conversation) return message.conversation
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text
    if (message.imageMessage?.caption) return message.imageMessage.caption
    if (message.videoMessage?.caption) return message.videoMessage.caption
    if (message.documentMessage?.caption) return message.documentMessage.caption
    return null
  }
}

// smsg function for message processing
function smsg(XeonBotInc, m, store) {
  if (!m) return m
  const M = proto.WebMessageInfo
  if (m.key) {
    m.id = m.key.id
    m.isBaileys = m.id.startsWith("BAE5") && m.id.length === 16
    m.chat = m.key.remoteJid
    m.fromMe = m.key.fromMe
    m.isGroup = m.chat.endsWith("@g.us")
    m.sender = XeonBotInc.decodeJid(
      (m.fromMe && XeonBotInc.user.id) || m.participant || m.key.participant || m.chat || "",
    )
    if (m.isGroup) m.participant = XeonBotInc.decodeJid(m.key.participant) || ""
  }
  if (m.message) {
    m.mtype = getContentType(m.message)
    m.msg =
      m.mtype == "viewOnceMessage"
        ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)]
        : m.message[m.mtype]
    m.body =
      m.message.conversation ||
      m.msg.caption ||
      m.msg.text ||
      (m.mtype == "listResponseMessage" && m.msg.singleSelectReply.selectedRowId) ||
      (m.mtype == "buttonsResponseMessage" && m.msg.selectedButtonId) ||
      (m.mtype == "viewOnceMessage" && m.msg.caption) ||
      m.text
    const quoted = (m.quoted = m.msg.contextInfo ? m.msg.contextInfo.quotedMessage : null)
    m.mentionedJid = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : []
    if (m.quoted) {
      let type = getContentType(quoted)
      m.quoted = m.quoted[type]
      if (["productMessage"].includes(type)) {
        type = getContentType(m.quoted)
        m.quoted = m.quoted[type]
      }
      if (typeof m.quoted === "string")
        m.quoted = {
          text: m.quoted,
        }
      m.quoted.mtype = type
      m.quoted.id = m.msg.contextInfo.stanzaId
      m.quoted.chat = m.msg.contextInfo.remoteJid || m.chat
      m.quoted.isBaileys = m.quoted.id ? m.quoted.id.startsWith("BAE5") && m.quoted.id.length === 16 : false
      m.quoted.sender = XeonBotInc.decodeJid(m.msg.contextInfo.participant)
      m.quoted.fromMe = m.quoted.sender === XeonBotInc.decodeJid(XeonBotInc.user.id)
      m.quoted.text =
        m.quoted.text ||
        m.quoted.caption ||
        m.quoted.conversation ||
        m.quoted.contentText ||
        m.quoted.selectedDisplayText ||
        m.quoted.title ||
        ""
      m.quoted.mentionedJid = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : []
      m.getQuotedObj = m.getQuotedMessage = async () => {
        if (!m.quoted.id) return false
        const q = await store.loadMessage(m.chat, m.quoted.id, XeonBotInc)
        return exports.smsg(XeonBotInc, q, store)
      }
      const vM = (m.quoted.fakeObj = M.fromObject({
        key: {
          remoteJid: m.quoted.chat,
          fromMe: m.quoted.fromMe,
          id: m.quoted.id,
        },
        message: quoted,
        ...(m.isGroup ? { participant: m.quoted.sender } : {}),
      }))
      m.quoted.delete = () => XeonBotInc.sendMessage(m.quoted.chat, { delete: vM.key })
      m.quoted.copyNForward = (jid, forceForward = false, options = {}) =>
        XeonBotInc.copyNForward(jid, vM, forceForward, options)
      m.quoted.download = () => XeonBotInc.downloadMediaMessage(m.quoted)
    }
  }
  if (m.msg.url) m.download = () => XeonBotInc.downloadMediaMessage(m.msg)
  m.text =
    m.msg.text ||
    m.msg.caption ||
    m.message.conversation ||
    m.msg.contentText ||
    m.msg.selectedDisplayText ||
    m.msg.title ||
    ""
  m.reply = (text, chatId = m.chat, options = {}) =>
    Buffer.isBuffer(text)
      ? XeonBotInc.sendMedia(chatId, text, "file", "", m, { ...options })
      : XeonBotInc.sendText(chatId, text, m, { ...options })
  m.copy = () => exports.smsg(XeonBotInc, M.fromObject(M.toObject(m)))
  m.copyNForward = (jid = m.chat, forceForward = false, options = {}) =>
    XeonBotInc.copyNForward(jid, m, forceForward, options)
  m.delete = () => XeonBotInc.sendMessage(m.chat, { delete: m.key })

  return m
}

function getContentType(message) {
  if (message) {
    const keys = Object.keys(message)
    const key = keys.find(
      (k) => (k === "conversation" || k.endsWith("Message")) && k !== "senderKeyDistributionMessage",
    )
    return key
  }
}

module.exports = { MessageUtils, smsg, getContentType }
