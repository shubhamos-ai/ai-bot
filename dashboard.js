/**
 * Minecraft Bot Dashboard
 * Provides a web interface to monitor bot status, voice channels, and player commands
 */

const { MongoClient } = require('mongodb');

// MongoDB connection
let dbClient = null;
let db = null;

// Maintain a reference to the WebSocket server
let wss = null;

// Maintain a chat history buffer
const chatHistory = [];
const MAX_CHAT_HISTORY = 100;

// Track voice channels and players
const voiceChannels = {
    "1179321724785922088": { id: "1179321724785922088", name: "VC-1", label: "VC-1", players: [], commandChannelId: "1359964669363617943" },
    "1182188218716790885": { id: "1182188218716790885", name: "VC-2", label: "VC-2", players: [], commandChannelId: "1359964697352343804" },
    "1182188286232510605": { id: "1182188286232510605", name: "VC-3", label: "VC-3", players: [], commandChannelId: "1359964716541149184" }
};

// Track bot state for broadcasting
const botState = {
    connected: false,
    username: '',
    health: 0,
    food: 0,
    position: { x: 0, y: 0, z: 0 },
    inventory: [],
    nearbyPlayers: [],
    chatHistory: [],
    voiceChannels: voiceChannels,
    devilPlsCommands: {},
    lastUpdated: null
};

/**
 * Broadcast the current bot state to all connected WebSocket clients
 * @param {WebSocket|null} ws - Optional specific client to send to, if null sends to all
 */
function broadcastState(ws = null) {
    if (!wss) return;
    
    // Update timestamps
    botState.lastUpdated = Date.now();
    
    const stateMessage = JSON.stringify({
        type: 'state',
        data: botState
    });
    
    if (ws && ws.readyState === 1) { // WebSocket.OPEN
        // Send to specific client
        ws.send(stateMessage);
    } else {
        // Broadcast to all clients
        wss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(stateMessage);
            }
        });
    }
}

/**
 * Update the bot state from the Minecraft bot
 * @param {Object} bot - Minecraft bot instance
 */
function updateBotState() {
    const bot = global.minecraftBot;
    if (!bot || !bot.entity) {
        botState.connected = false;
        return;
    }
    
    botState.connected = true;
    botState.username = bot.username;
    botState.health = bot.health || 0;
    botState.food = bot.food || 0;
    
    if (bot.entity) {
        botState.position = {
            x: Math.round(bot.entity.position.x * 100) / 100,
            y: Math.round(bot.entity.position.y * 100) / 100,
            z: Math.round(bot.entity.position.z * 100) / 100
        };
    }
    
    // Update inventory
    if (bot.inventory && bot.inventory.slots) {
        botState.inventory = bot.inventory.slots
            .filter(item => item !== null)
            .map(item => ({
                name: item.name,
                displayName: item.displayName,
                count: item.count,
                slot: item.slot,
                type: item.type
            }));
    }
    
    // Update nearby players
    if (bot.players) {
        botState.nearbyPlayers = Object.values(bot.players)
            .filter(player => player.entity && player.username !== bot.username)
            .map(player => ({
                username: player.username,
                position: player.entity ? {
                    x: Math.round(player.entity.position.x * 100) / 100,
                    y: Math.round(player.entity.position.y * 100) / 100,
                    z: Math.round(player.entity.position.z * 100) / 100
                } : null,
                distance: player.entity ? 
                    Math.round(Math.sqrt(
                        Math.pow(player.entity.position.x - bot.entity.position.x, 2) +
                        Math.pow(player.entity.position.y - bot.entity.position.y, 2) +
                        Math.pow(player.entity.position.z - bot.entity.position.z, 2)
                    ) * 10) / 10 : null
            }));
    }
    
    // Update chat history
    botState.chatHistory = [...chatHistory];
}

/**
 * Initialize MongoDB connection
 */
async function initializeMongoDB() {
    try {
        // Connect to MongoDB
        dbClient = new MongoClient('mongodb+srv://Subbu:Sanchiirao2010@san-mod.ocfuqyn.mongodb.net/?retryWrites=true&w=majority&appName=san-mod');
        await dbClient.connect();
        db = dbClient.db('minecraft_discord_bot');
        console.log('[Dashboard] 🔌 Connected to MongoDB');
        return true;
    } catch (err) {
        console.error('[Dashboard] ❌ Error connecting to MongoDB:', err);
        return false;
    }
}

/**
 * Fetch voice channel data from MongoDB
 */
