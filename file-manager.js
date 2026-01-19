/**
 * File Manager
 * Handles reading and writing data to files
 */

const fs = require('fs').promises;
const path = require('path');

// File paths
const DATA_FOLDER = path.join(process.cwd(), 'data');
const PLAYERS_FILE = path.join(DATA_FOLDER, 'players.txt');
const COMMANDS_FILE = path.join(DATA_FOLDER, 'commands.txt');
const PLAYER_VOICE_FILE = path.join(DATA_FOLDER, 'player_voice.txt');
const VC_USERLIST_FILE = path.join(DATA_FOLDER, 'vc-userlist.txt');

// Voice channel mapping with labels
const VOICE_CHANNELS = {
    'VC-1': '1179321724785922088',
    'VC-2': '1182188218716790885',
    'VC-3': '1182188286232510605'
};

// Voice channel IDs that we will create files for
const VOICE_CHANNEL_IDS = Object.values(VOICE_CHANNELS);

// Reverse mapping for easier label lookup
const VOICE_CHANNEL_LABELS = {};
Object.entries(VOICE_CHANNELS).forEach(([label, id]) => {
    VOICE_CHANNEL_LABELS[id] = label;
});

/**
 * Ensures the data folder exists
 */
async function ensureDataFolderExists() {
    try {
        await fs.mkdir(DATA_FOLDER, { recursive: true });
        console.log(`[File] Data folder created at ${DATA_FOLDER}`);
        
        // Create empty files if they don't exist
        try {
            await fs.access(PLAYERS_FILE);
        } catch (e) {
            await fs.writeFile(PLAYERS_FILE, '');
            console.log(`[File] Created empty players file at ${PLAYERS_FILE}`);
        }
        
        try {
            await fs.access(COMMANDS_FILE);
        } catch (e) {
            await fs.writeFile(COMMANDS_FILE, '');
            console.log(`[File] Created empty commands file at ${COMMANDS_FILE}`);
        }
        
        try {
            await fs.access(PLAYER_VOICE_FILE);
        } catch (e) {
            await fs.writeFile(PLAYER_VOICE_FILE, '');
            console.log(`[File] Created empty player voice file at ${PLAYER_VOICE_FILE}`);
        }
        
        try {
            await fs.access(VC_USERLIST_FILE);
        } catch (e) {
            // Create with initial channel headers
            const initialContent = VOICE_CHANNEL_IDS.map(channelId => {
                const label = VOICE_CHANNEL_LABELS[channelId] || channelId;
                return `# Channel: ${label} (${channelId})\n# No users in ${label}\n\n`;
            }).join('');
            
            await fs.writeFile(VC_USERLIST_FILE, initialContent);
            console.log(`[File] Created vc-userlist file at ${VC_USERLIST_FILE}`);
        }
        
        // Create channel-specific files
        for (const channelId of VOICE_CHANNEL_IDS) {
            const channelFile = path.join(DATA_FOLDER, `${channelId}.txt`);
            try {
                await fs.access(channelFile);
            } catch (e) {
                const label = VOICE_CHANNEL_LABELS[channelId] || channelId;
                const header = `# Voice Channel: ${label} (${channelId})\n# Messages in this channel:\n\n`;
                await fs.writeFile(channelFile, header);
                console.log(`[File] Created channel file for ${label}`);
            }
        }
    } catch (err) {
        console.error('[File] Error creating data folder:', err);
        throw err;
    }
}

/**
 * Writes player data to the players file
 * @param {string} discordId - The player's Discord ID
 * @param {string} minecraftUsername - The player's Minecraft username
 */
async function writePlayerData(discordId, minecraftUsername) {
    try {
        // Read current file contents
        let fileContent = '';
        try {
            fileContent = await fs.readFile(PLAYERS_FILE, 'utf8');
        } catch (e) {
            if (e.code !== 'ENOENT') {
                throw e;
            }
        }
        
        const lines = fileContent.split('\n').filter(line => line.trim());
        
        // Check if this discord ID already exists in the file
        const existingLineIndex = lines.findIndex(line => {
            const lineParts = line.split(' = ');
            return lineParts.length >= 2 && lineParts[0] === discordId;
        });
        
        if (existingLineIndex >= 0) {
            // Update existing line
            lines[existingLineIndex] = `${discordId} = ${minecraftUsername}`;
        } else {
            // Add new line
            lines.push(`${discordId} = ${minecraftUsername}`);
        }
        
        // Write back to file
        await fs.writeFile(PLAYERS_FILE, lines.join('\n') + '\n');
        console.log(`[File] Updated player data for ${minecraftUsername} with Discord ID ${discordId}`);
    } catch (err) {
        console.error('[File] Error writing player data:', err);
        throw err;
    }
}

/**
 * Reads player data from the players file
 * @returns {Object} - An object mapping Discord IDs to player data
 */
async function readPlayerData() {
    try {
        const data = await fs.readFile(PLAYERS_FILE, 'utf8');
        const playerData = {};
        
        // Parse file content - need to take the most recent entry for each Discord ID
        data.split('\n').filter(line => line.trim()).forEach(line => {
            // Only process valid lines
            if (!line.includes(' = ')) return;
            
            const parts = line.split(' = ');
            if (parts.length >= 2) {
                const discordId = parts[0];
                const minecraftUsername = parts[1];
                
                if (discordId && minecraftUsername) {
                    playerData[discordId] = {
                        minecraftUsername,
                        lastUpdated: new Date().toISOString()
                    };
                }
            }
        });
        
        console.log(`[File] Read player data: ${Object.keys(playerData).length} entries`);
        return playerData;
    } catch (err) {
        if (err.code === 'ENOENT') {
            // File doesn't exist, return empty object
            return {};
        }
        console.error('[File] Error reading player data:', err);
        throw err;
    }
}

