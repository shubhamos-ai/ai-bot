/**
 * MongoDB Database Manager
 * Manages all database interactions for the Minecraft-Discord bot
 */

const { MongoClient } = require('mongodb');

// MongoDB Connection URI
const MONGODB_URI = "mongodb+srv://Subbu:Sanchiirao2010@san-mod.ocfuqyn.mongodb.net/?retryWrites=true&w=majority&appName=san-mod";
const DB_NAME = "minecraft_discord_bot";

// MongoDB connection retry settings
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000; // 2 seconds between retries
const COLLECTIONS = {
    PLAYERS: "players",
    VOICE_CHANNELS: "voice_channels",
    COMMANDS: "commands",
    MESSAGES: "channel_messages",
    CONFIGS: "configurations",
    VOICE_STATUS: "voice_channels" // Use the same collection as VOICE_CHANNELS for compatibility
};

let client = null;
let db = null;

/**
 * Wait for a specified amount of time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Initialize the MongoDB connection with retry logic
 * @returns {Promise<Object>} MongoDB database instance
 */
async function initializeDatabase() {
    let retries = 0;
    let lastError = null;
    
    // Try to connect with retries
    while (retries <= MAX_RETRIES) {
        try {
            console.log(`[MongoDB] Connecting to database (attempt ${retries + 1}/${MAX_RETRIES + 1})...`);
            
            if (client) {
                console.log('[MongoDB] Reusing existing connection');
                return db;
            }

            // Create new client with reduced RAM footprint options
            client = new MongoClient(MONGODB_URI, {
                maxPoolSize: 5, // Limit connection pool size
                minPoolSize: 1,  // Minimum pool size
                maxIdleTimeMS: 30000, // Close idle connections after 30 seconds
                connectTimeoutMS: 5000, // Connection timeout after 5 seconds
                serverSelectionTimeoutMS: 10000 // Server selection timeout after 10 seconds
            });
            
            await client.connect();
            console.log('[MongoDB] Successfully connected to MongoDB');
            
            db = client.db(DB_NAME);
            
            // Create indexes for better performance if they don't exist
            try {
                await db.collection(COLLECTIONS.PLAYERS).createIndex({ discordId: 1 }, { unique: true });
                await db.collection(COLLECTIONS.VOICE_CHANNELS).createIndex({ discordId: 1 });
                await db.collection(COLLECTIONS.VOICE_CHANNELS).createIndex({ channelId: 1 });
                await db.collection(COLLECTIONS.MESSAGES).createIndex({ channelId: 1 });
                await db.collection(COLLECTIONS.MESSAGES).createIndex({ timestamp: 1 });
                console.log('[MongoDB] Indexes created successfully');
            } catch (indexError) {
                console.warn('[MongoDB] Error creating indexes:', indexError);
                // Continue anyway, indexes are just for performance
            }
            
            return db;
        } catch (err) {
            lastError = err;
            retries++;
            
            if (retries <= MAX_RETRIES) {
                // Calculate exponential backoff time
                const backoffTime = RETRY_DELAY_MS * Math.pow(2, retries - 1);
                console.error(`[MongoDB] Connection attempt ${retries}/${MAX_RETRIES + 1} failed: ${err.message}`);
                console.log(`[MongoDB] Retrying in ${backoffTime / 1000} seconds...`);
                await sleep(backoffTime);
            } else {
                console.error('[MongoDB] All connection attempts failed:', err);
                throw err;
            }
        }
    }
    
    throw lastError || new Error('Failed to connect to MongoDB after multiple attempts');
}

/**
 * Get the database instance, initializing if needed, with retry logic for handling connection issues
 * @returns {Promise<Object>} MongoDB database instance
 */
async function getDatabase() {
    try {
        if (!db) {
            return initializeDatabase();
        }
        
        // Check if the connection is still valid with a simple ping operation
        try {
            const adminDb = db.admin();
            await adminDb.ping();
            return db; // Connection is valid
        } catch (pingError) {
            console.warn('[MongoDB] Ping failed, connection might be stale. Reconnecting...', pingError.message);
            // Close the existing client if ping failed
            try {
                if (client) {
                    await client.close().catch(() => {});
                }
            } catch (closeError) {
                console.warn('[MongoDB] Error closing stale connection:', closeError.message);
            }
            
            // Reset client and db
            client = null;
            db = null;
            
            // Try to initialize again
            return initializeDatabase();
        }
    } catch (err) {
        console.error('[MongoDB] Error in getDatabase:', err);
        throw err;
    }
}

