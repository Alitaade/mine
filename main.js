// ========================================
// WHATSAPP BOT - CLEAN INDEX FILE
// ========================================

// Export the main function from the modular system
const { startXeonBotInc } = require("./starter")

module.exports = { startXeonBotInc }

// File watcher for auto-reload
const fs = require("fs")
const chalk = require("chalk")

const file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  console.log(chalk.redBright(`Update ${__filename}`))
  delete require.cache[file]
  require(file)
})
