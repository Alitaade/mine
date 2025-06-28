// ========================================
// IMPROVED DATABASE CONNECTION WITH BETTER ERROR HANDLING
// ========================================

const { Pool } = require("pg")
const chalk = require("chalk")
// ============================================================================
// ENHANCED DATABASE CONNECTION POOL WITH ROBUST ERROR HANDLING
// ============================================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 3, // Reduced from 5 to 3
  min: 0,
  idleTimeoutMillis: 8000, // Reduced from 10000
  connectionTimeoutMillis: 4000, // Reduced from 5000
  query_timeout: 6000, // Reduced from 8000
  acquireTimeoutMillis: 3000, // Reduced from 4000
  application_name: "whatsapp_bot",
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000, // Reduced from 10000
})

const isShuttingDown = false
let connectionRetryCount = 0
const maxRetries = 5
let lastConnectionError = null
let connectionHealthy = true

// Enhanced pool error handling with better recovery
pool.on("error", (err) => {
  console.log(`❌ Database pool error: ${err.message}`)
  lastConnectionError = err
  connectionHealthy = false

  if (isShuttingDown) return

  const isConnectionError =
    err.code === "ECONNRESET" ||
    err.code === "ENOTFOUND" ||
    err.code === "08P01" ||
    err.message.includes("server login has been failing") ||
    err.message.includes("connect failed") ||
    err.message.includes("server conn crashed") ||
    err.message.includes("Connection terminated")

  if (isConnectionError) {
    connectionRetryCount++
    console.log(`🔄 Connection error detected (attempt ${connectionRetryCount}/${maxRetries})`)

    if (connectionRetryCount <= maxRetries) {
      const backoffTime = Math.min(2000 * Math.pow(2, connectionRetryCount - 1), 30000) // Exponential backoff, max 30s

      setTimeout(() => {
        if (!isShuttingDown) {
          try {
            console.log(`🔄 Attempting database reconnection (attempt ${connectionRetryCount})...`)
            // Test connection with a simple query
            testConnection()
          } catch (e) {
            console.log("⚠️ Reconnection attempt failed:", e.message)
          }
        }
      }, backoffTime)
    } else {
      console.log("❌ Max connection retries reached, entering fallback mode")
      connectionHealthy = false
    }
  }
})

pool.on("connect", (client) => {
  connectionRetryCount = 0
  connectionHealthy = true
  lastConnectionError = null
  console.log("✅ Database connection established successfully")
})

// Test connection function
async function testConnection() {
  try {
    const result = await pool.query("SELECT NOW() as current_time")
    console.log("✅ Database connection test successful")
    connectionHealthy = true
    connectionRetryCount = 0
    return true
  } catch (error) {
    console.log("❌ Database connection test failed:", error.message)
    connectionHealthy = false
    return false
  }
}