/**
 * Close the MongoDB connection
 */
async function closeDatabase() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('[MongoDB] Connection closed');
    }
}

/**
 * Execute a database operation with retry logic
 * @param {function} operation - The database operation to execute
 * @param {string} operationName - Name of the operation for logging
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @returns {Promise<any>} - Result of the operation
 */
async function executeWithRetry(operation, operationName, maxRetries = 3) {
    let lastError = null;
    let retryCount = 0;
    
    while (retryCount <= maxRetries) {
        try {
            return await operation();
        } catch (err) {
            lastError = err;
            retryCount++;
            
            // Check if this is a network-related error that might be recoverable
            const isNetworkError = 
                err.name === 'MongoNetworkError' || 
                err.message.includes('network') ||
                err.message.includes('connection') ||
                err.message.includes('timeout');
                
            if (isNetworkError && retryCount <= maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
                console.warn(`[MongoDB] ${operationName} failed (attempt ${retryCount}/${maxRetries + 1}): ${err.message}`);
                console.log(`[MongoDB] Retrying ${operationName} in ${delay/1000} seconds...`);
                await sleep(delay);
            } else {
                console.error(`[MongoDB] ${operationName} failed after ${retryCount} attempts:`, err);
                throw err;
            }
        }
    }
    
    throw lastError;
}

/**
 * Save or update player data
 * @param {string} discordId - Player's Discord ID
 * @param {string} minecraftUsername - Player's Minecraft username
 */
async function savePlayerData(discordId, minecraftUsername) {
    try {
        // Sanitize inputs to prevent potential issues
        if (!discordId || !minecraftUsername) {
            console.error('[MongoDB] Invalid player data - discordId or minecraftUsername is missing');
            return { error: 'Invalid player data' };
        }
        
        // Enforce string format for IDs (avoid number types causing issues)
        const sanitizedDiscordId = String(discordId).trim();
        const sanitizedUsername = String(minecraftUsername).trim();
        
        // Don't save malformed data
        if (!sanitizedDiscordId || !sanitizedUsername) {
            console.error('[MongoDB] Invalid player data after sanitization');
            return { error: 'Invalid player data after sanitization' };
        }
        
        // Check for duplicate entries with different case
        return await executeWithRetry(async () => {
            const database = await getDatabase();
            const players = database.collection(COLLECTIONS.PLAYERS);
            
            // First check if player already exists with different casing
            const existingPlayer = await players.findOne({ 
                minecraftUsername: { $regex: new RegExp(`^${sanitizedUsername}$`, 'i') }
            });
            
            if (existingPlayer && existingPlayer.discordId !== sanitizedDiscordId) {
                console.log(`[MongoDB] Warning: Minecraft username ${sanitizedUsername} already linked to Discord ID ${existingPlayer.discordId}`);
            }
            
            const timestamp = new Date();
            
            // Update if exists, insert if not (upsert)
            const result = await players.updateOne(
                { discordId: sanitizedDiscordId },
                {
                    $set: {
                        minecraftUsername: sanitizedUsername,
                        lastUpdated: timestamp
                    },
                    $setOnInsert: {
                        createdAt: timestamp,
                    }
                },
                { upsert: true }
            );
            
            if (result.upsertedCount) {
                console.log(`[MongoDB] Created new player: ${sanitizedUsername} with Discord ID: ${sanitizedDiscordId}`);
            } else if (result.modifiedCount) {
                console.log(`[MongoDB] Updated player: ${sanitizedUsername} with Discord ID: ${sanitizedDiscordId}`);
            } else {
                console.log(`[MongoDB] Player data already up to date: ${sanitizedUsername}`);
            }
            
            return result;
        }, `savePlayerData for ${sanitizedUsername}`);
    } catch (err) {
        console.error('[MongoDB] Error saving player data:', err);
        return { error: err.message };
    }
}

/**
 * Get all players from the database
 * @returns {Promise<Array>} Array of player objects
 */
