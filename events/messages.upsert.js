// Event Handler: messages.upsert
// Description: Handles incoming messages, scrapes group messages, parses commands, and executes them.
// Triggers when a new message is received in the chat.

const config = require("./../utils");
const MessageStorage = require('../messageStorage');
const MessageQueue = require('../messageQueue');
const prefix = config.bot?.prefix || "!";

// Initialize with socket for notifications
const messageStorage = new MessageStorage();
const messageQueue = new MessageQueue(messageStorage);

// Load existing messages on startup
messageStorage.load().catch(console.error);

// Export method for manual testing
module.exports.forceProcessing = async () => {
    return await messageStorage.forceImmediateSaveAndCuration();
};

module.exports = {
  eventName: "messages.upsert",
  /**
   * Handles the messages.upsert event.
   * @param {object} sock - The WhatsApp socket instance.
   * @param {object} logger - Logger for logging info and errors.
   * @param {Map} commands - Available bot commands.
   * @returns {Function}
   */
  handler: (sock, logger, commands) => async ({ messages, type }) => {
    // Update the messageStorage instance with current socket
    messageStorage.curator = new (require('../messageCurator'))(sock);
    
    // Message scraping for groups (only if not from bot)
    if (config.messageScraping?.enabled) {
      const groupMessages = messages.filter(msg => 
        msg.message && 
        !msg.key.fromMe && 
        msg.key.remoteJid.endsWith('@g.us')
      );
      
      if (groupMessages.length > 0) {
        // Use MessageQueue instead of direct processing
        await messageQueue.addMessages(groupMessages, sock);
      }
    }
    
    const msg = messages[0];
    if (!msg.message) return;
    
    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    const sender = msg.pushName || 'Unknown';
    const messageType = Object.keys(msg.message)[0];
    
    // Enhanced logging for all messages
    const chatType = isGroup ? 'Group' : 'Private';
    
    if (text) {
      logger.info(`📨 [${chatType}] Message from ${sender}: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
    } else {
      logger.info(`📨 [${chatType}] ${messageType} from ${sender}`);
    }
    
    // Skip command processing for bot's own messages
    if (msg.key.fromMe) return;
    
    // Command processing (existing logic)
    if (!text || !text.startsWith(prefix)) return;
    
    logger.info(`⚡ Command detected from ${sender}: ${text}`);
    const [cmdName, ...args] = text.slice(1).trim().split(" ");
    const command = commands.get(cmdName.toLowerCase());
    
    if (command) {
      try {
        await command.execute(sock, from, args);
        logger.info(`✅ Command executed successfully: ${cmdName}`);
      } catch (err) {
        logger.error(`❌ Command error (${cmdName}): ${err}`);
      }
    } else {
      logger.info(`❓ Unknown command: ${cmdName}`);
    }
  },
  
  // Export both for external access
  getMessageStorage: () => messageStorage,
  getMessageQueue: () => messageQueue
};