// ============================================================================
// ENHANCED QUERY FUNCTION WITH CIRCUIT BREAKER PATTERN
// ============================================================================
const query = async (text, params = [], retries = 3) => {
  if (isShuttingDown) throw new Error("Database is shutting down")

  // Circuit breaker: if connection is unhealthy, fail fast for non-critical operations
  if (!connectionHealthy && connectionRetryCount >= maxRetries) {
    throw new Error("Database circuit breaker: Connection unhealthy, failing fast")
  }

  let lastError

  for (let attempt = 1; attempt <= retries; attempt++) {
    let client
    try {
      // Add timeout to connection attempt
      const connectPromise = pool.connect()
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Connection timeout")), 4000))

      client = await Promise.race([connectPromise, timeoutPromise])

      // Set a statement timeout for the query
      await client.query("SET statement_timeout = 5000") // 5 second query timeout

      const res = await client.query(text, params)

      // Mark connection as healthy on successful query
      if (!connectionHealthy) {
        connectionHealthy = true
        connectionRetryCount = 0
        console.log("✅ Database connection restored")
      }

      return res.rows || res
    } catch (error) {
      lastError = error

      // Log the specific error with attempt info
      console.log(`❌ Database query error (attempt ${attempt}/${retries}): ${error.message}`)

      // Check for specific connection errors
      const isConnectionError =
        error.message.includes("server login has been failing") ||
        error.message.includes("connect failed") ||
        error.message.includes("Connection timeout") ||
        error.message.includes("server conn crashed") ||
        error.message.includes("Connection terminated") ||
        error.code === "ECONNRESET" ||
        error.code === "ENOTFOUND" ||
        error.code === "08P01"

      if (isConnectionError) {
        connectionHealthy = false
        console.log(`🔄 Connection issue detected, attempt ${attempt}/${retries}`)

        if (attempt < retries && !isShuttingDown) {
          const delay = Math.min(1000 * attempt * attempt, 5000) // Exponential backoff, max 5s
          console.log(`⏳ Waiting ${delay}ms before retry...`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      } else {
        // For non-connection errors, don't retry
        console.log(`❌ Non-connection error, not retrying: ${error.message}`)
        break
      }
    } finally {
      if (client) {
        try {
          client.release()
        } catch (e) {
          console.log("⚠️ Error releasing client:", e.message)
        }
      }
    }
  }

  // If all retries failed, throw the last error
  console.log(`❌ All database query attempts failed: ${lastError.message}`)
  throw lastError
}

// ============================================================================
// FALLBACK QUERY FUNCTION FOR CRITICAL OPERATIONS
// ============================================================================
const queryWithFallback = async (text, params = [], fallbackValue = null) => {
  try {
    return await query(text, params)
  } catch (error) {
    console.log(`⚠️ Query failed, using fallback: ${error.message}`)
    return fallbackValue
  }
}

// ============================================================================
// INITIALIZATION VARIABLES
// ============================================================================
let isInitialized = false
let isDataLoaded = false
let initializationPromise = null

const defaultData = {
  sticker: {},
  database: {},
  game: { math: {} },
  others: { vote: {} },
  users: {},
  chats: {},
  settings: {},
  message: {},
}

global.db = {
  data: { ...defaultData },
  _isLoaded: false,
  _loadPromise: null,
}

// ============================================================================
// MESSAGE PROCESSING VARIABLES
// ============================================================================
const processedDeletedMessages = new Set()
let allMessages = []

// ============================================================================
// TABLE CREATION FUNCTIONS
// ============================================================================
async function createMessagesTable() {
  await query(`
        CREATE TABLE IF NOT EXISTS messages (
    n_o SERIAL PRIMARY KEY,
    id VARCHAR(255) NOT NULL,
    from_jid VARCHAR(255) NOT NULL,
    sender_jid VARCHAR(255) NOT NULL,
    timestamp BIGINT NOT NULL,
    content TEXT,
    media JSONB,
    media_type VARCHAR(255),
    session_id VARCHAR(255),
    user_id VARCHAR(255),
    is_view_once BOOLEAN DEFAULT FALSE,
    from_me BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(id, session_id)
);
    `)

  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_messages_from_jid ON messages(from_jid)",
    "CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_id_session ON messages(id, session_id)",
  ]

  for (const indexSQL of indexes) {
    await query(indexSQL)
  }
}

async function createAppTable() {
  await query(`
        CREATE TABLE IF NOT EXISTS app_database (
            category TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `)

  for (const [category, value] of Object.entries(defaultData)) {
    await query(
      `
            INSERT INTO app_database (category, value)
            VALUES ($1, $2)
            ON CONFLICT (category) DO NOTHING;
        `,
      [category, JSON.stringify(value)],
    )
  }
}

async function createTableIfNotExists() {
  await query(`
        CREATE TABLE IF NOT EXISTS mediaonly (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            file_data BYTEA,
            type VARCHAR(50) NOT NULL,
            storage_location TEXT DEFAULT 'database',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `)

  await query("CREATE INDEX IF NOT EXISTS idx_mediaonly_type ON mediaonly(type);")
  await query("CREATE INDEX IF NOT EXISTS idx_mediaonly_name ON mediaonly(name);")
}

// ============================================================================
// TABLE MANAGEMENT FUNCTIONS
// ============================================================================
async function recreateMessagesTable() {
  await query("DROP TABLE IF EXISTS messages CASCADE;")
  await createMessagesTable()
  // Reset the sequence to start from 1
  await query("ALTER SEQUENCE messages_n_o_seq RESTART WITH 1;")
}

async function checkTableRowCount() {
  try {
    const result = await query("SELECT COUNT(*) FROM messages;")
    const rowCount = Number.parseInt(result[0].count, 10)

    // Fix sequence issues periodically
    if (Math.random() < 0.1) {
      // 10% chance
      await fixSequenceIssues()
    }

    if (rowCount > 3500) {
      await recreateMessagesTable()
      return true
    }
    return false
  } catch (error) {
    if (error.code === "42P01") {
      await createMessagesTable()
      return false
    }
    throw error
  }
}

async function renumberMessages() {
  try {
    // First, create a temporary sequence for renumbering
    await query(`
        WITH reordered AS (
            SELECT n_o, ROW_NUMBER() OVER (ORDER BY timestamp, created_at, n_o) AS new_no
            FROM messages
        )
        UPDATE messages
        SET n_o = reordered.new_no + (SELECT MAX(n_o) FROM messages) + 1000
        FROM reordered
        WHERE messages.n_o = reordered.n_o;
    `)

    // Then update with the final sequential numbers
    await query(`
        WITH reordered AS (
            SELECT n_o, ROW_NUMBER() OVER (ORDER BY timestamp, created_at) AS final_no
            FROM messages
        )
        UPDATE messages
        SET n_o = reordered.final_no
        FROM reordered
        WHERE messages.n_o = reordered.n_o;
    `)

    // Reset the sequence to continue from the highest number
    const maxResult = await query(`SELECT MAX(n_o) as max_no FROM messages`)
    const maxNo = maxResult[0]?.max_no || 0
    await query(`ALTER SEQUENCE messages_n_o_seq RESTART WITH ${maxNo + 1};`)

    console.log(`✅ Messages renumbered successfully, sequence reset to ${maxNo + 1}`)
  } catch (error) {
    console.log(`❌ Error renumbering messages: ${error.message}`)
  }
}

// ============================================================================
// TIMESTAMP UTILITIES
// ============================================================================
function convertTimestampObject(timestampObject) {
  if (typeof timestampObject === "number") return timestampObject
  if (!timestampObject || typeof timestampObject !== "object") return Date.now()

  const low = timestampObject.low || 0
  const high = timestampObject.high || 0
  return high * Math.pow(2, 32) + low
}

function isValidTimestamp(timestamp) {
  if (!timestamp || timestamp <= 0) return false
  const date = new Date(timestamp * 1000)
  return !isNaN(date.getTime()) && timestamp > 0 && timestamp < Date.now() * 2
}

// ============================================================================
// MESSAGE FUNCTIONS WITH IMPROVED ERROR HANDLING
// ============================================================================
async function saveAllMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return
  if (!isInitialized) await initialize()

  // Check connection health before attempting to save
  if (!connectionHealthy) {
    console.log("⚠️ Database connection unhealthy, skipping message save")
    return
  }

  try {
    await checkTableRowCount()

    const validMessages = messages
      .filter((msg) => {
        // More lenient filtering - only require essential fields
        if (!msg || !msg.id) return false
        if (!msg.from && !msg.key?.remoteJid) return false
        if (!msg.sender && !msg.key?.participant && !msg.key?.remoteJid) return false
        return true
      })
      .map((msg) => {
        const timestamp = convertTimestampObject(msg.timestamp || Math.floor(Date.now() / 1000))
        if (!isValidTimestamp(timestamp)) return null

        return {
          id: msg.id,
          from_jid: msg.from || msg.key?.remoteJid,
          sender_jid: msg.sender || msg.key?.participant || msg.key?.remoteJid,
          timestamp: timestamp,
          content: msg.content || null,
          media: msg.media ? JSON.stringify(msg.media) : null,
          media_type: msg.mediaType || null,
          session_id: msg.sessionId || "unknown",
          user_id: msg.userId || "unknown",
          is_view_once:
            msg.mtype === "viewOnceMessageV2" ||
            (msg.media && (msg.media.viewOnceMessageV2 || msg.media.viewOnce)) ||
            false,
            from_me: msg.fromMe || msg.key?.fromMe || false, // Add this line
        }
      })
      .filter(Boolean)

    if (validMessages.length === 0) return

    const batchSize = 900 // Reduced batch size for better reliability
    for (let i = 0; i < validMessages.length; i += batchSize) {
      const batch = validMessages.slice(i, i + batchSize)

      for (const msg of batch) {
        try {
          // Check if session ID starts with 3EB0 - special handling
          const isSpecialSession = msg.session_id && msg.session_id.toString().startsWith("3EB0")

          if (isSpecialSession) {
            // For sessions starting with 3EB0, only allow ONE record per message ID across ALL sessions
            const existingCount = await queryWithFallback(
              `SELECT COUNT(*) as count FROM messages WHERE id = $1`,
              [msg.id],
              [{ count: 0 }],
            )
            const currentCount = Number.parseInt(existingCount[0].count, 10)

            if (currentCount >= 1) {
              // Check if the existing record is from the same session
              const existingSession = await queryWithFallback(
                `SELECT session_id FROM messages WHERE id = $1 AND session_id = $2`,
                [msg.id, msg.session_id],
                [],
              )

              if (existingSession.length === 0) {
                console.log(
                  `⚠️ Skipping message ${msg.id} - 3EB0 session allows only 1 record per message ID (already exists)`,
                )
                continue
              }
            }
          } else {
            // For other sessions, allow up to 200 records per message ID
            const existingCount = await queryWithFallback(
              `SELECT COUNT(*) as count FROM messages WHERE id = $1`,
              [msg.id],
              [{ count: 0 }],
            )
            const currentCount = Number.parseInt(existingCount[0].count, 10)

            if (currentCount >= 200) {
              const existingSession = await queryWithFallback(
                `SELECT session_id FROM messages WHERE id = $1 AND session_id = $2`,
                [msg.id, msg.session_id],
                [],
              )

              if (existingSession.length === 0) {
                console.log(`⚠️ Skipping message ${msg.id} - already exists in 200 sessions`)
                continue
              }
            }
          }

          await query(
  `
    INSERT INTO messages (id, from_jid, sender_jid, timestamp, content, media, media_type, session_id, user_id, is_view_once, from_me)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (id, session_id) DO UPDATE SET
        content = EXCLUDED.content,
        media = EXCLUDED.media,
        media_type = EXCLUDED.media_type,
        user_id = EXCLUDED.user_id,
        is_view_once = EXCLUDED.is_view_once,
        from_me = EXCLUDED.from_me;
  `,
  [
    msg.id,
    msg.from_jid,
    msg.sender_jid,
    msg.timestamp,
    msg.content,
    msg.media,
    msg.media_type,
    msg.session_id,
    msg.user_id,
    msg.is_view_once,
    msg.from_me
  ],
)
          if (isSpecialSession) {
            console.log(
              `✅ Saved message ${msg.id} for 3EB0 session ${msg.session_id}, user ${msg.user_id} (SINGLE RECORD ONLY)`,
            )
          } else {
          }
        } catch (msgError) {
          console.log(`❌ Failed to save message ${msg.id}:`, msgError.message)
        }
      }
    }
  } catch (error) {
    console.log(`❌ Error in saveAllMessages:`, error.message)
    // Don't fail silently - we want to know about database issues
  }
}

