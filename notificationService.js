const fs = require('fs').promises;
const path = require('path');

class NotificationService {
  constructor(sock) {
    this.sock = sock;
    this.notificationNumber = process.env.NOTIFICATION_NUMBER;
    
    if (!this.notificationNumber) {
      console.warn('⚠️ NOTIFICATION_NUMBER not set in environment variables');
    }
  }

  /**
   * Format a curated message for notification
   */
  formatNotificationMessage(message) {
    const { author, groupName, text, curation } = message;
    const { relevance, category, reason } = curation;
    
    // Create a brief title/summary from the text (first 50 chars)
    const summary = text.length > 50 ? text.substring(0, 50) + '...' : text;
    
    return `🔥 *New Relevant Message*\n\n` +
           `👤 *From:* ${author}\n` +
           `💬 *Group:* ${groupName}\n` +
           `📝 *Summary:* ${summary}\n` +
           `⭐ *Relevance:* ${relevance}/1.0\n` +
           `🏷️ *Category:* ${category}\n` +
           `💡 *Why relevant:* ${reason}\n\n` +
           `📄 *Full message:* ${text}`;
  }

  /**
   * Send notification for a curated message
   */
  async sendNotification(message) {
    if (!this.notificationNumber) {
      console.log('📵 Notification number not configured, skipping notification');
      return false;
    }

    if (!this.sock) {
      console.error('❌ WhatsApp socket not available for notifications');
      return false;
    }

    try {
      const formattedMessage = this.formatNotificationMessage(message);
      const jid = this.notificationNumber.includes('@') ? 
                  this.notificationNumber : 
                  `${this.notificationNumber}@s.whatsapp.net`;
      
      console.log(`📤 Sending notification for message ${message.id} to ${jid}`);
      
      await this.sock.sendMessage(jid, { 
        text: formattedMessage 
      });
      
      console.log(`✅ Notification sent successfully for message ${message.id}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to send notification for message ${message.id}:`, error);
      return false;
    }
  }

  /**
   * Send notifications for multiple messages
   */
  async sendNotifications(messages) {
    const results = [];
    
    for (const message of messages) {
      const success = await this.sendNotification(message);
      results.push({ messageId: message.id, success });
      
      // Add delay between messages to avoid rate limiting
      if (messages.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    return results;
  }
}

module.exports = NotificationService;