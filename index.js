/**
 * Minecraft Anti-AFK Bot with Discord Integration
 * Main entry point that initializes both the Minecraft and Discord bots
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const bodyParser = require('body-parser');

const { startMinecraftBot } = require('./minecraft-bot');
const { startDiscordBot } = require('./discord-bot');
const { ensureDataFolderExists } = require('./mongodb-manager');
const { initializeDatabase, closeDatabase, COLLECTIONS } = require('./db-manager');
const { setupDashboard, broadcastState } = require('./dashboard');
const { router: botApiRouter, processSpecialCommand } = require('./bot-api');

// Constants
const MINECRAFT_SERVER = 'devilkings.sdlf.fun';
const MINECRAFT_USERNAME = 'SHUBHAMOS';
const DISCORD_TOKEN = '[REDACTED_MATRIX_TOKEN]';
const PORT = process.env.PORT || 5000;

// Track bot instances
let discordBot = null;
let minecraftBot = null;
let database = null;
let webServer = null;
let wss = null;

// Flag to prevent multiple initialization attempts
let minecraftBotStarting = false;

// Store references to global functions that may be needed across modules
global.kickPlayerWithMessage = null; // Will be set when Minecraft bot loads

/**
 * Initialize the bots
 */
async function initializeBots() {
    try {
        console.log('[System] 🚀 Initializing bots...');
        
        // Ensure data directory exists (still useful for backward compatibility)
        await ensureDataFolderExists();
        
        // Initialize MongoDB connection
        try {
            database = await initializeDatabase();
            console.log('[System] 🔌 MongoDB connection established');
            
            // Clear all data from MongoDB on startup as requested
            try {
                const { clearAllData } = require('./db-manager');
                await clearAllData();
                console.log('[System] 🧹 Cleared all data from MongoDB on startup');
            } catch (clearErr) {
                console.error('[System] ❌ Error clearing MongoDB data on startup:', clearErr);
            }
        } catch (dbError) {
            console.error('[System] ❌ Error connecting to MongoDB:', dbError);
            console.log('[System] 📁 Continuing with file-based storage as fallback');
        }
        
        // Store the database connection in global for access across modules
        global.database = database;
        
        // Start the Discord bot if not already started
        if (!discordBot) {
            console.log('[System] 🤖 Starting Discord bot...');
            discordBot = startDiscordBot(DISCORD_TOKEN);
            
            // Handle Discord ready event
            discordBot.on('ready', async () => {
                console.log(`[Discord] ✅ Bot logged in as ${discordBot.user.tag}`);
                
                // Start Minecraft bot if not already starting
                if (!minecraftBotStarting) {
                    startMinecraftBotWithDelay();
                }
            });
            
            // Handle Discord reconnection
            discordBot.on('reconnecting', () => {
                console.log('[Discord] 🔄 Reconnecting...');
            });
            
            discordBot.on('disconnect', () => {
                console.log('[Discord] 🔌 Disconnected. Attempting to reconnect...');
            });
            
            discordBot.on('error', (error) => {
                console.error('[Discord] ❌ Error:', error);
            });
        }
    } catch (error) {
        console.error('[System] ❌ Error during initialization:', error);
        // Retry initialization after a delay
        setTimeout(initializeBots, 60000); // 1 minute
    }
}

/**
 * Start the Minecraft bot with a delay to avoid connection throttling
 */
