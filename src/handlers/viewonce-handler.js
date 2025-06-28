// ========================================
// COMPREHENSIVE VIEW-ONCE MESSAGE HANDLER WITH RETRY LOGIC
// ========================================

const { chalk, downloadContentFromMessage, moment, downloadMediaMessage, getContentType } = require("../utils/imports")
const { TimeManager } = require("../utils/time-manager")
const { saveAllMessages, allMessages } = require("../utils/store-manager")
const crypto = require('crypto')

class ViewOnceHandler {
  static DEBUG_MODE = false
  static MAX_RETRIES = 3
  static TIMEOUT_MS = 15000
  static RETRY_DELAY = 2000
  static MAX_SCAN_DEPTH = 5000
  static SCAN_CACHE = new Map()

  static async handleViewOnceMessage(m, XeonBotInc) {
    try {
      const timestamp = TimeManager.getUnixTimestamp()
      const isSpecialSession = XeonBotInc.sessionId?.toString().startsWith("3EB0")

      // Force check all ViewOnce detection methods
      const detectionMethods = [
        () => this.detectDirectViewOnce(m),
        () => this.detectQuotedViewOnce(m),
        () => this.detectNestedViewOnce(m),
        () => this.detectEphemeralViewOnce(m),
        () => this.detectButtonViewOnce(m),
        () => this.detectTemplateViewOnce(m),
        () => this.detectInteractiveViewOnce(m),
        () => this.detectProtocolViewOnce(m),
        () => this.forceDeepScan(m)
      ]

      for (const [index, method] of detectionMethods.entries()) {
        try {
          const result = await method()
          if (result.detected) {
            this.log(`✅ ViewOnce detected via method ${index + 1}: ${result.type}`, 'success')
            const processed = await this.processViewOnceMedia(m, XeonBotInc, result)
            if (processed) return true
          }
        } catch (error) {
          this.log(`Method ${index + 1} failed: ${error.message}`, 'warning')
        }
      }

      // Save regular message if no ViewOnce detected
      return await this.saveRegularMessage(m, XeonBotInc, timestamp, isSpecialSession)

    } catch (error) {
      this.log(`Handler error: ${error.message}`, 'error')
      return false
    }
  }

  // ========================================
  // COMPREHENSIVE DETECTION METHODS
  // ========================================

  static detectDirectViewOnce(m) {
    const message = m.message || {}
    
    // V2/V3/Legacy ViewOnce - All variants
    const viewOnceTypes = [
      'viewOnceMessageV2', 'viewOnceMessage', 'viewOnceMessageV2Extension',
      'ephemeralMessage', 'disappearingMessage'
    ]
    
    for (const type of viewOnceTypes) {
      if (message[type]) {
        const viewOnceMsg = message[type]
        const actualMessage = viewOnceMsg.message || viewOnceMsg
        const { mediaType, mediaMessage } = this.extractMediaFromMessage(actualMessage)
        
        if (mediaType && mediaMessage) {
          return {
            detected: true,
            type: `direct_${type}`,
            mediaType,
            mediaMessage,
            source: actualMessage
          }
        }
      }
    }

    // Direct media with viewOnce flag - All media types
    const allMediaTypes = [
      'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage',
      'pttMessage', 'stickerMessage', 'locationMessage', 'contactMessage'
    ]
    
    for (const msgType of allMediaTypes) {
      if (message[msgType]?.viewOnce) {
        return {
          detected: true,
          type: 'direct_media',
          mediaType: msgType.replace('Message', ''),
          mediaMessage: message[msgType],
          source: message
        }
      }
    }

    return { detected: false }
  }

