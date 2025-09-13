const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const NotificationService = require('./notificationService');

class MessageCurator {
  constructor(sock = null) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    // Your taste profile - customize this based on your preferences
    this.taste = {
      i_like: [
        "startups",
        "venture capital",
        "latam startups",
        "hardware design",
        "engineering",
        "technical integrations",
        "AI",
        "San Francisco"
      ],
      i_dislike: [
        "gossip", 
        "the kardashians", 
        "fake news",
        "spam messages",
        "irrelevant chatter",
        "irrelevant jokes",
        "pickles",
        "recipes with pickles"
      ],
      strong_signals: [
        "funding round", "seed funding", "series A", "series B", "venture capital", "VC",
        "startup", "entrepreneur", "founder", "co-founder", "pitch deck", "demo day",
        "Y Combinator", "YC", "accelerator", "incubator", "unicorn", "valuation",
        "product launch", "MVP", "minimum viable product", "go-to-market", "GTM",
        "hardware", "PCB", "circuit design", "embedded systems", "IoT", "sensors",
        "engineering", "software engineering", "full-stack", "backend", "frontend",
        "API integration", "microservices", "cloud architecture", "DevOps", "CI/CD",
        "artificial intelligence", "machine learning", "ML", "deep learning", "neural networks",
        "LLM", "GPT", "OpenAI", "generative AI", "computer vision", "NLP",
        "San Francisco", "SF", "Silicon Valley", "Bay Area", "SOMA", "Mission",
        "LatAm", "Latin America", "Mexico", "Brazil", "Argentina", "Colombia", "Venezuela",
        "tech hub", "innovation", "disruption", "scalability", "growth hacking",
        "product-market fit", "PMF", "user acquisition", "retention", "churn",
        "B2B", "B2C", "SaaS", "platform", "marketplace", "fintech", "edtech"
      ],
      how_to_decide: "Rank highest the messages that are recent, specific, and actionable, especially about startups, venture capital (funding rounds, investors), LatAm tech, hardware/engineering, technical integrations, and AI—prefer those with concrete numbers (round size, valuation, dates, addresses), named people/companies, or San Francisco/Bay Area context. Down-rank anything that is gossip, Kardashians, fake news, spam, irrelevant chatter/jokes, or about pickles/recipes. Break ties by: (1) clearer details and direct next steps, (2) credibility of the source (known founder/investor/engineer > anonymous), (3) geographic relevance (SF/Bay Area or LatAm > elsewhere), and (4) novelty/diversity (avoid near-duplicates). If two items are similar, keep the one with more verifiable data and stronger strong-signal terms (e.g., funding round, YC, API integration)"
    };
    
    this.relevantMessagesPath = path.join(__dirname, 'relevant_messages.json');
    console.log('🔧 [DEBUG] Relevant messages path set to:', this.relevantMessagesPath);
    
