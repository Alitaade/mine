// ========================================
// CONNECTION MANAGER - SMART SESSION LOADING
// ========================================

const {
  pino,
  Boom,
  fs,
  path,
  chalk,
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  NodeCache,
} = require("../utils/imports")

const config = require("../../config.js")
const { EventHandlerManager } = require("./event-handlers")
const { ClientUtilities } = require("../utils/client-utilities")
const { AdvancedRateLimitManager } = require("../utils/rate-limiter")
const { MultiUserGroupCacheManager } = require("../utils/group-cache")
const { ConnectionStateManager } = require("./connection-state")
const { SessionManager } = require("./session-manager")
const { store, loadMessages } = require("../utils/store-manager")

// Global instances - Initialize here to avoid circular dependencies
const rateLimitManager = new AdvancedRateLimitManager()
const multiUserGroupCache = new MultiUserGroupCacheManager()
const connectionStateManager = new ConnectionStateManager()

// Cache for group membership status to avoid repeated API calls
const groupMembershipCache = new Map()
const CACHE_DURATION = 3 * 60 * 1000 // 3 minutes

async function validateGroupMembership(XeonBotInc, groupJid) {
  try {
    // Check cache first
    const cacheKey = `membership_${groupJid}`
    const cached = groupMembershipCache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.isMember
    }

    // Method 1: Try to get group metadata directly (most efficient)
    try {
      // Check user-specific cache first
      let groupMetadata = multiUserGroupCache.getGroupMetadata(XeonBotInc.userId, groupJid)
      if (!groupMetadata) {
        groupMetadata = await XeonBotInc.groupMetadata(groupJid)
      }

      if (groupMetadata) {
        // Cache the positive result
        groupMembershipCache.set(cacheKey, {
          isMember: true,
          timestamp: Date.now(),
        })
        return true
      }
    } catch (metadataError) {
      console.debug(`Group metadata fetch failed for ${groupJid}: ${metadataError.message}`)
    }

    // Method 2: Try to send a presence update (lightweight check)
    try {
      await XeonBotInc.sendPresenceUpdate("available", groupJid)
      groupMembershipCache.set(cacheKey, {
        isMember: true,
        timestamp: Date.now(),
      })
      return true
    } catch (presenceError) {
      console.debug(`Presence update failed for ${groupJid}: ${presenceError.message}`)
    }

    // If all methods fail, assume we're not in the group
    groupMembershipCache.set(cacheKey, {
      isMember: false,
      timestamp: Date.now(),
    })

    console.log(`Bot not in group ${groupJid} (validation failed)`)
    return false
  } catch (error) {
    console.error(`Group membership validation error for ${groupJid}:`, error.message)
    return false
  }
}

function validateEnvironment() {
  const checks = {
    nodeVersion: process.version,
    hasInternet: true,
    diskSpace: true,
    permissions: fs.constants.W_OK,
  }

  console.log("Environment checks:", checks)
  return checks
}

// Helper function to check if session already exists
function checkExistingSession(userId) {
  try {
    const sessionPath = path.join(config.paths.sessions, userId.toString())

    // Check if session directory exists and has credential files
    if (!fs.existsSync(sessionPath)) {
      return { exists: false, hasCredentials: false }
    }

    // Check for key credential files
    const credFiles = ["creds.json", "app-state-sync-key-undefined.json"]
    const hasCredentials = credFiles.some((file) => fs.existsSync(path.join(sessionPath, file)))

    // Check if there are any .json files in the session directory
    const files = fs.readdirSync(sessionPath)
    const hasAnyCredentials = files.some((file) => file.endsWith(".json"))

    return {
      exists: true,
      hasCredentials: hasCredentials || hasAnyCredentials,
      fileCount: files.length,
    }
  } catch (error) {
    console.log(chalk.yellow(`User ${userId}: Error checking existing session:`, error.message))
    return { exists: false, hasCredentials: false }
  }
}

