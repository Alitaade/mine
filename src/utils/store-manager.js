// ========================================
// OPTIMIZED STORE MANAGER - HIGH PERFORMANCE VERSION
// ========================================

const { fs, chalk, pool, allMessages, saveAllMessages, loadMessages, findMessageById, getAllMessages, processedDeletedMessages, deletedMessages, testConnection, deleteMessageById } = require("./imports")

// ========================================
// CONFIGURATION & STATE
// ========================================

const CONFIG = {
  RETRY_DELAY: 2 * 60 * 1000,
  HEALTH_CHECK_INTERVAL: 30 * 1000,
  MAX_MEMORY_MESSAGES: 10000,
  MAX_PENDING_MESSAGES: 5000,
  MAX_IN_MEMORY_CACHE: 100,
  CLEANUP_INTERVAL: 2 * 60 * 1000,
  BATCH_SIZE: 500
}

const state = {
  isConnected: false,
  lastHealthCheck: null,
  retryTimeout: null,
  cleanupInterval: null,
  connectionTestInProgress: false,
  pendingMessages: new Map(), // Use Map for O(1) lookups
  pendingDeleted: new Set(),
}

const memoryStorage = {
  messages: new Map(), // messageId -> message object
  deletedMessages: new Set(),
  messagesBySession: new Map(), // sessionId -> Set of messageIds
}

const inMemoryStore = {
  groupMetadata: new Map(),
  contacts: new Map(),
  messages: new Map(), // key -> message (LRU cache)
  messageOrder: [], // For LRU eviction

  bind(ev) {
    console.log(chalk.green("✅ Store bound to events"))

    ev.on("messages.upsert", async (chatUpdate) => {
      const messages = chatUpdate.messages || []
      if (messages.length === 0) return

      // Force connection check on new messages if connection is down
      if (!state.isConnected && !state.connectionTestInProgress) {
        checkHealth(true).catch(() => {}) // Fire and forget
      }

      const messageDataArray = []
      for (const message of messages) {
        if (!message.key?.id) continue
        this.saveMessage(message)
        messageDataArray.push(formatMessage(message))
      }

      if (messageDataArray.length > 0) {
        saveBatchMessages(messageDataArray).catch(err => 
          console.log(chalk.red("❌ Batch save error:", err.message))
        )
      }
    })

    ev.on("contacts.update", (updates) => {
      for (const contact of updates) {
        if (contact?.id) {
          this.contacts.set(contact.id, { ...(this.contacts.get(contact.id) || {}), ...contact })
        }
      }
    })

    ev.on("groups.update", (updates) => {
      for (const update of updates) {
        if (update?.id) {
          this.groupMetadata.set(update.id, { ...(this.groupMetadata.get(update.id) || {}), ...update })
        }
      }
    })
  },

  loadMessage: function (jid, id) {
    const key = `${jid}_${id}`
    const memoryMessage = this.messages.get(key)
    if (memoryMessage) {
      this.updateLRU(key)
      return memoryMessage
    }
    
    if (!state.isConnected) {
      return memoryStorage.messages.get(id)
    }
    
    return null
  },

  saveMessage: function (message) {
    if (!message?.key) return
    
    const key = `${message.key.remoteJid}_${message.key.id}`
    this.messages.set(key, message)
    this.updateLRU(key)
    this.evictIfNeeded()
  },

  updateLRU: function (key) {
    const index = this.messageOrder.indexOf(key)
    if (index > -1) {
      this.messageOrder.splice(index, 1)
    }
    this.messageOrder.push(key)
  },

  evictIfNeeded: function () {
    while (this.messageOrder.length > CONFIG.MAX_IN_MEMORY_CACHE) {
      const oldestKey = this.messageOrder.shift()
      this.messages.delete(oldestKey)
    }
  }
}

// ========================================
// DATABASE FUNCTIONS
// ========================================

let dbFunctions = null