async function fetchVoiceChannelData() {
    if (!db) return;

    try {
        // Get the voice_channels collection
        const voiceChannelsCollection = db.collection('voice_channels');
        
        // Reset all players in voice channels
        Object.values(voiceChannels).forEach(channel => {
            channel.players = [];
        });
        
        // Find all active voice channel records
        const records = await voiceChannelsCollection.find({}).sort({ timestamp: -1 }).toArray();
        
        // Process records to update our voiceChannels object
        const processedPlayers = new Set();
        
        for (const record of records) {
            const { discordId, minecraftUsername, voiceChannelId } = record;
            
            // Skip if we've already processed this player (take only the most recent record)
            if (processedPlayers.has(discordId)) continue;
            processedPlayers.add(discordId);
            
            // Skip if no channel ID or missing data
            if (!voiceChannelId || !discordId || !minecraftUsername) continue;
            
            // Skip if the channel isn't in our tracked channels
            if (!voiceChannels[voiceChannelId]) continue;
            
            // Get player avatar from Discord
            const avatarUrl = await getDiscordAvatar(discordId);
            
            console.log(`[Dashboard] Adding player ${minecraftUsername} to channel ${voiceChannelId} with avatar: ${avatarUrl}`);
            
            // Add player to the appropriate channel
            voiceChannels[voiceChannelId].players.push({
                discordId,
                minecraftUsername,
                avatar: avatarUrl, 
                username: minecraftUsername // Add username field for display consistency
            });
        }
        
        // Update the botState
        botState.voiceChannels = { ...voiceChannels };
        
    } catch (err) {
        console.error('[Dashboard] ❌ Error fetching voice channel data:', err);
    }
}

/**
 * Get Discord user avatar URL
 */
async function getDiscordAvatar(discordId) {
    // Get from Discord bot if available
    const discordBot = global.discordBot;
    if (discordBot && discordBot.client) {
        try {
            const user = await discordBot.client.users.fetch(discordId);
            if (user) {
                // User was found
                if (user.avatar) {
                    // User has a custom avatar
                    const avatarUrl = `https://cdn.discordapp.com/avatars/${discordId}/${user.avatar}.png?size=128`;
                    console.log(`[Dashboard] Successfully fetched avatar for ${discordId}: ${avatarUrl}`);
                    return avatarUrl;
                } else {
                    // Use default Discord avatar (based on discriminator or id)
                    let discriminator = 0;
                    if (user.discriminator) {
                        discriminator = parseInt(user.discriminator) % 5;
                    } else {
                        // For newer Discord users without discriminators
                        discriminator = parseInt(discordId.slice(-1)) % 5;
                    }
                    
                    const defaultDiscordAvatar = `https://cdn.discordapp.com/embed/avatars/${discriminator}.png`;
                    console.log(`[Dashboard] Using default Discord avatar for ${discordId}: ${defaultDiscordAvatar}`);
                    return defaultDiscordAvatar;
                }
            }
        } catch (err) {
            console.error(`[Dashboard] Could not fetch avatar for ${discordId}:`, err);
            return '/images/default-avatar.svg';
        }
    }
    console.log(`[Dashboard] Discord bot not available, using default avatar`);
    return '/images/default-avatar.svg';
}

/**
 * Fetch latest "devil pls" commands for each player
 */
async function fetchDevilPlsCommands() {
    if (!db) return;
    
    try {
        // Get collections
        const messagesCollection = db.collection('voice_channel_messages');
        
        // Find all players who have records in voice_channels
        const voiceChannelsCollection = db.collection('voice_channels');
        const players = await voiceChannelsCollection.distinct('discordId');
        
        const playerCommands = {};
        
        for (const discordId of players) {
            // Get latest 5 "devil pls" messages for this player
            const messages = await messagesCollection.find({
                discordId,
                message: { $regex: 'devil pls', $options: 'i' }
            })
            .sort({ timestamp: -1 })
            .limit(5)
            .toArray();
            
            if (messages.length > 0) {
                // Get minecraftUsername from the first message
                const minecraftUsername = messages[0].minecraftUsername;
                
                // Process the commands to extract just the subcommand part
                const processedCommands = messages.map(m => {
                    const fullMessage = m.message;
                    // Extract the subcommand part after "devil pls"
                    let subcommand = "";
                    
                    if (fullMessage) {
                        const match = fullMessage.match(/devil\s+pls\s+(.*)/i);
                        if (match && match[1]) {
                            subcommand = match[1].trim();
                        } else {
                            subcommand = "No subcommand";
                        }
                    }
                    
                    console.log(`[Dashboard] Processed command: "${fullMessage}" -> Subcommand: "${subcommand}"`);
                    
                    return {
                        fullMessage: m.message,
                        subcommand: subcommand,
                        timestamp: m.timestamp
                    };
                });
                
                playerCommands[discordId] = {
                    discordId,
                    minecraftUsername,
                    commands: processedCommands
                };
            }
        }
        
        botState.devilPlsCommands = playerCommands;
        
    } catch (err) {
        console.error('[Dashboard] ❌ Error fetching devil pls commands:', err);
    }
}