async function getAllPlayers() {
    try {
        const database = await getDatabase();
        const players = database.collection(COLLECTIONS.PLAYERS);
        
        return players.find({}).toArray();
    } catch (err) {
        console.error('[MongoDB] Error getting all players:', err);
        throw err;
    }
}

/**
 * Get a player by Discord ID
 * @param {string} discordId - Player's Discord ID
 * @returns {Promise<Object|null>} Player object or null if not found
 */
async function getPlayerByDiscordId(discordId) {
    try {
        // Safety check
        if (!discordId) {
            console.error('[MongoDB] Cannot get player with empty Discord ID');
            return null;
        }
        
        // Ensure string format
        const sanitizedDiscordId = String(discordId).trim();
        
        const database = await getDatabase();
        const players = database.collection(COLLECTIONS.PLAYERS);
        
        return players.findOne({ discordId: sanitizedDiscordId });
    } catch (err) {
        console.error(`[MongoDB] Error getting player with Discord ID ${discordId}:`, err);
        // Return null instead of throwing to be more resilient to failures
        return null;
    }
}

/**
 * Get a player by Minecraft username
 * @param {string} minecraftUsername - Player's Minecraft username
 * @returns {Promise<Object|null>} Player object or null if not found
 */
async function getPlayerByMinecraftUsername(minecraftUsername) {
    try {
        // Safety check
        if (!minecraftUsername) {
            console.error('[MongoDB] Cannot get player with empty Minecraft username');
            return null;
        }
        
        console.log(`[MongoDB] Looking up player with Minecraft username: ${minecraftUsername}`);
        
        const database = await getDatabase();
        const players = database.collection(COLLECTIONS.PLAYERS);
        
        // Try to find by exact username first
        const exactPlayer = await players.findOne({ 
            minecraftUsername: minecraftUsername 
        });
        
        if (exactPlayer) {
            console.log(`[MongoDB] Found player with exact match: ${JSON.stringify(exactPlayer)}`);
            return exactPlayer;
        }
        
        // If no exact match, try case-insensitive
        const player = await players.findOne({ 
            minecraftUsername: { $regex: new RegExp(`^${minecraftUsername}$`, 'i') }
        });
        
        if (player) {
            console.log(`[MongoDB] Found player with case-insensitive match: ${JSON.stringify(player)}`);
            return player;
        }
        
        // If still no player found, try alternative lookup methods
        console.log(`[MongoDB] No player found for Minecraft username ${minecraftUsername}, trying alternatives...`);
        
        // Get all players and try to match manually (log them for debugging)
        const allPlayers = await players.find({}).toArray();
        console.log(`[MongoDB] All players in database: ${JSON.stringify(allPlayers.map(p => ({id: p._id, username: p.minecraftUsername})))}`);
        
        // Fall back to Discord channel information check
        // Get the collection that maps Discord IDs to voice channels
        const voiceStatusColl = database.collection(COLLECTIONS.VOICE_STATUS);
        const voiceStatusResult = await voiceStatusColl.find({}).toArray();
        
        console.log(`[MongoDB] Voice status entries: ${JSON.stringify(voiceStatusResult)}`);
        
        for (const entry of voiceStatusResult) {
            // If this voice entry has a stored Minecraft username, check if it matches
            if (entry.minecraftUsername && 
                entry.minecraftUsername.toLowerCase() === minecraftUsername.toLowerCase()) {
                
                console.log(`[MongoDB] Found player via voice status match: ${JSON.stringify(entry)}`);
                // Return a player object with the format expected by the calling code
                return {
                    _id: entry._id,
                    discordId: entry.discordId,
                    minecraftUsername: entry.minecraftUsername,
                    channelId: entry.channelId || null
                };
            }
        }
        
        console.log(`[MongoDB] Could not find player ${minecraftUsername} with any method`);
        return null;
    } catch (err) {
        console.error(`[MongoDB] Error getting player with Minecraft username ${minecraftUsername}:`, err);
        // Return null instead of throwing to be more resilient to failures
        return null;
    }
}

/**
 * Update a player's voice channel status
 * @param {string} discordId - Player's Discord ID
 * @param {string} minecraftUsername - Player's Minecraft username
 * @param {string|null} voiceChannelId - Voice channel ID or null if not in a channel
 * @returns {Promise<Object>} Result with previous and current channel info
 */
