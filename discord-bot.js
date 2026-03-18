/**
 * Discord Bot Implementation
 * Handles connection to Discord and monitors voice channel status
 */

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { 
    updatePlayerVoiceStatus, 
    readPlayerData, 
    updatePlayerVoiceChannel,
    VOICE_CHANNEL_IDS
} = require('./mongodb-manager');
const fs = require('fs').promises;
const path = require('path');

// Target guild and allowed voice channels
const TARGET_GUILD_ID = '784763845763006474';
const ALLOWED_VOICE_CHANNELS = VOICE_CHANNEL_IDS;

// File paths
const DATA_FOLDER = path.join(process.cwd(), 'data');
const PLAYERS_FILE = path.join(DATA_FOLDER, 'players.txt');
const COMMANDS_FILE = path.join(DATA_FOLDER, 'commands.txt');

// Cache of player voice statuses
const voiceStatusCache = new Map();

/**
 * Starts the Discord bot and connects to Discord API
 * @param {string} token - The Discord bot token
 * @returns {Object} - The Discord bot instance
 */
function startDiscordBot(token) {
    // Create Discord client with necessary intents
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildVoiceStates
        ]
    });

    // Handle Discord client errors
    client.on('error', (err) => {
        console.error('[Discord] Error:', err);
    });

    // Log when connected and check for target guild
    client.once(Events.ClientReady, async () => {
        console.log(`[Discord] Bot logged in as ${client.user.tag}`);
        
        // Verify we can see the target guild
        const guild = client.guilds.cache.get(TARGET_GUILD_ID);
        if (guild) {
            console.log(`[Discord] Successfully connected to guild: ${guild.name}`);
            
            // Perform an initial scan of all voice channels to update player statuses
            await scanVoiceChannels(guild);
        } else {
            console.error(`[Discord] WARNING: Could not find guild with ID: ${TARGET_GUILD_ID}`);
        }
    });
    
    /**
     * Scans all voice channels in the guild to update player statuses
     * @param {Guild} guild - The Discord guild to scan
     */
    async function scanVoiceChannels(guild) {
        try {
            console.log('[Discord] Scanning voice channels for players...');
            
            // Clear voice status cache before we begin
            voiceStatusCache.clear();
            
            // Try multiple approaches to find voice channel users
            let playersWithVoice = 0;
            let actuallPlayersInVoice = 0; // Track actual humans in voice, not bots or test accounts
            const processedUsers = new Set();
            
            // APPROACH 1: First try using REST API to get current voice states
            try {
                // Get all voice states directly from the API (more reliable than cache)
                console.log('[Discord] Fetching voice states from the API...');
                try {
                    // Get all guild members with voice states
                    const members = await guild.members.fetch();
                    console.log(`[Discord] Fetched ${members.size} members from guild`);
                    
                    // Check each member's voice state directly
                    for (const [userId, member] of members) {
                        if (!userId || userId === 'null') continue;
                        
                        // Check if member is in a voice channel
                        const voiceState = member.voice;
                        if (!voiceState || !voiceState.channelId) continue;
                        
                        // Check if this is a bot or a test account (exclude them from player count)
                        const isBot = member.user.bot;
                        const isTestAccount = userId === client.user.id; // Our bot's ID
                        const isOwnerAccount = userId === '635399541742632960'; // DEVILKINGS_07
                        
                        // Count as player in voice only if it's a real human player (not a bot or test account)
                        if (!isBot && !isTestAccount) {
                            playersWithVoice++;
                            
                            // If it's not the owner's test account, count as "actual player"
                            if (!isOwnerAccount) {
                                actuallPlayersInVoice++;
                            }
                        }
                        
                        processedUsers.add(userId);
                        
                        const isAllowedChannel = ALLOWED_VOICE_CHANNELS.includes(voiceState.channelId);
                        const channelIdToStore = isAllowedChannel ? voiceState.channelId : null;
                        
                        // Update cache
                        voiceStatusCache.set(userId, channelIdToStore);
                        
                        // Update player data
                        await updatePlayerVoiceStatus(userId, channelIdToStore);
                        
                        if (isAllowedChannel) {
                            console.log(`[Discord] API: User ${userId} is in allowed voice channel: ${voiceState.channelId}`);
                        } else {
                            console.log(`[Discord] API: User ${userId} is in non-allowed voice channel: ${voiceState.channelId}`);
                        }
                    }
                } catch (err) {
                    console.error('[Discord] Error fetching voice states:', err);
                }
            } catch (err) {
                console.error('[Discord] Error with voice states approach:', err);
            }
            
            // APPROACH 2: Explicit check for DEVILKINGS_07 who we know is your account
            try {
                // Get your Discord ID
                const yourDiscordId = '635399541742632960';
                
                // Force fetch your member object
                try {
                    const yourMember = await guild.members.fetch(yourDiscordId);
                    console.log(`[Discord] Found your member account: ${yourMember.user.username}`);
                    
                    // Check if you're in a voice channel
                    if (yourMember.voice.channelId) {
                        console.log(`[Discord] Detected your voice channel: ${yourMember.voice.channelId}`);
                        
                        // Check if the voice channel is allowed
                        const isAllowedChannel = ALLOWED_VOICE_CHANNELS.includes(yourMember.voice.channelId);
                        const channelIdToStore = isAllowedChannel ? yourMember.voice.channelId : null;
                        
                        // Update cache
                        voiceStatusCache.set(yourDiscordId, channelIdToStore);
                        
                        // Update player data
                        await updatePlayerVoiceStatus(yourDiscordId, channelIdToStore);
                        
                        if (isAllowedChannel) {
                            console.log(`[Discord] You are in an allowed voice channel: ${yourMember.voice.channelId}`);
                        } else {
                            console.log(`[Discord] You are in a non-allowed voice channel: ${yourMember.voice.channelId}`);
                        }
                        
                        processedUsers.add(yourDiscordId);
                        
                        // Owner account - count in general player count but not in "actual players" count
                        // for game mechanics that require real players
                        playersWithVoice++;
                    } else {
                        console.log('[Discord] You are not in a voice channel according to member data');
                    }
                } catch (err) {
                    console.error(`[Discord] Error fetching your member: ${err.message}`);
                }
            } catch (err) {
                console.error('[Discord] Error checking your voice status:', err);
            }
            
            // APPROACH 3: Check each voice channel manually
            try {
                // Fetch all voice channels in the guild
                const voiceChannels = guild.channels.cache.filter(channel => 
                    channel.type === 2 // GuildVoiceChannel type
                );
                
                // Loop through each voice channel to check members
                
                for (const channel of voiceChannels.values()) {
                    const isAllowedChannel = ALLOWED_VOICE_CHANNELS.includes(channel.id);
                    console.log(`[Discord] Checking voice channel: ${channel.name} (${channel.id}) - ${isAllowedChannel ? 'Allowed' : 'Not allowed'}`);
                    
                    // Force fetch the latest members in this channel
                    try {
                        await channel.fetch();
                        
                        // Process all members in this voice channel
                        for (const [memberId, member] of channel.members) {
                            // Skip already processed users
                            if (processedUsers.has(memberId)) continue;
                            
                            // Check if this is a bot or a test account (exclude them from player count)
                            const isBot = member.user.bot;
                            const isTestAccount = memberId === client.user.id; // Our bot's ID
                            const isOwnerAccount = memberId === '635399541742632960'; // DEVILKINGS_07
                            
                            // Count as player in voice only if it's a real human player (not a bot or test account)
                            if (!isBot && !isTestAccount) {
                                playersWithVoice++;
                                
                                // If it's not the owner's test account, count as "actual player"
                                if (!isOwnerAccount) {
                                    actuallPlayersInVoice++;
                                }
                            }
                            
                            processedUsers.add(memberId);
                            
                            // Only count as in voice if it's an allowed channel
                            const channelIdToStore = isAllowedChannel ? channel.id : null;
                            
                            // Update cache
                            voiceStatusCache.set(memberId, channelIdToStore);
                            
                            // Update player data
                            await updatePlayerVoiceStatus(memberId, channelIdToStore);
                            
                            if (isAllowedChannel) {
                                console.log(`[Discord] User ${memberId} (${member.user.username}) is in allowed voice channel: ${channel.id} [${isBot ? 'BOT' : 'HUMAN'}]`);
                            } else {
                                console.log(`[Discord] User ${memberId} (${member.user.username}) is in non-allowed voice channel: ${channel.id} [${isBot ? 'BOT' : 'HUMAN'}]`);
                            }
                        }
                    } catch (err) {
                        console.error(`[Discord] Error fetching channel ${channel.id}:`, err);
                    }
                }
            } catch (err) {
                console.error('[Discord] Error processing voice channels:', err);
            }
            
            // APPROACH 4: Check all guild members for voice state
            try {
                const members = await guild.members.fetch();
                for (const [memberId, member] of members) {
                    // Skip already processed users
                    if (processedUsers.has(memberId)) continue;
                    
                    // Check if this member has a voice state
                    if (member.voice && member.voice.channelId) {
                        // Check if this is a bot or a test account (exclude them from player count)
                        const isBot = member.user.bot;
                        const isTestAccount = memberId === client.user.id; // Our bot's ID
                        const isOwnerAccount = memberId === '635399541742632960'; // DEVILKINGS_07
                        
                        // Count as player in voice only if it's a real human player (not a bot or test account)
                        if (!isBot && !isTestAccount) {
                            playersWithVoice++;
                            
                            // If it's not the owner's test account, count as "actual player"
                            if (!isOwnerAccount) {
                                actuallPlayersInVoice++;
                            }
                        }
                        
                        const isAllowedChannel = ALLOWED_VOICE_CHANNELS.includes(member.voice.channelId);
                        const channelIdToStore = isAllowedChannel ? member.voice.channelId : null;
                        
                        // Update cache
                        voiceStatusCache.set(memberId, channelIdToStore);
                        
                        // Update player data
                        await updatePlayerVoiceStatus(memberId, channelIdToStore);
                        
                        if (isAllowedChannel) {
                            console.log(`[Discord] Found user ${memberId} (${member.user.username}) in allowed voice channel: ${member.voice.channelId} [${isBot ? 'BOT' : 'HUMAN'}]`);
                        } else {
                            console.log(`[Discord] Found user ${memberId} (${member.user.username}) in non-allowed voice channel: ${member.voice.channelId} [${isBot ? 'BOT' : 'HUMAN'}]`);
                        }
                    }
                }
            } catch (err) {
                console.error('[Discord] Error checking member voice states:', err);
            }
            
            console.log(`[Discord] Found ${actuallPlayersInVoice} actual players (excluding bots and test accounts) in voice channels`);
            
            // Use the actual player count for any game logic
            playersWithVoice = actuallPlayersInVoice;
            
            // Now check registered players against our voice cache to identify players not in voice
            // First, clear any old data
            try {
                // Read the players.txt file directly to get most accurate data
                const playerFileContent = await fs.readFile(PLAYERS_FILE, 'utf8').catch(() => '');
                const playerLines = playerFileContent.split('\n').filter(line => line.trim().length > 0);
                
                // Process each line and check if player is in voice
                for (const line of playerLines) {
                    if (!line.includes(' = ')) continue;
                    
                    const parts = line.split(' = ');
                    if (parts.length < 2) continue;
                    
                    const discordId = parts[0];
                    const minecraftUsername = parts[1];
                    
                    // Skip the default entry and the bot itself
                    if (discordId === '0' || minecraftUsername === 'SHUBHAMOS') continue;
                    
                    if (!voiceStatusCache.has(discordId)) {
                        console.log(`[Discord] Player ${minecraftUsername} (${discordId}) is not in any voice channel`);
                        await updatePlayerVoiceStatus(discordId, null);
                    }
                }
            } catch (err) {
                console.error('[Discord] Error processing player data:', err);
            }
        } catch (err) {
            console.error('[Discord] Error scanning voice channels:', err);
        }
    }
    
    // Check voice channels every 60 seconds to ensure our data stays updated
    setInterval(() => {
        try {
            const guild = client.guilds.cache.get(TARGET_GUILD_ID);
            if (guild) {
                scanVoiceChannels(guild);
            }
        } catch (err) {
            console.error('[Discord] Error in scanVoiceChannels interval:', err);
        }
    }, 60000); // Every minute

    // Handle voice state updates (join/leave/move between voice channels)
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
        try {
            const userId = newState.member.id;
            const guildId = newState.guild.id;
            const username = newState.member.user.username;
            
            // Log the voice state change for debugging
            console.log(`[Discord] ⚠️ VOICE STATE CHANGE DETECTED for ${username} (${userId})`);
            console.log(`[Discord] Old channel: ${oldState.channelId || 'none'}, New channel: ${newState.channelId || 'none'}`);
            
            // Only process events from our target guild
            if (guildId !== TARGET_GUILD_ID) {
                return;
            }
            
            // Check if the user joined, left, or moved voice channels
            const oldChannelId = oldState.channelId;
            const newChannelId = newState.channelId;
            
            if (oldChannelId === newChannelId) {
                // No channel change
                console.log(`[Discord] No channel change detected for ${username}, ignoring event`);
                return;
            }
            
            // Get the minecraft instance for notifications - will be passed from index.js
            let minecraftBot = global.minecraftBot || null;
            if (!minecraftBot) {
                console.log(`[Discord] ⚠️ Warning: Minecraft bot reference not found in global scope`);
            } else {
                console.log(`[Discord] 🟢 Minecraft bot reference found, can send notifications`);
            }
            
            // Check if the user is in an allowed voice channel
            const isInAllowedChannel = newChannelId && ALLOWED_VOICE_CHANNELS.includes(newChannelId);
            
            // Update cache with channel ID - only store if in allowed channel
            const channelIdToStore = isInAllowedChannel ? newChannelId : null;
            voiceStatusCache.set(userId, channelIdToStore);
            
            // Log voice status change
            console.log(`[Discord] Updated voice status for ${username}: ${channelIdToStore ? `In allowed channel ${channelIdToStore}` : 'Not in allowed channel'}`);
            
            // PHASE 1: Look up Minecraft username for this Discord user from various sources
            let minecraftUsername = null;
            
            // First try MongoDB (most reliable)
            try {
                const { getPlayerByDiscordId } = require('./db-manager');
                const playerFromDb = await getPlayerByDiscordId(userId);
                
                if (playerFromDb && playerFromDb.minecraftUsername) {
                    minecraftUsername = playerFromDb.minecraftUsername;
                    console.log(`[Discord] ✅ Found Minecraft username from DB for ${userId}: ${minecraftUsername}`);
                }
            } catch (dbErr) {
                console.error(`[Discord] Error looking up player in MongoDB:`, dbErr);
            }
            
            // If not found in MongoDB, try file system
            if (!minecraftUsername) {
                try {
                    const playerData = await readPlayerData();
                    
                    // Find the Minecraft username for this Discord user
                    for (const [discordId, data] of Object.entries(playerData)) {
                        if (discordId === userId) {
                            minecraftUsername = typeof data === 'object' ? data.minecraftUsername : data;
                            console.log(`[Discord] ✅ Found Minecraft username from file for ${userId}: ${minecraftUsername}`);
                            break;
                        }
                    }
                } catch (fileErr) {
                    console.error(`[Discord] Error looking up player in files:`, fileErr);
                }
            }
            
            // PHASE 2: Update player's voice channel in database
            if (minecraftUsername) {
                try {
                    console.log(`[Discord] Updating voice channel for ${minecraftUsername} (${userId}) to ${channelIdToStore || 'none'}`);
                    
                    // IMPORTANT: If player just joined an allowed voice channel, immediately cancel any kick timers
                    if (isInAllowedChannel) {
                        try {
                            // Try to directly access the timers from the global scope first
                            let timersCleared = false;
                            
                            if (global.playerKickTimers && global.playerKickTimers.has(minecraftUsername)) {
                                clearTimeout(global.playerKickTimers.get(minecraftUsername));
                                global.playerKickTimers.delete(minecraftUsername);
                                console.log(`[Discord] ✅ PRIORITY: Cancelled kick timer for ${minecraftUsername} - joined voice`);
                                timersCleared = true;
                            }
                            
                            if (global.playerMessageTimers && global.playerMessageTimers.has(minecraftUsername)) {
                                clearInterval(global.playerMessageTimers.get(minecraftUsername));
                                global.playerMessageTimers.delete(minecraftUsername);
                                console.log(`[Discord] ✅ PRIORITY: Cancelled warning messages for ${minecraftUsername} - joined voice`);
                                timersCleared = true;
                            }
                            
                            // If timers were cleared, send a confirmation message
                            if (timersCleared && minecraftBot && typeof minecraftBot.chat === 'function') {
                                // Get a friendly channel name
                                let channelName = "Unknown Channel";
                                if (newChannelId === '1179321724785922088') channelName = "VC-1";
                                else if (newChannelId === '1182188218716790885') channelName = "VC-2";
                                else if (newChannelId === '1182188286232510605') channelName = "VC-3";
                                
                                setTimeout(() => {
                                    minecraftBot.chat(`/msg ${minecraftUsername} ✅ Voice connection confirmed! You are now connected to ${channelName}. Kick countdown cancelled.`);
                                    console.log(`[Discord] Sent confirmation message to ${minecraftUsername}`);
                                }, 1000);
                            }
                            
                            // Also trigger a full check to make sure data is consistent
                            try {
                                const minecraftBotModule = require('./minecraft-bot');
                                if (typeof minecraftBotModule.checkPlayerVoiceStatus === 'function') {
                                    setTimeout(() => {
                                        minecraftBotModule.checkPlayerVoiceStatus(minecraftUsername, userId, client);
                                    }, 2000);
                                }
                            } catch (checkError) {
                                console.error(`[Discord] Error triggering voice check: ${checkError.message}`);
                            }
                        } catch (timerErr) {
                            console.error(`[Discord] Error clearing timers: ${timerErr.message}`);
                        }
                    }
                    
                    // Update in MongoDB with notification support
                    const { updatePlayerVoiceChannel } = require('./mongodb-manager');
                    const result = await updatePlayerVoiceChannel(
                        userId, 
                        minecraftUsername, 
                        channelIdToStore,
                        minecraftBot
                    );
                    
                    if (result && result.previousChannel !== result.currentChannel) {
                        console.log(`[Discord] Voice channel update success: ${minecraftUsername} moved from ${result.previousChannel || 'none'} to ${result.currentChannel || 'none'}`);
                    }
                } catch (updateErr) {
                    console.error(`[Discord] Failed to update voice channel in MongoDB:`, updateErr);
                    
                    // Fallback to simpler update method
                    try {
                        await updatePlayerVoiceStatus(userId, channelIdToStore);
                        console.log(`[Discord] Used fallback method to update voice status`);
                    } catch (fallbackErr) {
                        console.error(`[Discord] Fallback update also failed:`, fallbackErr);
                    }
                }
                
                // PHASE 3: Handle player left voice channel case (CRITICAL)
                if (!isInAllowedChannel && oldChannelId && ALLOWED_VOICE_CHANNELS.includes(oldChannelId)) {
                    console.log(`[Discord] 🔴 CRITICAL EVENT: Player ${minecraftUsername} left allowed voice channel`);
                    
                    // Get player check function and current player list
                    const isPlayerOnline = (username) => {
                        // Method 1: Direct bot.players check if bot reference is available
                        if (minecraftBot && minecraftBot.players && 
                            typeof minecraftBot.players === 'object' &&
                            minecraftBot.players[username]) {
                            return true;
                        }
                        
                        // Method 2: Check active players in global reference
                        if (global.minecraftBot && global.minecraftBot.players && 
                            typeof global.minecraftBot.players === 'object' &&
                            global.minecraftBot.players[username]) {
                            return true;
                        }
                        
                        return false;
                    };
                    
                    if (isPlayerOnline(minecraftUsername)) {
                        console.log(`[Discord] 🔴 CONFIRMED: ${minecraftUsername} is ONLINE in Minecraft and LEFT voice - Starting kick countdown`);
                        
                        try {
                            // STRATEGY 1: Try to import the minecraft-bot module and use its functions
                            console.log(`[Discord] Importing minecraft-bot functions`);
                            const minecraftBotModule = require('./minecraft-bot');
                            
                            if (typeof minecraftBotModule.startVoiceDisconnectCountdown === 'function') {
                                console.log(`[Discord] Starting voice disconnect countdown for ${minecraftUsername}`);
                                minecraftBotModule.startVoiceDisconnectCountdown(minecraftUsername, userId);
                            } else {
                                throw new Error('Function not available in import');
                            }
                        } catch (countdownErr) {
                            console.error(`[Discord] ⚠️ Error using module import: ${countdownErr.message}`);
                            
                            // STRATEGY 2: Try the global kick function and chat methods
                            console.log(`[Discord] 🔴 Using GLOBAL function method to handle disconnect`);
                            
                            // Send initial warning using various bot references
                            const sendWarningMessage = () => {
                                const warningMsg = `🔴 Voice Chat Disconnected! You have 30 seconds to rejoin DevilSMP's VC (VC-1, VC-2, or VC-3).`;
                                
                                if (minecraftBot && typeof minecraftBot.chat === 'function') {
                                    minecraftBot.chat(`/msg ${minecraftUsername} ${warningMsg}`);
                                    return true;
                                } else if (global.minecraftBot && typeof global.minecraftBot.chat === 'function') {
                                    global.minecraftBot.chat(`/msg ${minecraftUsername} ${warningMsg}`);
                                    return true;
                                }
                                return false;
                            };
                            
                            const warningSuccess = sendWarningMessage();
                            if (!warningSuccess) {
                                console.error(`[Discord] ⚠️ Failed to send warning message to player ${minecraftUsername}`);
                            }
                            
                            // Start a direct kick timer as fallback
                            setTimeout(() => {
                                console.log(`[Discord] Voice disconnect timer for ${minecraftUsername} expired - initiating kick`);
                                
                                // Try multiple methods to ensure the kick happens
                                let kickSuccess = false;
                                
                                // METHOD 1: Use global function reference
                                if (typeof global.kickPlayerWithMessage === 'function') {
                                    try {
                                        console.log(`[Discord] Using global kickPlayerWithMessage function`);
                                        kickSuccess = global.kickPlayerWithMessage(minecraftUsername, "Please Join DevilSMP's VC To Continue", userId);
                                        if (kickSuccess) return;
                                    } catch (kickErr) {
                                        console.error(`[Discord] Error using global kick function:`, kickErr);
                                    }
                                }
                                
                                // METHOD 2: Try direct bot methods
                                if (!kickSuccess && minecraftBot && typeof minecraftBot.chat === 'function') {
                                    try {
                                        console.log(`[Discord] Using minecraftBot chat function for kick`);
                                        minecraftBot.chat(`/op @s`);
                                        setTimeout(() => {
                                            minecraftBot.chat(`/kick ${minecraftUsername} Please Join DevilSMP's VC To Continue`);
                                        }, 500);
                                        kickSuccess = true;
                                    } catch (chatErr) {
                                        console.error(`[Discord] Error using bot.chat for kick:`, chatErr);
                                    }
                                }
                                
                                // METHOD 3: Last resort - global bot reference
                                if (!kickSuccess && global.minecraftBot && typeof global.minecraftBot.chat === 'function') {
                                    try {
                                        console.log(`[Discord] EMERGENCY: Using global bot reference for kick`);
                                        global.minecraftBot.chat(`/op @s`);
                                        setTimeout(() => {
                                            global.minecraftBot.chat(`/kick ${minecraftUsername} Please Join DevilSMP's VC To Continue`);
                                        }, 500);
                                    } catch (emergencyErr) {
                                        console.error(`[Discord] Emergency kick also failed:`, emergencyErr);
                                    }
                                }
                            }, 30000);
                        }
                    } else {
                        console.log(`[Discord] Player ${minecraftUsername} not found in online players list, no kick needed`);
                    }
                }
            } else {
                console.log(`[Discord] Could not find Minecraft username for Discord user ${username} (${userId})`);
                
                // Still update voice status in database if possible
                try {
                    await updatePlayerVoiceStatus(userId, channelIdToStore);
                } catch (err) {
                    console.error(`[Discord] Error updating voice status:`, err);
                }
            }
            
            // PHASE 4: Trigger a voice channel scan to ensure data stays in sync
            setTimeout(() => {
                try {
                    const guild = client.guilds.cache.get(TARGET_GUILD_ID);
                    if (guild) {
                        console.log(`[Discord] Running follow-up voice channel scan`);
                        scanVoiceChannels(guild);
                    }
                } catch (scanErr) {
                    console.error(`[Discord] Error in follow-up scan:`, scanErr);
                }
            }, 5000);
        } catch (err) {
            console.error('[Discord] Error handling voice state update:', err);
        }
    });
    
    /**
     * Send a message to a specific Discord channel
     * @param {string} channelId - The Discord channel ID to send the message to
     * @param {string} content - The message content to send
     * @returns {Promise<boolean>} - Whether the message was sent successfully
     */
    client.sendToChannel = async (channelId, content) => {
        try {
            if (!channelId || !content) {
                console.error('[Discord] Missing channelId or content for sendToChannel');
                return false;
            }
            
            // Get the channel
            const channel = await client.channels.fetch(channelId).catch(err => {
                console.error(`[Discord] Error fetching channel ${channelId}:`, err);
                return null;
            });
            
            if (!channel) {
                console.error(`[Discord] Could not find channel with ID: ${channelId}`);
                return false;
            }
            
            // Send the message
            await channel.send(content);
            console.log(`[Discord] Sent message to channel ${channelId}: ${content.length > 50 ? content.substring(0, 50) + '...' : content}`);
            return true;
        } catch (err) {
            console.error(`[Discord] Error sending message to channel ${channelId}:`, err);
            return false;
        }
    };

    // Log in to Discord
    client.login(token).catch(err => {
        console.error('[Discord] Login error:', err);
        process.exit(1);
    });

    return client;
}

module.exports = {
    startDiscordBot,
    // Export internal functions for cross-module access 
    scanVoiceChannels: (guild) => {
        if (typeof scanVoiceChannels === 'function') {
            return scanVoiceChannels(guild);
        }
        return null;
    }
};