// ========================================
// MESSAGE PROCESSOR WITH DEDUPLICATION
// ========================================

const { chalk } = require("../utils/imports")
const { MessageUtils } = require("../utils/message-utils")
const { ViewOnceHandler } = require("../handlers/viewonce-handler")
const { ProtocolHandler } = require("../handlers/protocol-handler")
const { TimeManager } = require("../utils/time-manager")
const { saveAllMessages, allMessages } = require("../utils/store-manager")

// Global message processing tracker to prevent duplicates across all sessions
const globalProcessedMessages = new Map() // messageId -> { timestamp, sessions: Set() }
const MESSAGE_DEDUP_TIMEOUT = 30000 // 30 seconds

class MessageProcessor {
  static async processIncomingMessage(mek, XeonBotInc, m) {
    if (!mek.message) return

    const isGroup = mek.key.remoteJid.endsWith("@g.us")
    const isStatus = mek.key.remoteJid.endsWith("@broadcast")

    if (isStatus) return

    // Handle protocol messages
    if (mek.message?.protocolMessage) {
      await ProtocolHandler.handleProtocolMessage(mek, XeonBotInc, m)
      return
    }

    // Handle view-once messages
    const isViewOnce = await ViewOnceHandler.handleViewOnceMessage(m, XeonBotInc)
    if (isViewOnce) return

    // Store ALL messages for ALL sessions - no deduplication
    await this.storeMessageForSession(mek, XeonBotInc)
  }

  static async storeMessageForSession(m, XeonBotInc) {
    try {
      const messageId = m.key.id
      const sessionId = XeonBotInc.sessionId
      const isOwnMessage = m.key.fromMe
      const messageFrom = m.key.remoteJid
      const messageSender = m.key.participant || m.key.remoteJid

      // Create message data for THIS specific session
      const messageData = {
        id: messageId,
        from: m.key.remoteJid,
        key: m.key,
        sender: m.key.participant || m.key.remoteJid,
        timestamp: TimeManager.getUnixTimestamp(),
        sessionId: sessionId, // This session that's processing the message
        userId: XeonBotInc.userId, // The WhatsApp user ID of this session
        isOwnMessage: isOwnMessage,
        messageDirection: isOwnMessage ? "outgoing" : "incoming",
        content:
          m.message.conversation ||
          m.message.extendedTextMessage?.text ||
          m.message.documentMessage?.fileName ||
          m.message.media?.caption ||
          "",
        media:
          m.message.imageMessage ||
          m.message.videoMessage ||
          m.message.audioMessage ||
          m.message.documentMessage ||
          m.message.stickerMessage ||
          (m.message.viewOnceMessageV2 ? { viewOnceMessageV2: m.message.viewOnceMessageV2 } : null) ||
          null,
        mediaType: MessageUtils.getMediaType(m.message),
      }

      // Always store the message for this session - no duplicate checking
      // Each session should have its own copy of every message it sees
      console.log(
        chalk.green(`✅ Storing ${messageData.messageDirection} message ${messageId} for session ${sessionId}`),
      )

      // Add to memory
      allMessages.push(messageData)

      // Save to database
      await saveAllMessages([messageData])

      console.log(
        chalk.green(
          `✅ Message ${messageId} stored successfully for session ${sessionId} (${messageData.messageDirection})`,
        ),
      )
    } catch (error) {
      console.log(chalk.red("❌ Error in storeMessageForSession:"), error.message)
    }
  }

  // Method to get deduplication statistics
  static getDeduplicationStats() {
    const currentTime = Date.now()
    const activeEntries = Array.from(globalProcessedMessages.entries()).filter(
      ([id, data]) => currentTime - data.timestamp <= MESSAGE_DEDUP_TIMEOUT,
    )

    return {
      totalTracked: activeEntries.length,
      duplicatesDetected: activeEntries.filter(([id, data]) => data.sessions.size > 1).length,
      oldestEntry: activeEntries.length > 0 ? Math.min(...activeEntries.map(([id, data]) => data.timestamp)) : null,
    }
  }

  // Method to manually clear deduplication cache (for testing)
  static clearDeduplicationCache() {
    globalProcessedMessages.clear()
    console.log(chalk.blue("🧹 Message deduplication cache cleared"))
  }
}

module.exports = { MessageProcessor }
