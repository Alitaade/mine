// ========================================
// EVENT HANDLERS MANAGER - IMPROVED DEDUPLICATION
// ========================================

const { chalk, smsg, moment, sleep, getBuffer, getAggregateVotesInPollMessage, store } = require("../utils/imports")

const { MessageProcessor } = require("../processors/message-processor")
const { GroupHandler } = require("../handlers/group-handler")
const { TimeManager } = require("../utils/time-manager")

// Import instances from connection manager to avoid circular dependencies
let rateLimitManager, multiUserGroupCache

// Lazy load to avoid circular dependency
function getRateLimitManager() {
  if (!rateLimitManager) {
    const { rateLimitManager: rlm } = require("./connection-manager")
    rateLimitManager = rlm
  }
  return rateLimitManager
}

function getMultiUserGroupCache() {
  if (!multiUserGroupCache) {
    const { multiUserGroupCache: mugc } = require("./connection-manager")
    multiUserGroupCache = mugc
  }
  return multiUserGroupCache
}

class EventHandlerManager {
  static setupAllEventHandlers(XeonBotInc, callbacks) {
    try {
      const eventTypes = [
        "messages.upsert",
        "groups.update",
        "group-participants.update",
        "messages.update",
        "contacts.update",
        "call",
      ]

      eventTypes.forEach((eventType) => {
        XeonBotInc.ev.removeAllListeners(eventType)
      })

      this.setupConsolidatedMessageHandlers(XeonBotInc, callbacks)
      this.setupGroupHandlers(XeonBotInc)
      this.setupContactHandlers(XeonBotInc)
      this.setupPollHandlers(XeonBotInc)
      this.setupWelcomeFarewellHandlers(XeonBotInc)
      this.setupAntiCallHandler(XeonBotInc)
      this.setupAutoStatusViewHandler(XeonBotInc)
      this.setupAdminEventHandler(XeonBotInc)
    } catch (error) {
      console.error("Error setting up event handlers:", error.message)
    }
  }

  static setupConsolidatedMessageHandlers(XeonBotInc, callbacks) {
    XeonBotInc.ev.on("messages.upsert", async (chatUpdate) => {
      try {
        const messages = chatUpdate.messages || []

        for (const mek of messages) {
          try {
            // Skip if no message content AND no key
            if (!mek.message && !mek.key) continue

            const messageId = mek.key?.id
            if (!messageId) continue

            // FIXED: Ensure processedMessages is always a Map
            if (!XeonBotInc.processedMessages || !(XeonBotInc.processedMessages instanceof Map)) {
              console.log(chalk.blue(`🔧 Initializing processedMessages Map for session ${XeonBotInc.sessionId}`))
              XeonBotInc.processedMessages = new Map()
            }

            const now = Date.now()
            const existingEntry = XeonBotInc.processedMessages.get(messageId)

            // Check if message was processed recently (within 5 seconds)
            if (existingEntry && now - existingEntry < 5000) {
              console.log(
                chalk.gray(
                  `⏭️ Session ${XeonBotInc.sessionId}: Skipping recent duplicate ${messageId} (${now - existingEntry}ms ago)`,
                ),
              )
              continue
            }

            // Store with timestamp
            XeonBotInc.processedMessages.set(messageId, now)

            // Clean up old entries (keep only last 5 minutes)
            if (XeonBotInc.processedMessages.size > 100) {
              const cutoffTime = now - 5 * 60 * 1000 // 5 minutes ago
              for (const [id, timestamp] of XeonBotInc.processedMessages.entries()) {
                if (timestamp < cutoffTime) {
                  XeonBotInc.processedMessages.delete(id)
                }
              }
            }

            // Create smsg object only if message exists, otherwise create minimal object
            let m
            if (mek.message) {
              m = smsg(XeonBotInc, mek, store)

              // ALWAYS process message storage for THIS session - no global deduplication
              await MessageProcessor.processIncomingMessage(mek, XeonBotInc, m)
            } else {
              // Create minimal m object for messages without content
              m = {
                key: mek.key,
                sender: mek.key?.participant || mek.key?.remoteJid,
                chat: mek.key?.remoteJid,
                body: "",
                text: "",
                isGroup: mek.key?.remoteJid?.includes("@g.us"),
                fromMe: mek.key?.fromMe,
              }
            }

            // Process bot commands for this session
            setImmediate(async () => {
              await this.processBotCommands(XeonBotInc, m, mek, chatUpdate, store)
            })

            // Call user callback for ALL messages
            if (callbacks?.onMessage && mek.key) {
              try {
                await callbacks.onMessage(mek)
              } catch (callbackError) {
                console.log(`Error in user message callback: ${callbackError.message}`)
              }
            }
          } catch (messageError) {
            console.log(`Error processing individual message ${mek.key?.id}: ${messageError.message}`)
          }
        }
      } catch (error) {
        console.log(`Error in consolidated message handler: ${error.message}`)
      }
    })
  }