/**
 * Set up the bot state update interval and message hooks
 * @param {Object} bot - Minecraft bot instance
 * @param {WebSocketServer} websocketServer - WebSocket server for broadcasting
 */
async function setupDashboard(bot, websocketServer) {
    // Store reference to WebSocket server
    wss = websocketServer;
    
    // Initialize MongoDB
    await initializeMongoDB();
    
    // Set up bot message hook
    setupBotMessageHook(bot);
    
    // Fetch initial data
    await fetchVoiceChannelData();
    await fetchDevilPlsCommands();
    
    // Perform initial state update
    updateBotState();
    broadcastState();
    
    // Set up state update interval (3 seconds)
    setInterval(async () => {
        // Clear player arrays in voice channels
        Object.values(voiceChannels).forEach(channel => {
            channel.players = [];
        });
        
        // Fetch fresh data
        await fetchVoiceChannelData();
        await fetchDevilPlsCommands();
        
        // Update and broadcast
        updateBotState();
        broadcastState();
    }, 3000);
    
    console.log('[Dashboard] 📊 Dashboard set up successfully');
}

/**
 * Set up hooks to capture Minecraft bot messages for the dashboard
 * @param {Object} bot - Minecraft bot instance
 */
function setupBotMessageHook(bot) {
    if (!bot) return;
    
    // Listen for Minecraft chat messages
    bot.on('message', (message) => {
        const messageStr = message.toString();
        const timestamp = Date.now();
        
        // Determine sender type and extract username if it's not a system message
        let sender = 'SERVER';
        let content = messageStr;
        
        // Extract username from chat message if it exists
        const usernameMatch = messageStr.match(/^<([^>]+)> (.+)$/);
        if (usernameMatch) {
            sender = usernameMatch[1];
            content = usernameMatch[2];
        }
        
        // Add to chat history
        addChatMessage(sender, content, timestamp);
    });
    
    // Listen for bot health changes
    bot.on('health', () => {
        updateBotState();
        broadcastState();
    });
    
    // Listen for bot spawn events
    bot.on('spawn', () => {
        addSystemMessage('Bot has spawned in the world');
        updateBotState();
        broadcastState();
    });
    
    // Listen for bot death events
    bot.on('death', () => {
        addSystemMessage('Bot has died');
        updateBotState();
        broadcastState();
    });
    
    // Listen for player join events
    bot.on('playerJoined', (player) => {
        addSystemMessage(`Player ${player.username} joined the game`);
        updateBotState();
        broadcastState();
    });
    
    // Listen for player leave events
    bot.on('playerLeft', (player) => {
        addSystemMessage(`Player ${player.username} left the game`);
        updateBotState();
        broadcastState();
    });
    
    // Listen for inventory changes
    bot.inventory.on('updateSlot', () => {
        updateBotState();
        broadcastState();
    });
}

/**
 * Add a system message to chat history
 * @param {string} message - The system message content
 */
function addSystemMessage(message) {
    addChatMessage('SYSTEM', message, Date.now());
}

/**
 * Add a chat message to history
 * @param {string} sender - The message sender
 * @param {string} message - The message content
 * @param {number} timestamp - The message timestamp
 */
function addChatMessage(sender, message, timestamp) {
    // Add to history buffer
    chatHistory.push({
        sender,
        message,
        timestamp
    });
    
    // Trim history if needed
    if (chatHistory.length > MAX_CHAT_HISTORY) {
        chatHistory.shift(); // Remove oldest message
    }
    
    // Update bot state with new chat history
    botState.chatHistory = [...chatHistory];
    
    // Broadcast updated state
    broadcastState();
}

module.exports = {
    setupDashboard,
    broadcastState,
    updateBotState,
    addSystemMessage,
    addChatMessage
};