/**
 * MongoDB Integration Layer
 * This module provides MongoDB-backed functions with the same API as file-manager.js
 * It allows for a smooth transition from file-based storage to MongoDB
 */

const fs = require('fs').promises;
const path = require('path');
const dbManager = require('./db-manager');

// Constants for file-based fallback
const DATA_FOLDER = path.join(process.cwd(), 'data');
const PLAYERS_FILE = path.join(DATA_FOLDER, 'players.txt');
const COMMANDS_FILE = path.join(DATA_FOLDER, 'commands.txt');
const PLAYER_VOICE_FILE = path.join(DATA_FOLDER, 'player_voice.txt');
const VC_USERLIST_FILE = path.join(DATA_FOLDER, 'vc-userlist.txt');

// Map the voice channel IDs to friendly labels
const VOICE_CHANNEL_LABELS = dbManager.VOICE_CHANNEL_LABELS;
const VOICE_CHANNEL_IDS = dbManager.VOICE_CHANNEL_IDS;

/**
 * Ensures the data folder exists
 */
async function ensureDataFolderExists() {
    try {
        await fs.mkdir(DATA_FOLDER, { recursive: true });
        console.log(`[File] Data folder created at ${DATA_FOLDER}`);
    } catch (err) {
        if (err.code !== 'EEXIST') {
            console.error('[File] Error creating data folder:', err);
            throw err;
        }
    }
}

/**
 * Writes player data to MongoDB and file as backup
 * @param {string} discordId - The player's Discord ID
 * @param {string} minecraftUsername - The player's Minecraft username
 */
async function writePlayerData(discordId, minecraftUsername) {
    try {
        // Try to use MongoDB first
        try {
            await dbManager.savePlayerData(discordId, minecraftUsername);
            return;
        } catch (mongoErr) {
            console.error('[MongoDB] Error saving player data, falling back to file:', mongoErr);
        }
        
        // Fallback to file-based storage
        const playerLine = `${discordId}:${minecraftUsername}`;
        
        // Ensure the data directory exists
        await ensureDataFolderExists();
        
        let existingData = '';
        try {
            existingData = await fs.readFile(PLAYERS_FILE, 'utf8');
        } catch (e) {
            if (e.code !== 'ENOENT') {
                throw e;
            }
        }
        
        const lines = existingData.split('\n').filter(line => line.trim());
        
        // Check if this player already exists
        const playerExists = lines.some(line => {
            const parts = line.split(':');
            return parts[0] === discordId;
        });
        
        if (!playerExists) {
            // Add the new player
            lines.push(playerLine);
            await fs.writeFile(PLAYERS_FILE, lines.join('\n') + '\n');
            console.log(`[File] Added player: ${minecraftUsername} with Discord ID: ${discordId}`);
        }
    } catch (err) {
        console.error('[File] Error writing player data:', err);
        throw err;
    }
}

/**
 * Reads player data from MongoDB or file
 * @returns {Object} - An object mapping Discord IDs to player data
 */
async function readPlayerData() {
    try {
        // Try to use MongoDB first
        try {
            const players = await dbManager.getAllPlayers();
            const playerMap = {};
            
            players.forEach(player => {
                playerMap[player.discordId] = player.minecraftUsername;
            });
            
            console.log(`[MongoDB] Read player data: ${players.length} entries`);
            return playerMap;
        } catch (mongoErr) {
            console.error('[MongoDB] Error reading players, falling back to file:', mongoErr);
        }
        
        // Fallback to file-based storage
        // Ensure the data directory exists
        await ensureDataFolderExists();
        
        const data = await fs.readFile(PLAYERS_FILE, 'utf8').catch(e => {
            if (e.code === 'ENOENT') {
                return '';
            }
            throw e;
        });
        
        const lines = data.split('\n').filter(line => line.trim());
        const players = {};
        
        lines.forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 2) {
                const discordId = parts[0];
                const minecraftUsername = parts[1];
                players[discordId] = minecraftUsername;
            }
        });
        
        console.log(`[File] Read player data: ${Object.keys(players).length} entries`);
        return players;
    } catch (err) {
        console.error('[File] Error reading player data:', err);
        return {};
    }
}

/**
 * Writes command data to MongoDB and file as backup
 * @param {string} commandData - The command data to write
 */
