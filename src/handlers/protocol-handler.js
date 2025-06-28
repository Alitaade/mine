// ========================================
// ENHANCED MESSAGE PROCESSING SYSTEM - OPTIMIZED WITH LOGGING
// ========================================

// All required constants at the top
const { chalk, proto, moment, PROTOCOL_MESSAGE_TYPES } = require("../utils/imports")
const { allMessages, processedDeletedMessages, deleteMessage, addProcessedDeletedMessage, findMessage } = require("../utils/store-manager")
const { TimeManager } = require("../utils/time-manager")
const { MessageUtils, smsg } = require("../utils/message-utils")
const { MessageForwarder } = require("./message-forwarder")

// Global constants for performance
const COMMAND_CACHE_DURATION = 10 * 60 * 1000 // 10 minutes
const MAX_COMMAND_CACHE_SIZE = 1000
const PROTOCOL_SEARCH_WINDOW = 50 // seconds
const PROTOCOL_EXTENDED_WINDOW = 190 // seconds
const MAX_RECENT_MESSAGES = 30

// Global command tracking cache
const processedCommands = new Map()
let lastCleanup = Date.now()

// Pre-compiled regex for faster command detection
const COMMAND_REGEX = /^[.\/!#]/
const HELLO_REGEX = /^hello/i

// ========================================
// OPTIMIZED UTILITY FUNCTIONS
// ========================================

function cleanupOldCommands() {
  const now = Date.now()
  
  // Only cleanup every 5 minutes to reduce overhead
  if (now - lastCleanup < 300000) return
  
  let cleanedCount = 0
  for (const [messageId, data] of processedCommands.entries()) {
    if (now - data.timestamp > COMMAND_CACHE_DURATION) {
      processedCommands.delete(messageId)
      cleanedCount++
    }
  }
  
  // If cache is still too large, remove oldest entries
  if (processedCommands.size > MAX_COMMAND_CACHE_SIZE) {
    const entries = Array.from(processedCommands.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
    
    const toRemove = entries.slice(0, processedCommands.size - MAX_COMMAND_CACHE_SIZE)
    toRemove.forEach(([id]) => processedCommands.delete(id))
    cleanedCount += toRemove.length
  }
  
  lastCleanup = now
  if (cleanedCount > 0) {
    console.log(chalk.blue(`🧹 Cache cleanup: ${cleanedCount} entries removed`))
  }
}

function wasCommandAlreadyProcessed(messageId) {
  return processedCommands.has(messageId)
}

function markCommandAsProcessed(messageId, sessionId, isNormalMessage = false) {
  processedCommands.set(messageId, {
    timestamp: Date.now(),
    sessionId: sessionId,
    processedAsNormal: isNormalMessage
  })
  
  // Trigger cleanup occasionally
  if (Math.random() < 0.05) { // 5% chance
    cleanupOldCommands()
  }
}

function shouldBlockMessage(content) {
  if (!content) return { blocked: false, reason: null, isHello: false }
  
  const trimmed = content.trim()
  
  // Fast hello check
  if (HELLO_REGEX.test(trimmed)) {
    return { blocked: true, reason: "hello message", isHello: true }
  }
  
  // Fast command check
  if (COMMAND_REGEX.test(trimmed) || trimmed.startsWith(global.xprefix)) {
    return { blocked: true, reason: "command", isHello: false }
  }
  
  return { blocked: false, reason: null, isHello: false }
}

// ========================================
// OPTIMIZED PROTOCOL HANDLER
// ========================================

class ProtocolHandler {
  static async handleProtocolMessage(mek, XeonBotInc, m) {
    const protocolMsg = mek.message.protocolMessage
    const protocolType = protocolMsg.type
    
    // Fast type routing
    switch (protocolType) {
      case PROTOCOL_MESSAGE_TYPES.PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE:
        return await this.handlePeerDataOperation(protocolMsg, mek, XeonBotInc, m)
      
      case 17:
        return await this.handleType17Protocol(protocolMsg, mek, XeonBotInc, m)
      
      case PROTOCOL_MESSAGE_TYPES.REVOKE:
        return await this.handleRevokeMessage(protocolMsg, mek, XeonBotInc, m)
      
      default:
        return // Ignore other protocol types
    }
  }
  
  static async handlePeerDataOperation(protocolMsg, mek, XeonBotInc, m) {
    try {
      const peerDataOp = protocolMsg.peerDataOperationRequestResponseMessage
      if (!peerDataOp?.peerDataOperationResult) return
      
      for (const result of peerDataOp.peerDataOperationResult) {
        const resendResponse = result.placeholderMessageResendResponse
        if (!resendResponse?.webMessageInfoBytes) continue
        
        try {
          const messageBytes = Buffer.from(resendResponse.webMessageInfoBytes, "base64")
          const decodedMessage = proto.WebMessageInfo.decode(messageBytes)
          
          if (!decodedMessage?.message) continue
          
          const messageContent = MessageUtils.extractMessageContent(decodedMessage.message)
          if (!messageContent) continue
          
          const blockCheck = shouldBlockMessage(messageContent)
          if (blockCheck.blocked) return
          
          if (COMMAND_REGEX.test(messageContent) || messageContent.startsWith(global.xprefix)) {
            console.log(chalk.cyan(`🔄 [PEER DATA] Passing decoded command to XeonCheems14: "${messageContent.substring(0, 50)}${messageContent.length > 50 ? '...' : ''}"`))
            await this.executeCommand(messageContent, mek, XeonBotInc, m, true)
          }
        } catch (decodeError) {
          // Silent fail for decode errors
        }
      }
    } catch (error) {
      console.log(chalk.red("❌ Peer data operation error:", error.message))
    }
  }
  
  static async handleType17Protocol(protocolMsg, mek, XeonBotInc, m) {
    const senderJid = mek.key?.remoteJid || m?.from || mek.from
    const protocolTimestamp = mek.messageTimestamp || m?.timestamp || mek.timestamp || TimeManager.getUnixTimestamp()
    
    // Small delay to allow message storage
    await new Promise(resolve => setTimeout(resolve, 500))
    
    let nearestMessage = this.findNearestMessage(senderJid, protocolTimestamp)
    
    if (!nearestMessage?.content) return
    
    const messageContent = nearestMessage.content
    const blockCheck = shouldBlockMessage(messageContent)
    if (blockCheck.blocked) return
    
    if (COMMAND_REGEX.test(messageContent) || messageContent.startsWith(global.xprefix)) {
      if (wasCommandAlreadyProcessed(nearestMessage.id)) return
      
      markCommandAsProcessed(nearestMessage.id, XeonBotInc.sessionId, false)
      console.log(chalk.magenta(`🔄 [TYPE 17] Passing protocol command to XeonCheems14: "${messageContent.substring(0, 50)}${messageContent.length > 50 ? '...' : ''}"`))
      await this.executeCommand(messageContent, mek, XeonBotInc, m, false, nearestMessage)
    }
  }
  
  static findNearestMessage(senderJid, protocolTimestamp) {
    // Strategy 1: Recent messages from same sender (60 seconds)
    let candidates = allMessages.filter(msg => {
      const timeDiff = Math.abs(msg.timestamp - protocolTimestamp)
      return msg.from === senderJid && timeDiff <= PROTOCOL_SEARCH_WINDOW
    })
    
    if (candidates.length === 0) {
      // Strategy 2: Extended window (3 minutes)
      candidates = allMessages.filter(msg => {
        const timeDiff = Math.abs(msg.timestamp - protocolTimestamp)
        return msg.from === senderJid && timeDiff <= PROTOCOL_EXTENDED_WINDOW
      })
    }
    
    if (candidates.length === 0) {
      // Strategy 3: Last 30 messages from sender
      candidates = allMessages
        .filter(msg => msg.from === senderJid)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_RECENT_MESSAGES)
    }
    
    // Return closest by timestamp
    return candidates.sort((a, b) => 
      Math.abs(a.timestamp - protocolTimestamp) - Math.abs(b.timestamp - protocolTimestamp)
    )[0]
  }
  
  static async handleRevokeMessage(protocolMsg, mek, XeonBotInc, m) {
  const deletedMessageId = protocolMsg.key?.id
  if (!deletedMessageId || processedDeletedMessages.has(deletedMessageId)) return
  
  console.log(chalk.yellow(`🗑️ [REVOKE] Processing deleted message: ${deletedMessageId}`))
  
  addProcessedDeletedMessage(deletedMessageId)
  const originalMessage = await findMessage(deletedMessageId)
  
  if (!originalMessage) {
    console.log(chalk.gray(`⏭️ [REVOKE] Skipping deleted message (not found): ${deletedMessageId}`))
    return
  }
      if (!originalMessage || originalMessage.key?.fromMe) {
      console.log(chalk.gray(`⏭️ [REVOKE] Skipping deleted message (not found or from me): ${deletedMessageId}`))
      return
    }
      
  const messageSessionId = originalMessage.sessionId
  const messageUserId = originalMessage.userId
  
  console.log(chalk.blue(`📤 [REVOKE] Found deleted message content: "${originalMessage.content?.substring(0, 50) || 'No content'}${originalMessage.content?.length > 50 ? '...' : ''}"`))
  
  // Always forward deleted messages with proper validation (removed fromMe check)
  if (messageSessionId === XeonBotInc.sessionId) {
    console.log(chalk.green(`📨 [REVOKE] Forwarding deleted message to user: ${messageUserId}`))
    await MessageForwarder.forwardDeletedMessage(XeonBotInc, originalMessage, messageUserId)
      .catch(err => console.log(chalk.yellow("⚠️ Forward failed:", err.message)))
  }
  
  // Clean deletion - removed the part that processes protocol content through XeonCheems14
  const deleteResult = await deleteMessage(deletedMessageId, messageSessionId)
  if (!deleteResult) {
    console.log(chalk.yellow(`⚠️ [REVOKE] Delete failed: ${deletedMessageId}`))
  } else {
    console.log(chalk.green(`✅ [REVOKE] Successfully deleted message: ${deletedMessageId}`))
  }
}
  
  static async executeCommand(messageContent, mek, XeonBotInc, m, isDecoded = false, nearestMessage = null) {
    const commandStartTime = TimeManager.getUnixTimestamp()
    
    const mockMessage = {
      ...(m || mek),
      message: { conversation: messageContent },
      body: messageContent,
      text: messageContent,
      content: messageContent,
      isDecodedProtocolCommand: isDecoded,
      isProtocolCommand: !isDecoded,
      commandStartTime: commandStartTime,
      sender: nearestMessage?.sender || mek.key.remoteJid,
      from: nearestMessage?.from || mek.key.remoteJid,
      key: mek.key || { remoteJid: mek.key.remoteJid },
      messageTimestamp: mek.messageTimestamp
    }
    
    try {
      console.log(chalk.green(`🚀 [EXECUTE] Calling XeonCheems14 with command: "${messageContent.substring(0, 50)}${messageContent.length > 50 ? '...' : ''}" | Type: ${isDecoded ? 'Decoded' : 'Protocol'}`))
      
      const commandHandler = require("../../XeonCheems14")
      if (typeof commandHandler === "function") {
        const { store } = require("../utils/store-manager")
        const processedMockMessage = smsg(XeonBotInc, mockMessage, store)
        await commandHandler(XeonBotInc, processedMockMessage, { messages: [mockMessage] }, store)
        
        console.log(chalk.green(`✅ [EXECUTE] XeonCheems14 command completed successfully`))
      } else {
        console.log(chalk.yellow(`⚠️ [EXECUTE] XeonCheems14 handler is not a function`))
      }
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") {
        console.log(chalk.red(`❌ [EXECUTE] Command execution error: ${error.message}`))
      } else {
        console.log(chalk.yellow(`⚠️ [EXECUTE] XeonCheems14 module not found`))
      }
    }
  }
  
  static async executeProtocolContent(protocolContent, mek, XeonBotInc, m, originalMessage) {
    const mockMessage = {
      ...(m || mek),
      message: { conversation: protocolContent.content },
      body: protocolContent.content,
      text: protocolContent.content,
      content: protocolContent.content,
      isProtocolMessage: true,
      originalMessage: protocolContent.originalMessage,
      sender: originalMessage.sender || mek.key?.remoteJid,
      from: originalMessage.from || mek.key?.remoteJid,
      key: mek.key || { remoteJid: originalMessage.from },
      messageTimestamp: mek.messageTimestamp || m?.timestamp || mek.timestamp
    }
    
    try {
      console.log(chalk.green(`🚀 [PROTOCOL] Calling XeonCheems14 with protocol content: "${protocolContent.content.substring(0, 50)}${protocolContent.content.length > 50 ? '...' : ''}"`))
      
      const commandHandler = require("../../XeonCheems14")
      if (typeof commandHandler === "function") {
        const { store } = require("../utils/store-manager")
        const processedMockMessage = smsg(XeonBotInc, mockMessage, store)
        await commandHandler(XeonBotInc, processedMockMessage, { messages: [mockMessage] }, store)
        
        console.log(chalk.green(`✅ [PROTOCOL] XeonCheems14 protocol content completed successfully`))
      } else {
        console.log(chalk.yellow(`⚠️ [PROTOCOL] XeonCheems14 handler is not a function`))
      }
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") {
        console.log(chalk.red(`❌ [PROTOCOL] Protocol content execution error: ${error.message}`))
      } else {
        console.log(chalk.yellow(`⚠️ [PROTOCOL] XeonCheems14 module not found`))
      }
    }
  }
}

// ========================================
// MODULE EXPORTS
// ========================================

module.exports = {
  ProtocolHandler,
  markCommandAsProcessed,
  wasCommandAlreadyProcessed,
  cleanupOldCommands,
  shouldBlockMessage
}