async function startXeonBotInc(userId, phoneNumber, callbacks) {
  try {
    console.log(chalk.blue(`User ${userId}: 🚀 Starting WhatsApp Bot initialization...`))

    // Check if session already exists
    const sessionCheck = checkExistingSession(userId)
    const isNewUser = !sessionCheck.exists || !sessionCheck.hasCredentials

    if (isNewUser) {
      console.log(chalk.yellow(`User ${userId}: 🆕 New user detected - will use full initialization`))
    } else {
      console.log(
        chalk.green(
          `User ${userId}: 🔄 Existing user detected - using fast initialization (${sessionCheck.fileCount} session files)`,
        ),
      )
    }

    // Ensure required directories exist
    if (!fs.existsSync(config.paths.sessions)) {
      fs.mkdirSync(config.paths.sessions, { recursive: true })
    }

    const logsDir = "./logs"
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }

    // Configure logger
    const logger = pino(
      {
        level: "debug",
      },
      pino.destination({
        dest: `${logsDir}/debug-${userId}.json`,
        sync: true,
      }),
    )

    // Initialize session - ensure safe path for this specific user
    const sessionPath = path.join(config.paths.sessions, userId.toString())
    const { state, saveCreds } = await SessionManager.initializeSession(sessionPath, userId)
    const groupCache = new NodeCache({
      /* ... */
    })

    // Create WhatsApp client
    const XeonBotInc = await createWhatsAppClient(state, userId, multiUserGroupCache)

    if (!XeonBotInc) {
      throw new Error("Failed to create WhatsApp client")
    }

    // Set up connection handling with smart timing
    await setupConnectionHandling(XeonBotInc, userId, sessionPath, callbacks, phoneNumber, saveCreds, isNewUser)

    // Add utility methods
    ClientUtilities.addUtilityMethods(XeonBotInc)

    console.log(chalk.green(`User ${userId}: ✅ Bot initialization completed`))
    return XeonBotInc
  } catch (error) {
    console.error(chalk.red(`User ${userId}: ❌ Critical error during initialization:`, error.message))
    return createMockClient(userId, callbacks)
  }
}

async function createWhatsAppClient(state, userId, groupCacheManager) {
  try {
    const XeonBotInc = makeWASocket({
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      auth: state,
      version: [2, 3000, 1019441105],
      browser: Browsers.ubuntu("Edge"),
      cachedGroupMetadata: async (jid) => {
        return groupCacheManager.getGroupMetadata(userId, jid) || store?.groupMetadata?.[jid]
      },
      retryRequestDelayMs: 1000,
      maxMsgRetryCount: 4,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      emitOwnEvents: true,
      fireInitQueries: true,
      defaultQueryTimeoutMs: 30000,
      keepAliveIntervalMs: 20000,
      getMessage: async (key) => {
        if (store) {
          const msg = await store.loadMessage(key.remoteJid, key.id)
          return msg?.message || undefined
        }
        return { conversation: "Bot Here!" }
      },
    })

    // Initialize processed messages set for this session (only for immediate duplicates)
    XeonBotInc.processedMessages = new Map()

    console.log(chalk.green(`User ${userId}: ✅ WhatsApp client created successfully`))
    return XeonBotInc
  } catch (error) {
    console.error(chalk.red(`User ${userId}: ❌ Error creating WhatsApp client:`, error.message))
    return null
  }
}