async function writeCommandData(commandData) {
    try {
        // Try to use MongoDB first
        try {
            await dbManager.saveCommand(commandData);
            return;
        } catch (mongoErr) {
            console.error('[MongoDB] Error saving command, falling back to file:', mongoErr);
        }
        
        // Fallback to file-based storage
        const timestamp = new Date().toISOString();
        const entry = `COMMAND = [${timestamp}] = ${commandData}`;
        
        // Ensure the data directory exists
        await ensureDataFolderExists();
        
        await fs.appendFile(COMMANDS_FILE, entry + '\n');
    } catch (err) {
        console.error('[File] Error writing command data:', err);
        throw err;
    }
}

/**
 * Updates player voice status in commands.txt (legacy format)
 * @param {string} discordId - The player's Discord ID
 * @param {string|null} voiceChannelId - The voice channel ID or null
 */
async function updatePlayerVoiceStatus(discordId, voiceChannelId) {
    try {
        // Get the player from MongoDB or file
        let player;
        let minecraftUsername = 'unknown';
        
        try {
            player = await dbManager.getPlayerByDiscordId(discordId);
            if (player) {
                // Get the Minecraft username based on the player data format
                minecraftUsername = typeof player === 'object' ? player.minecraftUsername : player;
            } else {
                console.log(`[MongoDB] Player with Discord ID ${discordId} not found in database`);
                
                // Fallback to file-based player lookup
                const players = await readPlayerData();
                player = players[discordId];
                
                if (player) {
                    minecraftUsername = typeof player === 'object' ? player.minecraftUsername : player;
                } else {
                    // Use 'unknown' as the Minecraft username if player not found
                    console.log(`[File] Player with Discord ID ${discordId} not found in data file, using 'unknown' as username`);
                }
            }
        } catch (mongoErr) {
            console.error('[MongoDB] Error getting player, falling back to file:', mongoErr);
            
            // Fallback to file-based player lookup
            const players = await readPlayerData();
            player = players[discordId];
            
            if (player) {
                minecraftUsername = typeof player === 'object' ? player.minecraftUsername : player;
            } else {
                // Use 'unknown' as the Minecraft username if player not found
                console.log(`[File] Player with Discord ID ${discordId} not found in data file, using 'unknown' as username`);
            }
        }
        
        // Update command data with new voice status
        const timestamp = new Date().toISOString();
        const voiceStatus = voiceChannelId || 'Not in voice channel';
        const commandData = `${timestamp}: ${discordId} = ${minecraftUsername} = ${voiceStatus}`;
        
        await writeCommandData(commandData);
    } catch (err) {
        console.error('[File] Error updating player voice status:', err);
        throw err;
    }
}

/**
 * Gets the current voice channel for a player
 * @param {string} discordId - The player's Discord ID
 * @returns {string|null} - The voice channel ID or null if not in a voice channel
 */
async function getPlayerVoiceChannel(discordId) {
    try {
        // Try to use MongoDB first
        try {
            return await dbManager.getPlayerVoiceChannel(discordId);
        } catch (mongoErr) {
            console.error('[MongoDB] Error getting voice channel, falling back to file:', mongoErr);
        }
        
        // Fallback to file-based storage
        // Ensure the data directory exists
        await ensureDataFolderExists();
        
        let data = '';
        try {
            data = await fs.readFile(PLAYER_VOICE_FILE, 'utf8');
        } catch (e) {
            if (e.code !== 'ENOENT') {
                throw e;
            }
            return null;
        }
        
        // Find the entries for this Discord ID
        const lines = data.split('\n').filter(line => line.trim());
        const playerLines = lines.filter(line => line.startsWith(`${discordId}:`));
        
        if (playerLines.length > 0) {
            // Sort entries by timestamp (most recent last)
            const sortedEntries = playerLines.map(line => {
                const parts = line.split(':');
                const timestamp = parts.length >= 4 ? parts[3] : ''; // Get timestamp if exists
                return { line, timestamp };
            }).sort((a, b) => {
                if (!a.timestamp) return -1;
                if (!b.timestamp) return 1;
                return new Date(a.timestamp) - new Date(b.timestamp);
            });
            
            // Get the most recent entry
            const latestEntry = sortedEntries[sortedEntries.length - 1].line;
            const parts = latestEntry.split(':');
            
            if (parts.length >= 2) {
                const channelId = parts[1].trim();
                if (channelId === 'null' || channelId === 'undefined' || channelId === 'Not in voice channel') {
                    return null;
                }
                return channelId;
            }
        }
        
        return null;
    } catch (err) {
        console.error('[File] Error getting player voice channel:', err);
        return null;
    }
}