function getDbFunctions() {
  if (!dbFunctions) {
    try {
      dbFunctions = {
        saveAllMessages: saveAllMessages || (async (msgs) => { await saveToMemory(msgs); return true }),
        loadMessages: loadMessages || (async () => Array.from(memoryStorage.messages.values())),
        findMessageById: findMessageById || (async (id, sessionId) => {
          return memoryStorage.messages.get(id);
        }),
        getAllMessages: getAllMessages || loadMessages || (async () => {
          if (Array.isArray(allMessages)) return allMessages;
          return Array.from(memoryStorage.messages.values());
        }),
        get allMessages() {
          if (Array.isArray(allMessages)) return allMessages;
          return Array.from(memoryStorage.messages.values());
        },
        processedDeletedMessages: processedDeletedMessages || memoryStorage.deletedMessages,
        testConnection: testConnection || (async () => false),
        deleteMessage: async (messageId, sessionId = null) => {
          try {
            const result = await deleteMessageById(messageId, sessionId)
            return result.success
          } catch (error) {
            console.log(chalk.red(`❌ DB delete failed for ${messageId}:`, error.message))
            return await deleteFromMemory(messageId, sessionId)
          }
        }
      }
    } catch (error) {
      console.log(chalk.yellow("⚠️ Database not available, using memory fallback"))
      dbFunctions = {
        saveAllMessages: async (msgs) => { await saveToMemory(msgs); return true },
        loadMessages: async () => Array.from(memoryStorage.messages.values()),
        findMessageById: async (id, sessionId) => memoryStorage.messages.get(id),
        getAllMessages: async () => Array.from(memoryStorage.messages.values()),
        get allMessages() { return Array.from(memoryStorage.messages.values()) },
        processedDeletedMessages: memoryStorage.deletedMessages,
        testConnection: async () => false,
        deleteMessage: async (id, sessionId) => await deleteFromMemory(id, sessionId)
      }
    }
  }
  return dbFunctions
}

// ========================================
// MESSAGE FORMATTING
// ========================================

function formatMessage(message) {
  return {
    id: message.key.id,
    from: message.key.remoteJid,
    sender: message.key.participant || message.key.remoteJid,
    timestamp: message.messageTimestamp || Math.floor(Date.now() / 1000),
    sessionId: message.sessionId || "unknown",
    userId: message.userId || "unknown",
    fromMe: message.key.fromMe || false,
    content: message.message?.conversation ||
             message.message?.extendedTextMessage?.text ||
             message.message?.imageMessage?.caption ||
             message.message?.videoMessage?.caption || "",
    media: message.message?.imageMessage ||
           message.message?.videoMessage ||
           message.message?.audioMessage ||
           message.message?.documentMessage || null,
    mediaType: message.message?.imageMessage ? "image" :
               message.message?.videoMessage ? "video" :
               message.message?.audioMessage ? "audio" :
               message.message?.documentMessage ? "document" : null,
  }
}

// ========================================
// CONNECTION MANAGEMENT
// ========================================

async function checkHealth(forceCheck = false) {
  if (state.connectionTestInProgress && !forceCheck) {
    return state.isConnected
  }

  const timeSinceCheck = Date.now() - (state.lastHealthCheck || 0)
  if (!forceCheck && timeSinceCheck < 5000) {
    return state.isConnected
  }

  state.connectionTestInProgress = true
  const { testConnection } = getDbFunctions()
  const wasConnected = state.isConnected
  
  try {
    state.isConnected = await testConnection()
  } catch (error) {
    state.isConnected = false
  }
  
  state.lastHealthCheck = Date.now()
  state.connectionTestInProgress = false

  if (state.isConnected && !wasConnected) {
    console.log(chalk.green("🎉 Database connection restored!"))
    migratePendingData().catch(() => {}) // Fire and forget
  } else if (!state.isConnected && wasConnected) {
    console.log(chalk.red("💔 Database connection lost - switching to memory storage"))
    showMemoryStatus()
  }

  return state.isConnected
}

