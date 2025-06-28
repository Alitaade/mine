const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Get directory paths
const currentDir = __dirname; // Gets the directory where this file is located

module.exports = {
    // Telegram configuration
    telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN,
    },
    // Paths
    paths: {
        sessions: path.join(currentDir, 'session'),
    },
    whatsapp: {
        maxReconnectAttempts: 5, // Maximum number of reconnection attempts
        reconnectInterval: 30000, // Reconnection interval in milliseconds (30 seconds)
      },
    // Logging
    logging: {
        level: process.env.LOG_LEVEL || 'info',
    }
};