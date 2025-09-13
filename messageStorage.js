const fs = require('fs').promises;
const path = require('path');
const config = require('./utils');

class MessageStorage {
  constructor() {
    this.messages = new Map(); // groupId -> messages array
    this.messageCount = new Map(); // groupId -> count
    this.lastSaveTime = Date.now();
    this.saveInterval = 30000; // Save every 30 seconds
    this.rateLimiter = new Map(); // groupId -> last message time
    
    this.config = config.messageScraping || {};
    this.humanConfig = this.config.humanBehavior || {};
    this.antiDetectionConfig = this.config.antiDetection || {};
    this.filtersConfig = this.config.filters || {};
    
    // Initialize auto-save
    if (this.config.saveToFile) {
      setInterval(() => this.autoSave(), this.saveInterval);
    }
  }

  /**
   * Add a message to storage with human-like processing
   */
  async addMessage(groupId, messageData) {
    if (!this.config.enabled) return;
    
    // Apply filters
    if (!this.shouldStoreMessage(messageData)) {
      return;
    }
    
    // Rate limiting check
    if (!this.checkRateLimit(groupId)) {
      console.log(`Rate limit exceeded for group ${groupId}, skipping message`);
      return;
    }
    
    // Human-like delay before processing
    if (this.humanConfig.enabled) {
      await this.humanLikeDelay();
    }
    
    // Initialize group storage if needed
    if (!this.messages.has(groupId)) {
      this.messages.set(groupId, []);
      this.messageCount.set(groupId, 0);
    }
    
    const messages = this.messages.get(groupId);
    const currentCount = this.messageCount.get(groupId);
    
    // Check max messages per group
    if (currentCount >= (this.config.maxMessagesPerGroup || 1000)) {
      // Remove oldest message to make room
      messages.shift();
    } else {
      this.messageCount.set(groupId, currentCount + 1);
    }
    
    // Store the message
    const processedMessage = this.processMessage(messageData);
    messages.push(processedMessage);
    
    console.log(`📥 Stored message from group ${groupId} (${messages.length} total)`);
  }

  /**
   * Process and structure message data
   */
  processMessage(messageData) {
    const processed = {
      id: messageData.key?.id,
      timestamp: messageData.messageTimestamp || Date.now(),
      sender: {
        id: messageData.key?.participant || messageData.key?.remoteJid,
        name: messageData.pushName || 'Unknown',
        isBot: messageData.key?.fromMe || false
      },
      content: {
        text: this.extractText(messageData.message),
        type: this.getMessageType(messageData.message),
        hasMedia: this.hasMedia(messageData.message),
        isForwarded: !!messageData.message?.extendedTextMessage?.contextInfo?.forwardingScore,
        quotedMessage: this.extractQuotedMessage(messageData.message)
      },
      metadata: {
        groupId: messageData.key?.remoteJid,
        messageType: Object.keys(messageData.message || {})[0],
        deviceType: messageData.deviceType,
        scraped: true,
        scrapedAt: new Date().toISOString()
      }
    };
    
    return processed;
  }

  /**
   * Extract text content from various message types
   */
  extractText(message) {
    if (!message) return '';
    
    return message.conversation ||
           message.extendedTextMessage?.text ||
           message.imageMessage?.caption ||
           message.videoMessage?.caption ||
           message.documentMessage?.caption ||
           '';
  }

  /**
   * Determine message type
   */
  getMessageType(message) {
    if (!message) return 'unknown';
    
    const messageTypes = {
      conversation: 'text',
      extendedTextMessage: 'text',
      imageMessage: 'image',
      videoMessage: 'video',
      audioMessage: 'audio',
      documentMessage: 'document',
      stickerMessage: 'sticker',
      locationMessage: 'location',
      contactMessage: 'contact'
    };
    
    const type = Object.keys(message)[0];
    return messageTypes[type] || type;
  }

  /**
   * Check if message has media content
   */
  hasMedia(message) {
    if (!message) return false;
    
    const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
    return mediaTypes.some(type => message[type]);
  }

  /**
   * Extract quoted message information
   */
  extractQuotedMessage(message) {
    const contextInfo = message?.extendedTextMessage?.contextInfo ||
                       message?.imageMessage?.contextInfo ||
                       message?.videoMessage?.contextInfo;
    
    if (!contextInfo?.quotedMessage) return null;
    
    return {
      id: contextInfo.stanzaId,
      text: this.extractText(contextInfo.quotedMessage),
      sender: contextInfo.participant
    };
  }