function showMemoryStatus() {
  console.log(chalk.blue(`💾 Memory: ${memoryStorage.messages.size}/${CONFIG.MAX_MEMORY_MESSAGES} messages, Pending: ${state.pendingMessages.size}, Deleted: ${memoryStorage.deletedMessages.size}`))
}

// ========================================
// MEMORY OPERATIONS
// ========================================

async function saveToMemory(messages) {
  if (!Array.isArray(messages)) return false
  
  let newMessages = 0
  
  for (const msg of messages) {
    if (memoryStorage.deletedMessages.has(msg.id) || state.pendingDeleted.has(msg.id)) {
      continue
    }
    
    if (!memoryStorage.messages.has(msg.id)) {
      memoryStorage.messages.set(msg.id, msg)
      
      // Track by session for faster session-based operations
      if (msg.sessionId && msg.sessionId !== "unknown") {
        if (!memoryStorage.messagesBySession.has(msg.sessionId)) {
          memoryStorage.messagesBySession.set(msg.sessionId, new Set())
        }
        memoryStorage.messagesBySession.get(msg.sessionId).add(msg.id)
      }
      
      newMessages++
    }
    
    if (!state.pendingMessages.has(msg.id)) {
      state.pendingMessages.set(msg.id, msg)
    }
  }
  
  // Handle memory overflow with batch removal
  if (memoryStorage.messages.size > CONFIG.MAX_MEMORY_MESSAGES) {
    const excess = memoryStorage.messages.size - CONFIG.MAX_MEMORY_MESSAGES
    const oldestKeys = Array.from(memoryStorage.messages.keys()).slice(0, excess)
    
    for (const key of oldestKeys) {
      const msg = memoryStorage.messages.get(key)
      memoryStorage.messages.delete(key)
      
      // Clean up session tracking
      if (msg.sessionId && memoryStorage.messagesBySession.has(msg.sessionId)) {
        memoryStorage.messagesBySession.get(msg.sessionId).delete(key)
        if (memoryStorage.messagesBySession.get(msg.sessionId).size === 0) {
          memoryStorage.messagesBySession.delete(msg.sessionId)
        }
      }
    }
  }
  
  // Handle pending overflow
  if (state.pendingMessages.size > CONFIG.MAX_PENDING_MESSAGES) {
    const excess = state.pendingMessages.size - CONFIG.MAX_PENDING_MESSAGES
    const oldestKeys = Array.from(state.pendingMessages.keys()).slice(0, excess)
    oldestKeys.forEach(key => state.pendingMessages.delete(key))
  }
  
  if (newMessages > 0) {
    console.log(chalk.blue(`💾 Saved ${newMessages} messages to memory (Total: ${memoryStorage.messages.size})`))
  }
  
  return true
}

async function deleteFromMemory(messageId, sessionId = null) {
  try {
    let deleted = false
    
    // Remove from memory storage
    if (memoryStorage.messages.has(messageId)) {
      const msg = memoryStorage.messages.get(messageId)
      memoryStorage.messages.delete(messageId)
      deleted = true
      
      // Clean up session tracking
      if (msg.sessionId && memoryStorage.messagesBySession.has(msg.sessionId)) {
        memoryStorage.messagesBySession.get(msg.sessionId).delete(messageId)
        if (memoryStorage.messagesBySession.get(msg.sessionId).size === 0) {
          memoryStorage.messagesBySession.delete(msg.sessionId)
        }
      }
    }
    
    // Remove from pending messages
    if (state.pendingMessages.has(messageId)) {
      state.pendingMessages.delete(messageId)
      deleted = true
    }
    
    // Add to deleted sets
    memoryStorage.deletedMessages.add(messageId)
    state.pendingDeleted.add(messageId)
    
    if (deleted) {
      console.log(chalk.green(`✅ Deleted from memory: ${messageId} (Total: ${memoryStorage.messages.size})`))
    }
    
    return deleted
  } catch (error) {
    console.log(chalk.red(`❌ Memory delete error for ${messageId}:`, error.message))
    return false
  }
}

