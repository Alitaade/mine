const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');
const { startXeonBotInc } = require('../main');
const {
  getPairingCodeMessage,
  getSuccessMessage,
  enableMessageForwardingMessage,
  homeButton,
} = require('./botUI');

// Define paths
const TMP_SESSIONS_PATH = path.join(__dirname, '..', 'tmp');

// Ensure TMP folder exists
function ensureTmpFolder() {
  try {
    if (!fs.existsSync(TMP_SESSIONS_PATH)) {
      fs.mkdirSync(TMP_SESSIONS_PATH, { recursive: true });
      logger.info(`Created TMP folder at ${TMP_SESSIONS_PATH}`);
    }
  } catch (error) {
    logger.error(`Error ensuring TMP folder exists: ${error.message}`);
    throw error;
  }
}

// Backup session to TMP folder
function backupSession(userId) {
  try {
    ensureTmpFolder();

    const sessionPath = path.join(config.paths.sessions, userId);
    const tmpUserPath = path.join(TMP_SESSIONS_PATH, userId);

    if (!fs.existsSync(sessionPath)) {
      logger.warn(`No session found for user ${userId} to back up.`);
      return false;
    }

    // Ensure TMP destination is clean
    if (fs.existsSync(tmpUserPath)) {
      fs.rmSync(tmpUserPath, { recursive: true, force: true });
    }

    // Copy session to TMP
    fs.cpSync(sessionPath, tmpUserPath, { recursive: true });

    // Remove original session after successful backup
    fs.rmSync(sessionPath, { recursive: true, force: true });

    logger.info(`Session for user ${userId} backed up to TMP folder.`);
    return true;
  } catch (error) {
    logger.error(`Error backing up session for user ${userId}: ${error.message}`);
    return false;
  }
}

// Restore session from TMP folder
function restoreSession(userId) {
  try {
    const sessionPath = path.join(config.paths.sessions, userId);
    const tmpUserPath = path.join(TMP_SESSIONS_PATH, userId);

    if (!fs.existsSync(tmpUserPath)) {
      logger.warn(`No backup session found for user ${userId}.`);
      return false;
    }

    // Ensure session folder is clean before restoring
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    // Move session from TMP back to the main directory
    fs.renameSync(tmpUserPath, sessionPath);

    logger.info(`Session for user ${userId} restored from TMP folder.`);
    return true;
  } catch (error) {
    logger.error(`Error restoring session for user ${userId}: ${error.message}`);
    return false;
  }
}

// Delete session permanently
function deleteSession(userId) {
  try {
    const sessionPath = path.join(config.paths.sessions, userId);
    const tmpUserPath = path.join(TMP_SESSIONS_PATH, userId);
    let deleted = false;

    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      logger.info(`Session for user ${userId} deleted from session folder.`);
      deleted = true;
    }

    if (fs.existsSync(tmpUserPath)) {
      fs.rmSync(tmpUserPath, { recursive: true, force: true });
      logger.info(`Session for user ${userId} deleted from TMP folder.`);
      deleted = true;
    }

    return deleted;
  } catch (error) {
    logger.error(`Error deleting session for user ${userId}: ${error.message}`);
    return false;
  }
}

async function checkRealConnection(userId, activeClients) {
  try {
    logger.debug(`Checking real connection for user: ${userId}`);
    const client = activeClients.get(userId);

    // Check if client exists and has a valid connection
    if (client && client.user) {
      logger.debug(`User ${userId} has an active connection.`);
      return true;
    }

    logger.debug(`User ${userId} does not have an active connection.`);
    return false;
  } catch (error) {
    logger.error(`Error checking real connection for user ${userId}: ${error.message}`);
    return false;
  }
}
async function reconnectAllSessions(activeClients, userStates, bot) {
  try {
    logger.info('Starting automatic session reconnection for all users...');
    const sessionsDir = config.paths.sessions;

    if (!fs.existsSync(sessionsDir)) {
      logger.info('Sessions directory does not exist. Creating it...');
      fs.mkdirSync(sessionsDir, { recursive: true });
      return;
    }

    const userDirs = fs.readdirSync(sessionsDir);
    for (const userId of userDirs) {
      const userSessionPath = path.join(sessionsDir, userId);

      if (!fs.statSync(userSessionPath).isDirectory() || fs.readdirSync(userSessionPath).length === 0) {
        continue;
      }

      if (activeClients.has(userId)) {
        logger.info(`User ${userId} already has an active client.`);
        continue;
      }

      logger.info(`Attempting to reconnect session for user ${userId}...`);
      try {
        const client = await startXeonBotInc(userId, null, {
          onPairingCode: async (pairingCode) => {
            const chatData = userStates.get(userId);
            if (chatData && chatData.chatId) {
              bot.sendMessage(chatData.chatId, getPairingCodeMessage(pairingCode), { parse_mode: 'Markdown', ...homeButton });
            }
          },
          onConnectionUpdate: async (status) => {
            const chatData = userStates.get(userId);
            if (chatData && chatData.chatId && bot) {
              handleConnectionUpdate(chatData.chatId, userId, status, bot, activeClients, userStates, new Map());
            } else if (status.status === 'connected') {
              logger.info(`User ${userId} automatically reconnected.`);
            }
          },
          onMessage: async (message) => {
            const chatData = userStates.get(userId);
            if (chatData && chatData.chatId && bot) {
              handleWhatsAppMessage(chatData.chatId, userId, message, bot, new Map());
            }
          },
          onError: async (errorMessage) => {
            logger.error(`Error reconnecting user ${userId}: ${errorMessage}`);
            const chatData = userStates.get(userId);
            if (chatData && chatData.chatId && bot) {
              bot.sendMessage(chatData.chatId, `❌ Error: ${errorMessage}`, homeButton);
            }
          },
        });

        if (client && client.user) { // Ensure client is valid and connected
          activeClients.set(userId, client);
          logger.info(`Successfully initiated reconnection for user ${userId}`);
        } else {
          logger.warn(`Failed to initialize client for user ${userId}`);
        }
      } catch (error) {
        logger.error(`Failed to reconnect session for user ${userId}: ${error.stack || error}`);
      }
    }

    logger.info('Automatic session reconnection completed.');
  } catch (error) {
    logger.error(`Error during automatic session reconnection: ${error.stack || error}`);
  }
}

