// ========================================
// GROUP HANDLER
// ========================================

const { chalk, PhoneNumber } = require("../utils/imports")
const { store } = require("../utils/store-manager")

// Import functions from connection manager to avoid circular dependencies
let validateGroupMembership, multiUserGroupCache

// Lazy load to avoid circular dependency
function getValidateGroupMembership() {
  if (!validateGroupMembership) {
    const { validateGroupMembership: vgm } = require("../core/connection-manager")
    validateGroupMembership = vgm
  }
  return validateGroupMembership
}

function getMultiUserGroupCache() {
  if (!multiUserGroupCache) {
    const { multiUserGroupCache: mugc } = require("../core/connection-manager")
    multiUserGroupCache = mugc
  }
  return multiUserGroupCache
}

class GroupHandler {
  static async handleGroupUpdates(XeonBotInc, updates) {
    for (const update of updates) {
      const { id } = update
      try {
        // Ensure store and groupMetadata exist
        if (!store) return
        if (!store.groupMetadata) store.groupMetadata = {}

        // Only update if we have valid data
        if (id && update) {
          store.groupMetadata[id] = {
            ...(store.groupMetadata[id] || {}),
            ...update,
          }
        }

        // Also update user-specific cache
        if (XeonBotInc.userId) {
          const multiUserGroupCache = getMultiUserGroupCache()
          const existingMetadata = multiUserGroupCache.getGroupMetadata(XeonBotInc.userId, id)
          if (existingMetadata) {
            multiUserGroupCache.setGroupMetadata(XeonBotInc.userId, id, { ...existingMetadata, ...update })
          }
        }

        // Handle group events with rate limiting
        if (global.groupevent) {
          await this.processGroupEvent(XeonBotInc, update)
        }
      } catch (error) {
        console.error(`Error handling group update for ${id}:`, error)
      }
    }
  }