// ========================================
// DATA MIGRATION
// ========================================

async function migratePendingData() {
  try {
    if (!(await checkHealth())) return false

    const { saveAllMessages: dbSaveAllMessages, processedDeletedMessages } = getDbFunctions()
    
    // Migrate messages in batches
    const allPendingMessages = Array.from(state.pendingMessages.values())
    const memoryMessages = Array.from(memoryStorage.messages.values())
    
    const uniqueMessages = [...allPendingMessages, ...memoryMessages.filter(msg => 
      !allPendingMessages.some(pm => pm.id === msg.id)
    )]
    
    if (uniqueMessages.length > 0) {
      // Process in batches for better performance
      for (let i = 0; i < uniqueMessages.length; i += CONFIG.BATCH_SIZE) {
        const batch = uniqueMessages.slice(i, i + CONFIG.BATCH_SIZE)
        await dbSaveAllMessages(batch)
      }
      
      console.log(chalk.green(`✅ Migrated ${uniqueMessages.length} messages to database`))
      
      // Clear memory after successful migration
      state.pendingMessages.clear()
      memoryStorage.messages.clear()
      memoryStorage.messagesBySession.clear()
    }
    
    // Migrate deleted messages
    if (state.pendingDeleted.size > 0) {
      for (const deletedId of state.pendingDeleted) {
        processedDeletedMessages.add(deletedId)
      }
      state.pendingDeleted.clear()
      memoryStorage.deletedMessages.clear()
    }
    
    return true
  } catch (error) {
    console.log(chalk.red("❌ Migration failed:", error.message))
    state.isConnected = false
    scheduleRetry()
    return false
  }
}

function scheduleRetry() {
  if (state.retryTimeout) clearTimeout(state.retryTimeout)
  
  state.retryTimeout = setTimeout(async () => {
    if (await checkHealth(true)) {
      console.log(chalk.green("✅ Database reconnection successful!"))
    } else {
      scheduleRetry()
    }
  }, CONFIG.RETRY_DELAY)
}

// ========================================
// CLEANUP AND MAINTENANCE
// ========================================

function startCleanup() {
  if (state.cleanupInterval) clearInterval(state.cleanupInterval)
  
  state.cleanupInterval = setInterval(async () => {
    try {
      const timeSinceCheck = Date.now() - (state.lastHealthCheck || 0)
      if (timeSinceCheck > CONFIG.HEALTH_CHECK_INTERVAL) {
        await checkHealth()
      }

      if (state.isConnected) {
        // Clear memory when database is available
        memoryStorage.messages.clear()
        memoryStorage.messagesBySession.clear()
        state.pendingMessages.clear()
        
        // Trim in-memory cache
        inMemoryStore.evictIfNeeded()
      } else {
        // Trim memory storage when database is down
        if (memoryStorage.messages.size > CONFIG.MAX_MEMORY_MESSAGES * 0.8) {
          const excess = memoryStorage.messages.size - Math.floor(CONFIG.MAX_MEMORY_MESSAGES * 0.8)
          const oldestKeys = Array.from(memoryStorage.messages.keys()).slice(0, excess)
          oldestKeys.forEach(key => {
            const msg = memoryStorage.messages.get(key)
            memoryStorage.messages.delete(key)
            if (msg.sessionId && memoryStorage.messagesBySession.has(msg.sessionId)) {
              memoryStorage.messagesBySession.get(msg.sessionId).delete(key)
            }
          })
        }
      }
      
      // Trim deleted sets
      if (state.pendingDeleted.size > 500) {
        const arr = Array.from(state.pendingDeleted)
        state.pendingDeleted = new Set(arr.slice(-500))
      }
      
    } catch (error) {
      console.log(chalk.yellow("⚠️ Cleanup error:", error.message))
    }
  }, CONFIG.CLEANUP_INTERVAL)
}

