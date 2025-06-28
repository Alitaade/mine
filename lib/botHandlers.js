const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');
const { bot, activeClients, messagePreferences, userStates } = require('./botConfig');
const { startXeonBotInc } = require('../main');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const {
  createMainMenuKeyboard, cancelaborted,
  homeButton, noActiveConnectionMessage,
  createDisconnectConfirmationKeyboard,
  createCancelConnectionConfirmationKeyboard,
  welcomeMessage, connectionCancelledForcedMessage,
  helpMessage, foundExistingSessionMessage,
  getPairingCodeMessage, connectionCancelledMessage,
  phoneNumberPromptMessage,
  getSuccessMessage, messageFowardingDisabled
} = require('./botUI');
const {
  checkRealConnection,
  handleConnectionUpdate,
  handleWhatsAppMessage,
  restoreSession,
  backupSession,
  deleteSession,
  reconnectAllSessions,
} = require('./connectionManager');
const { 
  Session, 
  restoreSessionFromString,
  generateAndSendSessionString,
} = require('./filewatcher');

// Consistent path functions
const getSessionPath = (userId) => {
  const sessionDir = path.join(config.paths.sessions, userId);
  logger.debug(`Session path for user: ${userId} = ${sessionDir}`);
  return sessionDir;
};

const getTmpUserPath = (userId) => {
  const tmpDir = path.join(__dirname, '..', 'tmp', userId);
  logger.debug(`Tmp path for user: ${userId} = ${tmpDir}`);
  return tmpDir;
};

// Ensure directories exist
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.debug(`Created directory: ${dirPath}`);
  }
};
const processPhoneNumber = async (chatId, userId, phoneNumber) => {
  try {
    userStates.set(userId, { state: 'connecting', chatId });
    bot.sendMessage(chatId, "📱 Connecting to WhatsApp...", homeButton);

    // Ensure session directories exist before connection
    ensureDirectoryExists(getSessionPath(userId));
    ensureDirectoryExists(getTmpUserPath(userId));

    const client = await startXeonBotInc(userId, phoneNumber, {
      onPairingCode: async (pairingCode) => {
        bot.sendMessage(chatId, getPairingCodeMessage(pairingCode), { parse_mode: 'Markdown', ...homeButton });
      },
      onConnectionUpdate: async (status) => {
        // Handle connection updates
        await handleConnectionUpdate(chatId, userId, status, bot, activeClients, userStates, messagePreferences);

        // Generate and send session string only when the connection is successful
        if (status.status === 'connected') {
          // Add a 15-second delay before generating the session string
          await sleep(27000); // 20 seconds delay
          try {
            await generateAndSendSessionString(client, chatId, userId);
          } catch (error) {
            logger.error(`Error generating session string for user ${userId}:`, error);
            bot.sendMessage(chatId, "⚠️ Connected, but couldn't generate session string.", homeButton);
          }
        }
      },
      onMessage: async (message) =>
        handleWhatsAppMessage(chatId, userId, message, bot, messagePreferences),
      onError: async (errorMessage) => {
        bot.sendMessage(chatId, `❌ Error: ${errorMessage}`, homeButton);
        userStates.set(userId, { state: 'home', chatId });
      },
    });

    if (client) {
      activeClients.set(userId, client);
      userStates.set(userId, { state: 'connected', chatId });
    } else {
      bot.sendMessage(chatId, "❌ Failed to establish connection. Please try again.", homeButton);
      userStates.set(userId, { state: 'home', chatId });
    }
  } catch (error) {
    logger.error(`Error starting WhatsApp client for user ${userId}:`, error);
    bot.sendMessage(chatId, "❌ An error occurred while connecting. Please try again later.", homeButton);
    userStates.set(userId, { state: 'home', chatId });
  }
};
// Improved check status implementation
const checkStatus = async (chatId, userId) => {
  try {
    // First check for active connection
    if (await checkRealConnection(userId, activeClients)) {
      const client = activeClients.get(userId);
      const userInfo = { 
        name: client.user?.name || "Unknown", 
        id: client.user?.id || "Unknown" 
      };
      const successMsg = getSuccessMessage(userInfo, 'connected');
      return bot.sendMessage(chatId, successMsg.message, successMsg.keyboard);
    }

    // Then check for session in main session directory
    const sessionDir = getSessionPath(userId);
    if (fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0) {
      const successMsg = getSuccessMessage(null, 'session_exists');
      return bot.sendMessage(chatId, successMsg.message, {
        ...successMsg.keyboard,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Reconnect', callback_data: 'reconnect_session' }],
            [{ text: '🏠 Back to Home', callback_data: 'home' }],
          ],
        },
      });
    }

    // Finally check for session in temporary directory
    const tmpDir = getTmpUserPath(userId);
    if (fs.existsSync(tmpDir) && fs.readdirSync(tmpDir).length > 0) {
      return bot.sendMessage(
        chatId,
        "🔍 Found a saved session in the temporary folder. Would you like to reconnect?",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Reconnect', callback_data: 'reconnect_session' }],
              [{ text: '🏠 Back to Home', callback_data: 'home' }],
            ],
          },
        }
      );
    }

    return bot.sendMessage(chatId, "❌ No active connection or saved session found!", homeButton);
  } catch (error) {
    logger.error(`Error checking status for user ${userId}:`, error);
    return bot.sendMessage(chatId, "❌ An error occurred while checking status.", homeButton);
  }
};

