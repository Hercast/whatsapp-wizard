const EventEmitter = require('events');

class MessageQueue extends EventEmitter {
  constructor(messageStorage, options = {}) {
    super();
    this.messageStorage = messageStorage;
    this.queue = [];
    this.processing = false;
    this.concurrency = options.concurrency || 3; // Process 3 messages simultaneously
    this.activeWorkers = 0;
    this.groupMetadataCache = new Map(); // Cache group metadata
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  async addMessages(messages, sock) {
    // Add all messages from the batch to queue
    for (const msg of messages) {
      if (msg.message && !msg.key.fromMe) {
        this.queue.push({ msg, sock, timestamp: Date.now() });
      }
    }
    
    console.log(`📥 Added ${messages.length} messages to queue. Queue size: ${this.queue.length}`);
    this.processQueue();
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0 || this.activeWorkers >= this.concurrency) {
      return;
    }

    this.processing = true;
    
    while (this.queue.length > 0 && this.activeWorkers < this.concurrency) {
      const item = this.queue.shift();
      this.processMessage(item);
    }
    
    this.processing = false;
  }

  async processMessage({ msg, sock, timestamp }) {
    this.activeWorkers++;
    
    try {
      const from = msg.key.remoteJid;
      const isGroup = from.endsWith('@g.us');
      
      if (isGroup) {
        // Use cached group metadata to avoid repeated API calls
        const groupName = await this.getCachedGroupMetadata(from, sock);
        
        // Process without delays for high-throughput
        await this.messageStorage.addMessageFast(from, msg, sock, groupName);
      }
    } catch (error) {
      console.error(`Error processing queued message:`, error);
    } finally {
      this.activeWorkers--;
      
      // Continue processing if there are more messages
      if (this.queue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  async getCachedGroupMetadata(groupId, sock) {
    const cached = this.groupMetadataCache.get(groupId);
    
    if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
      return cached.name;
    }

    try {
      const metadata = await sock.groupMetadata(groupId);
      const groupName = metadata.subject || 'Unknown Group';
      
      this.groupMetadataCache.set(groupId, {
        name: groupName,
        timestamp: Date.now()
      });
      
      return groupName;
    } catch (error) {
      console.warn(`Could not fetch group metadata for ${groupId}:`, error.message);
      return 'Unknown Group';
    }
  }
}

module.exports = MessageQueue;