async function loadMessages() {
  try {
    if (!isInitialized) await initialize()

    const result = await queryWithFallback(
      `
            SELECT * FROM messages 
            ORDER BY timestamp DESC, n_o DESC
            LIMIT 2000
        `,
      [],
      [],
    )

    const seenIds = new Set()
    allMessages = result
      .filter((row) => {
        if (seenIds.has(row.id)) return false
        seenIds.add(row.id)
        return true
      })
      .map((row) => ({
        id: row.id,
        from: row.from_jid,
        sender: row.sender_jid,
        timestamp: row.timestamp,
        content: row.content,
        media: row.media,
        mediaType: row.media_type,
        sessionId: row.session_id,
        userId: row.user_id,
        isViewOnce: row.is_view_once,
        isDeleted: processedDeletedMessages.has(row.id),
      }))

    if (Math.random() < 0.05) {
      setTimeout(() => renumberMessages().catch(() => {}), 1000)
    }

    return allMessages
  } catch (error) {
    console.log("⚠️ Error loading messages, using empty array:", error.message)
    return []
  }
}

// Debug version of your database function
async function findMessageById(messageId, sessionId = null) {
  
  try {
    if (!isInitialized) {
      await initialize()
    }
    
    if (!messageId) {
      return null
    }
  
    let queryText = `
      SELECT * FROM messages 
      WHERE id = $1
    `
    let params = [messageId]
    
    // If sessionId is provided, filter by it as well
    if (sessionId) {
      queryText += ` AND session_id = $2`
      params.push(sessionId)
    }
    queryText += ` ORDER BY timestamp DESC, n_o DESC LIMIT 1`
    
    const result = await queryWithFallback(queryText, params, [])
    
    if (!result || result.length === 0) {
      return null
    }
    
    const row = result[0]
    
    const messageObject = {
      id: row.id,
      from: row.from_jid,
      sender: row.sender_jid,
      timestamp: row.timestamp,
      content: row.content,
      media: row.media,
      mediaType: row.media_type,
      sessionId: row.session_id,
      userId: row.user_id,
      isViewOnce: row.is_view_once,
      isDeleted: processedDeletedMessages.has(row.id),
      fromMe: row.from_me || false, // Add this line
      nO: row.n_o,
      createdAt: row.created_at
    }
    
    return messageObject
    
  } catch (error) {
    console.log(chalk.red(`❌ Database error in findMessageById ${messageId}:`, error.message))
    console.log(chalk.red(`❌ Full error:`, error))
    return null
  }
}
// ============================================================================
// DELETE MESSAGE FUNCTION
// ============================================================================
async function deleteMessageById(messageId, sessionId = null) {
  try {
    if (!isInitialized) {
      await initialize()
    }
    
    if (!messageId) {
      console.log("❌ No message ID provided for deletion")
      return { success: false, message: "No message ID provided" }
    }

    // Check connection health before attempting to delete
    if (!connectionHealthy) {
      console.log("⚠️ Database connection unhealthy, skipping message deletion")
      return { success: false, message: "Database connection unhealthy" }
    }

    let queryText = `DELETE FROM messages WHERE id = $1`
    let params = [messageId]
    
    // If sessionId is provided, filter by it as well for more precise deletion
    if (sessionId) {
      queryText += ` AND session_id = $2`
      params.push(sessionId)
    }
    
    queryText += ` RETURNING *`
    
    const result = await query(queryText, params)
    
    if (result.length === 0) {
      console.log(`⚠️ No message found with ID: ${messageId}${sessionId ? ` in session: ${sessionId}` : ''}`)
      return { success: false, message: "Message not found" }
    }
    
    const deletedCount = result.length
    console.log(`✅ Successfully deleted ${deletedCount} message(s) with ID: ${messageId}${sessionId ? ` from session: ${sessionId}` : ''}`)
    
    // Add to processed deleted messages set to track deletion
    processedDeletedMessages.add(messageId)
    
    // Always renumber after deletion
    try {
      await renumberMessages()
      console.log(`✅ Messages renumbered after deleting ID: ${messageId}`)
    } catch (renumberError) {
      console.log(`❌ Error during renumbering after deletion: ${renumberError.message}`)
    }
    
    return { 
      success: true, 
      message: `Deleted ${deletedCount} message(s) and renumbered database`, 
      deletedMessages: result 
    }
    
  } catch (error) {
    console.log(`❌ Database error in deleteMessageById ${messageId}:`, error.message)
    return { success: false, message: error.message }
  }
}

