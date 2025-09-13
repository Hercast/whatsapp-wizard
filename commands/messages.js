const messagesHandler = require('../events/messages.upsert.js');

module.exports = {
  name: 'messages',
  description: 'Manage scraped messages',
  execute: async (sock, from, args) => {
    const messageStorage = messagesHandler.getMessageStorage();
    const subCommand = args[0]?.toLowerCase();
    
    switch (subCommand) {
      case 'stats':
        const stats = messageStorage.getStats();
        const response = `📊 **Message Statistics**\n\n` +
          `Total Groups: ${stats.totalGroups}\n` +
          `Total Messages: ${stats.totalMessages}\n\n` +
          `**Per Group:**\n` +
          Object.entries(stats.groupStats)
            .map(([groupId, data]) => `• ${groupId.split('@')[0]}: ${data.messageCount} messages`)
            .join('\n');
        
        await sock.sendMessage(from, { text: response });
        break;
        
      case 'save':
        await messageStorage.save();
        await sock.sendMessage(from, { text: '💾 Messages saved successfully!' });
        break;
        
      case 'clear':
        const groupId = args[1];
        if (groupId) {
          messageStorage.clearGroup(groupId);
          await sock.sendMessage(from, { text: `🗑️ Cleared messages for group: ${groupId}` });
        } else {
          await sock.sendMessage(from, { text: '❌ Please specify a group ID to clear' });
        }
        break;
        
      case 'export':
        const allMessages = messageStorage.getAllMessages();
        const exportData = {
          exportedAt: new Date().toISOString(),
          totalMessages: Object.values(allMessages).reduce((sum, msgs) => sum + msgs.length, 0),
          messages: allMessages
        };
        
        // In a real implementation, you might want to send this as a file
        await sock.sendMessage(from, { 
          text: `📤 **Export Ready**\n\nTotal messages: ${exportData.totalMessages}\nGroups: ${Object.keys(allMessages).length}\n\n_Use this data for LLM processing_` 
        });
        break;
        
      default:
        await sock.sendMessage(from, { 
          text: `📋 **Message Management Commands:**\n\n` +
                `• !messages stats - View statistics\n` +
                `• !messages save - Manual save\n` +
                `• !messages clear <groupId> - Clear group messages\n` +
                `• !messages export - Export for LLM processing`
        });
    }
  }
};