async function updatePlayerVoiceChannel(discordId, minecraftUsername, voiceChannelId) {
    try {
        const database = await getDatabase();
        const voiceChannels = database.collection(COLLECTIONS.VOICE_CHANNELS);
        
        // Make sure the player exists in the players collection
        await savePlayerData(discordId, minecraftUsername);
        
        // Get the previous voice channel for the player
        const prevVoiceData = await voiceChannels.findOne(
            { discordId },
            { sort: { timestamp: -1 } }
        );
        
        const previousChannel = prevVoiceData?.channelId || null;
        const timestamp = new Date();
        
        // Insert new voice channel record (we keep history)
        await voiceChannels.insertOne({
            discordId,
            minecraftUsername,
            channelId: voiceChannelId,
            channelLabel: getChannelLabel(voiceChannelId),
            previousChannelId: previousChannel,
            previousChannelLabel: getChannelLabel(previousChannel),
            timestamp
        });
        
        console.log(`[MongoDB] Updated voice channel for ${minecraftUsername}: ${getChannelLabel(voiceChannelId) || 'Not in voice channel'}`);
        
        return {
            previousChannel,
            currentChannel: voiceChannelId
        };
    } catch (err) {
        console.error('[MongoDB] Error updating player voice channel:', err);
        throw err;
    }
}

/**
 * Get a player's current voice channel
 * @param {string} discordId - Player's Discord ID
 * @returns {Promise<string|null>} Voice channel ID or null if not in a channel
 */
async function getPlayerVoiceChannel(discordId) {
    try {
        // Safety check
        if (!discordId) {
            console.error('[MongoDB] Cannot get voice channel for empty Discord ID');
            return null;
        }
        
        // Ensure string format
        const sanitizedDiscordId = String(discordId).trim();
        
        const database = await getDatabase();
        const voiceChannels = database.collection(COLLECTIONS.VOICE_CHANNELS);
        
        // Get the most recent voice channel record for this player
        const voiceData = await voiceChannels.findOne(
            { discordId: sanitizedDiscordId },
            { sort: { timestamp: -1 } }
        );
        
        if (!voiceData || !voiceData.channelId || 
            voiceData.channelId === 'null' || 
            voiceData.channelId === 'undefined') {
            return null;
        }
        
        // Ensure it's one of our allowed voice channels
        if (!VOICE_CHANNEL_IDS.includes(voiceData.channelId)) {
            console.log(`[MongoDB] Player with Discord ID ${sanitizedDiscordId} is in non-allowed voice channel ${voiceData.channelId}`);
            return null;
        }
        
        return voiceData.channelId;
    } catch (err) {
        console.error(`[MongoDB] Error getting voice channel for Discord ID ${discordId}:`, err);
        // Return null instead of throwing to be more resilient to failures
        return null;
    }
}

/**
 * Save a command that was directed at the bot
 * @param {string} command - The command text
 * @param {string|null} sender - The sender's Minecraft username (if available)
 * @param {string|null} discordId - The sender's Discord ID (if available)
 * @returns {Promise<boolean>} Success status
 */
async function saveCommand(command, sender = null, discordId = null) {
    try {
        // Ensure we have something to save
        if (!command || typeof command !== 'string') {
            console.error('[MongoDB] Invalid command data - empty or non-string command');
            return false;
        }
        
        const database = await getDatabase();
        const commands = database.collection(COLLECTIONS.COMMANDS);
        
        const timestamp = new Date();
        
        // Create command document with basic info
        const commandDoc = {
            command: command.trim(),
            timestamp
        };
        
        // Add sender information if available
        if (sender && typeof sender === 'string') {
            commandDoc.sender = sender.trim();
        }
        
        if (discordId) {
            // Ensure string format
            const sanitizedDiscordId = String(discordId).trim();
            commandDoc.discordId = sanitizedDiscordId;
            
            // Add voice channel information if available
            try {
                const voiceChannelId = await getPlayerVoiceChannel(sanitizedDiscordId);
                if (voiceChannelId) {
                    commandDoc.voiceChannelId = voiceChannelId;
                    commandDoc.channelLabel = getChannelLabel(voiceChannelId);
                }
            } catch (err) {
                console.error('[MongoDB] Error getting voice channel for command:', err);
                // Continue without voice channel info
            }
        }
        
        // Insert the command document
        await commands.insertOne(commandDoc);
        
        console.log(`[MongoDB] Saved command: ${command}${sender ? ` from ${sender}` : ''}`);
        return true;
    } catch (err) {
        console.error('[MongoDB] Error saving command:', err);
        return false; // Return false instead of throwing to be more resilient
    }
}

