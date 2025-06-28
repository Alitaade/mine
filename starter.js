// ========================================
// WHATSAPP BOT - MAIN ENTRY POINT
// ========================================

require("./settings")
require("./src/utils/crash-protection") // Initialize crash protection
const { startXeonBotInc } = require("./src/core/connection-manager")

// Export the main function
module.exports = { startXeonBotInc }

// If running directly, you can add startup logic here
if (require.main === module) {
  console.log("🚀 WhatsApp Bot System Ready")
  console.log("Use startXeonBotInc(userId, phoneNumber, callbacks) to start a bot instance")
}
