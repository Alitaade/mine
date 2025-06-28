// ========================================
// GROUP CACHE MANAGER
// ========================================

const { chalk, store } = require("./imports")

class MultiUserGroupCacheManager {
  constructor() {
    this.userCaches = new Map() // userId -> Map of groupId -> metadata
    this.refreshIntervals = new Map() // userId -> intervalId
    this.refreshCooldowns = new Map() // userId -> timestamp
  }

  // Get or create cache for a specific user
  getUserCache(userId) {
    if (!this.userCaches.has(userId)) {
      this.userCaches.set(userId, new Map())
    }
    return this.userCaches.get(userId)
  }

  // Set group metadata for a specific user
  setGroupMetadata(userId, groupId, metadata) {
    const userCache = this.getUserCache(userId)
    userCache.set(groupId, metadata)

    // Also update global store if it exists
    if (store && store.groupMetadata) {
      store.groupMetadata[groupId] = metadata
    }
  }

  // Get group metadata for a specific user
  getGroupMetadata(userId, groupId) {
    const userCache = this.getUserCache(userId)
    return userCache.get(groupId) || store?.groupMetadata?.[groupId] || null
  }

  // Initialize smart group cache for a specific user
  async initializeUserGroupCache(XeonBotInc, userId, rateLimitManager) {
    try {

      // Clear any existing interval for this user
      if (this.refreshIntervals.has(userId)) {
        clearInterval(this.refreshIntervals.get(userId))
      }

      // Initial cache setup - RUNS ONCE after 10 seconds
      setTimeout(async () => {
        try {
          const groups = await rateLimitManager.rateLimitApiCall(
            `groupFetchAllParticipating_${userId}`,
            () => XeonBotInc.groupFetchAllParticipating(),
            8000, // 8 second minimum interval
          )

          // Cache all group metadata for this specific user
          for (const [groupId, groupData] of Object.entries(groups)) {
            if (groupData) {
              this.setGroupMetadata(userId, groupId, groupData)
            }
          }

          const userCache = this.getUserCache(userId)
        } catch (error) {
          console.log(chalk.red(`❌ User ${userId}: Initial group cache setup failed:`, error.message))
        }
      }, 10000)

      // Smart refresh with exponential backoff - RUNS EVERY 8 MINUTES per user
      const refreshInterval = setInterval(
        async () => {
          try {
            // Check cooldown for this user
            const now = Date.now()
            const lastRefresh = this.refreshCooldowns.get(userId) || 0
            const cooldownPeriod = 7 * 60 * 1000 // 7 minutes

            if (now - lastRefresh < cooldownPeriod) {
              return
            }

            const groups = await rateLimitManager.rateLimitApiCall(
              `groupFetchAllParticipating_${userId}`,
              () => XeonBotInc.groupFetchAllParticipating(),
              25000, // 25 second minimum interval for refresh
            )

            if (!groups) {
              return
            }

            this.refreshCooldowns.set(userId, now)


            let updatedCount = 0
            let newGroupCount = 0
            let errorCount = 0

            const userCache = this.getUserCache(userId)

            // Process groups in batches to avoid overwhelming the API
            const groupEntries = Object.entries(groups)
            const batchSize = 3 // Reduced batch size

            for (let i = 0; i < groupEntries.length; i += batchSize) {
              const batch = groupEntries.slice(i, i + batchSize)

              await Promise.all(
                batch.map(async ([groupId, groupData]) => {
                  try {
                    if (groupData) {
                      // Check if there are changes
                      const cached = userCache.get(groupId)
                      let hasChanges = false
                      const changeDetails = []

                      if (!cached) {
                        hasChanges = true
                        newGroupCount++
                        changeDetails.push("New group")
                      } else {
                        // Check for name changes
                        if (cached.subject !== groupData.subject) {
                          hasChanges = true
                          changeDetails.push(`Name: "${cached.subject}" → "${groupData.subject}"`)
                        }

                        // Check for member count changes
                        if (cached.participants?.length !== groupData.participants?.length) {
                          hasChanges = true
                          changeDetails.push(
                            `Members: ${cached.participants?.length || 0} → ${groupData.participants?.length || 0}`,
                          )
                        }

                        // Check for description changes
                        if (cached.desc !== groupData.desc) {
                          hasChanges = true
                          changeDetails.push("Description updated")
                        }
                      }

                      // Update user-specific cache
                      this.setGroupMetadata(userId, groupId, groupData)

                      // Log changes if any
                      if (hasChanges) {
                        updatedCount++
                      }
                    }
                  } catch (groupError) {
                    errorCount++
                    console.log(chalk.red(`❌ User ${userId}: Error processing group ${groupId}:`, groupError.message))
                  }
                }),
              )

              // Add delay between batches to respect rate limits
              if (i + batchSize < groupEntries.length) {
                await new Promise((resolve) => setTimeout(resolve, 1500)) // 1.5 second delay between batches
              }
            }

            // Clean up groups that no longer exist (bot was removed)
            const currentGroupIds = Object.keys(groups)
            const cachedGroupIds = Array.from(userCache.keys())
            const removedGroups = cachedGroupIds.filter((id) => !currentGroupIds.includes(id))

            if (removedGroups.length > 0) {
              for (const groupId of removedGroups) {
                const groupName = userCache.get(groupId)?.subject || groupId
                userCache.delete(groupId)
                if (store?.groupMetadata?.[groupId]) {
                  delete store.groupMetadata[groupId]
                }
              }
            }
          } catch (error) {
            if (error.message.includes("rate-overlimit")) {
              // The rateLimitManager will handle the backoff automatically
            } else {
              console.log(chalk.red(`❌ User ${userId}: Group refresh failed:`, error.message))
            }
            // Continue running - don't let refresh errors stop the bot
          }
        },
        8 * 60 * 1000,
      ) // Every 8 minutes

      this.refreshIntervals.set(userId, refreshInterval)
    } catch (error) {
      console.log(chalk.red(`❌ User ${userId}: Group cache manager initialization failed:`, error.message))
    }
  }

  // Clean up resources for a user
  cleanupUser(userId) {
    if (this.refreshIntervals.has(userId)) {
      clearInterval(this.refreshIntervals.get(userId))
      this.refreshIntervals.delete(userId)
    }
    this.userCaches.delete(userId)
    this.refreshCooldowns.delete(userId)
  }

  // Get all users with active caches
  getActiveUsers() {
    return Array.from(this.userCaches.keys())
  }
}

module.exports = { MultiUserGroupCacheManager }