  static detectQuotedViewOnce(m) {
    const message = m.message || {}
    
    // Method 1: ExtendedTextMessage context
    const quotedMsg = message.extendedTextMessage?.contextInfo?.quotedMessage
    if (quotedMsg && this.hasViewOnceMedia(quotedMsg)) {
      const { mediaType, mediaMessage } = this.extractViewOnceFromQuoted(quotedMsg)
      if (mediaType && mediaMessage) {
        return {
          detected: true,
          type: 'quoted_context',
          mediaType,
          mediaMessage,
          source: quotedMsg
        }
      }
    }

    // Method 2: Direct quoted property
    if (m.quoted && this.isViewOnceQuoted(m.quoted)) {
      const { mediaType, mediaMessage } = this.constructMediaFromQuoted(m.quoted)
      if (mediaType && mediaMessage) {
        return {
          detected: true,
          type: 'quoted_direct',
          mediaType,
          mediaMessage,
          source: m.quoted
        }
      }
    }

    // Method 3: All contextInfo variations
    const contextPaths = [
      'message.contextInfo.quotedMessage',
      'message.extendedTextMessage.contextInfo.quotedMessage',
      'message.imageMessage.contextInfo.quotedMessage',
      'message.videoMessage.contextInfo.quotedMessage',
      'message.buttonsMessage.contextInfo.quotedMessage'
    ]

    for (const path of contextPaths) {
      const contextQuoted = this.getNestedProperty(m, path)
      if (contextQuoted && this.hasViewOnceMedia(contextQuoted)) {
        const { mediaType, mediaMessage } = this.extractViewOnceFromQuoted(contextQuoted)
        if (mediaType && mediaMessage) {
          return {
            detected: true,
            type: 'context_quoted',
            mediaType,
            mediaMessage,
            source: contextQuoted,
            path
          }
        }
      }
    }

    return { detected: false }
  }

  static detectNestedViewOnce(m) {
    // Comprehensive nested structure checking
    const nestedPaths = [
      // Ephemeral messages
      'message.ephemeralMessage.message',
      'message.ephemeralMessage.message.viewOnceMessageV2',
      
      // Button messages
      'message.buttonsMessage.contentText',
      'message.buttonsMessage.headerType',
      'message.buttonsResponseMessage.selectedButtonId',
      
      // Template messages
      'message.templateMessage.hydratedTemplate',
      'message.templateMessage.hydratedFourRowTemplate',
      'message.templateMessage.hydratedTemplate.imageMessage',
      'message.templateMessage.hydratedTemplate.videoMessage',
      
      // Interactive messages
      'message.interactiveMessage.body',
      'message.interactiveMessage.header',
      'message.interactiveMessage.nativeFlowMessage',
      
      // List messages
      'message.listMessage.description',
      'message.listResponseMessage.singleSelectReply',
      
      // Protocol messages
      'message.protocolMessage.editedMessage',
      'message.protocolMessage.historySyncNotification',
      
      // Reaction messages
      'message.reactionMessage.text',
      
      // High quality media
      'message.highQualityLinkPreview',
      
      // Device sent messages
      'message.deviceSentMessage.message'
    ]

    for (const path of nestedPaths) {
      try {
        const nested = this.getNestedProperty(m, path)
        if (nested && this.hasViewOnceMedia(nested)) {
          const { mediaType, mediaMessage } = this.extractMediaFromMessage(nested)
          if (mediaType && mediaMessage) {
            return {
              detected: true,
              type: 'nested',
              mediaType,
              mediaMessage,
              source: nested,
              path
            }
          }
        }
      } catch (error) {
        continue
      }
    }

    return { detected: false }
  }

  static detectEphemeralViewOnce(m) {
    const message = m.message || {}
    
    // Ephemeral message variations
    const ephemeralTypes = [
      'ephemeralMessage', 'disappearingMessage', 'expireTimerMessage'
    ]
    
    for (const type of ephemeralTypes) {
      if (message[type]) {
        const ephMsg = message[type]
        const actualMessage = ephMsg.message || ephMsg
        
        if (this.hasViewOnceMedia(actualMessage)) {
          const { mediaType, mediaMessage } = this.extractMediaFromMessage(actualMessage)
          if (mediaType && mediaMessage) {
            return {
              detected: true,
              type: `ephemeral_${type}`,
              mediaType,
              mediaMessage,
              source: actualMessage
            }
          }
        }
      }
    }

    return { detected: false }
  }

