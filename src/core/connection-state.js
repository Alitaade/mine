// ========================================
// CONNECTION STATE MANAGER - IMPROVED SESSION CLEANUP
// ========================================

const { chalk, DisconnectReason } = require("../utils/imports")
const { SessionManager } = require("./session-manager")

class ConnectionStateManager {
  constructor() {
    this.retryAttempts = new Map()
    this.maxRetries = 5
    this.restartingUsers = new Set()
  }

  async handleDisconnect(reason, userId, sessionPath, callbacks, XeonBotInc, phoneNumber) {
    try {
      const currentRetries = this.retryAttempts.get(userId) || 0

      if (currentRetries >= this.maxRetries) {
        console.log(chalk.red(`User ${userId}: ❌ Max retry attempts (${this.maxRetries}) reached`))
        if (callbacks?.onMaxRetriesReached) {
          await callbacks.onMaxRetriesReached(currentRetries)
        }
        return
      }

      console.log(chalk.yellow(`User ${userId}: 🔄 Handling disconnect reason: ${reason}`))

      switch (reason) {
        case DisconnectReason.badSession:
        case 440:
          console.log(
            chalk.yellow(`User ${userId}: 🔧 Bad session - cleaning up ONLY this user's session and restarting`),
          )
          await SessionManager.cleanupSpecificUserSession(userId)
          await this.scheduleRestart(userId, phoneNumber, callbacks, 2000)
          break

        case DisconnectReason.connectionClosed:
        case DisconnectReason.connectionLost:
        case DisconnectReason.timedOut:
        case 428:
        case 408:
          console.log(chalk.yellow(`User ${userId}: 🔄 Connection issue - restarting with session preserved`))
          await this.scheduleRestart(userId, phoneNumber, callbacks, 3000)
          break

        case DisconnectReason.loggedOut:
          console.log(chalk.red(`User ${userId}: 🚪 User logged out - deleting ONLY this user's session data`))
          try {
            await SessionManager.cleanupSpecificUserSession(userId)
            console.log(chalk.blue(`User ${userId}: ✅ Successfully deleted session for logged out user`))
          } catch (deleteError) {
            console.log(chalk.yellow(`User ${userId}: ⚠️ Session deletion warning:`, deleteError.message))
          }

          // Don't restart for logout - user intentionally logged out
          if (callbacks?.onUserLoggedOut) {
            await callbacks.onUserLoggedOut(userId)
          }
          break

        case DisconnectReason.restartRequired:
        case 515:
          console.log(chalk.yellow(`User ${userId}: 🔄 Restart required`))
          await this.scheduleRestart(userId, phoneNumber, callbacks, 2500)
          break

        default:
          console.log(chalk.yellow(`User ${userId}: ❓ Unknown disconnect (${reason}) - attempting restart`))
          await this.scheduleRestart(userId, phoneNumber, callbacks, 3000)
          break
      }
    } catch (error) {
      console.log(chalk.red(`User ${userId}: ❌ Error in disconnect handler:`, error.message))
    }
  }

  async scheduleRestart(userId, phoneNumber, callbacks, delay = 2000) {
    if (this.restartingUsers.has(userId)) {
      console.log(chalk.yellow(`User ${userId}: ⏳ Restart already in progress`))
      return
    }

    this.restartingUsers.add(userId)
    console.log(chalk.cyan(`User ${userId}: ⏰ Scheduling restart in ${delay}ms...`))

    setTimeout(async () => {
      try {
        const { startXeonBotInc } = require("./connection-manager")
        const newClient = await startXeonBotInc(userId, phoneNumber, callbacks)

        if (newClient && !newClient.sessionId?.includes("mock")) {
          console.log(chalk.green(`User ${userId}: ✅ Restart successful!`))
          this.retryAttempts.delete(userId)

          if (callbacks?.onConnectionRestarted) {
            await callbacks.onConnectionRestarted(newClient)
          }
        } else {
          throw new Error("Failed to create valid client")
        }
      } catch (error) {
        console.log(chalk.red(`User ${userId}: ❌ Restart failed:`, error.message))
        const currentRetries = this.retryAttempts.get(userId) || 0
        this.retryAttempts.set(userId, currentRetries + 1)

        if (callbacks?.onRestartFailed) {
          await callbacks.onRestartFailed(error.message)
        }
      } finally {
        this.restartingUsers.delete(userId)
      }
    }, delay)
  }

  resetRetryAttempts(userId) {
    this.retryAttempts.delete(userId)
    this.restartingUsers.delete(userId)
    console.log(chalk.green(`User ${userId}: 🔄 Retry attempts reset`))
  }

  getRetryCount(userId) {
    return this.retryAttempts.get(userId) || 0
  }

  isRestarting(userId) {
    return this.restartingUsers.has(userId)
  }
}

module.exports = { ConnectionStateManager }