/**
 * Updates a player's voice channel status and handles notifications
 * @param {string} discordId - The player's Discord ID
 * @param {string} minecraftUsername - The player's Minecraft username
 * @param {string|null} voiceChannelId - The new voice channel ID or null
 * @param {Object} bot - The Minecraft bot instance for sending notifications
 * @returns {Object} - Result object with previousChannel and currentChannel
 */
async function updatePlayerVoiceChannel(discordId, minecraftUsername, voiceChannelId, bot) {
    try {
        // Get previous channel (try MongoDB first)
        let previousChannel;
        let result;
        
        try {
            result = await dbManager.updatePlayerVoiceChannel(discordId, minecraftUsername, voiceChannelId);
            previousChannel = result.previousChannel;
        } catch (mongoErr) {
            console.error('[MongoDB] Error updating voice channel, falling back to file:', mongoErr);
            
            // Fallback to file operations
            previousChannel = await getPlayerVoiceChannel(discordId);
            
            // Update player voice status in player_voice.txt
            // Ensure the data directory exists
            await ensureDataFolderExists();
            
            let fileContent = '';
            try {
                fileContent = await fs.readFile(PLAYER_VOICE_FILE, 'utf8');
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    throw e;
                }
            }
            
            const lines = fileContent.split('\n').filter(line => line.trim());
            
            // Filter out all entries for this Discord ID, so there are no duplicates
            const filteredLines = lines.filter(line => !line.startsWith(`${discordId}:`));
            
            const timestamp = new Date().toISOString();
            const newLine = `${discordId}:${voiceChannelId || 'null'}:${minecraftUsername}:${timestamp}`;
            
            // Add the new line with the latest data
            filteredLines.push(newLine);
            
            // Write back to file
            await fs.writeFile(PLAYER_VOICE_FILE, filteredLines.join('\n') + '\n');
            
            // Also update in the legacy format
            await updatePlayerVoiceStatus(discordId, voiceChannelId);
            
            // Update the voice channel user list and get users in the new channel
            const usersInNewChannel = await updateVoiceChannelUserList(discordId, minecraftUsername, voiceChannelId);
            
            result = {
                previousChannel,
                currentChannel: voiceChannelId
            };
        }
        
        // Update the voice channel user list (even if using MongoDB)
        const usersInNewChannel = await updateVoiceChannelUserList(discordId, minecraftUsername, voiceChannelId);
        
        // Send notifications to all parties
        if (bot && minecraftUsername) {
            // Get channel labels for better readability
            const prevChannelLabel = previousChannel ? (VOICE_CHANNEL_LABELS[previousChannel] || previousChannel) : null;
            const newChannelLabel = voiceChannelId ? (VOICE_CHANNEL_LABELS[voiceChannelId] || voiceChannelId) : null;
            
            if (!previousChannel && voiceChannelId) {
                // Player joined a voice channel
                const message = `You are now connected to ${newChannelLabel}`;
                bot.chat(`/msg ${minecraftUsername} ${message}`);
                console.log(`[Minecraft] Notified ${minecraftUsername} about joining ${newChannelLabel}`);
                
                // Notify other users in the channel that someone joined
                for (const user of usersInNewChannel) {
                    const notifMsg = `${minecraftUsername} has joined your voice channel (${newChannelLabel})`;
                    bot.chat(`/msg ${user.minecraftUsername} ${notifMsg}`);
                    console.log(`[Minecraft] Notified ${user.minecraftUsername} that ${minecraftUsername} joined their voice channel`);
                }
            } else if (previousChannel && !voiceChannelId) {
                // Player left voice channels
                const message = `You disconnected from ${prevChannelLabel}`;
                bot.chat(`/msg ${minecraftUsername} ${message}`);
                console.log(`[Minecraft] Notified ${minecraftUsername} about leaving ${prevChannelLabel}`);
                
                // Get users who were in the previous channel
                const prevChannelUsers = await getUsersInVoiceChannel(previousChannel);
                for (const user of prevChannelUsers) {
                    const notifMsg = `${minecraftUsername} has left your voice channel (${prevChannelLabel})`;
                    bot.chat(`/msg ${user.minecraftUsername} ${notifMsg}`);
                    console.log(`[Minecraft] Notified ${user.minecraftUsername} that ${minecraftUsername} left their voice channel`);
                }
            } else if (previousChannel && voiceChannelId && previousChannel !== voiceChannelId) {
                // Player switched voice channels
                const message = `You switched from ${prevChannelLabel} to ${newChannelLabel}`;
                bot.chat(`/msg ${minecraftUsername} ${message}`);
                console.log(`[Minecraft] Notified ${minecraftUsername} about switching voice channels`);
                
                // Notify users in the new channel about the player joining their channel
                for (const user of usersInNewChannel) {
                    const notifMsg = `${minecraftUsername} has switched to your voice channel (${newChannelLabel})`;
                    bot.chat(`/msg ${user.minecraftUsername} ${notifMsg}`);
                    console.log(`[Minecraft] Notified ${user.minecraftUsername} that ${minecraftUsername} switched to their voice channel`);
                }
                
                // Notify users in the previous channel about the player leaving
                const prevChannelUsers = await getUsersInVoiceChannel(previousChannel);
                for (const user of prevChannelUsers) {
                    const notifMsg = `${minecraftUsername} has switched from your voice channel (${prevChannelLabel}) to ${newChannelLabel}`;
                    bot.chat(`/msg ${user.minecraftUsername} ${notifMsg}`);
                    console.log(`[Minecraft] Notified ${user.minecraftUsername} that ${minecraftUsername} switched from their voice channel`);
                }
            }
        }
        
        // Format for console logging
        const prevLabel = previousChannel ? VOICE_CHANNEL_LABELS[previousChannel] || previousChannel : 'Not in voice channel';
        const currLabel = voiceChannelId ? VOICE_CHANNEL_LABELS[voiceChannelId] || voiceChannelId : 'Not in voice channel';
        
        if (result) {
            console.log(`[File] Updated voice channel for ${minecraftUsername}: ${currLabel}`);
            return result;
        } else {
            // If MongoDB was successful but we have no result
            return {
                previousChannel,
                currentChannel: voiceChannelId
            };
        }
    } catch (err) {
        console.error('[File] Error updating player voice channel:', err);
        throw err;
    }
}