async function setupConnectionHandling(XeonBotInc, userId, sessionPath, callbacks, phoneNumber, saveCreds, isNewUser) {
  // Connection state variables
  const connectionState = {
    isConnected: false,
    userInfo: { name: null, id: null },
    retryCount: 0,
    isRestarting: false,
    sessionReady: false,
  }

  // Save credentials when updated
  XeonBotInc.ev.on("creds.update", async () => {
    try {
      await saveCreds()
    } catch (error) {
      console.log(chalk.yellow(`User ${userId}: ⚠️ Could not save credentials:`, error.message))
    }
  })

  // Handle pairing process
  await handlePairingProcess(XeonBotInc, userId, phoneNumber, callbacks)

  // Handle connection updates with smart session wait times
  XeonBotInc.ev.on("connection.update", async (update) => {
    try {
      const { connection, lastDisconnect, receivedPendingNotifications, qr } = update

      if (connection) {
        console.log(chalk.cyan(`User ${userId}: 📡 Connection status: ${connection}`))
      }

      if (connection === "close") {
        const reason = Boom.isBoom(lastDisconnect?.error) ? lastDisconnect?.error.output.statusCode : undefined
        console.log(chalk.yellow(`User ${userId}: 🔌 Connection closed (reason: ${reason})`))

        if (!connectionState.isRestarting) {
          connectionState.isRestarting = true
          await connectionStateManager.handleDisconnect(reason, userId, sessionPath, callbacks, XeonBotInc, phoneNumber)
        }
      } else if (connection === "connecting") {
        console.log(chalk.blue(`User ${userId}: 🔄 Connecting to WhatsApp...`))
      } else if (connection === "open" && !connectionState.isConnected) {
        console.log(chalk.green(`User ${userId}: 🎉 Connection opened! Waiting for session...`))

        // SMART TIMING: Different wait times based on user type
        let sessionWaitTime, commandBlockTime

        if (isNewUser) {
          // New users need full session synchronization
          sessionWaitTime = 20000 // 20 seconds for new users
          commandBlockTime = 20000 // 20 seconds command block for new users
          console.log(
            chalk.blue(`User ${userId}: ⏳ NEW USER: Waiting ${sessionWaitTime / 1000}s for complete session load...`),
          )
        } else {
          // Existing users can start faster
          sessionWaitTime = 5000 // 5 seconds for existing users
          commandBlockTime = 5000 // 5 seconds command block for existing users
          console.log(
            chalk.blue(`User ${userId}: ⚡ EXISTING USER: Fast session load - waiting ${sessionWaitTime / 1000}s...`),
          )
        }

        await new Promise((resolve) => setTimeout(resolve, sessionWaitTime))

        console.log(chalk.blue(`User ${userId}: ✅ Session wait complete, initializing bot...`))
        connectionState.sessionReady = true

        await handleSuccessfulConnection(XeonBotInc, userId, callbacks, connectionState, commandBlockTime)
      } else if (
        receivedPendingNotifications === true &&
        !connectionState.isConnected &&
        connectionState.sessionReady
      ) {
        console.log(chalk.blue(`User ${userId}: 📬 Pending notifications received, session ready`))
        const commandBlockTime = isNewUser ? 20000 : 5000
        await handleSuccessfulConnection(XeonBotInc, userId, callbacks, connectionState, commandBlockTime)
      }

      // Handle QR code
      if (qr && callbacks?.onQRCode) {
        console.log(chalk.yellow(`User ${userId}: 📱 QR Code generated`))
        await callbacks.onQRCode(qr)
      }
    } catch (error) {
      console.log(chalk.yellow(`User ${userId}: ⚠️ Connection update error:`, error.message))
    }
  })
}

async function handlePairingProcess(XeonBotInc, userId, phoneNumber, callbacks) {
  try {
    if (!XeonBotInc.authState?.creds?.registered && phoneNumber) {
      const formattedPhoneNumber = phoneNumber.replace(/^\+/, "").replace(/\s+/g, "")

      console.log(chalk.yellow(`User ${userId}: 📱 Requesting pairing code for ${formattedPhoneNumber}...`))

      setTimeout(async () => {
        try {
          const code = await XeonBotInc.requestPairingCode(formattedPhoneNumber)
          if (code) {
            const formattedCode = code.match(/.{1,4}/g)?.join("-") || code
            console.log(chalk.green(`User ${userId}: 🔑 Pairing code: ${formattedCode}`))

            if (callbacks?.onPairingCode) {
              await callbacks.onPairingCode(formattedCode)
            }
          }
        } catch (error) {
          console.log(chalk.red(`User ${userId}: ❌ Pairing failed:`, error.message))
          if (callbacks?.onError) {
            await callbacks.onError("Pairing code generation failed")
          }
        }
      }, 2000)
    }
  } catch (error) {
    console.log(chalk.yellow(`User ${userId}: ⚠️ Pairing process error:`, error.message))
  }
}