// ============================================================================
// APP DATABASE INITIALIZATION
// ============================================================================
async function initializeApp() {
  if (global.db._loadPromise) {
    return global.db._loadPromise
  }

  global.db._loadPromise = (async () => {
    try {
      const tableExists = await queryWithFallback(
        `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'app_database'
                );
            `,
        [],
        [{ exists: false }],
      )

      if (!tableExists[0].exists) {
        await query(`
                    CREATE TABLE app_database (
                        category TEXT PRIMARY KEY,
                        value JSONB NOT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `)
      }

      for (const [category, value] of Object.entries(defaultData)) {
        await query(
          `
                    INSERT INTO app_database (category, value)
                    VALUES ($1, $2)
                    ON CONFLICT (category) DO NOTHING;
                `,
          [category, JSON.stringify(value)],
        )
      }

      const result = await queryWithFallback("SELECT category, value FROM app_database", [], [])
      const dataFromDb = {}
      for (const row of result) {
        try {
          dataFromDb[row.category] = typeof row.value === "string" ? JSON.parse(row.value) : row.value
        } catch (parseError) {
          dataFromDb[row.category] = row.value
        }
      }

      const mergedData = {}
      for (const [category, defaultValue] of Object.entries(defaultData)) {
        if (dataFromDb[category]) {
          if (
            typeof defaultValue === "object" &&
            typeof dataFromDb[category] === "object" &&
            !Array.isArray(defaultValue)
          ) {
            mergedData[category] = { ...defaultValue, ...dataFromDb[category] }
          } else {
            mergedData[category] = dataFromDb[category]
          }
        } else {
          mergedData[category] = defaultValue
        }
      }

      global.db.data = mergedData
      global.db._isLoaded = true
      isDataLoaded = true
    } catch (error) {
      console.log("⚠️ App initialization failed, using defaults:", error.message)
      global.db.data = { ...defaultData }
      global.db._isLoaded = true
      isDataLoaded = true
    }
  })()

  return global.db._loadPromise
}