/**
 * Save a chat message to the appropriate voice channel collection
 * @param {string} discordId - Player's Discord ID
 * @param {string} minecraftUsername - Player's Minecraft username
 * @param {string} message - Chat message content
 * @param {string|null} commandContent - Optional command content extracted from @SHUBHAMOS messages
 * @returns {Promise<boolean>} Success status
 */
async function saveMessageToVoiceChannel(discordId, minecraftUsername, message, commandContent = null) {
    try {
        // New debug logging to trace the input values
        console.log(`[MongoDB] 📥 Saving message:
        - Discord ID: ${discordId}
        - Minecraft Username: ${minecraftUsername}
        - Message: "${message}"
        - Command Content: "${commandContent || 'none'}"
        `);
        
        const channelId = await getPlayerVoiceChannel(discordId);
        
        if (!channelId) {
            console.log(`[MongoDB] Player ${minecraftUsername} is not in a voice channel, not saving message`);
            return false;
        }
        
        // Check if this is an allowed channel
        if (!VOICE_CHANNEL_IDS.includes(channelId)) {
            console.log(`[MongoDB] Player ${minecraftUsername} is in non-allowed voice channel ${channelId}`);
            return false;
        }
        
        const database = await getDatabase();
        const messages = database.collection(COLLECTIONS.MESSAGES);
        
        const timestamp = new Date();
        
        // Create document with the most complete message content available
        // Order of preference: commandContent (if it contains the entire message), message, or a combination
        const fullMessage = commandContent || message;
        
        // Basic document fields
        const messageDoc = {
            discordId,
            minecraftUsername,
            channelId,
            channelLabel: getChannelLabel(channelId),
            timestamp,
            // Store the original raw message as received
            rawMessage: message,
            // Store the most complete version we have
            fullMessage: fullMessage
        };
        
        // Add command-specific fields if this is a command (message to the bot)
        if (fullMessage && (fullMessage.includes('@SHUBHAMOS') || fullMessage.toLowerCase().includes('@shubhamos'))) {
            messageDoc.isCommand = true;
            
            // Extract command part if present
            let commandPart = "";
            if (fullMessage.includes('@SHUBHAMOS')) {
                const parts = fullMessage.split('@SHUBHAMOS');
                commandPart = parts[1] ? parts[1].trim() : "";
            } else if (fullMessage.toLowerCase().includes('@shubhamos')) {
                const parts = fullMessage.split('@shubhamos');
                commandPart = parts[1] ? parts[1].trim() : "";
            }
            
            messageDoc.commandContent = commandPart;
            
            console.log(`[MongoDB] 💾 Saving command message:
            - Raw message: "${fullMessage}"
            - Extracted command: "${commandPart}"
            `);
        }
        
        await messages.insertOne(messageDoc);
        
        const channelLabel = getChannelLabel(channelId);
        console.log(`[MongoDB] ✅ Saved message from ${minecraftUsername} to ${channelLabel}`);
        
        // Log more details about what was saved
        console.log(`[MongoDB] 📊 Message details:
        - Channel: ${channelLabel}
        - Full content saved: "${fullMessage}"
        ${messageDoc.isCommand ? `- Command part: "${messageDoc.commandContent}"` : ''}
        `);
        
        // Additional logging for command messages
        if (messageDoc.isCommand) {
            console.log(`[MongoDB] Command content saved: "${fullMessage}" from player ${minecraftUsername} in ${channelLabel}`);
        }
        
        return true;
    } catch (err) {
        console.error('[MongoDB] Error saving message to channel:', err);
        return false;
    }
}

/**
 * Get all users in a specific voice channel
 * @param {string} channelId - Voice channel ID
 * @returns {Promise<Array>} Array of users in the channel
 */