  static async processBotCommands(XeonBotInc, m, mek, chatUpdate, store) {
    try {
      // Check if commands are blocked (during initialization)
      if (XeonBotInc.commandsBlocked) {
        return
      }

      // Handle ephemeral messages only if message exists
      if (mek.message) {
        mek.message =
          Object.keys(mek.message)[0] === "ephemeralMessage" ? mek.message.ephemeralMessage.message : mek.message
      }

      if (mek.key && mek.key.remoteJid === "status@broadcast") {
        return
      }

      // Simplified condition - only check if private bot and not from owner
      if (!XeonBotInc.public && !mek.key.fromMe) {
        return
      }

      // Get message text for checking
      const messageText = m.body || m.text || ""

      // Check if message should be stored (contains prefix)
      if (messageText && (messageText.startsWith(global.xprefix) || messageText.startsWith("."))) {
        if (store && store.saveMessage) {
          store.saveMessage(mek)
        }
      }

      // Message Tracking for Prefix Commands
      if (messageText.startsWith(global.xprefix) || messageText.startsWith(".")) {
        const commandStartTime = TimeManager.getUnixTimestamp()
        const readableTime = moment.unix(commandStartTime).utc().format("MM/DD/YYYY, hh:mm:ss A") + " UTC"

        m.commandStartTime = commandStartTime
        m.commandStartTimeReadable = readableTime

        console.log(
          chalk.cyan(`🎯 Command detected in session ${XeonBotInc.sessionId}: ${messageText.substring(0, 50)}...`),
        )
    if (messageText.toLowerCase().includes("hello")) {
      return
    }
        // 🔥 MARK COMMAND AS PROCESSED NORMALLY (to prevent protocol duplicates)
        const { markCommandAsProcessed } = require("../handlers/protocol-handler")
        markCommandAsProcessed(mek.key.id, messageText, XeonBotInc.sessionId, true) // true = normal message
        // ✅ ADDED: Console log to track if command reaches handler
        console.log(chalk.green(`🚀 Session ${XeonBotInc.sessionId}: Passing command to handler: ${messageText.substring(0, 30)}...`))
      }
          if (messageText.toLowerCase().includes("hello")) {
      return
    }
      try {
        const commandHandler = require("../../XeonCheems14")
        if (typeof commandHandler === "function") {
          await commandHandler(XeonBotInc, m, chatUpdate, store)
        }
      } catch (error) {
        if (error.code !== "MODULE_NOT_FOUND") {
          console.log(`Error in command handler: ${error.message}`)
        }
      }
    } catch (error) {
      console.log(`Error processing bot commands: ${error.message}`)
    }
  }

  static setupGroupHandlers(XeonBotInc) {
    XeonBotInc.ev.on("groups.update", async (updates) => {
      try {
        await GroupHandler.handleGroupUpdates(XeonBotInc, updates)
      } catch (error) {
        console.error("Error handling groups update:", error)
      }
    })

    XeonBotInc.ev.on("group-participants.update", async (update) => {
      try {
        await GroupHandler.handleGroupParticipantsUpdate(XeonBotInc, update)
      } catch (error) {
        console.error("Error handling group participants update:", error)
      }
    })
  }

  static setupContactHandlers(XeonBotInc) {
    XeonBotInc.ev.on("contacts.update", (update) => {
      try {
        for (const contact of update) {
          if (contact && contact.id) {
            const id = XeonBotInc.decodeJid(contact.id)

            // Ensure store and contacts exist
            if (store) {
              if (!store.contacts) {
                store.contacts = {}
              }

              store.contacts[id] = {
                id,
                name: contact.notify || contact.name || "Unknown",
                ...contact,
              }
            }
          }
        }
      } catch (error) {
        console.log(chalk.yellow("⚠️ Error in contacts update handler:", error.message))
      }
    })
  }