// Improved session reconnection
const attemptReconnection = async (chatId, userId) => {
  try {
    bot.sendMessage(chatId, "🔄 Attempting to reconnect...", homeButton);
    
    // Ensure session directories exist
    ensureDirectoryExists(getSessionPath(userId));
    ensureDirectoryExists(getTmpUserPath(userId));
    
    // Check if we need to restore from tmp first
    const sessionDir = getSessionPath(userId);
    const tmpDir = getTmpUserPath(userId);
    
    if ((!fs.existsSync(sessionDir) || fs.readdirSync(sessionDir).length === 0) && 
        fs.existsSync(tmpDir) && fs.readdirSync(tmpDir).length > 0) {
      logger.debug(`Restoring session from tmp for user ${userId}`);
      restoreSession(userId);
    }
    
    const client = await startXeonBotInc(userId, null, {
      onPairingCode: async (pairingCode) => {
        bot.sendMessage(chatId, getPairingCodeMessage(pairingCode), { parse_mode: 'Markdown', ...homeButton });
      },
      onConnectionUpdate: async (status) => {
        await handleConnectionUpdate(chatId, userId, status, bot, activeClients, userStates, messagePreferences);
        
        // Generate and send session string only when the connection is successful
        if (status.status === 'connected') {
          try {
            await generateAndSendSessionString(client, chatId, userId);
          } catch (error) {
            logger.error(`Error generating session string for user ${userId}:`, error);
          }
        }
      },
      onMessage: async (message) =>
        handleWhatsAppMessage(chatId, userId, message, bot, messagePreferences),
      onError: async (errorMessage) => {
        bot.sendMessage(chatId, `❌ Error: ${errorMessage}`, homeButton);
        userStates.set(userId, { state: 'home', chatId });
      },
    });
    
    if (client) {
      activeClients.set(userId, client);
      userStates.set(userId, { state: 'connected', chatId });
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`Error reconnecting for user ${userId}:`, error);
    bot.sendMessage(chatId, `❌ Reconnection failed: ${error.message}`, homeButton);
    return false;
  }
};

// Improved disconnect handling
const handleDisconnect = async (chatId, userId) => {
  try {
    if (activeClients.has(userId)) {
      const client = activeClients.get(userId);
      try {
        // Try formal logout first
        await client.logout();
      } catch (logoutError) {
        logger.error(`Logout error for user ${userId}:`, logoutError);
        // Fallback to manual close if logout fails
        try {
          if (typeof client.close === 'function') {
            await client.close();
          } else if (client.ws && typeof client.ws.close === 'function') {
            client.ws.close(1000, "User disconnected");
          }
        } catch (closeError) {
          logger.error(`Close error for user ${userId}:`, closeError);
        }
      } finally {
        // Always clean up regardless of errors
        activeClients.delete(userId);
      }
    }
    
    // Delete session data
    deleteSession(userId);
    messagePreferences.delete(userId);
    
    return bot.sendMessage(chatId, "✅ Disconnected and session removed successfully!", homeButton);
  } catch (error) {
    logger.error(`Error during disconnect for user ${userId}:`, error);
    activeClients.delete(userId);
    deleteSession(userId);
    messagePreferences.delete(userId);
    return bot.sendMessage(chatId, connectionCancelledForcedMessage, homeButton);
  }
};