// ============================================================================
// APP DATA FUNCTIONS
// ============================================================================
async function loadAppData() {
  if (global.db._loadPromise) return global.db._loadPromise

  global.db._loadPromise = (async () => {
    try {
      const result = await queryWithFallback("SELECT category, value FROM app_database", [], [])
      const dataFromDb = {}

      for (const row of result) {
        try {
          dataFromDb[row.category] = typeof row.value === "string" ? JSON.parse(row.value) : row.value
        } catch (parseError) {
          dataFromDb[row.category] = row.value
        }
      }

      const mergedData = {}
      for (const [category, defaultValue] of Object.entries(defaultData)) {
        if (dataFromDb[category]) {
          if (
            typeof defaultValue === "object" &&
            typeof dataFromDb[category] === "object" &&
            !Array.isArray(defaultValue) &&
            !Array.isArray(dataFromDb[category])
          ) {
            mergedData[category] = { ...defaultValue, ...dataFromDb[category] }
          } else {
            mergedData[category] = dataFromDb[category]
          }
        } else {
          mergedData[category] = { ...defaultValue }
        }
      }

      global.db.data = mergedData
      global.db._isLoaded = true
      isDataLoaded = true
    } catch (error) {
      console.log("⚠️ App data load failed, using defaults:", error.message)
      global.db.data = { ...defaultData }
      global.db._isLoaded = true
      isDataLoaded = true
    }
  })()

  return global.db._loadPromise
}