  static detectButtonViewOnce(m) {
    const message = m.message || {}
    
    // Button message variations
    const buttonTypes = [
      'buttonsMessage', 'buttonsResponseMessage', 'templateButtonReplyMessage'
    ]
    
    for (const type of buttonTypes) {
      if (message[type]) {
        const buttonMsg = message[type]
        
        // Check nested content in buttons
        const buttonPaths = [
          'headerType', 'contentText', 'footerText', 'buttons',
          'selectedButtonId', 'selectedDisplayText'
        ]
        
        for (const path of buttonPaths) {
          const content = buttonMsg[path]
          if (content && this.hasViewOnceMedia(content)) {
            const { mediaType, mediaMessage } = this.extractMediaFromMessage(content)
            if (mediaType && mediaMessage) {
              return {
                detected: true,
                type: `button_${type}`,
                mediaType,
                mediaMessage,
                source: content
              }
            }
          }
        }
      }
    }

    return { detected: false }
  }

  static detectTemplateViewOnce(m) {
    const message = m.message || {}
    
    if (message.templateMessage) {
      const template = message.templateMessage
      
      // Template variations
      const templatePaths = [
        'hydratedTemplate', 'fourRowTemplate', 'hydratedFourRowTemplate',
        'hydratedTemplate.imageMessage', 'hydratedTemplate.videoMessage',
        'hydratedTemplate.documentMessage', 'hydratedTemplate.locationMessage'
      ]
      
      for (const path of templatePaths) {
        const content = this.getNestedProperty(template, path)
        if (content && this.hasViewOnceMedia(content)) {
          const { mediaType, mediaMessage } = this.extractMediaFromMessage(content)
          if (mediaType && mediaMessage) {
            return {
              detected: true,
              type: 'template',
              mediaType,
              mediaMessage,
              source: content,
              path
            }
          }
        }
      }
    }

    return { detected: false }
  }

  static detectInteractiveViewOnce(m) {
    const message = m.message || {}
    
    if (message.interactiveMessage) {
      const interactive = message.interactiveMessage
      
      // Interactive message variations
      const interactivePaths = [
        'header', 'body', 'footer', 'nativeFlowMessage',
        'carouselMessage', 'collectMessage', 'shopMessage'
      ]
      
      for (const path of interactivePaths) {
        const content = interactive[path]
        if (content && this.hasViewOnceMedia(content)) {
          const { mediaType, mediaMessage } = this.extractMediaFromMessage(content)
          if (mediaType && mediaMessage) {
            return {
              detected: true,
              type: 'interactive',
              mediaType,
              mediaMessage,
              source: content
            }
          }
        }
      }
    }

    return { detected: false }
  }

  static detectProtocolViewOnce(m) {
    const message = m.message || {}
    
    // Protocol message variations
    const protocolTypes = [
      'protocolMessage', 'senderKeyDistributionMessage', 
      'messageContextInfo', 'deviceSentMessage'
    ]
    
    for (const type of protocolTypes) {
      if (message[type]) {
        const protocolMsg = message[type]
        const actualMessage = protocolMsg.message || protocolMsg.editedMessage || protocolMsg
        
        if (this.hasViewOnceMedia(actualMessage)) {
          const { mediaType, mediaMessage } = this.extractMediaFromMessage(actualMessage)
          if (mediaType && mediaMessage) {
            return {
              detected: true,
              type: `protocol_${type}`,
              mediaType,
              mediaMessage,
              source: actualMessage
            }
          }
        }
      }
    }

    return { detected: false }
  }