async function startMinecraftBotWithDelay() {
    try {
        if (minecraftBotStarting) return;
        
        minecraftBotStarting = true;
        
        // Delay Minecraft connection to allow Discord to fully initialize
        console.log('[System] ⏳ Waiting 10 seconds before starting Minecraft bot...');
        
        setTimeout(async () => {
            try {
                console.log('[System] 🎮 Starting Minecraft bot...');
                minecraftBot = await startMinecraftBot(MINECRAFT_SERVER, MINECRAFT_USERNAME, discordBot);
                
                // Store a global reference to the Minecraft bot for notifications
                global.minecraftBot = minecraftBot;
                console.log('[System] 🔄 Stored Minecraft bot in global reference for cross-module access');
                
                // Setup dashboard connection if WebSocket server exists
                if (wss) {
                    setupDashboard(minecraftBot, wss);
                    console.log('[System] 📊 Dashboard connected to Minecraft bot');
                }
                
                minecraftBotStarting = false;
            } catch (error) {
                console.error('[System] ❌ Error starting Minecraft bot:', error);
                minecraftBotStarting = false;
            }
        }, 10000); // 10 seconds delay
    } catch (error) {
        console.error('[System] ❌ Error in startMinecraftBotWithDelay:', error);
        minecraftBotStarting = false;
    }
}

/**
 * Initialize the web server and dashboard
 */
async function initializeWebServer() {
    try {
        console.log('[System] 🌐 Initializing web server...');
        
        // Create Express app
        const app = express();
        
        // Middleware
        app.use(bodyParser.json());
        app.use(bodyParser.urlencoded({ extended: true }));
        
        // Serve static files from 'public' directory
        app.use(express.static(path.join(__dirname, 'public')));
        
        // Use API routes
        app.use('/api', botApiRouter);
        
        // Create HTTP server
        const server = http.createServer(app);
        
        // Create WebSocket server
        wss = new WebSocketServer({ server, path: '/ws' });
        
        // Setup WebSocket connection handling
        wss.on('connection', (ws) => {
            console.log('[WebSocket] 🔌 Client connected');
            
            // Send initial state
            if (global.minecraftBot) {
                broadcastState(ws);
            } else {
                ws.send(JSON.stringify({
                    type: 'state',
                    data: { connected: false }
                }));
            }
            
            // Handle incoming messages
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    
                    if (data.type === 'command') {
                        const { command } = data;
                        
                        // Process the command
                        if (global.minecraftBot) {
                            const specialResult = processSpecialCommand(command);
                            
                            if (!specialResult.processed) {
                                // Send as chat message
                                global.minecraftBot.chat(command);
                            }
                            
                            // Send acknowledgment
                            ws.send(JSON.stringify({
                                type: 'commandAck',
                                success: true,
                                message: specialResult.processed ? specialResult.message : 'Command sent'
                            }));
                        } else {
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: 'Bot is not connected'
                            }));
                        }
                    }
                } catch (err) {
                    console.error('[WebSocket] ❌ Error processing message:', err);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Error processing message'
                    }));
                }
            });
            
            // Handle connection close
            ws.on('close', () => {
                console.log('[WebSocket] 🔌 Client disconnected');
            });
        });
        
        // Start server
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`[System] 🚀 Web server running on port ${PORT}`);
            
            // Setup dashboard if bot is already running
            if (global.minecraftBot) {
                setupDashboard(global.minecraftBot, wss);
            }
        });
        
        // Store server reference
        webServer = server;
        
        return { server, wss };
    } catch (error) {
        console.error('[System] ❌ Error setting up web server:', error);
        throw error;
    }
}

// Initialize the bots and web server
initializeBots().then(() => {
    initializeWebServer().catch(err => {
        console.error('[System] ❌ Failed to initialize web server:', err);
    });
});

// Handle process termination
process.on('SIGINT', async () => {
    console.log('[System] 🛑 Shutting down...');
    
    // Close the web server if it exists
    if (webServer) {
        try {
            webServer.close(() => {
                console.log('[System] 🔌 Web server closed');
            });
        } catch (err) {
            console.error('[System] ❌ Error closing web server:', err);
        }
    }
    
    // Close the MongoDB connection if it exists
    if (database) {
        try {
            await closeDatabase();
            console.log('[System] 🔌 MongoDB connection closed');
        } catch (err) {
            console.error('[System] ❌ Error closing MongoDB connection:', err);
        }
    }
    
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('[System] ⚠️ Uncaught Exception:', err);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('[System] ⚠️ Unhandled Promise Rejection:', reason);
});