// ============================================================================
// SAVE DATABASE FUNCTION WITH IMPROVED ERROR HANDLING
// ============================================================================
let saveTimeout = null
const saveQueue = new Set()

async function saveDatabase(category = null) {
  if (isShuttingDown || !connectionHealthy) return
  if (saveTimeout) clearTimeout(saveTimeout)

  if (category) saveQueue.add(category)

  saveTimeout = setTimeout(async () => {
    try {
      if (!global.db?.data || isShuttingDown || !connectionHealthy) return

      const categoriesToSave = saveQueue.size > 0 ? Array.from(saveQueue) : Object.keys(global.db.data)

      for (const cat of categoriesToSave) {
        if (global.db.data[cat] !== undefined) {
          await queryWithFallback(
            `
                        INSERT INTO app_database (category, value, updated_at)
                        VALUES ($1, $2, CURRENT_TIMESTAMP)
                        ON CONFLICT (category) 
                        DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP;
                    `,
            [cat, JSON.stringify(global.db.data[cat])],
            null,
          )
        }
      }

      saveQueue.clear()
    } catch (error) {
      console.log("⚠️ Database save failed:", error.message)
    }
  }, 2000) // Increased from 1500 to 2000
}

// ============================================================================
// MEDIA FUNCTIONS
// ============================================================================
async function insertFile(name, fileBuffer, type, storageLocation = "database") {
  try {
    if (!isInitialized) await initialize()

    const fileData = storageLocation === "dropbox" ? null : fileBuffer

    await query(
      `
            INSERT INTO mediaonly (name, file_data, type, storage_location) 
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (name) DO UPDATE SET
                file_data = EXCLUDED.file_data,
                type = EXCLUDED.type,
                storage_location = EXCLUDED.storage_location;
        `,
      [name, fileData, type, storageLocation],
    )
  } catch (error) {
    throw error
  }
}

