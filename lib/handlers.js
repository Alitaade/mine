
const fs = require('fs');
const path = require('path');
const utils = require('./utils');
const logger = require('./logger.js');
const config = require('../config.js')
const setupHandlers = (bot, activeClients, messagePreferences, userSettings, usageStats, userStates, utils, startXeonBotInc, logger) => {
    // Connection update handler
const handleConnectionUpdate = async (chatId, userId, status) => {
  userId = userId.toString(); // Ensure userId is a string

  if (status.status === 'connected') {
    // Get user info from the status object
    const userInfo = {
      name: status.userInfo?.name || status.client?.user?.name || "Unknown",
      id: status.userInfo?.id || status.client?.user?.id || "Unknown"
    };

    const { message, keyboard } = utils.getSuccessMessage(userInfo, 'connected');
    bot.sendMessage(chatId, message, keyboard);

    // Only ask about message forwarding if preference isn't set
    if (!messagePreferences.has(userId)) {
      bot.sendMessage(chatId, "🔔 Enable message forwarding to Telegram?", {
        ...utils.yesNoKeyboard('forward'),
        parse_mode: 'Markdown',
      });
    }

    userStates.set(userId, {
      state: 'connected',
      chatId: chatId
    });
  } else if (status.status === 'reconnecting') {
    bot.sendMessage(chatId, `🔄 WhatsApp connection issue: ${status.reason || 'Unknown reason'}. Attempting to reconnect...`);
  } else if (status.status === 'restarting') {
    // Update the client reference if a new client was created during restart
    if (status.client) {
      activeClients.set(userId, status.client);
    }
    bot.sendMessage(chatId, "🔄 WhatsApp connection is being restarted...");
  } else if (status.status === 'disconnected') {
    activeClients.delete(userId);
    bot.sendMessage(chatId, `❌ WhatsApp connection lost. Reason: ${status.reason || 'Unknown'}`);

    // If it's a permanent disconnection, let the user know
    if (status.reason === 'Logged out') {
      bot.sendMessage(chatId, "You'll need to reconnect using /pair or the 'Pair WhatsApp' button");
    }
  }
};

// WhatsApp message handler
const handleWhatsAppMessage = async (chatId, userId, message) => {
  userId = userId.toString(); // Ensure userId is a string

  // Only forward messages if user has enabled it
  if (messagePreferences.get(userId)) {
    // Handle incoming WhatsApp messages
    try {
      const msgType = message.message?.conversation ? 'text' :
                     message.message?.imageMessage ? 'image' :
                     message.message?.videoMessage ? 'video' :
                     message.message?.documentMessage ? 'document' :
                     message.message?.audioMessage ? 'audio' : 'other';

      // Get sender information
      const sender = message.pushName || 'Unknown';

      if (msgType === 'text') {
        const text = message.message.conversation;
        bot.sendMessage(chatId, `*${sender}*:\n${text}`, { parse_mode: 'Markdown' });
      } else {
        // For other message types, just send a notification
        bot.sendMessage(chatId, `*${sender}* sent a ${msgType} message.`, { parse_mode: 'Markdown' });
        // Advanced handling of media messages would go here
      }
    } catch (error) {
      logger.error('Error handling WhatsApp message:', error);
    }
  }
};
  // Bot Handlers
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    // Update user state with chat context if we have an active session
    if (userStates.has(userId)) {
      const currentState = userStates.get(userId);
      userStates.set(userId, {
        ...currentState,
        chatId: chatId
      });
    } else {
      userStates.set(userId, {
        state: 'home',
        chatId: chatId
      });
    }

    bot.sendMessage(chatId, utils.welcomeMessage, {
      ...utils.createMainMenuKeyboard(),
      parse_mode: 'Markdown',
    });
  });

  // Pair command handler
  bot.onText(/\/pair/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    // Check if already connected
    const isConnected = await utils.checkRealConnection(userId, activeClients);
    if (isConnected) {
      bot.sendMessage(chatId, "⚠️ You're already connected!", utils.homeButton);
      return;
    }

    // Check for existing session that might be reconnectable
    const sessionPath = `${config.paths.sessions}/${userId}`;
    if (fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0) {
      bot.sendMessage(chatId, "Found existing session. Attempting to reconnect...", utils.homeButton);

      try {
        // Try to reconnect using existing session
        const client = await startXeonBotInc(userId, null, {
          onPairingCode: async (pairingCode) => {
            bot.sendMessage(
              chatId,
              `🔐 *Pairing Code*\n\`${pairingCode}\`\n\n1. Open WhatsApp > Settings\n2. Linked Devices > Link Device\n3. Enter code`,
              { parse_mode: 'Markdown', ...utils.homeButton }
            );
          },
          onConnectionUpdate: async (status) => handleConnectionUpdate(chatId, userId, status),
          onMessage: async (message) => handleWhatsAppMessage(chatId, userId, message),
          onError: async (errorMessage) => {
            bot.sendMessage(chatId, `❌ Error: ${errorMessage}`, utils.homeButton);
          }
        });

        if (client) {
          activeClients.set(userId, client);

          // Store chat context
          userStates.set(userId, {
            state: 'connecting',
            chatId: chatId
          });

          return;
        }
      } catch (error) {
        logger.error(`Error reconnecting for user ${userId}:`, error);
        // Continue to new pairing process
      }
    }

    userStates.set(userId, {
      state: 'awaiting_phone',
      chatId: chatId
    });

    bot.sendMessage(chatId, "📲 Please enter your WhatsApp number in international format:\n(e.g., +1234567890)", utils.homeButton);
  });
    const showStatsMessage = (chatId, userId) => {
  const stats = usageStats.get(userId) || {
    messagesReceived: 0,
    messagesSent: 0,
    mediaReceived: 0,
    mediaSent: 0,
    connectionTime: 0,
    lastConnected: null,
    reconnectionCount: 0
  };
  
  const statsMessage = `
╭═══════『 𝐔𝐒𝐀𝐆𝐄 𝐒𝐓𝐀𝐓𝐈𝐒𝐓𝐈𝐂𝐒 』═══════⊱
│
├─────『 𝐌𝐞𝐬𝐬𝐚𝐠𝐞𝐬 』
│ • Received: ${stats.messagesReceived}
│ • Sent: ${stats.messagesSent}
│
├─────『 𝐌𝐞𝐝𝐢𝐚 』
│ • Received: ${stats.mediaReceived}
│ • Sent: ${stats.mediaSent}
│
├─────『 𝐂𝐨𝐧𝐧𝐞𝐜𝐭𝐢𝐨𝐧 』
│ • Time Connected: ${formatConnectionTime(stats.connectionTime)}
│ • Last Connected: ${stats.lastConnected ? new Date(stats.lastConnected).toLocaleString() : 'Never'}
│ • Reconnections: ${stats.reconnectionCount}
│
╰═════════════════════⊱`;

  bot.sendMessage(chatId, statsMessage, utils.homeButton);
};