// Improved cancel connection handling
const handleCancelConnection = async (chatId, userId) => {
  try {
    if (activeClients.has(userId)) {
      const client = activeClients.get(userId);
      try {
        client.isCancelled = true;
        if (typeof client.close === 'function') {
          await client.close();
        } else if (client.ws && typeof client.ws.close === 'function') {
          client.ws.close(1000, "User cancelled connection");
        } else {
          throw new Error("No valid method to close the connection.");
        }
      } catch (error) {
        logger.error(`Error closing connection for user ${userId}:`, error);
      } finally {
        // Always clean up and backup
        activeClients.delete(userId);
        backupSession(userId);
      }
      return bot.sendMessage(chatId, connectionCancelledMessage, homeButton);
    }
    return bot.sendMessage(chatId, noActiveConnectionMessage, homeButton);
  } catch (error) {
    logger.error(`Error cancelling connection for user ${userId}:`, error);
    activeClients.delete(userId);
    backupSession(userId);
    return bot.sendMessage(chatId, connectionCancelledForcedMessage, homeButton);
  }
};

// /start command handler
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const currentState = userStates.get(userId) || {};
  userStates.set(userId, { ...currentState, state: 'home', chatId });
  bot.sendMessage(chatId, welcomeMessage, createMainMenuKeyboard());
});

// /help command handler
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown', ...homeButton });
});

// /pair command handler
bot.onText(/\/pair/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  if (await checkRealConnection(userId, activeClients)) {
    return bot.sendMessage(chatId, "⚠️ You're already connected!", homeButton);
  }

  // Check for existing session in sessions or tmp folder
  const sessionDir = getSessionPath(userId);
  const tmpDir = getTmpUserPath(userId);

  if (fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0) {
    bot.sendMessage(chatId, foundExistingSessionMessage, homeButton);
    if (await attemptReconnection(chatId, userId)) {
      return;
    }
  } else if (fs.existsSync(tmpDir) && fs.readdirSync(tmpDir).length > 0) {
    bot.sendMessage(chatId, "🔍 Found a saved session. Attempting to reconnect...", homeButton);
    if (await attemptReconnection(chatId, userId)) {
      return;
    }
  }

  // If no session exists or reconnection failed, ask if they have a session string
  userStates.set(userId, { state: 'awaiting_session_string_choice', chatId });
  return bot.sendMessage(
    chatId,
    "Do you have a session string? If yes, click 'Yes' below. If no, click 'No' to proceed with phone number pairing.",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Yes', callback_data: 'has_session_string' }],
          [{ text: '❌ No', callback_data: 'no_session_string' }],
        ],
      },
    }
  );
});

// /status command handler
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const currentState = userStates.get(userId) || {};
  userStates.set(userId, { ...currentState, state: 'checking_status', chatId });

  bot.sendMessage(chatId, "🔍 Checking your connection status...");
  await checkStatus(chatId, userId);
});

// /disconnect command handler
bot.onText(/\/disconnect/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  // Check if user has an active session before showing disconnect confirmation
  const hasActiveSession = await checkRealConnection(userId, activeClients);
  const hasStoredSession = fs.existsSync(getSessionPath(userId)) && fs.readdirSync(getSessionPath(userId)).length > 0;
  const hasTmpSession = fs.existsSync(getTmpUserPath(userId)) && fs.readdirSync(getTmpUserPath(userId)).length > 0;

  if (!hasActiveSession && !hasStoredSession && !hasTmpSession) {
    return bot.sendMessage(chatId, "⚠️ You don't have any active or saved sessions to disconnect.", homeButton);
  }

  userStates.set(userId, { state: 'disconnect_confirmation', chatId });
  return bot.sendMessage(
    chatId,
    "⚠️ Are you sure you want to permanently disconnect and remove your WhatsApp session?",
    createDisconnectConfirmationKeyboard()
  );
});

