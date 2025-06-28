
const fs = require('fs');
const path = require('path');
const os = require('os');

// Default user settings
const defaultSettings = {
  notifyNewMessages: true,
  forwardMedia: true,
  autoReconnect: true,
  notificationSound: true,
  darkMode: false,
  language: 'en'
};

// Initialize user settings if not exist
const initUserSettings = (userId, userSettings, usageStats) => {
  if (!userSettings.has(userId)) {
    userSettings.set(userId, { ...defaultSettings });
  }

  // Initialize usage stats if not exist
  if (!usageStats.has(userId)) {
    usageStats.set(userId, {
      messagesReceived: 0,
      messagesSent: 0,
      mediaReceived: 0,
      mediaSent: 0,
      connectionTime: 0,
      lastConnected: null,
      reconnectionCount: 0
    });
  }
};

// Check if a user has an active WhatsApp connection
const checkRealConnection = (userId, activeClients) => {
  const client = activeClients.get(userId);
  return !!(client && client.user); // Check if user object exists, indicating an active connection
};

// UI Components
const createMainMenuKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📱 Pair WhatsApp', callback_data: 'pair' },
        { text: '🔍 Check Status', callback_data: 'status' }
      ],
      [
        { text: '⚙️ Settings', callback_data: 'settings' },
        { text: '❌ Disconnect', callback_data: 'disconnect' }
      ],
      [
        { text: '📊 Usage Stats', callback_data: 'stats' },
        { text: '❓ Help', callback_data: 'help' }
      ],
    ],
  },
});

const homeButton = {
  reply_markup: {
    inline_keyboard: [[{ text: '🏠 Back to Home', callback_data: 'home' }]],
  },
};

const backButton = (destination) => ({
  reply_markup: {
    inline_keyboard: [[{ text: '◀️ Back', callback_data: destination }]],
  },
});

const yesNoKeyboard = (dataPrefix) => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '✅ Yes', callback_data: `${dataPrefix}_yes` },
        { text: '❌ No', callback_data: `${dataPrefix}_no` }
      ],
      [{ text: '🏠 Back to Home', callback_data: 'home' }],
    ],
  },
});

const createSettingsKeyboard = (userId, userSettings) => {
  // Ensure user settings exist
  if (!userSettings.has(userId)) {
    userSettings.set(userId, { ...defaultSettings });
  }
  
  const settings = userSettings.get(userId);
  
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: `${settings.notifyNewMessages ? '🔔' : '🔕'} Notifications`, callback_data: 'setting_notifications' },
          { text: `${settings.forwardMedia ? '✅' : '❌'} Forward Media`, callback_data: 'setting_media' }
        ],
        [
          { text: `${settings.autoReconnect ? '✅' : '❌'} Auto Reconnect`, callback_data: 'setting_reconnect' },
          { text: `${settings.notificationSound ? '🔊' : '🔇'} Sound`, callback_data: 'setting_sound' }
        ],
        [
          { text: `${settings.darkMode ? '🌙' : '☀️'} Theme`, callback_data: 'setting_theme' },
          { text: `🌐 Language (${settings.language.toUpperCase()})`, callback_data: 'setting_language' }
        ],
        [
          { text: '🔄 Reset All Settings', callback_data: 'setting_reset' }
        ],
        [
          { text: '🏠 Back to Home', callback_data: 'home' }
        ]
      ]
    }
  };
};

const createLanguageKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🇺🇸 English', callback_data: 'lang_en' },
        { text: '🇪🇸 Español', callback_data: 'lang_es' }
      ],
      [
        { text: '🇫🇷 Français', callback_data: 'lang_fr' },
        { text: '🇩🇪 Deutsch', callback_data: 'lang_de' }
      ],
      [
        { text: '🇮🇹 Italiano', callback_data: 'lang_it' },
        { text: '🇷🇺 Русский', callback_data: 'lang_ru' }
      ],
      [
        { text: '🇯🇵 日本語', callback_data: 'lang_ja' },
        { text: '🇨🇳 中文', callback_data: 'lang_zh' }
      ],
      [
        { text: '◀️ Back', callback_data: 'settings' }
      ]
    ]
  }
});

// Formatting Functions
const getSuccessMessage = (userInfo, status) => {
  const statusMessage = status === 'connected' ? 'Connected ✅' : 'Not Connected ❌';

  // Use the userInfo object to display connection details
  const connectionInfo = status === 'connected' ?
    `│ • Name: ${userInfo?.name || 'Unknown'}\n│ • Number: ${userInfo?.id ? String(userInfo.id).split(':')[0] : 'Unknown'}` :
    '│ • Session: Existing session found';

  return {
    message: `
╭═══════『 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐒𝐭𝐚𝐭𝐮𝐬 』═══════⊱
│
├─────『 𝐂𝐨𝐧𝐧𝐞𝐜𝐭𝐢𝐨𝐧 𝐒𝐭𝐚𝐭𝐮𝐬 』
│ • Status: ${statusMessage}
${connectionInfo}
│
├─────『 𝐁𝐨𝐭 𝐈𝐧𝐟𝐨 』
│ • Mode: ${status === 'connected' ? 'Active' : 'Standby'}
│ • Version: 3.5 Premium Release
│ • Type: Multi-Device
│ • Server: ${os.hostname()}
│ 
╰═════════════════════⊱`,
    keyboard: {
      reply_markup: {
        inline_keyboard: [
          ...(status !== 'connected' ? [[{ text: '📱 Reconnect', callback_data: 'pair' }]] : []),
          [{ text: '🏠 Back to Home', callback_data: 'home' }],
        ],
      },
    },
  };
};