// Helper function to format connection time
const formatConnectionTime = (timeInMs) => {
  if (!timeInMs) return '0 minutes';
  
  const seconds = Math.floor(timeInMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''}, ${hours % 24} hour${hours % 24 > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}, ${minutes % 60} minute${minutes % 60 > 1 ? 's' : ''}`;
  return `${minutes} minute${minutes > 1 ? 's' : ''}`;
};

  // Status command handler
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    // Update user state with chat context
    if (userStates.has(userId)) {
      const currentState = userStates.get(userId);
      userStates.set(userId, {
        ...currentState,
        chatId: chatId
      });
    } else {
      userStates.set(userId, {
        state: 'checking_status',
        chatId: chatId
      });
    }
    
    const isConnected = await utils.checkRealConnection(userId, activeClients);
    if (isConnected) {
      const client = activeClients.get(userId);
      const userInfo = {
        name: client.user?.name || "Unknown",
        id: client.user?.id || "Unknown"
      };
      const { message, keyboard } = utils.getSuccessMessage(userInfo, 'connected');
      return bot.sendMessage(chatId, message, keyboard);
    }

    const sessionPath = `${config.paths.sessions}/${userId}`;
    if (fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0) {
      const { message, keyboard } = utils.getSuccessMessage(null, 'session_exists');
      return bot.sendMessage(chatId, message, keyboard);
    }

    bot.sendMessage(chatId, "❌ No active connection or saved session!", utils.homeButton);
  });
    
      bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    // Initialize user settings
    utils.initUserSettings(userId, userSettings, usageStats);
    // Show help message
    bot.sendMessage(chatId, utils.helpMessage, utils.homeButton);
  });

    bot.onText(/\/settings/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    // Initialize user settings
    utils.initUserSettings(userId, userSettings, usageStats);
    // Show settings menu
    bot.sendMessage(chatId, "Settings Menu:", utils.createSettingsKeyboard(userId, userSettings));
  });
    bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    // Initialize user settings
    utils.initUserSettings(userId, userSettings, usageStats);
    // Show stats (implement this part based on your stats display logic)
    showStatsMessage(chatId, userId);
  });
    
  // Disconnect command handler
  bot.onText(/\/disconnect/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    // Update user state with chat context
    userStates.set(userId, {
      state: 'disconnect_confirmation',
      chatId: chatId
    });
    
    // Check if user has an active session
    const sessionPath = `${config.paths.sessions}/${userId}`;
    if (!fs.existsSync(sessionPath) || fs.readdirSync(sessionPath).length === 0) {
      return bot.sendMessage(chatId, "⚠️ No active session found to disconnect!", utils.homeButton);
    }
    
    // Show confirmation dialog
    bot.sendMessage(
      chatId, 
      "⚠️ Are you sure you want to disconnect your WhatsApp session?",
      utils.yesNoKeyboard('disconnect_confirm')
    );
  });

  // Handle callback queries
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const data = query.data;

  try {
    if (data === 'home') {
      userStates.set(userId, {
        state: 'home',
        chatId: chatId
      });
      return bot.sendMessage(chatId, utils.welcomeMessage, utils.createMainMenuKeyboard());
    }

    if (data === 'pair') {
      const isConnected = await utils.checkRealConnection(userId, activeClients);
      if (isConnected) {
        return bot.sendMessage(chatId, "⚠️ You're already connected!", utils.homeButton);
      }

      // Check for existing session
      const sessionPath = `${config.paths.sessions}/${userId}`;
      if (fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0) {
        bot.sendMessage(chatId, "Found existing session. Attempting to reconnect...", utils.homeButton);

        try {
          // Try to reconnect using existing session
          const client = await startXeonBotInc(userId, null, {
            onPairingCode: async (pairingCode) => {
              bot.sendMessage(
                chatId,
                `🔐 *Pairing Code*\n\`${pairingCode}\`\n\n1. Open WhatsApp > Settings\n2. Linked Devices > Link Device\n3. Enter code`,
                { parse_mode: 'Markdown', ...utils.homeButton }
              );
            },
            onConnectionUpdate: async (status) => handleConnectionUpdate(chatId, userId, status),
            onMessage: async (message) => handleWhatsAppMessage(chatId, userId, message),
            onError: async (errorMessage) => {
              bot.sendMessage(chatId, `❌ Error: ${errorMessage}`, utils.homeButton);
            }
          });

          if (client) {
            activeClients.set(userId, client);
            userStates.set(userId, {
              state: 'connecting',
              chatId: chatId
            });
            return;
          }
        } catch (error) {
          logger.error(`Error reconnecting for user ${userId}:`, error);
          // Continue to new pairing process
        }
      }

      userStates.set(userId, {
        state: 'awaiting_phone',
        chatId: chatId
      });
      return bot.sendMessage(chatId, "📲 Please enter your WhatsApp number in international format:\n(e.g., +1234567890)", utils.homeButton);
    }

    if (data === 'status') {
      userStates.set(userId, {
        state: 'checking_status',
        chatId: chatId
      });

      const isConnected = await utils.checkRealConnection(userId, activeClients);
      if (isConnected) {
        const client = activeClients.get(userId);
        const userInfo = {
          name: client.user?.name || "Unknown",
          id: client.user?.id || "Unknown"
        };
        const { message, keyboard } = utils.getSuccessMessage(userInfo, 'connected');
        return bot.sendMessage(chatId, message, keyboard);
      }

      const sessionPath = `${config.paths.sessions}/${userId}`;
      if (fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0) {
        const { message, keyboard } = utils.getSuccessMessage(null, 'session_exists');
        return bot.sendMessage(chatId, message, keyboard);
      }

      return bot.sendMessage(chatId, "❌ No active connection or saved session!", utils.homeButton);
    }

    if (data === 'disconnect') {
      userStates.set(userId, {
        state: 'disconnect_confirmation',
        chatId: chatId
      });

      // Check if user has an active session
      const sessionPath = `${config.paths.sessions}/${userId}`;
      if (!fs.existsSync(sessionPath) || fs.readdirSync(sessionPath).length === 0) {
        return bot.sendMessage(chatId, "⚠️ No active session found to disconnect!", utils.homeButton);
      }

      // Show confirmation dialog
      return bot.sendMessage(
        chatId,
        "⚠️ Are you sure you want to disconnect your WhatsApp session?",
        utils.yesNoKeyboard('disconnect_confirm')
      );
    }

    if (data === 'disconnect_confirm_yes') {
      if (activeClients.has(userId)) {
        const client = activeClients.get(userId);
        try {
          await client.logout();
          activeClients.delete(userId);
          fs.rmSync(`${config.paths.sessions}/${userId}`, { recursive: true, force: true });
          messagePreferences.delete(userId);
          return bot.sendMessage(chatId, "✅ Disconnected successfully!", utils.homeButton);
        } catch (error) {
          logger.error(`Error during logout for user ${userId}:`, error);
          // Force disconnect if logout fails
          activeClients.delete(userId);
          fs.rmSync(`${config.paths.sessions}/${userId}`, { recursive: true, force: true });
          messagePreferences.delete(userId);
          return bot.sendMessage(chatId, "✅ Disconnected (forced).", utils.homeButton);
        }
      }

      const sessionPath = `${config.paths.sessions}/${userId}`;
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        return bot.sendMessage(chatId, "✅ Session removed successfully!", utils.homeButton);
      }

      return bot.sendMessage(chatId, "⚠️ No active connection or session found!", utils.homeButton);
    }

    if (data === 'disconnect_confirm_no') {
      return bot.sendMessage(chatId, "✅ Disconnection cancelled.", utils.homeButton);
    }

    if (data === 'forward_yes') {
      messagePreferences.set(userId, true);
      return bot.sendMessage(chatId, "✅ Message forwarding enabled!", utils.homeButton);
    }

    if (data === 'forward_no') {
      messagePreferences.set(userId, false);
      return bot.sendMessage(chatId, "❌ Message forwarding disabled!", utils.homeButton);
    }

    // Handle Settings button
    if (data === 'settings') {
      userStates.set(userId, {
        state: 'settings',
        chatId: chatId
      });
      return bot.sendMessage(
        chatId,
        "⚙️ *Settings*\nConfigure your preferences below:",
        { parse_mode: 'Markdown', ...utils.createSettingsKeyboard(userId, userSettings) }
      );
    }

    // Handle Usage Stats button
    if (data === 'stats') {
      const stats = usageStats.get(userId) || {
        messagesReceived: 0,
        messagesSent: 0,
        mediaReceived: 0,
        mediaSent: 0,
        connectionTime: 0,
        lastConnected: null,
        reconnectionCount: 0
      };

      const statsMessage = `
📊 *Usage Stats*
├── Messages Received: ${stats.messagesReceived}
├── Messages Sent: ${stats.messagesSent}
├── Media Received: ${stats.mediaReceived}
├── Media Sent: ${stats.mediaSent}
├── Total Connection Time: ${Math.floor(stats.connectionTime / 3600)} hours
├── Last Connected: ${stats.lastConnected || 'Never'}
└── Reconnection Attempts: ${stats.reconnectionCount}
      `;

      return bot.sendMessage(
        chatId,
        statsMessage,
        { parse_mode: 'Markdown', ...utils.homeButton }
      );
    }

    // Handle Help button
    if (data === 'help') {
      return bot.sendMessage(
        chatId,
        utils.helpMessage,
        { parse_mode: 'Markdown', ...utils.homeButton }
      );
    }

      if (data === 'setting_reset') {
  // Reset all settings to default
  userSettings.set(userId, { ...utils.defaultSettings });

  // Send confirmation message with updated settings keyboard
  return bot.sendMessage(
    chatId,
    "⚙️ *Settings Updated*\nAll settings have been reset to default.",
    { parse_mode: 'Markdown', ...utils.createSettingsKeyboard(userId, userSettings) }
  );
}
   if (data.startsWith('setting_')) {
  const setting = data.replace('setting_', '');
  const currentSettings = userSettings.get(userId);

  // Toggle the appropriate setting
  switch (setting) {
    case 'notifications':
      currentSettings.notifyNewMessages = !currentSettings.notifyNewMessages;
      break;
    case 'media':
      currentSettings.forwardMedia = !currentSettings.forwardMedia;
      break;
    case 'reconnect':
      currentSettings.autoReconnect = !currentSettings.autoReconnect;
      break;
    case 'sound':
      currentSettings.notificationSound = !currentSettings.notificationSound;
      break;
    case 'theme':
      currentSettings.darkMode = !currentSettings.darkMode;
      break;
    case 'reset':
      // Reset all settings to default
      userSettings.set(userId, { ...utils.defaultSettings });
      return bot.sendMessage(
        chatId,
        "⚙️ *Settings Updated*\nAll settings have been reset to default.",
        { parse_mode: 'Markdown', ...utils.createSettingsKeyboard(userId, userSettings) }
      );
    case 'language':
      // Show language selection keyboard
      return bot.sendMessage(
        chatId,
        "🌐 Select your preferred language:",
        utils.createLanguageKeyboard()
      );
  }

  // Save the updated settings
  userSettings.set(userId, currentSettings);

  // Send confirmation message with updated settings keyboard
  return bot.sendMessage(
    chatId,
    "⚙️ *Settings Updated*\nYour preferences have been saved.",
    { parse_mode: 'Markdown', ...utils.createSettingsKeyboard(userId, userSettings) }
  );
}
  } catch (error) {
    logger.error(`Callback error: ${error}`);
    bot.sendMessage(chatId, "⚠️ An error occurred!", utils.homeButton);
  }
});
  // Handle regular messages (for phone number input)
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const userState = userStates.get(userId);
    
    // Ignore command messages or if user has no state
    if (!userState || !msg.text || msg.text.startsWith('/')) return;
    
    if (userState.state === 'awaiting_phone') {
      const phoneNumber = msg.text.trim();
      
      // Validate phone number format
      if (!/^\+\d{10,15}$/.test(phoneNumber)) {
        return bot.sendMessage(chatId, "❌ Invalid format! Example: +1234567890", utils.homeButton);
      }
      
      // Update user state
      userStates.set(userId, { 
        state: 'pairing', 
        phoneNumber,
        chatId: chatId
      });
      
      bot.sendMessage(chatId, "🔗 Initializing connection...", utils.homeButton);
      
      try {
        // Initialize WhatsApp client with callbacks
        const client = await startXeonBotInc(userId, phoneNumber, {
          onPairingCode: async (pairingCode) => {
            bot.sendMessage(
              chatId,
              `🔐 *Pairing Code*\n\`${pairingCode}\`\n\n1. Open WhatsApp > Settings\n2. Linked Devices > Link Device\n3. Enter code`,
              { parse_mode: 'Markdown', ...utils.homeButton }
            );
          },
          onConnectionUpdate: async (status) => handleConnectionUpdate(chatId, userId, status),
          onMessage: async (message) => handleWhatsAppMessage(chatId, userId, message),
          onError: async (errorMessage) => {
            bot.sendMessage(chatId, `❌ Error: ${errorMessage}`, utils.homeButton);
          }
        });
        
        // Store client for future reference
        if (client) {
          activeClients.set(userId, client);
        }
      } catch (error) {
        logger.error(`Error initializing WhatsApp for user ${userId}:`, error);
        bot.sendMessage(chatId, "❌ Failed to initialize WhatsApp connection. Please try again later.", utils.homeButton);
        userStates.delete(userId);
      }
    }
  });
};

module.exports = { setupHandlers };