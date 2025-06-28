// botConfig.js

const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const logger = require('./logger');

// Global state maps for active clients, message preferences, and user states
const activeClients = new Map();
const messagePreferences = new Map();
const userStates = new Map();

// Initialize Telegram bot with polling options
const bot = new TelegramBot(config.telegram.token, {
  polling: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4, // Force IPv4
    },
  },
});

// Log polling errors
bot.on('polling_error', (error) => {
  logger.error('Telegram polling error:', error);
});

module.exports = {
  bot,
  activeClients,
  messagePreferences,
  userStates,
};