    // Initialize notification service if socket is provided
    this.notificationService = sock ? new NotificationService(sock) : null;
  }

  // Convert scraped messages format to simple format for curation
  formatMessagesForCuration(scrapedData) {
    console.log('🔧 [DEBUG] formatMessagesForCuration called with data keys:', Object.keys(scrapedData));
    const messages = [];
    
    if (!scrapedData.messages) {
      console.log('🔧 [DEBUG] No messages found in scraped data');
      return messages;
    }
    
    console.log('🔧 [DEBUG] Found message groups:', Object.keys(scrapedData.messages));
    
    Object.keys(scrapedData.messages).forEach(groupId => {
      const groupMessages = scrapedData.messages[groupId];
      console.log(`🔧 [DEBUG] Processing group ${groupId} with ${groupMessages.length} messages`);
      
      // Get group name from stats
      const groupName = scrapedData.stats?.groupStats?.[groupId]?.groupName || 'Unknown Group';
      
      groupMessages.forEach(msg => {
        // Only include unprocessed messages
        if (!msg.metadata.processed) {
          messages.push({
            id: msg.id,
            text: msg.content.text || '',
            ts: new Date(msg.timestamp * 1000).toISOString(),
            author: msg.sender.name || 'Unknown',
            groupId: groupId,
            groupName: groupName,
            messageType: msg.content.type
          });
        }
      });
    });
    
    console.log(`🔧 [DEBUG] Formatted ${messages.length} unprocessed messages for curation`);
    return messages;
  }

  // Main function to process scraped messages
  async processScrapedMessages(scrapedMessagesPath) {
    console.log(`🔧 [DEBUG] processScrapedMessages called with path: ${scrapedMessagesPath}`);
    
    try {
      // Read scraped messages
      console.log('🔧 [DEBUG] Reading scraped messages file...');
      const scrapedData = JSON.parse(
        await fs.promises.readFile(scrapedMessagesPath, 'utf8')
      );
      console.log('🔧 [DEBUG] Successfully read scraped messages file');
      console.log('🔧 [DEBUG] Scraped data structure:', {
        hasMessages: !!scrapedData.messages,
        messageGroupCount: scrapedData.messages ? Object.keys(scrapedData.messages).length : 0,
        lastUpdated: scrapedData.lastUpdated
      });

      // Format for curation (only unprocessed messages)
      console.log('🔧 [DEBUG] Formatting unprocessed messages for curation...');
      const messages = this.formatMessagesForCuration(scrapedData);
      
      if (messages.length === 0) {
        console.log('📭 [DEBUG] No unprocessed messages to curate');
        return { processedMessageIds: [] };
      }

      console.log(`🔍 [DEBUG] Curating ${messages.length} unprocessed messages with OpenAI...`);
      
      // Curate with OpenAI
      const curatedItems = await this.curate(messages, 5);
      console.log(`🔧 [DEBUG] Curation completed, received ${curatedItems.length} curated items`);
      
      // Save results
      console.log('🔧 [DEBUG] Saving curated results...');
      const result = await this.saveCuratedMessages(curatedItems, messages);
      
      // Return processed message IDs
      const processedMessageIds = messages.map(m => m.id);
      console.log(`🔧 [DEBUG] Process completed successfully, processed ${processedMessageIds.length} messages`);
      
      return { ...result, processedMessageIds };
    } catch (error) {
      console.error('🔧 [DEBUG] Error processing scraped messages:', error);
      console.error('🔧 [DEBUG] Error stack:', error.stack);
      throw error;
    }
  }

  // Main curation function using OpenAI
  async curate(messages, topK = 5) {
    console.log(`🔧 [DEBUG] curate called with ${messages.length} messages, topK=${topK}`);
    
    if (!messages || messages.length === 0) {
      console.log('🔧 [DEBUG] No messages to curate, returning empty array');
      return [];
    }

    // Limit message text length to avoid token limits
    const trimmed = messages.map(m => ({
      id: m.id,
      ts: m.ts,
      author: m.author,
      groupId: m.groupId,
      text: (m.text || "").slice(0, 500),
      messageType: m.messageType
    }));
    
    console.log(`🔧 [DEBUG] Trimmed messages for API call, sample message:`, trimmed[0]);

    const system = `You rank WhatsApp messages for a user based on their taste profile. Read the user's preferences and the messages carefully.

The user’s interests include: startups, venture capital (funding rounds, investors, accelerators like Y Combinator), LatAm startups and tech hubs, hardware design and engineering (PCBs, embedded systems, IoT), technical integrations (APIs, CI/CD, DevOps), artificial intelligence (LLMs, GPT, ML, generative AI), and San Francisco/Bay Area ecosystem.

The user dislikes: gossip, Kardashians, fake news, spam, irrelevant chatter or jokes, and anything about pickles or pickle recipes.

Strong signals of relevance include terms like: funding round, seed/Series A/B, venture capital, founder, demo day, accelerator, unicorn, valuation, product launch, MVP, go-to-market, API integration, hardware/PCB/IoT, engineering, DevOps, AI/LLM/ML, San Francisco, Silicon Valley, Bay Area, LatAm countries, innovation, scalability, growth hacking, product-market fit, SaaS, fintech, edtech.

Decide which ${topK} messages are most relevant and valuable. Be strict: avoid generic, off-topic, low-value, or motivational-only content. 

Prioritize:
- Recent, specific, actionable content  
- Concrete numbers (e.g., funding amounts, valuations, dates, addresses)  
- Named people, companies, or events  
- Geographic context in SF/Bay Area or Latin America  

Break ties by preferring (1) clearer and more detailed messages, (2) credible sources (founders, investors, engineers over anonymous chatter), (3) geographic relevance (SF/Bay Area, LatAm), and (4) novelty/diversity (avoid near-duplicates).

Return JSON ONLY with: 
{
  items: [
    {id, include, relevance, category, reason}
  ]
}
- relevance: number 0..1 (1 = most relevant)  
- category: short label (e.g., "startup", "venture-capital", "latam", "hardware", "engineering", "AI", "SF", "real-estate", "opportunity", "other")  
- include: true for exactly the top ${topK} most relevant messages, false for the rest  
- reason: a brief explanation of why this message is relevant or not relevant`;

    const user = `TASTE PROFILE:\n${JSON.stringify(this.taste, null, 2)}\n\nMESSAGES TO RANK:\n` +
      trimmed.map(m => `- id:${m.id} | ts:${m.ts} | author:${m.author} | group:${m.groupId} | text:${m.text}`).join("\n");

    console.log('🔧 [DEBUG] Preparing OpenAI API call...');
    console.log('🔧 [DEBUG] System prompt length:', system.length);
    console.log('🔧 [DEBUG] User prompt length:', user.length);

    try {
      console.log('🔧 [DEBUG] Making OpenAI API call...');
      const resp = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3 // Lower temperature for more consistent results
      });

      console.log('🔧 [DEBUG] OpenAI API call successful');
      console.log('🔧 [DEBUG] Response usage:', resp.usage);
      console.log('🔧 [DEBUG] Raw response content:', resp.choices[0].message.content);

      const json = JSON.parse(resp.choices[0].message.content);
      console.log(`🔧 [DEBUG] Parsed JSON with ${json.items?.length || 0} items`);
      
      if (json.items) {
        const includedCount = json.items.filter(item => item.include).length;
        console.log(`🔧 [DEBUG] ${includedCount} messages marked for inclusion`);
      }
      
      return json.items || [];
    } catch (error) {
      console.error('🔧 [DEBUG] Error during OpenAI curation:', error);
      console.error('🔧 [DEBUG] Error details:', {
        message: error.message,
        status: error.status,
        type: error.type
      });
      return [];
    }
  }

  // Save curated results to relevant_messages.json
  async saveCuratedMessages(curatedItems, originalMessages) {
    console.log(`🔧 [DEBUG] saveCuratedMessages called with ${curatedItems.length} curated items and ${originalMessages.length} original messages`);
    
    // Read existing relevant messages if file exists
    let existingData = {
      messages: []
    };
    
    try {
      const existingContent = await fs.promises.readFile(this.relevantMessagesPath, 'utf8');
      existingData = JSON.parse(existingContent);
      console.log(`🔧 [DEBUG] Found ${existingData.messages?.length || 0} existing relevant messages`);
    } catch (error) {
      console.log('🔧 [DEBUG] No existing relevant_messages.json found, starting fresh');
    }
    
    // Get new relevant messages from current curation
    const newRelevantMessages = [];
    curatedItems.forEach(item => {
      const originalMsg = originalMessages.find(m => m.id === item.id);
      if (originalMsg && item.include) {
        console.log(`🔧 [DEBUG] Including message ${item.id} with relevance ${item.relevance} in category ${item.category}`);
        newRelevantMessages.push({
          ...originalMsg,
          curation: {
            relevance: item.relevance,
            category: item.category,
            reason: item.reason,
            curatedAt: new Date().toISOString()
          },
          notified: false // 🆕 Track notification status
        });
      }
    });
    
    // Combine existing and new messages, avoiding duplicates
    const existingIds = new Set((existingData.messages || []).map(m => m.id));
    const uniqueNewMessages = newRelevantMessages.filter(msg => !existingIds.has(msg.id));
    
    const allMessages = [...(existingData.messages || []), ...uniqueNewMessages];
    
    // Sort all messages by relevance (highest first)
    allMessages.sort((a, b) => b.curation.relevance - a.curation.relevance);
    console.log('🔧 [DEBUG] Messages sorted by relevance (highest first)');
    console.log(`🔧 [DEBUG] Added ${uniqueNewMessages.length} new relevant messages, total now: ${allMessages.length}`);
    
    const relevantMessages = {
      lastUpdated: new Date().toISOString(),
      curatedBy: "openai-gpt-4o-mini",
      totalEvaluated: originalMessages.length,
      totalRelevant: newRelevantMessages.length,
      totalMessages: allMessages.length,
      messages: allMessages
    };

    try {
      console.log(`🔧 [DEBUG] Writing curated messages to file: ${this.relevantMessagesPath}`);
      await fs.promises.writeFile(
        this.relevantMessagesPath, 
        JSON.stringify(relevantMessages, null, 2),
        'utf8'
      );
      console.log(`✅ [DEBUG] Successfully saved ${uniqueNewMessages.length} new relevant messages (${allMessages.length} total) to relevant_messages.json`);
      
      // 🆕 Send notifications for new messages
      if (this.notificationService && uniqueNewMessages.length > 0) {
        console.log(`📤 Sending notifications for ${uniqueNewMessages.length} new messages`);
        const notificationResults = await this.notificationService.sendNotifications(uniqueNewMessages);
        
        // Update notified status for successfully sent messages
        const successfulNotifications = notificationResults.filter(r => r.success);
        if (successfulNotifications.length > 0) {
          await this.updateNotificationStatus(successfulNotifications.map(r => r.messageId));
        }
      }
      
      console.log('🔧 [DEBUG] File write completed successfully');
      return relevantMessages;
    } catch (error) {
      console.error('🔧 [DEBUG] Error saving curated messages:', error);
      throw error;
    }
  }
  
  /**
   * Update notification status for messages
   */
  async updateNotificationStatus(messageIds) {
    try {
      const data = JSON.parse(await fs.promises.readFile(this.relevantMessagesPath, 'utf8'));
      
      data.messages.forEach(message => {
        if (messageIds.includes(message.id)) {
          message.notified = true;
          message.notifiedAt = new Date().toISOString();
        }
      });
      
      await fs.promises.writeFile(
        this.relevantMessagesPath,
        JSON.stringify(data, null, 2),
        'utf8'
      );
      
      console.log(`✅ Updated notification status for ${messageIds.length} messages`);
    } catch (error) {
      console.error('❌ Error updating notification status:', error);
    }
  }
}

module.exports = MessageCurator;