// ========================================
// CORE OPERATIONS
// ========================================

async function saveBatchMessages(messageDataArray) {
  try {
    if (await checkHealth(!state.isConnected)) {
      const { saveAllMessages: dbSaveAllMessages } = getDbFunctions()
      await dbSaveAllMessages(messageDataArray)
    } else {
      await saveToMemory(messageDataArray)
    }
  } catch (error) {
    console.log(chalk.red(`❌ Batch save failed for ${messageDataArray.length} messages`))
    state.isConnected = false
    await saveToMemory(messageDataArray)
  }
}

async function deleteMessage(messageId, sessionId = null) {
  try {
    let deleted = false
    
    if (state.isConnected) {
      try {
        const result = await deleteMessageById(messageId, sessionId)
        if (result.success) {
          deleted = true
        } else {
          deleted = await deleteFromMemory(messageId, sessionId)
        }
      } catch (dbError) {
        console.log(chalk.red(`❌ DB delete failed for ${messageId}, using memory fallback`))
        state.isConnected = false
        deleted = await deleteFromMemory(messageId, sessionId)
      }
    } else {
      deleted = await deleteFromMemory(messageId, sessionId)
    }
    
    // Remove from in-memory store
    const keys = Array.from(inMemoryStore.messages.keys())
    for (const key of keys) {
      if (key.endsWith(`_${messageId}`)) {
        inMemoryStore.messages.delete(key)
        const index = inMemoryStore.messageOrder.indexOf(key)
        if (index > -1) {
          inMemoryStore.messageOrder.splice(index, 1)
        }
        break
      }
    }
    
    return deleted
  } catch (error) {
    console.log(chalk.red(`❌ Critical delete error for ${messageId}:`, error.message))
    
    try {
      return await deleteFromMemory(messageId, sessionId)
    } catch (memError) {
      console.log(chalk.red(`❌ Emergency memory delete failed for ${messageId}`))
      return false
    }
  }
}

// ========================================
// PUBLIC API FUNCTIONS
// ========================================

async function storeSaveAllMessages(messages) {
  try {
    if (!Array.isArray(messages) || messages.length === 0) return true

    if (await checkHealth()) {
      const { saveAllMessages: dbSaveAllMessages } = getDbFunctions()
      await dbSaveAllMessages(messages)
    } else {
      await saveToMemory(messages)
    }
    
    return true
  } catch (error) {
    console.log(chalk.red("❌ SaveAll error:", error.message))
    state.isConnected = false
    await saveToMemory(messages)
    return true
  }
}

async function loadAllMessages() {
  try {
    if (await checkHealth()) {
      const { loadMessages } = getDbFunctions()
      return await loadMessages()
    }
    
    return Array.from(memoryStorage.messages.values())
  } catch (error) {
    console.log(chalk.red("❌ Load error:", error.message))
    return Array.from(memoryStorage.messages.values())
  }
}

async function storeGetAllMessages() {
  try {
    if (memoryStorage.messages.size > 0) {
      return Array.from(memoryStorage.messages.values())
    }
    
    if (await checkHealth()) {
      const { getAllMessages } = getDbFunctions()
      
      if (typeof getAllMessages === 'function') {
        const dbMessages = await getAllMessages()
        return dbMessages || []
      } else {
        const { allMessages } = getDbFunctions()
        if (Array.isArray(allMessages)) {
          return allMessages
        }
      }
    }
    
    return []
  } catch (error) {
    console.log(chalk.red("❌ Error getting all messages:", error.message))
    return Array.from(memoryStorage.messages.values())
  }
}

