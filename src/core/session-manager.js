// ========================================
// SESSION MANAGER - IMPROVED USER-SPECIFIC CLEANUP
// ========================================

const { fs, chalk, useMultiFileAuthState } = require("../utils/imports")
const path = require("path")

class SessionManager {
  static async initializeSession(sessionPath, userId) {
    try {
      console.log(chalk.blue(`User ${userId}: 🔐 Initializing session at ${sessionPath}...`))

      // Ensure the specific user's session directory exists
      const authState = await useMultiFileAuthState(sessionPath)
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true })
        console.log(chalk.blue(`User ${userId}: Created session directory`))
      }

      console.log(chalk.green(`User ${userId}: ✅ Session loaded successfully`))

      return {
        state: authState.state,
        saveCreds: authState.saveCreds,
      }
    } catch (error) {
      console.log(chalk.yellow(`User ${userId}: ⚠️ Session load warning:`, error.message))

      return {
        state: { creds: {}, keys: {} },
        saveCreds: async () => console.log(`User ${userId}: 💾 SaveCreds called but skipped due to session issues`),
      }
    }
  }

  static async cleanupSession(sessionPath, userId) {
    try {
      // ONLY delete the specific user's session, not the entire sessions folder
      if (fs.existsSync(sessionPath)) {
        // Double check we're only deleting a specific user folder
        const sessionDir = path.basename(sessionPath)
        if (sessionDir === userId) {
          fs.rmSync(sessionPath, { recursive: true, force: true })
          console.log(chalk.blue(`User ${userId}: 🗑️ Session files deleted for user ${userId}`))
        } else {
          console.log(chalk.red(`User ${userId}: ❌ Session path mismatch - refusing to delete`))
        }
      }
    } catch (error) {
      console.log(chalk.yellow(`User ${userId}: ⚠️ Session cleanup warning:`, error.message))
    }
  }

  static async cleanupSpecificUserSession(userId) {
    try {
      const config = require("../../config.js")
      const userSessionPath = path.join(config.paths.sessions, userId.toString())

      console.log(chalk.blue(`User ${userId}: 🧹 Starting cleanup of specific user session...`))
      console.log(chalk.blue(`User ${userId}: 📁 Session path: ${userSessionPath}`))

      if (fs.existsSync(userSessionPath)) {
        // Verify this is actually a user session directory
        const sessionDir = path.basename(userSessionPath)
        const parentDir = path.basename(path.dirname(userSessionPath))

        console.log(chalk.blue(`User ${userId}: 🔍 Verifying session directory: ${sessionDir} in ${parentDir}`))

        // Safety check: ensure we're in the sessions directory and deleting the right user
        if (parentDir === "session" && sessionDir === userId.toString()) {
          // List files before deletion for logging
          const files = fs.readdirSync(userSessionPath)
          console.log(chalk.blue(`User ${userId}: 📋 Found ${files.length} files to delete: ${files.join(", ")}`))

          fs.rmSync(userSessionPath, { recursive: true, force: true })
          console.log(
            chalk.green(`User ${userId}: ✅ Successfully deleted session directory with ${files.length} files`),
          )
        } else {
          console.log(chalk.red(`User ${userId}: ❌ Safety check failed - refusing to delete`))
          console.log(chalk.red(`User ${userId}: Expected parent: 'sessions', got: '${parentDir}'`))
          console.log(chalk.red(`User ${userId}: Expected session: '${userId}', got: '${sessionDir}'`))
        }
      } else {
        console.log(chalk.yellow(`User ${userId}: ⚠️ Session directory does not exist: ${userSessionPath}`))
      }
    } catch (error) {
      console.log(chalk.red(`User ${userId}: ❌ Error during specific session cleanup:`, error.message))
      console.log(chalk.red(`User ${userId}: Stack trace:`, error.stack))
    }
  }

  static listActiveSessions() {
    try {
      const config = require("../../config.js")
      const sessionsDir = config.paths.sessions

      if (!fs.existsSync(sessionsDir)) {
        return []
      }

      const sessions = fs
        .readdirSync(sessionsDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => {
          const sessionPath = path.join(sessionsDir, dirent.name)
          const files = fs.readdirSync(sessionPath)
          return {
            userId: dirent.name,
            fileCount: files.length,
            hasCredentials: files.some((file) => file.endsWith(".json")),
          }
        })

      console.log(
        chalk.blue(`📁 Active sessions: ${sessions.map((s) => `${s.userId}(${s.fileCount} files)`).join(", ")}`),
      )
      return sessions
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Error listing sessions:`, error.message))
      return []
    }
  }

  // New method to get session info
  static getSessionInfo(userId) {
    try {
      const config = require("../../config.js")
      const userSessionPath = path.join(config.paths.sessions, userId.toString())

      if (!fs.existsSync(userSessionPath)) {
        return { exists: false, fileCount: 0, files: [] }
      }

      const files = fs.readdirSync(userSessionPath)
      return {
        exists: true,
        fileCount: files.length,
        files: files,
        hasCredentials: files.some((file) => file.endsWith(".json")),
        path: userSessionPath,
      }
    } catch (error) {
      console.log(chalk.yellow(`User ${userId}: ⚠️ Error getting session info:`, error.message))
      return { exists: false, fileCount: 0, files: [], error: error.message }
    }
  }
}

module.exports = { SessionManager }
