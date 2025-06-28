// ========================================
// RATE LIMITER
// ========================================

const { chalk } = require("./imports")

class AdvancedRateLimitManager {
  constructor() {
    this.apiCallTimestamps = new Map() // API call -> last timestamp
    this.messageQueues = new Map() // chatId -> message queue
    this.processingQueues = new Set() // Set of chatIds being processed
    this.globalRateLimit = {
      lastCall: 0,
      minInterval: 1000, // 1 second between any API calls
    }
    this.fastTrackLimit = {
      lastCall: 0,
      minInterval: 500, // 500ms for fast track messages
    }
  }

  // Rate limit API calls with exponential backoff
  async rateLimitApiCall(key, apiFunction, minInterval = 2000) {
    try {
      const now = Date.now()
      const lastCall = this.apiCallTimestamps.get(key) || 0
      const timeSinceLastCall = now - lastCall

      if (timeSinceLastCall < minInterval) {
        const waitTime = minInterval - timeSinceLastCall
        console.log(chalk.blue(`⏳ Rate limiting ${key}: waiting ${waitTime}ms`))
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }

      // Global rate limiting
      const globalTimeSince = now - this.globalRateLimit.lastCall
      if (globalTimeSince < this.globalRateLimit.minInterval) {
        const globalWait = this.globalRateLimit.minInterval - globalTimeSince
        await new Promise((resolve) => setTimeout(resolve, globalWait))
      }

      this.apiCallTimestamps.set(key, Date.now())
      this.globalRateLimit.lastCall = Date.now()

      const result = await apiFunction()
      return result
    } catch (error) {
      if (error.message.includes("rate-overlimit") || error.message.includes("429")) {
        console.log(chalk.yellow(`⚠️ Rate limit hit for ${key}, implementing exponential backoff`))

        // Exponential backoff: double the interval for this specific call
        const currentInterval = this.apiCallTimestamps.get(`${key}_interval`) || minInterval
        const newInterval = Math.min(currentInterval * 2, 60000) // Max 1 minute
        this.apiCallTimestamps.set(`${key}_interval`, newInterval)

        console.log(chalk.blue(`⏳ Backing off ${key} for ${newInterval}ms`))
        await new Promise((resolve) => setTimeout(resolve, newInterval))

        // Retry once with new interval
        return await this.rateLimitApiCall(key, apiFunction, newInterval)
      }
      throw error
    }
  }

  // Smart group refresh with rate limiting
  async smartGroupRefresh(XeonBotInc, groupId) {
    try {
      return await this.rateLimitApiCall(
        `groupMetadata_${groupId}`,
        () => XeonBotInc.groupMetadata(groupId),
        5000, // 5 second minimum interval for group metadata
      )
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Smart group refresh failed for ${groupId}:`, error.message))
      return null
    }
  }

  // Fast track for important messages (welcome, farewell, anti-call)
  async fastTrackMessage(messageFunction) {
    try {
      const now = Date.now()
      const timeSince = now - this.fastTrackLimit.lastCall

      if (timeSince < this.fastTrackLimit.minInterval) {
        const waitTime = this.fastTrackLimit.minInterval - timeSince
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }

      this.fastTrackLimit.lastCall = Date.now()
      await messageFunction()
      return true
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Fast track message failed:`, error.message))
      return false
    }
  }

  // Add message to queue for rate-limited sending
  async addToQueue(chatId, messageFunction, isHighPriority = false) {
    if (!this.messageQueues.has(chatId)) {
      this.messageQueues.set(chatId, [])
    }

    const queue = this.messageQueues.get(chatId)

    if (isHighPriority) {
      queue.unshift(messageFunction) // Add to front for high priority
    } else {
      queue.push(messageFunction) // Add to back for normal priority
    }

    // Process queue if not already processing
    if (!this.processingQueues.has(chatId)) {
      this.processQueue(chatId)
    }
  }

  // Process message queue for a specific chat
  async processQueue(chatId) {
    if (this.processingQueues.has(chatId)) {
      return // Already processing this queue
    }

    this.processingQueues.add(chatId)
    const queue = this.messageQueues.get(chatId)

    while (queue && queue.length > 0) {
      const messageFunction = queue.shift()

      try {
        await this.rateLimitApiCall(
          `queue_${chatId}`,
          messageFunction,
          2000, // 2 second interval for queued messages
        )
      } catch (error) {
        console.log(chalk.red(`❌ Error processing queued message for ${chatId}:`, error.message))
      }

      // Small delay between queue processing
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    this.processingQueues.delete(chatId)
  }

  // Get queue status
  getQueueStatus() {
    const status = {}
    for (const [chatId, queue] of this.messageQueues.entries()) {
      status[chatId] = {
        queueLength: queue.length,
        isProcessing: this.processingQueues.has(chatId),
      }
    }
    return status
  }

  // Clear all queues (emergency use)
  clearAllQueues() {
    this.messageQueues.clear()
    this.processingQueues.clear()
    console.log(chalk.yellow("🧹 All message queues cleared"))
  }
}

module.exports = { AdvancedRateLimitManager }
