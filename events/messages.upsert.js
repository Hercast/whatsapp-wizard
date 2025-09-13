// Event Handler: messages.upsert
// Description: Handles incoming messages (real-time and offline sync), parses commands, and executes them if matched.
// Triggers when a new message is received in the chat.

const config = require("./../utils");
const prefix = config.bot?.prefix || "!";

module.exports = {
  eventName: "messages.upsert",
  /**
   * Handles new incoming messages and executes commands.
   * @param {object} sock - The WhatsApp socket instance.
   * @param {object} logger - Logger for logging info and errors.
   * @param {Map} commands - Map of available commands.
   * @returns {Function}
   */
  handler: (sock, logger, commands) => async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    
    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    
    // Enhanced logging for all received messages
    const messageType = Object.keys(msg.message)[0];
    const isGroup = from.endsWith('@g.us');
    const chatType = isGroup ? 'Group' : 'Private';
    const sender = msg.pushName || 'Unknown';
    
    // Log all incoming messages
    if (text) {
      logger.info(`📨 [${chatType}] Message from ${sender} (${from}): ${text}`);
    } else {
      logger.info(`📨 [${chatType}] ${messageType} message from ${sender} (${from})`);
    }
    
    // Additional detailed logging for different message types
    if (msg.message.imageMessage) {
      logger.info(`🖼️  Image received - Caption: ${msg.message.imageMessage.caption || 'No caption'}`);
    } else if (msg.message.videoMessage) {
      logger.info(`🎥 Video received - Caption: ${msg.message.videoMessage.caption || 'No caption'}`);
    } else if (msg.message.audioMessage) {
      logger.info(`🎵 Audio message received`);
    } else if (msg.message.documentMessage) {
      logger.info(`📄 Document received: ${msg.message.documentMessage.fileName || 'Unknown file'}`);
    } else if (msg.message.stickerMessage) {
      logger.info(`😀 Sticker received`);
    }
    
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
  }
};