async function storeFindMessageById(messageId, sessionId = null) {
  try {
    // Check memory storage first (fastest)
    if (memoryStorage.messages.has(messageId)) {
      return memoryStorage.messages.get(messageId)
    }
    
    // Check in-memory store
    const keys = Array.from(inMemoryStore.messages.keys())
    for (const key of keys) {
      if (key.endsWith(`_${messageId}`)) {
        inMemoryStore.updateLRU(key)
        return inMemoryStore.messages.get(key)
      }
    }
    
    // Check database if connected
    if (await checkHealth()) {
      const { findMessageById: dbFindMessageById } = getDbFunctions()
      
      if (typeof dbFindMessageById === 'function') {
        try {
          const dbMessage = await dbFindMessageById(messageId, sessionId)
          
          if (dbMessage) {
            return {
              id: dbMessage.id,
              from: dbMessage.from,
              sender: dbMessage.sender,
              timestamp: parseInt(dbMessage.timestamp),
              content: dbMessage.content,
              media: dbMessage.media,
              mediaType: dbMessage.mediaType,
              sessionId: dbMessage.sessionId,
              userId: dbMessage.userId,
              fromMe: dbMessage.fromMe || false,
              isDeleted: dbMessage.isDeleted || false
            }
          }
        } catch (dbError) {
          console.log(chalk.red(`❌ DB query error for ${messageId}`))
        }
      }
    }
    
    return null
  } catch (error) {
    console.log(chalk.red(`❌ Error finding message ${messageId}:`, error.message))
    return null
  }
}

function getProcessedDeletedMessages() {
  try {
    if (state.isConnected) {
      const { processedDeletedMessages } = getDbFunctions()
      return processedDeletedMessages
    } else {
      return memoryStorage.deletedMessages
    }
  } catch (error) {
    return memoryStorage.deletedMessages
  }
}

function addProcessedDeletedMessage(messageId) {
  try {
    if (state.isConnected) {
      const { processedDeletedMessages } = getDbFunctions()
      processedDeletedMessages.add(messageId)
    } else {
      memoryStorage.deletedMessages.add(messageId)
      state.pendingDeleted.add(messageId)
    }
    return true
  } catch (error) {
    return false
  }
}

function getAllMessagesSync() {
  try {
    const { allMessages } = getDbFunctions()
    if (Array.isArray(allMessages)) {
      return allMessages
    }
    return Array.from(memoryStorage.messages.values())
  } catch (error) {
    return Array.from(memoryStorage.messages.values())
  }
}

// ========================================
// INITIALIZATION AND CLEANUP
// ========================================

async function initialize() {
  console.log(chalk.blue("🚀 Initializing Store Manager..."))
  await checkHealth(true)
  startCleanup()
  console.log(chalk.green("✅ Store Manager initialized"))
}

function cleanup() {
  console.log(chalk.yellow('🔄 Graceful shutdown...'))
  if (state.retryTimeout) clearTimeout(state.retryTimeout)
  if (state.cleanupInterval) clearInterval(state.cleanupInterval)
  console.log(chalk.green('✅ Cleanup completed'))
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

initialize().catch(error => {
  console.log(chalk.red("❌ Initialization error:", error.message))
})

// ========================================
// EXPORTS
// ========================================

module.exports = {
  store: inMemoryStore,
  saveAllMessages: storeSaveAllMessages,
  loadMessages: loadAllMessages,
  deleteMessage,
  findMessage: storeFindMessageById,
  findMessageById: storeFindMessageById,
  get allMessages() { 
    return getAllMessagesSync()
  },
  getAllMessages: storeGetAllMessages,
  get processedDeletedMessages() { return getProcessedDeletedMessages() },
  addProcessedDeletedMessage,
  getDatabaseState: () => ({ ...state }),
  getMemoryStorage: () => ({ 
    messagesCount: memoryStorage.messages.size,
    deletedCount: memoryStorage.deletedMessages.size,
    sessionCount: memoryStorage.messagesBySession.size
  }),
}