/**
 * Saves a chat message to the respective voice channel file
 * @param {string} discordId - The player's Discord ID
 * @param {string} minecraftUsername - The player's Minecraft username
 * @param {string} message - The chat message content
 * @param {string|null} commandContent - Optional command content extracted from @SHUBHAMOS messages
 * @returns {Promise<boolean>} - Whether the message was successfully saved
 */
async function savePlayerMessageToChannelFile(discordId, minecraftUsername, message, commandContent = null) {
    try {
        // Try to use MongoDB first
        try {
            // If the message contains @SHUBHAMOS, log the full command content
            if (commandContent) {
                console.log(`[MongoDB] Saving message with full command content: "${commandContent}"`);
                return await dbManager.saveMessageToVoiceChannel(discordId, minecraftUsername, message, commandContent);
            } else {
                return await dbManager.saveMessageToVoiceChannel(discordId, minecraftUsername, message);
            }
        } catch (mongoErr) {
            console.error('[MongoDB] Error saving message, falling back to file:', mongoErr);
        }
        
        // Fallback to file-based storage
        // Get the player's current voice channel
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
        
        // Get the channel label for logging
        const channelLabel = VOICE_CHANNEL_LABELS[channelId] || channelId;
        
        // Create the message entry with timestamp
        const timestamp = new Date().toISOString();
        let entry;
        
        // Include command content if available
        if (commandContent) {
            entry = `[${timestamp}] ${minecraftUsername}: ${message} (COMMAND: ${commandContent})`;
        } else {
            entry = `[${timestamp}] ${minecraftUsername}: ${message}`;
        }
        
        // Ensure the data directory exists
        await ensureDataFolderExists();
        
        // Write to the channel-specific file
        const channelFile = path.join(DATA_FOLDER, `${channelId}.txt`);
        await fs.appendFile(channelFile, entry + '\n');
        
        console.log(`[File] Saved message from ${minecraftUsername} to ${channelLabel}`);
        return true;
    } catch (err) {
        console.error('[File] Error saving message to channel file:', err);
        return false;
    }
}

/**
 * Updates the voice channel user list file
 * @param {string} discordId - The player's Discord ID
 * @param {string} minecraftUsername - The player's Minecraft username
 * @param {string|null} voiceChannelId - The voice channel ID or null
 * @returns {Array} - Array of users in the new channel if player switched channels
 */
