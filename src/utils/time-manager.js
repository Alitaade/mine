// ========================================
// TIME MANAGER
// ========================================

const { moment } = require("./imports")

class TimeManager {
  static getUnixTimestamp() {
    return Math.floor(Date.now() / 1000)
  }

  static getReadableTime(timestamp = null) {
    const time = timestamp || this.getUnixTimestamp()
    return moment.unix(time).utc().format("MM/DD/YYYY, hh:mm:ss A") + " UTC"
  }

  static formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  static getTimezone(timezone = "Asia/Kolkata") {
    return moment.tz(timezone).format("HH:mm:ss DD/MM/YYYY")
  }

  static isWithinTimeRange(startHour, endHour, timezone = "Asia/Kolkata") {
    const currentHour = moment.tz(timezone).hour()
    return currentHour >= startHour && currentHour <= endHour
  }
}

module.exports = { TimeManager }