async function listFiles(type) {
  try {
    if (!isInitialized) await initialize()

    const result = await queryWithFallback(
      "SELECT id, name, created_at, storage_location FROM mediaonly WHERE type = $1 ORDER BY created_at DESC;",
      [type],
      [],
    )

    if (result.length === 0) {
      return `No ${type} files available in the database.`
    }

    let list = `┌──⭓「 *${type.charAt(0).toUpperCase() + type.slice(1)} List* 」\n│\n`
    result.forEach((file, index) => {
      const date = new Date(file.created_at).toLocaleDateString()
      list += `│ ${index + 1}. ${file.name}\n│    Location: [${file.storage_location}] | Date: ${date}\n`
    })
    list += `│\n└────────────⭓\n\n*Total ${type} files: ${result.length}*`

    return list
  } catch (error) {
    return `Error retrieving ${type} files.`
  }
}

async function getFile(name, type) {
  try {
    if (!isInitialized) await initialize()

    const result = await queryWithFallback("SELECT * FROM mediaonly WHERE name = $1 AND type = $2;", [name, type], [])

    return result[0] || null
  } catch (error) {
    return null
  }
}

async function deleteFile(name, type) {
  try {
    if (!isInitialized) await initialize()

    const result = await queryWithFallback(
      "DELETE FROM mediaonly WHERE name = $1 AND type = $2 RETURNING *;",
      [name, type],
      [],
    )

    return result.length > 0
  } catch (error) {
    return false
  }
}