const welcomeMessage = `
╭═══════『 𝐖𝐄𝐋𝐂𝐎𝐌𝐄 』═══════⊱
│
├─────『 𝐏𝐀𝐔𝐋 𝐁𝐎𝐓 𝐅𝐞𝐚𝐭𝐮𝐫𝐞𝐬 』
│ • WhatsApp ↔ PAUL BOT Integration
│ • Full Media Support
│ • Multi-Device Ready
│ • End-to-End Encryption
│ • Advanced Settings
│ • Usage Statistics
│
├─────『 𝐒𝐮𝐩𝐩𝐨𝐫𝐭𝐞𝐝 𝐂𝐨𝐦𝐦𝐚𝐧𝐝𝐬 』
│ /start - Show main menu
│ /pair - Connect WhatsApp
│ /status - Check connection
│ /settings - Adjust preferences
│ /stats - View usage statistics
│ /help - Show help information
│ /disconnect - Remove session
│
╰═════════════════════⊱`;

const helpMessage = `
╭═══════『 𝐇𝐄𝐋𝐏 𝐂𝐄𝐍𝐓𝐄𝐑 』═══════⊱
│
├─────『 𝐆𝐞𝐭𝐭𝐢𝐧𝐠 𝐒𝐭𝐚𝐫𝐭𝐞𝐝 』
│ • Tap "Pair WhatsApp" to connect
│ • Enter your phone number
│ • Use the pairing code in WhatsApp
│ • Manage settings as needed
│
├─────『 𝐓𝐫𝐨𝐮𝐛𝐥𝐞𝐬𝐡𝐨𝐨𝐭𝐢𝐧𝐠 』
│ • Connection issues? Try disconnect and reconnect
│ • WhatsApp logged out? Re-pair your device
│ • Not receiving messages? Check your settings
│ • For persistent issues, use /disconnect then /pair
│
├─────『 𝐂𝐨𝐧𝐭𝐚𝐜𝐭 𝐒𝐮𝐩𝐩𝐨𝐫𝐭 』
│ • Email: support@paulbot.com
│ • Website: paulbot.com/support
│ • Telegram: @PaulBotSupport
│`;

// Reconnect all sessions
const reconnectAllSessions = async (bot, activeClients, userStates, config, logger, startXeonBotInc) => {
  logger.info('Starting automatic session reconnection for all users...');

  try {
    // Get the sessions directory
    const sessionsDir = config.paths.sessions;

    // Check if the directory exists
    if (!fs.existsSync(sessionsDir)) {
      logger.info('Sessions directory does not exist. Creating it...');
      fs.mkdirSync(sessionsDir, { recursive: true });
      return;
    }

    // Read all directories in the sessions folder
    const userDirs = fs.readdirSync(sessionsDir);

    for (const userId of userDirs) {
      const userSessionPath = path.join(sessionsDir, userId);

      // Skip if not a directory or empty
      if (!fs.statSync(userSessionPath).isDirectory() ||
        fs.readdirSync(userSessionPath).length === 0) {
        continue;
      }

      // Skip if already connected
      if (activeClients.has(userId)) {
        logger.info(`User ${userId} already has an active client.`);
        continue;
      }

      logger.info(`Attempting to reconnect session for user ${userId}...`);

      try {
        const client = await startXeonBotInc(userId, null, {
          onPairingCode: async (pairingCode) => {
            // Store the pairing code to be used when the user checks status
            userStates.set(userId, {
              state: 'awaiting_pairing_code_entry',
              pairingCode: pairingCode
            });
          },
          onConnectionUpdate: async (status) => {
            // If we have chat context, handle the status update
            const chatData = userStates.get(userId);
            if (chatData && chatData.chatId) {
              handleConnectionUpdate(chatData.chatId, userId, status);
            } else if (status.status === 'connected') {
              logger.info(`User ${userId} automatically reconnected.`);
            }
          },
          onMessage: async (message) => {
            // If we have chat context and message forwarding is enabled, forward messages
            const chatData = userStates.get(userId);
            if (chatData && chatData.chatId && messagePreferences.get(userId)) {
              handleWhatsAppMessage(chatData.chatId, userId, message);
            }
          },
          onError: async (errorMessage) => {
            logger.error(`Error reconnecting user ${userId}: ${errorMessage}`);
          }
        });

        if (client) {
          activeClients.set(userId, client);
          logger.info(`Successfully initiated reconnection for user ${userId}`);
        }
      } catch (error) {
        logger.error(`Failed to reconnect session for user ${userId}:`, error);
      }
    }

    logger.info('Automatic session reconnection completed.');
  } catch (error) {
    logger.error('Error during automatic session reconnection:', error);
  }
};

module.exports = {
  defaultSettings,
  initUserSettings,
  checkRealConnection,
  createMainMenuKeyboard,
  homeButton,
  backButton,
  yesNoKeyboard,
  createSettingsKeyboard,
  createLanguageKeyboard,
  getSuccessMessage,
  welcomeMessage,
  helpMessage,
  reconnectAllSessions
};