  static setupPollHandlers(XeonBotInc) {
    XeonBotInc.ev.on("messages.update", async (chatUpdate) => {
      for (const { key, update } of chatUpdate) {
        if (update.pollUpdates && key.fromMe) {
          try {
            const { MessageUtils } = require("../utils/message-utils")
            const pollCreation = await MessageUtils.getMessage(key)
            if (pollCreation) {
              const pollUpdate = await getAggregateVotesInPollMessage({
                message: pollCreation,
                pollUpdates: update.pollUpdates,
              })

              const toCmd = pollUpdate.filter((v) => v.voters.length !== 0)[0]?.name
              if (toCmd) {
                const prefCmd = global.xprefix + toCmd
                XeonBotInc.appenTextMessage(prefCmd, chatUpdate)
              }
            }
          } catch (error) {
            console.error("Error handling poll update:", error)
          }
        }
      }
    })
  }

// ========================================
  // UPDATED WELCOME/FAREWELL HANDLER
  // ========================================
  static setupWelcomeFarewellHandlers(XeonBotInc) {
  XeonBotInc.ev.on("group-participants.update", async (anu) => {
    try {
      // Check if welcome is enabled for THIS specific group using database
      const groupId = anu.id
      const chatData = global.db.data.chats[groupId]

      // If no data exists for this group, initialize it with defaults
      if (!chatData) {
        global.db.data.chats[groupId] = {
          welcome: false,
          farewell: false,
          // Add other default settings as needed
        }
      }

      const isWelcomeEnabled = global.db.data.chats[groupId].welcome
      const isFarewellEnabled = global.db.data.chats[groupId].farewell

      // Skip if neither welcome nor farewell is enabled
      if (!isWelcomeEnabled && !isFarewellEnabled) {
        return
      }

      console.log(anu)

      // Add 5 second delay before processing
      await new Promise(resolve => setTimeout(resolve, 5000))

      const rateLimitManager = getRateLimitManager()
      const multiUserGroupCache = getMultiUserGroupCache()

      let metadata = await rateLimitManager.smartGroupRefresh(XeonBotInc, anu.id)
      if (!metadata) {
        // Fallback to user-specific cached metadata if refresh is rate limited
        metadata = multiUserGroupCache.getGroupMetadata(XeonBotInc.userId, anu.id) || store?.groupMetadata?.[anu.id]
      }

      // ADD THIS: Direct metadata check
      const directMetadata = await XeonBotInc.groupMetadata(anu.id)
      console.log("Direct metadata check:", directMetadata)

      if (!metadata) {
        console.log(`No metadata available for group ${anu.id}`)
        return
      }

      const participants = anu.participants
      for (const num of participants) {
        try {
          // Debug: Log the participant data
          console.log(`Processing participant: ${num}`)
          
          // Find the participant in the metadata to get the actual jid
          let actualPhoneNumber = num.split("@")[0] // Default fallback
          
          // Look for the participant in the direct metadata
          const participantData = directMetadata.participants.find(p => p.id === num || p.lid === num)
          
          if (participantData && participantData.jid) {
            // Use the jid from metadata
            actualPhoneNumber = participantData.jid.split('@')[0]
            console.log(`Found actual phone number from metadata: ${actualPhoneNumber}`)
          } else {
            // Fallback: If it's a business account (@lid), try to get the real phone number
            if (num.includes('@lid')) {
              try {
                const userInfo = await XeonBotInc.onWhatsApp(num)
                console.log(`User info for ${num}:`, userInfo)
                
                if (userInfo && userInfo[0] && userInfo[0].jid) {
                  const realJid = userInfo[0].jid
                  if (realJid.includes('@s.whatsapp.net')) {
                    actualPhoneNumber = realJid.split("@")[0]
                    console.log(`Found real phone number via onWhatsApp: ${actualPhoneNumber}`)
                  }
                }
              } catch (err) {
                console.log(`Could not get real phone for ${num}:`, err.message)
              }
            }
          }
          
          let ppuser
          try {
            ppuser = await rateLimitManager.rateLimitApiCall(
              `profilePicture_${num}`,
              () => XeonBotInc.profilePictureUrl(num, "image"),
              3000,
            )
          } catch (err) {
            ppuser = "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png?q=60"
          }

          try {
            let ppgroup
            try {
              ppgroup = await rateLimitManager.rateLimitApiCall(
                `profilePicture_${anu.id}`,
                () => XeonBotInc.profilePictureUrl(anu.id, "image"),
                3000,
              )
            } catch (err) {
              ppgroup = "https://i.ibb.co/RBx5SQC/avatar-group-large-v2.png?q=60"
            }

            const memb = metadata.participants.length
            const XeonWlcm = await getBuffer(ppuser)
            const XeonLft = await getBuffer(ppuser)

            if (anu.action == "add" && isWelcomeEnabled) {
              const xeonbuffer = await getBuffer(ppuser)
              // Use the extracted actual phone number
              const xeonName = actualPhoneNumber
              const xtime = moment.tz("Asia/Kolkata").format("HH:mm:ss")
              const xdate = moment.tz("Asia/Kolkata").format("DD/MM/YYYY")
              const xmembers = metadata.participants.length

              const xeonbody = `┌─❖
│「 𝗛𝗶 👋 」
└┬❖ 「  @${xeonName}  」
   │✑  𝗪𝗲𝗹𝗰𝗼𝗺𝗲 𝘁𝗼 
   │✑  ${metadata.subject}
   │✑  𝗠𝗲𝗺𝗯𝗲𝗿 : 
   │✑ ${xmembers}th
   │✑  𝗝𝗼𝗶𝗻𝗲𝗱 : 
   │✑ ${xtime} ${xdate}
   └───────────────┈ ⳹`

              const buttonMessage = {
                image: XeonWlcm,
                caption: xeonbody,
                footer: global.botname,
                buttons: [
                  {
                    buttonId: "welcome_btn",
                    buttonText: { displayText: "Welcome 💐" },
                    type: 1,
                  },
                ],
                headerType: 1,
                viewOnce: true,
              }

              // Use fast track for welcome messages
              const fastResult = await rateLimitManager.fastTrackMessage(async () => {
                return await XeonBotInc.sendMessage(anu.id, buttonMessage, {
                  quoted: null,
                  mentions: [num], // Keep original JID for mentions
                })
              })

              if (!fastResult) {
                await rateLimitManager.addToQueue(
                  anu.id,
                  async () => {
                    await XeonBotInc.sendMessage(anu.id, buttonMessage, {
                      quoted: null,
                      mentions: [num],
                    })
                  },
                  true,
                )
              }
            } else if (anu.action == "remove" && isFarewellEnabled) {
              const xeonbuffer = await getBuffer(ppuser)
              const xeontime = moment.tz("Asia/Kolkata").format("HH:mm:ss")
              const xeondate = moment.tz("Asia/Kolkata").format("DD/MM/YYYY")
              // Use the extracted actual phone number
              const xeonName = actualPhoneNumber
              const xeonmembers = metadata.participants.length

              const xeonbody = `┌─❖
│「 𝗚𝗼𝗼𝗱𝗯𝘆𝗲 👋 」
└┬❖ 「 @${xeonName}  」
   │✑  𝗟𝗲𝗳𝘁 
   │✑ ${metadata.subject}
   │✑  𝗠𝗲𝗺𝗯𝗲𝗿 : 
   │✑ ${xeonmembers}th
   │✑  𝗧𝗶𝗺𝗲 : 
   │✑  ${xeontime} ${xeondate}
   └───────────────┈ ⳹`

              const buttonMessage = {
                image: XeonLft,
                caption: xeonbody,
                footer: global.botname,
                buttons: [
                  {
                    buttonId: "goodbye_btn",
                    buttonText: { displayText: "Goodbye 👋" },
                    type: 1,
                  },
                ],
                headerType: 1,
                viewOnce: true,
              }

              // Use fast track for farewell messages
              const fastResult = await rateLimitManager.fastTrackMessage(async () => {
                return await XeonBotInc.sendMessage(anu.id, buttonMessage, {
                  quoted: null,
                  mentions: [num], // Keep original JID for mentions
                })
              })

              if (!fastResult) {
                await rateLimitManager.addToQueue(
                  anu.id,
                  async () => {
                    await XeonBotInc.sendMessage(anu.id, buttonMessage, {
                      quoted: null,
                      mentions: [num],
                    })
                  },
                  true,
                )
              }
            }
          } catch (messageError) {
            console.log("Error sending welcome/farewell message:", messageError.message)
          }
        } catch (participantError) {
          console.log("Error processing participant:", participantError.message)
        }
      }
    } catch (err) {
      console.log("Welcome/Farewell handler error:", err.message)
    }
  })
}
  // ========================================
  // ANTI CALL HANDLER
  // ========================================
  static setupAntiCallHandler(XeonBotInc) {
    XeonBotInc.ev.on("call", async (XeonPapa) => {
      if (global.anticall) {
        console.log(XeonPapa)
        const rateLimitManager = getRateLimitManager()

        for (const XeonFucks of XeonPapa) {
          if (XeonFucks.isGroup == false) {
            if (XeonFucks.status == "offer") {
              // Use fast track for anti-call messages
              const fastResult = await rateLimitManager.fastTrackMessage(async () => {
                const XeonBlokMsg = await XeonBotInc.sendTextWithMentions(
                  XeonFucks.from,
                  `*${XeonBotInc.user.name}* can't receive ${XeonFucks.isVideo ? `video` : `voice`} call. Sorry @${XeonFucks.from.split("@")[0]} you will be blocked. If called accidentally please contact the owner to be unblocked !`,
                )
                XeonBotInc.sendContact(XeonFucks.from, global.owner, XeonBlokMsg)
                await sleep(4000)
                await XeonBotInc.updateBlockStatus(XeonFucks.from, "block")
                return true
              })

              if (!fastResult) {
                await rateLimitManager.addToQueue(
                  XeonFucks.from,
                  async () => {
                    const XeonBlokMsg = await XeonBotInc.sendTextWithMentions(
                      XeonFucks.from,
                      `*${XeonBotInc.user.name}* can't receive ${XeonFucks.isVideo ? `video` : `voice`} call. Sorry @${XeonFucks.from.split("@")[0]} you will be blocked. If called accidentally please contact the owner to be unblocked !`,
                    )
                    XeonBotInc.sendContact(XeonFucks.from, global.owner, XeonBlokMsg)
                    await sleep(4000)
                    await XeonBotInc.updateBlockStatus(XeonFucks.from, "block")
                  },
                  false,
                )
              }
            }
          }
        }
      }
    })
  }