// ============================================================================
// INITIALIZATION FUNCTION
// ============================================================================
async function initialize() {
  if (isInitialized) return
  if (initializationPromise) return initializationPromise

  initializationPromise = (async () => {
    try {
      // Test connection first
      await testConnection()

      await createMessagesTable()
      await createAppTable()
      await createTableIfNotExists()

      await loadAppData()

      isInitialized = true
      console.log("✅ Database initialization completed successfully")
    } catch (error) {
      console.log("⚠️ Database initialization failed, using fallback mode:", error.message)
      global.db.data = { ...defaultData }
      global.db._isLoaded = true
      isDataLoaded = true
      connectionHealthy = false

      throw error
    }
  })()

  return initializationPromise
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function ensureDataLoaded() {
  if (!global.db._isLoaded && !global.db._loadPromise) {
    loadAppData().catch(() => {})
  }
  return global.db.data
}

// ============================================================================
// BACKWARD COMPATIBILITY PROXIES
// ============================================================================
const getVote = () => global.db.data?.others?.vote || {}
const getKuismath = () => global.db.data?.game?.math || {}

const vote = new Proxy([], {
  get(target, prop) {
    const currentVote = getVote()
    if (typeof prop === "string" && !isNaN(prop)) {
      return currentVote[Number.parseInt(prop)]
    }
    if (prop === "length") return currentVote.length
    if (typeof currentVote[prop] === "function") {
      return currentVote[prop].bind(currentVote)
    }
    return currentVote[prop]
  },
  set(target, prop, value) {
    if (!global.db.data.others) global.db.data.others = {}
    if (!global.db.data.others.vote) global.db.data.others.vote = {}
    global.db.data.others.vote[prop] = value
    saveDatabase("others")
    return true
  },
})

const kuismath = new Proxy({}, {
  get(target, prop) {
    const currentKuismath = getKuismath()
    if (typeof prop === "string" && !isNaN(prop)) {
      return currentKuismath[Number.parseInt(prop)]
    }
    if (prop === "length") return currentKuismath.length
    if (typeof currentKuismath[prop] === "function") {
      return currentKuismath[prop].bind(currentKuismath)
    }
    return currentKuismath[prop]
  },
  set(target, prop, value) {
    if (!global.db.data.game) global.db.data.game = {}
    if (!global.db.data.game.math) global
    if (!global.db.data.game) global.db.data.game = {}
    if (!global.db.data.game.math) global.db.data.game.math = {}
    global.db.data.game.math[prop] = value
    saveDatabase("game")
    return true
  },
})

// ============================================================================
// IMPROVED ERROR HANDLING
// ============================================================================
process.on("uncaughtException", (error) => {
  if (
    error.message.includes("Connection terminated") ||
    error.message.includes("server conn crashed") ||
    error.code === "08P01"
  ) {
    console.log("🔄 Database connection error handled, continuing operation")
    connectionHealthy = false
    return
  }
  // Handle other uncaught exceptions normally
})

process.on("unhandledRejection", (reason, promise) => {
  if (
    reason &&
    (reason.message?.includes("Connection terminated") ||
      reason.message?.includes("server conn crashed") ||
      reason.code === "08P01")
  ) {
    console.log("🔄 Database promise rejection handled, continuing operation")
    connectionHealthy = false
    return
  }
})

// ============================================================================
// AUTO-INITIALIZE
// ============================================================================
;(async () => {
  try {
    await initialize()
  } catch (error) {
    console.log("⚠️ Auto-initialization failed, will retry on first use")
  }
})()

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
async function fixSequenceIssues() {
  try {
    // Get the current sequence value and max n_o
    const seqResult = await queryWithFallback(`SELECT last_value FROM messages_n_o_seq`, [], [{ last_value: 0 }])
    const maxResult = await queryWithFallback(`SELECT MAX(n_o) as max_no FROM messages`, [], [{ max_no: 0 }])

    const currentSeq = seqResult[0]?.last_value || 0
    const maxNo = maxResult[0]?.max_no || 0

    // If sequence is behind the max value, reset it
    if (currentSeq <= maxNo) {
      await query(`ALTER SEQUENCE messages_n_o_seq RESTART WITH ${maxNo + 1};`)
      console.log(`🔧 Fixed sequence: was ${currentSeq}, now ${maxNo + 1}`)
    }
  } catch (error) {
    console.log(`❌ Error fixing sequence: ${error.message}`)
  }
}

// ============================================================================
// HEALTH CHECK FUNCTION
// ============================================================================
async function getConnectionHealth() {
  return {
    healthy: connectionHealthy,
    retryCount: connectionRetryCount,
    lastError: lastConnectionError?.message || null,
    maxRetries: maxRetries,
  }
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  // Core functions
  pool,
  query,
  queryWithFallback,
  initialize,
  initializeApp,

  // Message functions
  saveAllMessages,
  loadMessages,
  allMessages,
  processedDeletedMessages,

  // Database functions
  saveDatabase,
  loadAppData,
  ensureDataLoaded,

  // Table management
  createMessagesTable,
  createAppTable,
  createTableIfNotExists,
  recreateMessagesTable,
  checkTableRowCount,
  renumberMessages,
   findMessageById,
  // Media functions
  insertFile,
  listFiles,
  getFile,
  deleteFile,

  // Data proxies
  vote,
  kuismath,
  db: global.db,
deleteMessageById,
  // Status functions
  isDataLoaded: () => isDataLoaded,
  waitForData: () => global.db._loadPromise || Promise.resolve(),
  isInitialized: () => isInitialized,
  getConnectionHealth,
  testConnection,
}