  static async processGroupEvent(XeonBotInc, update) {
    const { id, subject, desc, announce, restrict } = update

    // Add rate limiting check
    if (!XeonBotInc.groupEventCooldown) XeonBotInc.groupEventCooldown = new Map()
    const now = Date.now()
    const lastEvent = XeonBotInc.groupEventCooldown.get(id) || 0

    if (now - lastEvent < 5000) {
      return
    }
    XeonBotInc.groupEventCooldown.set(id, now)

    try {
      let ppgroup
      try {
        ppgroup = await XeonBotInc.profilePictureUrl(id, "image")
      } catch (err) {
        ppgroup = "https://i.ibb.co/RBx5SQC/avatar-group-large-v2.png?q=60"
      }

      if (announce === true) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        await XeonBotInc.sendMessage(id, {
          text: `「 Group Settings Change 」\n\nGroup has been closed by admin, Now only admins can send messages !`,
        })
      } else if (announce === false) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        await XeonBotInc.sendMessage(id, {
          text: `「 Group Settings Change 」\n\nThe group has been opened by admin, Now participants can send messages !`,
        })
      } else if (restrict === true) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        await XeonBotInc.sendMessage(id, {
          text: `「 Group Settings Change 」\n\nGroup info has been restricted, Now only admin can edit group info !`,
        })
      } else if (restrict === false) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        await XeonBotInc.sendMessage(id, {
          text: `「 Group Settings Change 」\n\nGroup info has been opened, Now participants can edit group info !`,
        })
      } else if (desc && desc !== "") {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        await XeonBotInc.sendMessage(id, {
          text: `「 Group Settings Change 」\n\n*Group description has been changed to*\n\n${desc}`,
        })
      } else if (subject) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        await XeonBotInc.sendMessage(id, {
          text: `「 Group Settings Change 」\n\n*Group name has been changed to*\n\n*${subject}*`,
        })
      }
    } catch (error) {
      console.error("Error processing group event:", error)
    }
  }

  static async handleGroupParticipantsUpdate(XeonBotInc, update) {
    const { id, participants, action } = update
    try {
      // First validate if bot is still in the group
      const validateGroupMembership = getValidateGroupMembership()
      const isInGroup = await validateGroupMembership(XeonBotInc, id)
      if (!isInGroup) {
        console.log(`Bot not in group ${id}, skipping participant update`)
        return
      }

      // Get initial group metadata - but don't fail if it's not available
      let groupMetadata = null
      try {
        // Try user-specific cache first
        const multiUserGroupCache = getMultiUserGroupCache()
        groupMetadata = multiUserGroupCache.getGroupMetadata(XeonBotInc.userId, id)
        if (!groupMetadata) {
          groupMetadata = await XeonBotInc.groupMetadata(id)
        }
      } catch (metaError) {
        console.warn(`Could not fetch initial metadata for group ${id}:`, metaError.message)
      }

      const groupName = groupMetadata?.subject || `Group ${id.split("@")[0]}`

      // Process each participant in the update
      for (const participant of participants) {
        try {
          // Get participant name safely
          let participantName = participant.split("@")[0] // Fallback to number
          try {
            const fullName = await XeonBotInc.getName(participant)
            if (fullName && fullName !== participant) {
              participantName = fullName
            }
          } catch (nameError) {
            // Keep the fallback name if getName fails
            console.debug(`Could not get name for ${participant}, using number`)
          }

          // Log the action with proper formatting
          switch (action) {
            case "add":
              console.log(chalk.green(`➕ ${participantName} joined group ${groupName}`))
              break
            case "remove":
              console.log(chalk.red(`➖ ${participantName} left/was removed from group ${groupName}`))
              break
            case "promote":
              console.log(chalk.yellow(`⬆️ ${participantName} was promoted to admin in group ${groupName}`))
              break
            case "demote":
              console.log(chalk.yellow(`⬇️ ${participantName} was demoted from admin in group ${groupName}`))
              break
            case "invite":
              console.log(chalk.cyan(`📧 ${participantName} was invited to group ${groupName}`))
              break
            case "leave":
              console.log(chalk.magenta(`🚪 ${participantName} left group ${groupName}`))
              break
            case "kick":
              console.log(chalk.red(`👢 ${participantName} was kicked from group ${groupName}`))
              break
            default:
              console.log(chalk.blue(`🔄 ${participantName} - ${action} in group ${groupName}`))
          }
        } catch (participantError) {
          console.error(`Error processing participant ${participant}:`, participantError.message)
        }
      }

      // Update metadata cache after processing participants
      await this.updateGroupMetadataCache(XeonBotInc, id, groupName, action)

      // Log group statistics for membership changes
      if (["add", "remove", "leave", "kick"].includes(action)) {
      }
    } catch (error) {
      console.error(`❌ Error handling group participants update for ${id}:`, error.message)

      // Fallback: Still try to update metadata cache
      try {
        await this.updateGroupMetadataCache(XeonBotInc, id, null, action, true)
      } catch (fallbackError) {
        console.error(`❌ Fallback metadata update failed for ${id}:`, fallbackError.message)
      }
    }
  }

  // Helper method to log group statistics
  static async logGroupStatistics(XeonBotInc, groupId, groupName) {
    try {
      const multiUserGroupCache = getMultiUserGroupCache()
      let metadata = multiUserGroupCache.getGroupMetadata(XeonBotInc.userId, groupId)
      if (!metadata) {
        metadata = await XeonBotInc.groupMetadata(groupId)
      }

      if (metadata && metadata.participants) {
        const participantCount = metadata.participants.length
        const adminCount = metadata.participants.filter((p) => p.admin === "admin" || p.admin === "superadmin").length
      }
    } catch (error) {
      console.debug(`Could not fetch group statistics for ${groupId}:`, error.message)
    }
  }

  // Helper method to update group metadata cache
  static async updateGroupMetadataCache(XeonBotInc, groupId, groupName = null, action = null, isFallback = false) {
    try {
      // Add delay to ensure WhatsApp has processed the change
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Fetch fresh metadata
      const updatedMetadata = await XeonBotInc.groupMetadata(groupId)

      if (updatedMetadata) {
        // Update user-specific cache
        const multiUserGroupCache = getMultiUserGroupCache()
        multiUserGroupCache.setGroupMetadata(XeonBotInc.userId, groupId, updatedMetadata)

        // Update store metadata
        if (typeof store !== "undefined" && store) {
          if (!store.groupMetadata) {
            store.groupMetadata = {}
          }
          store.groupMetadata[groupId] = updatedMetadata
          if (!isFallback) {
           
          }
        }

        if (!isFallback && action) {
        }

        return updatedMetadata
      } else {
        console.warn(chalk.yellow(`⚠️ Could not fetch updated metadata for group ${groupId}`))
        return null
      }
    } catch (error) {
      console.error(`❌ Error updating metadata cache for group ${groupId}:`, error.message)
      return null
    }
  }

  static logGroupUpdate(id, update) {
    const { subject, subjectOwner, desc, descOwner, announce, restrict, ephemeralDuration } = update

    if (subject) {
    }

    if (desc) {
    }

    if (announce !== undefined) {
    }

    if (restrict !== undefined) {
    }

    if (ephemeralDuration !== undefined) {
    }
  }
}

module.exports = { GroupHandler }
