// ========================================
// CRASH ERROR PROTECTION
// ========================================

const { fs, chalk, path } = require("./imports")

const crashLogPath = path.join(__dirname, "../../crash_errors.txt")

function logCrashError(error, type) {
  const timestamp = new Date().toISOString()
  const logEntry = `[${timestamp}] ${type}: ${error.message}\nStack: ${error.stack}\n${"=".repeat(80)}\n`

  try {
    if (!fs.existsSync(crashLogPath)) {
      fs.writeFileSync(crashLogPath, `CRASH ERROR LOG - Started: ${timestamp}\n${"=".repeat(80)}\n`)
    }
    fs.appendFileSync(crashLogPath, logEntry)
    console.error(chalk.red(`💾 Crash error logged to file: ${type}`))
  } catch (e) {
    console.error(chalk.red("Failed to write crash log:"), e.message)
  }
}

process.on("uncaughtException", (error) => {
  logCrashError(error, "UNCAUGHT_EXCEPTION")
  console.error(chalk.red("🛡️ PREVENTED SERVER SHUTDOWN - Uncaught Exception:"), error.message)
})

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  logCrashError(error, "UNHANDLED_PROMISE_REJECTION")
  console.error(chalk.red("🛡️ PREVENTED SERVER SHUTDOWN - Unhandled Promise Rejection:"), error.message)
})

process.on("SIGTERM", () => {
  console.log(chalk.blue("🛡️ SIGTERM received - Server protected from shutdown"))
})

process.on("SIGINT", () => {
  console.log(chalk.blue("🛡️ SIGINT received - Server protected from shutdown"))
})

console.log(chalk.green("🛡️ Server crash protection enabled - All errors will be logged but server will stay running"))

// ========================================
// CLEANUP ON EXIT
// ========================================
process.on("exit", () => {
  // Clean up all user caches
  const { multiUserGroupCache } = require("../core/connection-manager")
  const activeUsers = multiUserGroupCache.getActiveUsers()
  activeUsers.forEach((userId) => {
    multiUserGroupCache.cleanupUser(userId)
  })
  console.log("🧹 Cleaned up all user group caches on exit")
})

module.exports = { logCrashError }
