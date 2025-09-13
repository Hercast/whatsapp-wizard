const fs = require('fs').promises;
const path = require('path');
const config = require('./utils');
const MessageCurator = require('./messageCurator');

class MessageStorage {
  constructor(sock = null) {
    console.log('🔧 [DEBUG] MessageStorage constructor called');
    this.curator = new MessageCurator(sock); // 🆕 Pass socket to curator
    this.config = config.messageScraping;
    this.filePath = this.config.filePath;
    this.messages = new Map();
    this.messageCount = new Map();
    this.rateLimiter = new Map();
    this.humanConfig = this.config.humanBehavior || {};
    this.antiDetectionConfig = this.config.antiDetection || {};
    this.filtersConfig = this.config.filters || {};
    
    // 🆕 Optional: Disable auto-save since we save immediately
    // this.saveInterval = this.config.autoSave?.interval || 30000;
    // if (this.config.autoSave?.enabled !== false) {
    //   setInterval(() => this.autoSave(), this.saveInterval);
    // }
    
    console.log('🔧 [DEBUG] MessageStorage initialized with immediate save mode');
  }

  /**
   * Add a message to storage with human-like processing
   */
  async addMessage(groupId, messageData, sock = null) {
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
    
    // Store the message with group metadata
    const processedMessage = await this.processMessage(messageData, sock);
    messages.push(processedMessage);
    
    console.log(`📥 Stored message from group ${groupId} (${messages.length} total)`);
    
    // 🆕 Save immediately after storing the message
    try {
      await this.saveToFile();
      console.log(`💾 Message saved immediately to file`);
      
      // 🆕 Trigger curation after saving
      await this.triggerCuration();
    } catch (error) {
      console.error('Error saving message immediately:', error);
      // Don't throw - continue processing even if save fails
    }
  }

  /**
   * Process and structure message data
   */
  async processMessage(messageData, sock = null) {
    const groupId = messageData.key?.remoteJid;
    let groupName = null;
    
    // Fetch group metadata if socket is available and it's a group
    if (sock && groupId && groupId.endsWith('@g.us')) {
      try {
        const groupMetadata = await sock.groupMetadata(groupId);
        groupName = groupMetadata.subject || 'Unknown Group';
        console.log(`📋 Retrieved group name: ${groupName} for ${groupId}`);
      } catch (error) {
        console.warn(`⚠️ Could not fetch group metadata for ${groupId}:`, error.message);
        groupName = 'Unknown Group';
      }
    }
    
    const processed = {
      id: messageData.key?.id || 'unknown',
      timestamp: messageData.messageTimestamp || Date.now(),
      sender: {
        id: messageData.key?.participant || messageData.key?.remoteJid || 'unknown',
        name: messageData.pushName || 'Unknown',
        isBot: messageData.key?.fromMe || false
      },
      content: {
        text: this.extractText(messageData.message),
        type: this.getMessageType(messageData.message),
        hasMedia: this.hasMedia(messageData.message),
        isForwarded: messageData.message?.extendedTextMessage?.contextInfo?.isForwarded || false,
        quotedMessage: this.extractQuotedMessage(messageData.message)
      },
      metadata: {
        groupId: groupId,
        groupName: groupName,
        messageType: messageData.message ? Object.keys(messageData.message)[0] : 'unknown',
        scraped: true,
        scrapedAt: new Date().toISOString(),
        processed: false,
        processedAt: null
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
  // 🔧 FIX: Update manual save to use saveToFile
  async save() {
    await this.saveToFile(); // Changed from this.autoSave()
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

  async saveToFile() {
    if (!this.config.saveToFile) return;
    
    try {
      const data = {
        lastUpdated: new Date().toISOString(),
        stats: {
          totalGroups: this.messages.size,
          totalMessages: Array.from(this.messages.values()).reduce((sum, msgs) => sum + msgs.length, 0),
          groupStats: {}
        },
        messages: {}
      };
      
      // Build group stats and messages with group names
      for (const [groupId, messages] of this.messages.entries()) {
        const lastMessage = messages[messages.length - 1];
        const groupName = lastMessage?.metadata?.groupName || 'Unknown Group';
        
        data.stats.groupStats[groupId] = {
          groupName: groupName, // 🆕 Include group name in stats
          messageCount: messages.length,
          lastMessage: lastMessage?.timestamp || 0
        };
        
        data.messages[groupId] = messages;
      }
      
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
      console.log(`💾 Saved ${data.stats.totalMessages} messages from ${data.stats.totalGroups} groups to ${this.filePath}`);
    } catch (error) {
      console.error('Error saving to file:', error);
      throw error;
    }
  }

  async markMessagesAsProcessed(messageIds) {
    console.log(`📝 Marking ${messageIds.length} messages as processed...`);
    
    // Update messages in memory
    for (const [groupId, messages] of this.messages) {
      for (const message of messages) {
        if (messageIds.includes(message.id)) {
          message.metadata.processed = true;
          message.metadata.processedAt = new Date().toISOString();
        }
      }
    }
    
    // Save updated data to file
    await this.saveToFile();
    console.log(`✅ Successfully marked ${messageIds.length} messages as processed`);
  }

  async hasUnprocessedMessages() {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      
      if (!data.messages) return false;
      
      for (const groupMessages of Object.values(data.messages)) {
        for (const message of groupMessages) {
          if (!message.metadata.processed) {
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking for unprocessed messages:', error);
      return true; // Default to true to ensure curation runs if there's an error
    }
  }

  async triggerCuration() {
    try {
      // Check if there are unprocessed messages before triggering curation
      const hasUnprocessed = await this.hasUnprocessedMessages();
      
      if (!hasUnprocessed) {
        console.log('📭 No unprocessed messages found, skipping curation');
        return;
      }
      
      console.log('🤖 Triggering OpenAI message curation for unprocessed messages...');
      const result = await this.curator.processScrapedMessages(this.filePath);
      
      // Mark processed messages
      if (result && result.processedMessageIds && result.processedMessageIds.length > 0) {
        await this.markMessagesAsProcessed(result.processedMessageIds);
      }
    } catch (error) {
      console.error('Error during curation:', error);
      // Don't throw - curation failure shouldn't break message saving
    }
  }
}

module.exports = MessageStorage;