async function handleSuccessfulConnection(XeonBotInc, userId, callbacks, connectionState, commandBlockTime) {
  try {
    console.log(chalk.blue(`User ${userId}: 🔧 Initializing successful connection...`))

    // Bind store
    if (store?.bind) {
      store.bind(XeonBotInc.ev)
      console.log(chalk.green(`User ${userId}: ✅ Store bound successfully`))
    }

    // Set user information with retry logic
    let attempts = 0
    const maxAttempts = 5

    while (!connectionState.userInfo.id && attempts < maxAttempts) {
      if (XeonBotInc?.user) {
        connectionState.userInfo.name = XeonBotInc.user.name || "Unknown"
        connectionState.userInfo.id = XeonBotInc.user.id || null

        XeonBotInc.userNumber = XeonBotInc.user.id?.split("@")[0] || "unknown"
        XeonBotInc.userId = XeonBotInc.user.id
        XeonBotInc.sessionId = userId

        console.log(chalk.green(`User ${userId}: ✅ User info set: ${connectionState.userInfo.name}`))
        break
      } else {
        attempts++
        console.log(chalk.yellow(`User ${userId}: ⏳ Waiting for user info... (${attempts}/${maxAttempts})`))
        await new Promise((resolve) => setTimeout(resolve, 3000)) // Reduced from 15000 to 3000
      }
    }

    // Initialize group cache
    if (XeonBotInc.userId) {
      await multiUserGroupCache.initializeUserGroupCache(XeonBotInc, userId, rateLimitManager)
      console.log(chalk.green(`User ${userId}: ✅ Group cache initialized`))
    }

    // Load messages
    if (loadMessages) {
      await loadMessages()
      console.log(chalk.green(`User ${userId}: ✅ Messages loaded`))
    }

    // Set up event handlers - SMART COMMAND BLOCKING
    console.log(chalk.blue(`User ${userId}: ⏳ Blocking command processing for ${commandBlockTime / 1000} seconds...`))
    XeonBotInc.commandsBlocked = true

    setTimeout(() => {
      XeonBotInc.commandsBlocked = false
      console.log(chalk.green(`User ${userId}: ✅ Command processing unblocked`))
    }, commandBlockTime)

    EventHandlerManager.setupAllEventHandlers(XeonBotInc, callbacks)
    console.log(chalk.green(`User ${userId}: ✅ Event handlers set up`))

    // Notify connection success
    if (callbacks?.onConnectionUpdate) {
      await callbacks.onConnectionUpdate({
        status: "connected",
        client: XeonBotInc,
        userInfo: connectionState.userInfo,
      })
    }

    connectionState.isConnected = true
    connectionState.isRestarting = false
    connectionState.retryCount = 0
    XeonBotInc.ready = true

    console.log(chalk.greenBright(`User ${userId}: 🚀 Bot is now ready and operational!`))
    console.log(
      chalk.blue(`User ${userId}: 📝 All messages will be stored for this session (both incoming and outgoing)`),
    )
  } catch (error) {
    console.log(chalk.yellow(`User ${userId}: ⚠️ Success handler error:`, error.message))
  }
}

function createMockClient(userId, callbacks) {
  console.log(chalk.yellow(`User ${userId}: 🔧 Creating mock client to prevent shutdown`))

  const mockClient = {
    ready: false,
    userId: userId,
    sessionId: userId,
    processedMessages: new Map(),
    commandsBlocked: true,
    ev: {
      on: (event, handler) => {
        console.log(`User ${userId}: 📝 Mock event listener added for: ${event}`)
      },
    },
    sendMessage: async () => {
      console.log(`User ${userId}: 📤 Mock sendMessage called - connection not ready`)
      return { status: "mock" }
    },
  }

  if (callbacks?.onError) {
    setTimeout(() => {
      callbacks.onError("Connection is in recovery mode. Bot remains active but WhatsApp features are limited.")
    }, 1000)
  }

  return mockClient
}

module.exports = {
  startXeonBotInc,
  rateLimitManager,
  multiUserGroupCache,
  validateGroupMembership,
}