async function updateVoiceChannelUserList(discordId, minecraftUsername, voiceChannelId) {
    try {
        // Try to get users from MongoDB first
        let usersInNewChannel = [];
        try {
            if (voiceChannelId) {
                usersInNewChannel = await dbManager.getUsersInVoiceChannel(voiceChannelId);
            }
        } catch (mongoErr) {
            console.error('[MongoDB] Error getting voice channel users, using file-based method:', mongoErr);
        }
        
        // Continue with file-based operations for backward compatibility
        // Make sure the data directory exists
        await ensureDataFolderExists();
        
        // Initialize vc-userlist.txt if it doesn't exist
        try {
            await fs.access(VC_USERLIST_FILE);
        } catch (e) {
            await fs.writeFile(VC_USERLIST_FILE, '');
            console.log(`[File] Created empty vc-userlist file at ${VC_USERLIST_FILE}`);
        }
        
        // Read current file contents
        const fileContent = await fs.readFile(VC_USERLIST_FILE, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim());
        
        // Get existing data
        const voiceChannelUsers = {};
        VOICE_CHANNEL_IDS.forEach(id => {
            voiceChannelUsers[id] = [];
        });
        
        // Parse current users in each channel
        lines.forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 3) {
                const [userId, channelId, username] = parts;
                
                if (channelId && VOICE_CHANNEL_IDS.includes(channelId) && userId !== discordId) {
                    // Only add other users (not the current one being updated)
                    voiceChannelUsers[channelId].push({
                        discordId: userId,
                        minecraftUsername: username
                    });
                }
            }
        });
        
        // Add the current user to their new channel
        if (voiceChannelId && VOICE_CHANNEL_IDS.includes(voiceChannelId)) {
            voiceChannelUsers[voiceChannelId].push({
                discordId,
                minecraftUsername
            });
        }
        
        // Format new file content
        const newLines = [];
        VOICE_CHANNEL_IDS.forEach(channelId => {
            const label = VOICE_CHANNEL_LABELS[channelId] || channelId;
            newLines.push(`# Channel: ${label} (${channelId})`);
            
            if (voiceChannelUsers[channelId].length === 0) {
                newLines.push(`# No users in ${label}`);
            } else {
                voiceChannelUsers[channelId].forEach(user => {
                    newLines.push(`${user.discordId}:${channelId}:${user.minecraftUsername}`);
                });
            }
            newLines.push(''); // Empty line between channels
        });
        
        // Write back to file
        await fs.writeFile(VC_USERLIST_FILE, newLines.join('\n') + '\n');
        console.log(`[File] Updated voice channel user list file`);
        
        // Return users in the new channel (excluding the player who switched)
        if (usersInNewChannel.length > 0) {
            // If we got users from MongoDB, return those
            return usersInNewChannel.filter(user => user.discordId !== discordId);
        } else {
            // Otherwise return users from file-based method
            return voiceChannelId ? 
                voiceChannelUsers[voiceChannelId].filter(user => user.discordId !== discordId) : 
                [];
        }
    } catch (err) {
        console.error('[File] Error updating voice channel user list:', err);
        return [];
    }
}

/**
 * Gets all users in a specific voice channel
 * @param {string} channelId - The voice channel ID to check
 * @returns {Array} - Array of users in the specified channel
 */
async function getUsersInVoiceChannel(channelId) {
    try {
        // Try to use MongoDB first
        try {
            return await dbManager.getUsersInVoiceChannel(channelId);
        } catch (mongoErr) {
            console.error('[MongoDB] Error getting voice channel users, falling back to file:', mongoErr);
        }
        
        // Fallback to file-based storage
        if (!VOICE_CHANNEL_IDS.includes(channelId)) {
            return [];
        }
        
        // Ensure the data directory exists
        await ensureDataFolderExists();
        
        // Read the voice channel user list file
        try {
            const data = await fs.readFile(VC_USERLIST_FILE, 'utf8');
            const lines = data.split('\n').filter(line => line.trim() && !line.startsWith('#'));
            
            // Find all users in the specified channel
            const users = [];
            lines.forEach(line => {
                const parts = line.split(':');
                if (parts.length >= 3 && parts[1] === channelId) {
                    users.push({
                        discordId: parts[0],
                        minecraftUsername: parts[2]
                    });
                }
            });
            
            return users;
        } catch (e) {
            if (e.code !== 'ENOENT') {
                throw e;
            }
            return [];
        }
    } catch (err) {
        console.error(`[File] Error getting users in voice channel ${channelId}:`, err);
        return [];
    }
}

module.exports = {
    ensureDataFolderExists,
    writePlayerData,
    readPlayerData,
    writeCommandData,
    updatePlayerVoiceStatus,
    getPlayerVoiceChannel,
    updatePlayerVoiceChannel,
    savePlayerMessageToChannelFile,
    updateVoiceChannelUserList,
    getUsersInVoiceChannel,
    VOICE_CHANNEL_IDS,
    VOICE_CHANNEL_LABELS
};