async function getUsersInVoiceChannel(channelId) {
    try {
        if (!VOICE_CHANNEL_IDS.includes(channelId)) {
            return [];
        }
        
        const database = await getDatabase();
        const voiceChannels = database.collection(COLLECTIONS.VOICE_CHANNELS);
        
        // Get distinct discord IDs currently in this channel
        // We need to perform a more complex aggregation to get the latest voice state for each user
        const usersInChannel = await voiceChannels.aggregate([
            // Sort by timestamp (descending)
            { $sort: { timestamp: -1 } },
            // Group by discordId and take the first document (most recent)
            { $group: {
                _id: "$discordId",
                latestDocument: { $first: "$$ROOT" }
            }},
            // Unwind the latest document
            { $replaceRoot: { newRoot: "$latestDocument" } },
            // Filter to only include users in this specific channel
            { $match: { channelId: channelId } },
            // Project only the fields we need
            { $project: {
                discordId: 1,
                minecraftUsername: 1
            }}
        ]).toArray();
        
        return usersInChannel;
    } catch (err) {
        console.error(`[MongoDB] Error getting users in voice channel ${channelId}:`, err);
        return [];
    }
}

/**
 * Get a friendly channel label for a channel ID
 * @param {string|null} channelId - Voice channel ID
 * @returns {string} Channel label
 */
function getChannelLabel(channelId) {
    if (!channelId) return null;
    return VOICE_CHANNEL_LABELS[channelId] || channelId;
}

// Voice channel configurations
const VOICE_CHANNEL_IDS = [
    '1179321724785922088', // VC-1
    '1182188218716790885', // VC-2
    '1182188286232510605'  // VC-3
];

const VOICE_CHANNEL_LABELS = {
    '1179321724785922088': 'VC-1',
    '1182188218716790885': 'VC-2',
    '1182188286232510605': 'VC-3'
};

/**
 * Reset voice channel data in the database but preserve player associations and message history
 * Used when everyone leaves or on bot restart
 */
async function clearAllData() {
    try {
        console.log('[MongoDB] Resetting voice channel data (preserving player data and message history)');
        const database = await getDatabase();
        
        // Only reset voice channel collection
        try {
            await database.collection(COLLECTIONS.VOICE_CHANNELS).deleteMany({});
            console.log(`[MongoDB] Reset voice channel data successfully`);
        } catch (err) {
            console.error(`[MongoDB] Error resetting voice channels: ${err}`);
        }
        
        // Keep other important data like player mappings and message history
        console.log('[MongoDB] Voice channel data reset complete. Player data and messages preserved.');
        return true;
    } catch (err) {
        console.error('[MongoDB] Error resetting voice data:', err);
        return false;
    }
}

/**
 * Clear data for a specific player when they leave the server
 * @param {string} discordId - Player's Discord ID
 * @param {string} minecraftUsername - Player's Minecraft username
 * @returns {Promise<boolean>} Success status
 */
async function clearPlayerData(discordId, minecraftUsername) {
    try {
        console.log(`[MongoDB] Clearing data for player ${minecraftUsername} (${discordId})`);
        const database = await getDatabase();
        
        // Clear player data from the players collection but keep the mapping
        // This way the system can still find the Discord ID if the player rejoins
        
        // Clear voice channel data
        await database.collection(COLLECTIONS.VOICE_CHANNELS).deleteMany({ discordId });
        console.log(`[MongoDB] Cleared voice channel data for player ${minecraftUsername}`);
        
        // Clear message data
        // We don't delete messages from channel_messages to preserve channel history
        
        console.log(`[MongoDB] Player data cleared for ${minecraftUsername}`);
        return true;
    } catch (err) {
        console.error(`[MongoDB] Error clearing player data for ${minecraftUsername}:`, err);
        return false;
    }
}

module.exports = {
    initializeDatabase,
    closeDatabase,
    savePlayerData,
    getAllPlayers,
    getPlayerByDiscordId,
    getPlayerByMinecraftUsername,
    updatePlayerVoiceChannel,
    getPlayerVoiceChannel,
    saveCommand,
    saveMessageToVoiceChannel,
    getUsersInVoiceChannel,
    clearAllData,
    clearPlayerData,
    COLLECTIONS,
    VOICE_CHANNEL_IDS,
    VOICE_CHANNEL_LABELS
};