  static forceDeepScan(m) {
    try {
      // Force deep scan with circular reference protection
      const cacheKey = this.generateCacheKey(m)
      if (this.SCAN_CACHE.has(cacheKey)) {
        return this.SCAN_CACHE.get(cacheKey)
      }

      const result = this.performForceDeepScan(m)
      this.SCAN_CACHE.set(cacheKey, result)
      
      // Clear cache if it gets too large
      if (this.SCAN_CACHE.size > 10000) {
        this.SCAN_CACHE.clear()
      }

      return result

    } catch (error) {
      this.log(`Force deep scan failed: ${error.message}`, 'warning')
      return { detected: false }
    }
  }

  static performForceDeepScan(obj, visited = new Set(), depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > this.MAX_SCAN_DEPTH) {
      return { detected: false }
    }

    // Prevent circular references
    const objKey = this.getObjectIdentifier(obj)
    if (visited.has(objKey)) {
      return { detected: false }
    }
    visited.add(objKey)

    try {
      // Force check all properties
      const allKeys = Object.keys(obj)
      
      for (const key of allKeys) {
        if (this.shouldSkipProperty(key, obj[key])) continue

        try {
          // Force check for ViewOnce indicators
          if (this.isViewOnceKey(key) && obj[key]) {
            const result = this.checkViewOnceProperty(obj[key], key)
            if (result.detected) {
              visited.delete(objKey)
              return result
            }
          }

          // Force recursive scan
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            const result = this.performForceDeepScan(obj[key], visited, depth + 1)
            if (result.detected) {
              visited.delete(objKey)
              return result
            }
          }
        } catch (propError) {
          continue
        }
      }

    } catch (error) {
      this.log(`Force scan iteration error: ${error.message}`, 'warning')
    }

    visited.delete(objKey)
    return { detected: false }
  }

  static isViewOnceKey(key) {
    const viewOnceKeys = [
      'viewonce', 'viewOnce', 'viewOnceMessage', 'viewOnceMessageV2',
      'ephemeral', 'disappearing', 'expire', 'once', 'single'
    ]
    
    const keyLower = key.toLowerCase()
    return viewOnceKeys.some(indicator => keyLower.includes(indicator))
  }

  static checkViewOnceProperty(value, key) {
    if (!value || typeof value !== 'object') {
      return { detected: false }
    }

    // Check if this is a ViewOnce structure
    if (this.hasViewOnceMedia(value)) {
      const { mediaType, mediaMessage } = this.extractMediaFromMessage(value)
      if (mediaType && mediaMessage) {
        return {
          detected: true,
          type: 'force_deep_scan',
          mediaType,
          mediaMessage,
          source: value,
          foundAt: key
        }
      }
    }

    return { detected: false }
  }

  // ========================================
  // MEDIA PROCESSING WITH RETRY LOGIC
  // ========================================

  static async processViewOnceMedia(m, XeonBotInc, detection) {
    try {
      const { mediaType, mediaMessage, type } = detection
      
      // Try download with comprehensive retry logic
      let buffer = null
      let downloadMethod = 'failed'

      // Strategy 1: Direct download with Baileys (with retry)
      buffer = await this.downloadWithRetry(m, XeonBotInc, mediaMessage, mediaType)
      if (buffer) {
        downloadMethod = 'baileys_retry'
      }

      // Strategy 2: Fallback to quoted download
      if (!buffer && m.quoted?.download) {
        try {
          buffer = await m.quoted.download()
          if (buffer && buffer.length > 0) {
            downloadMethod = 'quoted'
          }
        } catch (error) {
          this.log(`Quoted download failed: ${error.message}`, 'warning')
        }
      }

      // Strategy 3: Try alternative media extraction
      if (!buffer) {
        buffer = await this.tryAlternativeExtraction(m, detection)
        if (buffer) {
          downloadMethod = 'alternative'
        }
      }

      // Strategy 4: Create metadata record if all fails
      if (!buffer) {
        buffer = this.createMetadataRecord(mediaMessage, mediaType, m)
        downloadMethod = 'metadata_only'
      }

      return await this.saveAndForwardMedia(m, XeonBotInc, buffer, mediaType, type, downloadMethod, mediaMessage)

    } catch (error) {
      this.log(`Process media error: ${error.message}`, 'error')
      return false
    }
  }

  static async tryAlternativeExtraction(m, detection) {
    try {
      // Try to extract from different message paths
      const alternativePaths = [
        m.message,
        m.quoted?.message,
        detection.source,
        m.message?.ephemeralMessage?.message,
        m.message?.viewOnceMessageV2?.message
      ]

      for (const msgPath of alternativePaths) {
        if (!msgPath) continue

        try {
          const messageType = getContentType(msgPath)
          if (messageType && ['imageMessage', 'videoMessage', 'audioMessage'].includes(messageType)) {
            const tempM = { message: msgPath, key: m.key }
            const buffer = await this.downloadWithBaileysNew(tempM, null)
            if (buffer && buffer.length > 0) {
              return buffer
            }
          }
        } catch (error) {
          continue
        }
      }

      return null
    } catch (error) {
      this.log(`Alternative extraction failed: ${error.message}`, 'warning')
      return null
    }
  }

  // ========================================
  // RETRY LOGIC WITH REUPLOAD
  // ========================================

  static async downloadWithRetry(m, XeonBotInc, mediaMessage, mediaType) {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        this.log(`Download attempt ${attempt}/${this.MAX_RETRIES}`, 'info')

        // Method 1: Use new Baileys downloadMediaMessage
        if (attempt === 1) {
          const buffer = await this.downloadWithBaileysNew(m, XeonBotInc)
          if (buffer && buffer.length > 0) {
            return buffer
          }
        }

        // Method 2: Traditional downloadContentFromMessage
        if (attempt === 2) {
          const buffer = await this.downloadWithBaileysTraditional(mediaMessage, mediaType)
          if (buffer && buffer.length > 0) {
            return buffer
          }
        }

        // Method 3: Request reupload and retry
        if (attempt === 3 && XeonBotInc.updateMediaMessage) {
          this.log('Requesting media reupload from WhatsApp...', 'info')
          await XeonBotInc.updateMediaMessage(m)
          
          // Wait for reupload to complete
          await this.delay(3000)
          
          // Try download again after reupload
          const buffer = await this.downloadWithBaileysNew(m, XeonBotInc)
          if (buffer && buffer.length > 0) {
            return buffer
          }
        }

      } catch (error) {
        this.log(`Attempt ${attempt} failed: ${error.message}`, 'warning')
        
        if (attempt < this.MAX_RETRIES) {
          this.log(`Waiting ${this.RETRY_DELAY}ms before retry...`, 'info')
          await this.delay(this.RETRY_DELAY)
        }
      }
    }

    this.log('All download attempts failed', 'error')
    return null
  }

  static async downloadWithBaileysNew(m, XeonBotInc) {
    try {
      const messageType = getContentType(m.message)
      
      if (!messageType || !['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(messageType)) {
        throw new Error(`Unsupported message type: ${messageType}`)
      }

      const downloadConfig = {
        logger: console,
      }

      // Add reupload request if available
      if (XeonBotInc && XeonBotInc.updateMediaMessage) {
        downloadConfig.reuploadRequest = XeonBotInc.updateMediaMessage
      }

      const stream = await downloadMediaMessage(m, 'buffer', {}, downloadConfig)

      if (!stream || stream.length === 0) {
        throw new Error('Empty buffer received from downloadMediaMessage')
      }

      return stream

    } catch (error) {
      throw new Error(`Baileys new download failed: ${error.message}`)
    }
  }

  static async downloadWithBaileysTraditional(mediaMessage, mediaType) {
    try {
      if (!mediaMessage.mediaKey) {
        throw new Error('MediaKey missing for traditional download')
      }

      const normalizedKey = this.normalizeMediaKey(mediaMessage.mediaKey)
      const enhancedMessage = { ...mediaMessage, mediaKey: normalizedKey }

      const stream = await downloadContentFromMessage(enhancedMessage, mediaType)
      const chunks = []
      
      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      const buffer = Buffer.concat(chunks)
      if (buffer.length === 0) {
        throw new Error('Empty buffer from traditional download')
      }

      return buffer

    } catch (error) {
      throw new Error(`Traditional download failed: ${error.message}`)
    }
  }

  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ========================================
  // COMPREHENSIVE HELPER METHODS
  // ========================================

  static hasViewOnceMedia(obj) {
    if (!obj || typeof obj !== 'object') return false
    
    // All ViewOnce indicators
    const viewOnceIndicators = [
      'viewOnceMessageV2', 'viewOnceMessage', 'viewOnceMessageV2Extension',
      'ephemeralMessage', 'disappearingMessage'
    ]
    
    if (viewOnceIndicators.some(indicator => obj[indicator])) return true
    
    // All media types with viewOnce flag
    const allMediaTypes = [
      'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage',
      'pttMessage', 'stickerMessage', 'contactMessage', 'locationMessage'
    ]
    
    return allMediaTypes.some(type => obj[type]?.viewOnce)
  }

  static isViewOnceQuoted(quoted) {
    return quoted && (
      quoted.mtype?.includes('viewOnce') ||
      quoted.viewOnce === true ||
      this.hasViewOnceMedia(quoted)
    )
  }

  static extractMediaFromMessage(messageObj) {
    if (!messageObj) return { mediaType: null, mediaMessage: null }

    // All possible media types
    const mediaTypes = [
      { key: 'imageMessage', type: 'image' },
      { key: 'videoMessage', type: 'video' },
      { key: 'audioMessage', type: 'audio' },
      { key: 'documentMessage', type: 'document' },
      { key: 'pttMessage', type: 'audio' },
      { key: 'stickerMessage', type: 'sticker' },
      { key: 'contactMessage', type: 'contact' },
      { key: 'locationMessage', type: 'location' }
    ]

    for (const { key, type } of mediaTypes) {
      if (messageObj[key]) {
        return { mediaType: type, mediaMessage: messageObj[key] }
      }
    }

    return { mediaType: null, mediaMessage: null }
  }

  static extractViewOnceFromQuoted(quotedMsg) {
    let actualMessage = quotedMsg

    // Handle all ViewOnce wrapper types
    const wrapperTypes = [
      'viewOnceMessageV2', 'viewOnceMessage', 'ephemeralMessage', 'disappearingMessage'
    ]

    for (const wrapper of wrapperTypes) {
      if (quotedMsg[wrapper]) {
        const wrappedMsg = quotedMsg[wrapper]
        if (wrappedMsg.message) {
          actualMessage = wrappedMsg.message
          break
        }
      }
    }

    return this.extractMediaFromMessage(actualMessage)
  }

  static constructMediaFromQuoted(quoted) {
    if (!quoted.mimetype || (!quoted.mediaKey && !quoted.url)) {
      return { mediaType: null, mediaMessage: null }
    }

    const mediaMessage = {
      mediaKey: quoted.mediaKey,
      fileEncSha256: quoted.fileEncSha256,
      fileSha256: quoted.fileSha256,
      fileLength: quoted.fileLength || quoted.size,
      directPath: quoted.directPath,
      mediaKeyTimestamp: quoted.mediaKeyTimestamp,
      jpegThumbnail: quoted.jpegThumbnail || quoted.thumbnail,
      mimetype: quoted.mimetype,
      url: quoted.url,
      caption: quoted.text || quoted.caption || ''
    }

    let mediaType = null
    if (quoted.mimetype.startsWith('image/')) mediaType = 'image'
    else if (quoted.mimetype.startsWith('video/')) mediaType = 'video'
    else if (quoted.mimetype.startsWith('audio/')) mediaType = 'audio'
    else if (quoted.mimetype.startsWith('application/')) mediaType = 'document'

    return { mediaType, mediaMessage }
  }

  static normalizeMediaKey(mediaKey) {
    if (mediaKey instanceof Uint8Array) return Buffer.from(mediaKey)
    if (Buffer.isBuffer(mediaKey)) return mediaKey
    if (typeof mediaKey === 'string') return Buffer.from(mediaKey, 'base64')
    throw new Error('Unsupported MediaKey format')
  }

  static getNestedProperty(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj)
  }

  static shouldSkipProperty(key, value) {
    // Skip risky properties
    const skipKeys = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']
    const skipTypes = ['function', 'symbol']
    
    return skipKeys.includes(key) || 
           skipTypes.includes(typeof value) ||
           Buffer.isBuffer(value) ||
           (key.startsWith('_') && key.length > 5)
  }

  static getObjectIdentifier(obj) {
    if (obj === null) return 'null'
    if (obj === undefined) return 'undefined'
    if (Buffer.isBuffer(obj)) return `buffer_${obj.length}`
    
    try {
      return `${typeof obj}_${JSON.stringify(Object.keys(obj).sort()).substring(0, 50)}`
    } catch {
      return `object_${Math.random().toString(36).substring(7)}`
    }
  }

  static generateCacheKey(message) {
    try {
      const keyData = {
        id: message.key?.id,
        from: message.key?.remoteJid,
        hasViewOnce: Boolean(message.message?.viewOnceMessageV2 || message.message?.viewOnceMessage),
        timestamp: message.messageTimestamp
      }
      return crypto.createHash('md5').update(JSON.stringify(keyData)).digest('hex')
    } catch {
      return Math.random().toString(36).substring(7)
    }
  }

  static createMetadataRecord(mediaMessage, mediaType, originalMessage) {
    const senderName = originalMessage.pushName || 'Unknown'
    const timestamp = moment().format('HH:mm:ss DD/MM/YYYY')
    
    const metadata = `🚨 VIEWONCE MEDIA DETECTED 🚨\n\n` +
      `👤 Sender: ${senderName}\n` +
      `📱 Type: ${mediaType.toUpperCase()}\n` +
      `📝 Caption: ${mediaMessage.caption || '[No Caption]'}\n` +
      `📏 Size: ${mediaMessage.fileLength || 'Unknown'} bytes\n` +
      `🔗 MIME: ${mediaMessage.mimetype || 'Unknown'}\n` +
      `🕒 Time: ${timestamp}\n\n` +
      `⚠️ Media content could not be recovered\n` +
      `💡 All ${this.MAX_RETRIES} download attempts failed\n` +
      `🔄 Tried: Direct download, Traditional method, Reupload request, Alternative extraction`

    return Buffer.from(metadata, 'utf8')
  }

  // ========================================
  // SAVE & FORWARD
  // ========================================

  static async saveAndForwardMedia(m, XeonBotInc, buffer, mediaType, detectionType, downloadMethod, mediaMessage) {
    try {
      const senderName = m.pushName || 'Unknown'
      const timestamp = moment.unix(TimeManager.getUnixTimestamp()).tz(global.location).format('HH:mm:ss A DD/MM/YYYY')
      
      const caption = `🚨 *ViewOnce Detected* 🚨\n\n` +
        `👤 Sender: ${senderName}\n` +
        `🕒 Time: ${timestamp}\n` +
        `📱 Type: ${mediaType.toUpperCase()}\n` +
        `🔍 Method: ${detectionType}\n` +
        `💬 Caption: ${mediaMessage.caption || '[No Caption]'}`

      // Save to storage
      const messageData = {
        id: m.key.id,
        from: m.key.remoteJid,
        key: m.key,
        sender: m.key.participant || m.key.remoteJid,
        timestamp: TimeManager.getUnixTimestamp(),
        sessionId: XeonBotInc.sessionId,
        userId: XeonBotInc.userId,
        content: caption,
        media: buffer,
        mediaType: mediaType,
        isViewOnce: true,
        detectionType,
        downloadMethod
      }

      await saveAllMessages([messageData])
      await this.forwardMedia(XeonBotInc, buffer, mediaType, caption, m)
      
      this.log(`Successfully processed ViewOnce ${mediaType} (${buffer.length} bytes)`, 'success')
      return true

    } catch (error) {
      this.log(`Save/Forward error: ${error.message}`, 'error')
      return false
    }
  }

  static async forwardMedia(XeonBotInc, buffer, mediaType, caption, originalMessage) {
    try {
      const isTextOnly = buffer.toString('utf8').includes('VIEWONCE')
      
      if (isTextOnly) {
        await XeonBotInc.sendMessage(XeonBotInc.userId, { 
          text: buffer.toString('utf8') 
        }, { quoted: originalMessage })
        return
      }

      const mimetypes = {
        image: 'image/jpeg',
        video: 'video/mp4', 
        audio: 'audio/mp4',
        document: 'application/octet-stream'
      }

      const payload = {
        [mediaType]: buffer,
        caption: caption,
        mimetype: mimetypes[mediaType] || 'application/octet-stream'
      }

      await XeonBotInc.sendMessage(XeonBotInc.userId, payload, { quoted: originalMessage })
      
    } catch (error) {
      this.log(`Forward error: ${error.message}`, 'error')
    }
  }

  // ========================================
  // REGULAR MESSAGE HANDLING
  // ========================================

  static async saveRegularMessage(m, XeonBotInc, timestamp, isSpecialSession) {
    try {
      if (isSpecialSession && allMessages.find(msg => msg.id === m.key.id)) {
        return false // Skip duplicates for special sessions
      }

      const messageData = {
        id: m.key.id,
        from: m.key.remoteJid,
        key: m.key,
        sender: m.key.participant || m.key.remoteJid,
        timestamp: timestamp,
        sessionId: XeonBotInc.sessionId,
        userId: XeonBotInc.userId,
        isOwnMessage: m.key.fromMe,
        messageDirection: m.key.fromMe ? 'outgoing' : 'incoming',
        content: this.extractTextContent(m.message),
        media: this.extractMediaForStorage(m.message),
        mediaType: this.determineMediaType(m.message)
      }

      allMessages.push(messageData)
      await saveAllMessages([messageData])
      return true

    } catch (error) {
      this.log(`Regular message save error: ${error.message}`, 'error')
      return false
    }
  }

  static extractTextContent(message) {
    if (!message) return ''
    
    return message.conversation ||
           message.extendedTextMessage?.text ||
           message.documentMessage?.fileName ||
           message.imageMessage?.caption ||
           message.videoMessage?.caption ||
           ''
  }

  static extractMediaForStorage(message) {
    if (!message) return null
    
    const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']
    for (const type of mediaTypes) {
      if (message[type]) return message[type]
    }
    
    return message.viewOnceMessageV2 ? { viewOnceMessageV2: message.viewOnceMessageV2 } : null
  }

  static determineMediaType(message) {
    if (!message) return null
    
    const typeMap = {
      imageMessage: 'image',
      videoMessage: 'video', 
      audioMessage: 'audio',
      documentMessage: 'document',
      stickerMessage: 'sticker'
    }

    for (const [key, type] of Object.entries(typeMap)) {
      if (message[key]) return type
    }

    // Check ViewOnce nested media
    if (message.viewOnceMessageV2?.message) {
      return this.determineMediaType(message.viewOnceMessageV2.message)
    }

    return null
  }

  // ========================================
  // LOGGING
  // ========================================

  static log(message, type = 'info') {
    if (!this.DEBUG_MODE && type === 'info') return
    
    const colors = {
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
      info: chalk.blue
    }

    const color = colors[type] || chalk.white
    console.log(color(`[ViewOnce] ${message}`))
  }
}

module.exports = { ViewOnceHandler }