// /cancel_connection command handler
bot.onText(/\/cancel_connection/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  if (!activeClients.has(userId)) {
    return bot.sendMessage(chatId, noActiveConnectionMessage, homeButton);
  }

  return bot.sendMessage(
    chatId,
    "⚠️ Are you sure you want to cancel your current WhatsApp connection without removing your session?",
    createCancelConnectionConfirmationKeyboard()
  );
});

// Handle text messages for session string input
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const currentState = userStates.get(userId) || {};

  if (currentState.state === 'awaiting_session_string') {
    const sessionString = msg.text.trim();

    // Ensure directories exist
    ensureDirectoryExists(getSessionPath(userId));
    ensureDirectoryExists(getTmpUserPath(userId));

    // Restore session from session string
    try {
      if (await restoreSessionFromString(sessionString, userId)) {
        bot.sendMessage(chatId, "✅ Session restored successfully! Attempting to connect...", homeButton);
        if (await attemptReconnection(chatId, userId)) {
          return;
        } else {
          bot.sendMessage(chatId, "⚠️ Session restored but connection failed. Try again later.", homeButton);
        }
      } else {
        bot.sendMessage(chatId, "❌ Invalid session string. Please try again or type /pair to start over.", homeButton);
      }
    } catch (error) {
      logger.error(`Error processing session string for user ${userId}:`, error);
      bot.sendMessage(chatId, "❌ Error processing session string. Please try again or type /pair to start over.", homeButton);
    }
  } else if (currentState.state === 'awaiting_phone') {
    const phoneNumber = msg.text.trim().replace(/\s+/g, '');
    if (/^\+?[0-9]{10,15}$/.test(phoneNumber)) {
      await processPhoneNumber(chatId, userId, phoneNumber);
    } else {
      bot.sendMessage(chatId, "❌ Invalid phone number format. Please enter a valid phone number with country code (e.g., +1234567890).", homeButton);
    }
  }
});