  // ========================================
  // AUTO STATUS VIEW HANDLER
  // ========================================
  static setupAutoStatusViewHandler(XeonBotInc) {
    XeonBotInc.ev.on("messages.upsert", async (chatUpdate) => {
      if (global.antiswview) {
        const mek = chatUpdate.messages[0]
        if (mek.key && mek.key.remoteJid === "status@broadcast") {
          await XeonBotInc.readMessages([mek.key])
        }
      }
    })
  }

  // ========================================
  // ADMIN EVENT HANDLER
  // ========================================
  static setupAdminEventHandler(XeonBotInc) {
    XeonBotInc.ev.on("group-participants.update", async (anu) => {
      try {
        // Check if adminevent is enabled for THIS specific group using database
        const groupId = anu.id
        const chatData = global.db.data.chats[groupId]

        // If no data exists for this group, initialize it with defaults
        if (!chatData) {
          global.db.data.chats[groupId] = {
            welcome: false,
            farewell: false,
            adminevent: false,
            // Add other default settings as needed
          }
        }

        const isAdminEventEnabled = global.db.data.chats[groupId].adminevent

        // Skip if adminevent is not enabled
        if (!isAdminEventEnabled) {
          return
        }

        console.log(anu)

        const rateLimitManager = getRateLimitManager()
        const multiUserGroupCache = getMultiUserGroupCache()

        const participants = anu.participants
        for (const num of participants) {
          try {
            let ppuser
            try {
              ppuser = await rateLimitManager.rateLimitApiCall(
                `profilePicture_${num}`,
                () => XeonBotInc.profilePictureUrl(num, "image"),
                3000,
              )
            } catch (err) {
              ppuser = "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png?q=60"
            }

            try {
              let ppgroup
              try {
                ppgroup = await rateLimitManager.rateLimitApiCall(
                  `profilePicture_${anu.id}`,
                  () => XeonBotInc.profilePictureUrl(anu.id, "image"),
                  3000,
                )
              } catch (err) {
                ppgroup = "https://i.ibb.co/RBx5SQC/avatar-group-large-v2.png?q=60"
              }

              const XeonWlcm = await getBuffer(ppuser)
              const XeonLft = await getBuffer(ppuser)

              if (anu.action == "promote") {
                const xeontime = moment.tz("Asia/Kolkata").format("HH:mm:ss")
                const xeondate = moment.tz("Asia/Kolkata").format("DD/MM/YYYY")
                const xeonName = num
                const xeonbody = ` 𝗖𝗼𝗻𝗴𝗿𝗮𝘁𝘀🎉 @${xeonName.split("@")[0]}, you have been *promoted* to *admin* 🥳`

                // Use fast track for admin event messages
                const fastResult = await rateLimitManager.fastTrackMessage(async () => {
                  return await XeonBotInc.sendMessage(anu.id, {
                    text: xeonbody,
                    contextInfo: {
                      mentionedJid: [num],
                      externalAdReply: {
                        showAdAttribution: true,
                        containsAutoReply: true,
                        title: ` ${global.botname}`,
                        body: `${global.ownername}`,
                        previewType: "PHOTO",
                        thumbnailUrl: ``,
                        thumbnail: XeonWlcm,
                        sourceUrl: `${global.wagc}`,
                      },
                    },
                  })
                })

                if (!fastResult) {
                  await rateLimitManager.addToQueue(
                    anu.id,
                    async () => {
                      await XeonBotInc.sendMessage(anu.id, {
                        text: xeonbody,
                        contextInfo: {
                          mentionedJid: [num],
                          externalAdReply: {
                            showAdAttribution: true,
                            containsAutoReply: true,
                            title: ` ${global.botname}`,
                            body: `${global.ownername}`,
                            previewType: "PHOTO",
                            thumbnailUrl: ``,
                            thumbnail: XeonWlcm,
                            sourceUrl: `${global.wagc}`,
                          },
                        },
                      })
                    },
                    true,
                  )
                }

                // Refresh cache and store after promotion
                await this.refreshGroupCacheAndStore(XeonBotInc, anu.id)
              } else if (anu.action == "demote") {
                const xeontime = moment.tz("Asia/Kolkata").format("HH:mm:ss")
                const xeondate = moment.tz("Asia/Kolkata").format("DD/MM/YYYY")
                const xeonName = num
                const xeonbody = `𝗢𝗼𝗽𝘀‼️ @${xeonName.split("@")[0]}, you have been *demoted* from *admin* 😬`

                // Use fast track for admin event messages
                const fastResult = await rateLimitManager.fastTrackMessage(async () => {
                  return await XeonBotInc.sendMessage(anu.id, {
                    text: xeonbody,
                    contextInfo: {
                      mentionedJid: [num],
                      externalAdReply: {
                        showAdAttribution: true,
                        containsAutoReply: true,
                        title: ` ${global.botname}`,
                        body: `${global.ownername}`,
                        previewType: "PHOTO",
                        thumbnailUrl: ``,
                        thumbnail: XeonLft,
                        sourceUrl: `${global.wagc}`,
                      },
                    },
                  })
                })

                if (!fastResult) {
                  await rateLimitManager.addToQueue(
                    anu.id,
                    async () => {
                      await XeonBotInc.sendMessage(anu.id, {
                        text: xeonbody,
                        contextInfo: {
                          mentionedJid: [num],
                          externalAdReply: {
                            showAdAttribution: true,
                            containsAutoReply: true,
                            title: ` ${global.botname}`,
                            body: `${global.ownername}`,
                            previewType: "PHOTO",
                            thumbnailUrl: ``,
                            thumbnail: XeonLft,
                            sourceUrl: `${global.wagc}`,
                          },
                        },
                      })
                    },
                    true,
                  )
                }

                // Refresh cache and store after demotion
                await this.refreshGroupCacheAndStore(XeonBotInc, anu.id)
              }
            } catch (messageError) {
              console.log("Error sending admin event message:", messageError.message)
            }
          } catch (participantError) {
            console.log("Error processing admin event participant:", participantError.message)
          }
        }
      } catch (err) {
        console.log("Admin event handler error:", err.message)
      }
    })
  }

  // Helper method to refresh group cache and store
  static async refreshGroupCacheAndStore(XeonBotInc, groupId) {
    try {
      console.log(`Refreshing cache and store for group: ${groupId}`)

      const multiUserGroupCache = getMultiUserGroupCache()

      // Fetch fresh group metadata
      const groupMetadata = await XeonBotInc.groupMetadata(groupId)

      if (groupMetadata) {
        // Update user-specific cache
        multiUserGroupCache.setGroupMetadata(XeonBotInc.userId, groupId, groupMetadata)
        console.log(`Updated user-specific cache for ${groupId}`)

        // Update store if it exists
        if (typeof store !== "undefined" && store && store.groupMetadata) {
          store.groupMetadata[groupId] = groupMetadata
          console.log(`Updated store.groupMetadata for ${groupId}`)
        }

        console.log(`Successfully refreshed cache and store for group: ${groupId}`)
      }
    } catch (error) {
      console.log(`Error refreshing cache and store for group ${groupId}:`, error.message)
    }
  }
}

module.exports = { EventHandlerManager }