/**
 * Writes command data to the commands file
 * @param {string} commandData - The command data to write
 */
async function writeCommandData(commandData) {
    try {
        // Check if it's a voice status update (format: "discordId = minecraftUsername = channelId")
        if (commandData.includes(' = ')) {
            const parts = commandData.split(' = ');
            if (parts.length === 3) {
                const [discordId, minecraftUsername, voiceChannelId] = parts;
                
                // Read current file contents
                let fileContent = '';
                try {
                    fileContent = await fs.readFile(COMMANDS_FILE, 'utf8');
                } catch (e) {
                    if (e.code !== 'ENOENT') {
                        throw e;
                    }
                }
                
                const lines = fileContent.split('\n').filter(line => line.trim());
                
                // Check if this user already exists in the file
                const existingLineIndex = lines.findIndex(line => {
                    const lineParts = line.split(' = ');
                    return lineParts.length === 3 && lineParts[0] === discordId;
                });
                
                if (existingLineIndex >= 0) {
                    // Update existing line
                    lines[existingLineIndex] = commandData;
                } else {
                    // Add new line
                    lines.push(commandData);
                }
                
                // Write back to file
                await fs.writeFile(COMMANDS_FILE, lines.join('\n') + '\n');
                console.log(`[File] Updated voice status for ${minecraftUsername}: ${voiceChannelId}`);
            } else {
                // Just append the data if not in the expected format
                await fs.appendFile(COMMANDS_FILE, commandData + '\n');
            }
        } else {
            // For other commands (like @SHUBHAMOS commands), just append
            await fs.appendFile(COMMANDS_FILE, commandData + '\n');
        }
    } catch (err) {
        console.error('[File] Error writing command data:', err);
        throw err;
    }
}

/**
 * Updates player voice status in the commands file
 * @param {string} discordId - The player's Discord ID
 * @param {string|null} voiceChannelId - The voice channel ID or null
 */
async function updatePlayerVoiceStatus(discordId, voiceChannelId) {
    try {
        // Read player data to get Minecraft username
        const playerData = await readPlayerData();
        const player = playerData[discordId];
        
        if (!player) {
            // Try to find player data directly from the file as a fallback
            try {
                const data = await fs.readFile(PLAYERS_FILE, 'utf8');
                const lines = data.split('\n').filter(line => line.trim());
                
                // Find the latest entry for this Discord ID
                const playerLines = lines.filter(line => line.startsWith(`${discordId} =`));
                
                if (playerLines.length > 0) {
                    // Get the most recent entry
                    const latestEntry = playerLines[playerLines.length - 1];
                    const parts = latestEntry.split(' = ');
                    
                    if (parts.length >= 2) {
                        const minecraftUsername = parts[1];
                        
                        // Update command data with new voice status
                        const voiceStatus = voiceChannelId || 'Not in voice channel';
                        const commandData = `${discordId} = ${minecraftUsername} = ${voiceStatus}`;
                        
                        await writeCommandData(commandData);
                        console.log(`[File] Updated voice status for ${minecraftUsername} using fallback method: ${voiceStatus}`);
                        return;
                    }
                }
            } catch (e) {
                console.error('[File] Error in fallback player lookup:', e);
            }
            
            // If we get here, we couldn't find the player even with fallback
            console.log(`[File] Player with Discord ID ${discordId} not found in data file, skipping voice update`);
            return;
        }
        
        // Get the Minecraft username based on the player data format
        const minecraftUsername = typeof player === 'object' ? player.minecraftUsername : player;
        
        // Update command data with new voice status
        const voiceStatus = voiceChannelId || 'Not in voice channel';
        const commandData = `${discordId} = ${minecraftUsername} = ${voiceStatus}`;
        
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
        // Read from player_voice.txt to get current voice channel
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
        // Get previous channel
        const previousChannel = await getPlayerVoiceChannel(discordId);
        
        // Update player voice status in player_voice.txt
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
        
        console.log(`[File] Updated voice channel for ${minecraftUsername}: ${currLabel}`);
        
        return {
            previousChannel,
            currentChannel: voiceChannelId
        };
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
 */
async function savePlayerMessageToChannelFile(discordId, minecraftUsername, message) {
    try {
        // Get the player's current voice channel
        const channelId = await getPlayerVoiceChannel(discordId);
        
        if (!channelId) {
            console.log(`[File] Player ${minecraftUsername} is not in a voice channel, not saving message`);
            return false;
        }
        
        // Check if this is an allowed channel
        if (!VOICE_CHANNEL_IDS.includes(channelId)) {
            console.log(`[File] Player ${minecraftUsername} is in non-allowed voice channel ${channelId}`);
            return false;
        }
        
        // Get the channel label for logging
        const channelLabel = VOICE_CHANNEL_LABELS[channelId] || channelId;
        
        // Create the message entry with timestamp
        const timestamp = new Date().toISOString();
        const entry = `[${timestamp}] ${minecraftUsername}: ${message}`;
        
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
        return voiceChannelId ? 
            voiceChannelUsers[voiceChannelId].filter(user => user.discordId !== discordId) : 
            [];
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
        if (!VOICE_CHANNEL_IDS.includes(channelId)) {
            return [];
        }
        
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
    VOICE_CHANNELS,
    VOICE_CHANNEL_LABELS
};