  /**
   * Apply message filters
   */
  shouldStoreMessage(messageData) {
    const text = this.extractText(messageData.message);
    
    // Length filters
    if (this.filtersConfig.minLength && text.length < this.filtersConfig.minLength) {
      return false;
    }
    
    if (this.filtersConfig.maxLength && text.length > this.filtersConfig.maxLength) {
      return false;
    }
    
    // Media filter
    if (this.filtersConfig.excludeMedia && this.hasMedia(messageData.message)) {
      return false;
    }
    
    // Forwarded message filter
    if (this.filtersConfig.excludeForwarded && 
        messageData.message?.extendedTextMessage?.contextInfo?.forwardingScore) {
      return false;
    }
    
    // Bot message filter (don't store our own messages)
    if (messageData.key?.fromMe) {
      return false;
    }
    
    return true;
  }

  /**
   * Rate limiting to avoid detection
   */
  checkRateLimit(groupId) {
    if (!this.antiDetectionConfig.respectRateLimit) return true;
    
    const now = Date.now();
    const lastMessageTime = this.rateLimiter.get(groupId) || 0;
    const timeDiff = now - lastMessageTime;
    const minInterval = 60000 / (this.antiDetectionConfig.maxMessagesPerMinute || 10);
    
    if (timeDiff < minInterval) {
      return false;
    }
    
    this.rateLimiter.set(groupId, now);
    return true;
  }

  /**
   * Human-like delay simulation
   */
  async humanLikeDelay() {
    const min = this.humanConfig.readDelay?.min || 2000;
    const max = this.humanConfig.readDelay?.max || 8000;
    
    let delay = min;
    if (this.humanConfig.randomizeTimings) {
      delay = Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Get messages for a specific group
   */
  getGroupMessages(groupId) {
    return this.messages.get(groupId) || [];
  }

  /**
   * Get all messages organized by group
   */
  getAllMessages() {
    const result = {};
    for (const [groupId, messages] of this.messages.entries()) {
      result[groupId] = messages;
    }
    return result;
  }

  /**
   * Get message statistics
   */
  getStats() {
    const stats = {
      totalGroups: this.messages.size,
      totalMessages: 0,
      groupStats: {}
    };
    
    for (const [groupId, messages] of this.messages.entries()) {
      stats.totalMessages += messages.length;
      stats.groupStats[groupId] = {
        messageCount: messages.length,
        lastMessage: messages[messages.length - 1]?.timestamp || null
      };
    }
    
    return stats;
  }

  /**
   * Auto-save messages to file
   */
  async autoSave() {
    if (!this.config.saveToFile || !this.config.filePath) return;
    
    try {
      const data = {
        lastUpdated: new Date().toISOString(),
        stats: this.getStats(),
        messages: this.getAllMessages()
      };
      
      await fs.writeFile(this.config.filePath, JSON.stringify(data, null, 2));
      console.log(`💾 Messages auto-saved to ${this.config.filePath}`);
    } catch (error) {
      console.error('Error saving messages:', error);
    }
  }

  /**
   * Manual save
   */
  async save() {
    await this.autoSave();
  }

  /**
   * Load messages from file
   */
  async load() {
    if (!this.config.saveToFile || !this.config.filePath) return;
    
    try {
      const data = await fs.readFile(this.config.filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      if (parsed.messages) {
        for (const [groupId, messages] of Object.entries(parsed.messages)) {
          this.messages.set(groupId, messages);
          this.messageCount.set(groupId, messages.length);
        }
        console.log(`📂 Loaded ${Object.keys(parsed.messages).length} groups from file`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading messages:', error);
      }
    }
  }

  /**
   * Clear messages for a specific group
   */
  clearGroup(groupId) {
    this.messages.delete(groupId);
    this.messageCount.delete(groupId);
    this.rateLimiter.delete(groupId);
  }

  /**
   * Clear all messages
   */
  clearAll() {
    this.messages.clear();
    this.messageCount.clear();
    this.rateLimiter.clear();
  }
}

module.exports = MessageStorage;