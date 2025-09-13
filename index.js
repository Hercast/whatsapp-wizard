
require('dotenv').config();

/**
 * WhatsApp Bot Entry Point
 * Loads config, commands, events, and starts the bot.
 */
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const config = require("./utils");

// Logging via pino
const logDir = path.join(__dirname, "logs");
if (!fs.existsSync(logDir)) { fs.mkdirSync(logDir); }
const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.log`);

const logger = pino(
  {
    level: config.logging?.level || "info",
    transport: { target: "pino-pretty" }
  },
  pino.destination(logFile)
);

/**
 * Loads all command modules from the commands directory.
 * @returns {Map}
 */
const commands = new Map();
fs.readdirSync("./commands").forEach((file) => {
  const cmd = require(`./commands/${file}`);
  commands.set(cmd.name, cmd);
});

/**
 * Loads all event handler modules from the events directory.
 * @returns {Array}
 */
const eventFiles = fs.readdirSync("./events").filter((f) => f.endsWith(".js"));
const eventHandlers = [];
for (const file of eventFiles) {
  const eventModule = require(`./events/${file}`);
  if (eventModule.eventName && typeof eventModule.handler === "function") {
    eventHandlers.push(eventModule);
  }
}

/**
 * Starts the WhatsApp bot and registers event handlers.
 */
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`Using Baileys v${version.join(".")}, Latest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ["ElChismoso", "Opera GX", "120.0.5543.204"],
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: config.bot?.online || true,
    syncFullHistory: config.bot?.history || false,
    shouldSyncHistoryMessage: config.bot?.history || false,
  });

  // Save login credentials on update
  sock.ev.on("creds.update", saveCreds);

  // Register all event handlers
  for (const { eventName, handler } of eventHandlers) {
    // Pass only the dependencies that the handler expects
    if (eventName === "connection.update") {
      sock.ev.on(eventName, handler(sock, logger, saveCreds, startBot));
    } else if (eventName === "messages.upsert") {
      sock.ev.on(eventName, handler(sock, logger, commands));
    } else {
      // For future extensibility, just pass sock and logger
      sock.ev.on(eventName, handler(sock, logger));
    }
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  try {
    // Save scraped messages before exit
    const messagesHandler = require('./events/messages.upsert.js');
    const messageStorage = messagesHandler.getMessageStorage();
    await messageStorage.save();
    console.log('💾 Messages saved successfully');
  } catch (error) {
    console.error('Error saving messages on shutdown:', error);
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  
  try {
    const messagesHandler = require('./events/messages.upsert.js');
    const messageStorage = messagesHandler.getMessageStorage();
    await messageStorage.save();
    console.log('💾 Messages saved successfully');
  } catch (error) {
    console.error('Error saving messages on shutdown:', error);
  }
  
  process.exit(0);
});

console.log('🤖 WhatsApp Wizard is running...');

startBot();
