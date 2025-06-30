// botConfig.js
const TelegramBot = require("node-telegram-bot-api");
const config = require("../config");
const logger = require("./logger");

// Global state maps for active clients, message preferences, and user states
const activeClients = new Map();
const messagePreferences = new Map();
const userStates = new Map();

// Enhanced polling options with retry logic
const pollingOptions = {
  polling: {
    interval: 1000, // Check for updates every second
    autoStart: true,
    params: {
      timeout: 30, // Long polling timeout
    },
  },
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4, // Force IPv4
      timeout: 60000, // 60 second timeout
    },
    timeout: 60000, // Request timeout
  },
  onlyFirstMatch: false,
  filepath: false,
};

// Initialize bot with enhanced error handling
let bot;
let retryCount = 0;
const maxRetries = 5;
const baseRetryDelay = 1000; // Start with 1 second delay

function createBot() {
  try {
    bot = new TelegramBot(config.telegram.token, pollingOptions);

    // Reset retry count on successful connection
    bot.on("message", () => {
      if (retryCount > 0) {
        logger.info("Telegram bot reconnected successfully");
        retryCount = 0;
      }
    });

    // Enhanced polling error handler with retry logic - NEVER SHUTDOWN
    bot.on("polling_error", (error) => {
      logger.error("Telegram polling error (bot will continue running):", {
        error: error.message,
        code: error.code,
        response: error.response?.body,
        retryCount: retryCount,
      });

      // Handle specific error types - but NEVER shutdown
      if (error.code === "EFATAL") {
        logger.error(
          "Fatal polling error, attempting to restart bot (keeping process alive)"
        );
        safeRestartBot();
      } else if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
        logger.warn(
          "Connection error, will retry automatically (keeping process alive)"
        );
        safeRestartBot();
      } else if (error.response?.statusCode === 429) {
        // Rate limiting - extract retry after from headers
        const retryAfter = error.response.headers["retry-after"] || 60;
        logger.warn(
          `Rate limited, waiting ${retryAfter} seconds (keeping process alive)`
        );
        setTimeout(() => {
          safeRestartBot();
        }, retryAfter * 1000);
      } else if (error.response?.statusCode >= 500) {
        logger.warn(
          "Server error, will retry with backoff (keeping process alive)"
        );
        scheduleRetry();
      } else {
        // For any other error, just log and continue
        logger.warn(
          "Unknown polling error, continuing operation:",
          error.message
        );
        setTimeout(() => {
          safeRestartBot();
        }, 5000);
      }
    });

    // Handle webhook errors - NEVER SHUTDOWN
    bot.on("webhook_error", (error) => {
      logger.error("Telegram webhook error (continuing anyway):", error);
      // Don't restart for webhook errors, just log
    });

    // Handle successful polling start
    bot.on("polling_start", () => {
      logger.info("Telegram bot polling started successfully");
    });

    // Handle polling stop
    bot.on("polling_stop", () => {
      logger.info("Telegram bot polling stopped (will restart)");
    });

    logger.info("Telegram bot initialized successfully (immortal mode active)");
  } catch (error) {
    logger.error("Failed to create Telegram bot (will retry anyway):", error);
    // Even if creation fails, keep trying
    setTimeout(() => {
      safeRestartBot();
    }, 3000);
  }
}

function scheduleRetry() {
  // NEVER STOP - just reset retry count after max attempts and continue
  if (retryCount >= maxRetries) {
    logger.warn(
      `Max retries (${maxRetries}) reached, resetting counter and continuing (NEVER SHUTDOWN)`
    );
    retryCount = 0; // Reset and keep trying
  }

  retryCount++;
  const delay = Math.min(baseRetryDelay * Math.pow(2, retryCount - 1), 60000); // Cap at 60 seconds

  logger.info(
    `Scheduling bot restart in ${delay}ms (attempt ${retryCount}, will NEVER give up)`
  );

  setTimeout(() => {
    safeRestartBot();
  }, delay);
}

function safeRestartBot() {
  try {
    if (bot) {
      logger.info(
        "Safely stopping existing bot instance (keeping process alive)"
      );
      try {
        bot.stopPolling();
        bot.removeAllListeners();
      } catch (stopError) {
        logger.warn(
          "Error stopping bot (ignoring, will continue):",
          stopError.message
        );
      }
    }
  } catch (error) {
    logger.warn(
      "Error in safe restart (ignoring, will continue):",
      error.message
    );
  }

  // Always wait and restart, no matter what
  setTimeout(() => {
    logger.info("Restarting Telegram bot (immortal mode)");
    try {
      createBot();
    } catch (createError) {
      logger.error(
        "Error creating bot (will retry anyway):",
        createError.message
      );
      // Even if createBot fails, schedule another retry
      setTimeout(() => {
        safeRestartBot();
      }, 5000);
    }
  }, 2000);
}

// Graceful shutdown handlers - BUT ONLY ON EXPLICIT SIGNALS
process.on("SIGINT", () => {
  logger.info(
    "Received SIGINT - Bot will attempt graceful shutdown but may continue running"
  );
  if (bot) {
    try {
      bot
        .stopPolling()
        .then(() => {
          logger.info("Bot stopped successfully on SIGINT");
          process.exit(0);
        })
        .catch((error) => {
          logger.error("Error stopping bot on SIGINT (exiting anyway):", error);
          process.exit(0); // Exit anyway, don't hang
        });
    } catch (error) {
      logger.error("Exception during SIGINT shutdown:", error);
      process.exit(0);
    }
  } else {
    process.exit(0);
  }
});

process.on("SIGTERM", () => {
  logger.info(
    "Received SIGTERM - Bot will attempt graceful shutdown but may continue running"
  );
  if (bot) {
    try {
      bot
        .stopPolling()
        .then(() => {
          logger.info("Bot stopped successfully on SIGTERM");
          process.exit(0);
        })
        .catch((error) => {
          logger.error(
            "Error stopping bot on SIGTERM (exiting anyway):",
            error
          );
          process.exit(0); // Exit anyway, don't hang
        });
    } catch (error) {
      logger.error("Exception during SIGTERM shutdown:", error);
      process.exit(0);
    }
  } else {
    process.exit(0);
  }
});

// Handle uncaught exceptions - LOG BUT NEVER SHUTDOWN
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception (bot will continue running):", error);
  // Don't exit - just log and continue
});

// Handle unhandled promise rejections - LOG BUT NEVER SHUTDOWN
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection (bot will continue running):", {
    reason,
    promise,
  });
  // Don't exit - just log and continue
});

// Initialize the bot
createBot();

// Export a getter function to ensure we always get the current bot instance
module.exports = {
  get bot() {
    return bot;
  },
  activeClients,
  messagePreferences,
  userStates,
  safeRestartBot, // Export safe restart function for manual use if needed
};