// Handle connection updates
const handleConnectionUpdate = async (chatId, userId, status, bot, activeClients, userStates, messagePreferences) => {
  try {
    userId = userId.toString();

    if (status.status === 'connected') {
      const userInfo = {
        name: status.userInfo?.name || status.client?.user?.name || 'Unknown',
        id: status.userInfo?.id || status.client?.user?.id || 'Unknown',
      };
      const successMsg = getSuccessMessage(userInfo, 'connected');
      bot.sendMessage(chatId, successMsg.message, successMsg.keyboard);

      // Ask about message forwarding if preference not yet set
      if (!messagePreferences.has(userId)) {
        bot.sendMessage(chatId, enableMessageForwardingMessage, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Yes', callback_data: 'forward_yes' }],
              [{ text: '❌ No', callback_data: 'forward_no' }],
              [{ text: '🏠 Back to Home', callback_data: 'home' }],
            ],
          },
          parse_mode: 'Markdown',
        });
      }

      userStates.set(userId, { state: 'connected', chatId });
    } else if (status.status === 'reconnecting') {
      bot.sendMessage(chatId, `🔄 WhatsApp connection issue: ${status.reason || 'Unknown reason'}. Attempting to reconnect...`);
    } else if (status.status === 'restarting') {
      if (status.client) {
        activeClients.set(userId, status.client);
      }
      bot.sendMessage(chatId, '🔄 WhatsApp connection is being restarted...');
    } else if (status.status === 'disconnected') {
      activeClients.delete(userId);
      bot.sendMessage(chatId, `❌ WhatsApp connection lost. Reason: ${status.reason || 'Unknown'}`);
      if (status.reason === 'Logged out') {
        bot.sendMessage(chatId, "You'll need to reconnect using /pair or the 'Pair WhatsApp' button");
      }
    }
  } catch (error) {
    logger.error(`Error handling connection update: ${error.stack || error}`);
  }
};

// Handle incoming WhatsApp messages
const handleWhatsAppMessage = async (chatId, userId, message, bot, messagePreferences) => {
  try {
    userId = userId.toString();

    // Check if message forwarding is enabled for this user
    if (messagePreferences.get(userId)) {
      let msgType = 'other';
      let content = '';

      // Determine message type and extract content
      if (message.message?.conversation) {
        msgType = 'text';
        content = message.message.conversation;
      } else if (message.message?.imageMessage) {
        msgType = 'image';
        content = 'an image';
      } else if (message.message?.videoMessage) {
        msgType = 'video';
        content = 'a video';
      } else if (message.message?.documentMessage) {
        msgType = 'document';
        content = 'a document';
      } else if (message.message?.audioMessage) {
        msgType = 'audio';
        content = 'an audio';
      }

      const sender = message.pushName || 'Unknown';

      // Forward the message to the user
      if (msgType === 'text') {
        bot.sendMessage(chatId, `*${sender}*:\n${content}`, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, `*${sender}* sent ${content}.`, { parse_mode: 'Markdown' });
      }
    }
  } catch (error) {
    logger.error(`Error handling WhatsApp message: ${error.stack || error}`);
  }
};

module.exports = {
  backupSession,
  restoreSession,
  deleteSession,
  checkRealConnection,
  reconnectAllSessions,
  handleConnectionUpdate,
  handleWhatsAppMessage,
};