// Callback query handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const data = query.data;

  try {
    // Acknowledge the callback query to stop the loading indicator
    bot.answerCallbackQuery(query.id).catch(err => 
      logger.error(`Error acknowledging callback query for user ${userId}:`, err)
    );

    switch (data) {
      case 'home':
        userStates.set(userId, { state: 'home', chatId });
        return bot.sendMessage(chatId, welcomeMessage, createMainMenuKeyboard());

      case 'help':
        return bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown', ...homeButton });

      case 'pair':
        if (await checkRealConnection(userId, activeClients)) {
          return bot.sendMessage(chatId, "⚠️ You're already connected!", homeButton);
        }

        // Check for existing session in sessions or tmp folder
        const sessionDir = getSessionPath(userId);
        const tmpDir = getTmpUserPath(userId);

        if (fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0) {
          bot.sendMessage(chatId, foundExistingSessionMessage, homeButton);
          if (await attemptReconnection(chatId, userId)) {
            return;
          }
        } else if (fs.existsSync(tmpDir) && fs.readdirSync(tmpDir).length > 0) {
          bot.sendMessage(chatId, "🔍 Found a saved session. Attempting to reconnect...", homeButton);
          if (await attemptReconnection(chatId, userId)) {
            return;
          }
        }

        // If no session exists or reconnection failed, ask if they have a session string
        userStates.set(userId, { state: 'awaiting_session_string_choice', chatId });
        return bot.sendMessage(
          chatId,
          "Do you have a session string? If yes, click 'Yes' below. If no, click 'No' to proceed with phone number pairing.",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Yes', callback_data: 'has_session_string' }],
                [{ text: '❌ No', callback_data: 'no_session_string' }],
              ],
            },
          }
        );

      case 'has_session_string':
        userStates.set(userId, { state: 'awaiting_session_string', chatId });
        return bot.sendMessage(chatId, "Please enter your session string:", homeButton);

      case 'no_session_string':
        userStates.set(userId, { state: 'awaiting_phone', chatId });
        return bot.sendMessage(chatId, phoneNumberPromptMessage, homeButton);

      case 'status':
        bot.sendMessage(chatId, "🔍 Checking your connection status...");
        return checkStatus(chatId, userId);

      case 'disconnect':
        logger.debug("Disconnect button clicked by user:", userId);
        const hasActiveSession = await checkRealConnection(userId, activeClients);
        logger.debug("Has active session:", hasActiveSession);
        const hasStoredSession = fs.existsSync(getSessionPath(userId)) && fs.readdirSync(getSessionPath(userId)).length > 0;
        logger.debug("Has stored session:", hasStoredSession);
        const hasTmpSession = fs.existsSync(getTmpUserPath(userId)) && fs.readdirSync(getTmpUserPath(userId)).length > 0;
        logger.debug("Has tmp session:", hasTmpSession);

        if (!hasActiveSession && !hasStoredSession && !hasTmpSession) {
          logger.debug("No active or saved sessions found for user:", userId);
          return bot.sendMessage(chatId, "⚠️ You don't have any active or saved sessions to disconnect.", homeButton);
        }

        userStates.set(userId, { state: 'disconnect_confirmation', chatId });
        return bot.sendMessage(
          chatId,
          "⚠️ Are you sure you want to permanently disconnect and remove your WhatsApp session?",
          createDisconnectConfirmationKeyboard()
        );

      case 'disconnect_confirm_yes':
        return handleDisconnect(chatId, userId);

      case 'disconnect_confirm_no':
        return bot.sendMessage(chatId, "✅ Disconnection cancelled.", homeButton);

      case 'cancel_connection':
        if (!activeClients.has(userId)) {
          return bot.sendMessage(chatId, noActiveConnectionMessage, homeButton);
        }

        return bot.sendMessage(
          chatId,
          "⚠️ Are you sure you want to cancel your current WhatsApp connection without removing your session?",
          createCancelConnectionConfirmationKeyboard()
        );

      case 'cancel_confirm_yes':
        return handleCancelConnection(chatId, userId);

      case 'cancel_confirm_no':
        return bot.sendMessage(chatId, cancelaborted, homeButton);

      case 'forward_yes':
        messagePreferences.set(userId, true);
        return bot.sendMessage(chatId, "✅ Message forwarding enabled! You will now receive WhatsApp messages in this chat.", homeButton);

      case 'forward_no':
        messagePreferences.set(userId, false);
        return bot.sendMessage(chatId, "❌ Message forwarding disabled. You will no longer receive WhatsApp messages in this chat.", homeButton);

      case 'reconnect_session':
        logger.debug("Reconnect button clicked by user:", userId);
        const sessionExists = fs.existsSync(getSessionPath(userId)) && fs.readdirSync(getSessionPath(userId)).length > 0;
        const tmpExists = fs.existsSync(getTmpUserPath(userId)) && fs.readdirSync(getTmpUserPath(userId)).length > 0;
        
        if (sessionExists || tmpExists) {
          logger.debug("Found saved session for user:", userId);
          if (tmpExists && !sessionExists) {
            restoreSession(userId);
          }
          
          if (await attemptReconnection(chatId, userId)) {
            return;
          } else {
            return bot.sendMessage(chatId, "❌ Failed to reconnect. Please try pairing again.", homeButton);
          }
        } else {
          logger.debug("No saved session found for user:", userId);
          return bot.sendMessage(chatId, "❌ No saved session found to reconnect.", homeButton);
        }

      default:
        logger.debug("Unknown callback data:", data);
        return bot.sendMessage(chatId, "⚠️ Unknown option. Please try again.", homeButton);
    }
  } catch (error) {
    logger.error(`Callback error for user ${userId}:`, error);
    bot.sendMessage(chatId, "⚠️ An error occurred! Please try again.", homeButton);
  }
});

// Initialize necessary directories
const initializeDirectories = () => {
  // Ensure main directories exist
  ensureDirectoryExists(config.paths.sessions);
  ensureDirectoryExists(path.join(__dirname, '..', 'tmp'));

  logger.debug("Initialized directories successfully");
};

// Call initialization on module load
initializeDirectories();

module.exports = {
  checkStatus,
  processPhoneNumber,
  attemptReconnection,
  handleDisconnect,
  handleCancelConnection,
  getSessionPath,
  getTmpUserPath,
  ensureDirectoryExists
};