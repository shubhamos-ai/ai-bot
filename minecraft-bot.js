/**
 * Minecraft Bot Implementation
 * Handles connection to Minecraft server, chat monitoring, and player management
 */

/**
 * Helper function to get a friendly label for a voice channel ID
 * @param {string|null} channelId - The Discord voice channel ID
 * @returns {string} - A user-friendly label for the channel
 */
function getChannelLabel(channelId) {
    if (!channelId) return "Not in voice channel";

    // Map channel IDs to friendly names
    switch (channelId) {
        case '1179321724785922088':
            return "VC-1";
        case '1182188218716790885':
            return "VC-2";
        case '1182188286232510605':
            return "VC-3";
        default:
            return `Channel ${channelId}`;
    }
}

const mineflayer = require('mineflayer');
const fs = require('fs').promises;
const { writePlayerData, readPlayerData, getPlayerVoiceChannel } = require('./mongodb-manager');
const { getPlayerByMinecraftUsername } = require('./db-manager');

// Define data folder path
const DATA_FOLDER = 'data';

// Player tracking maps
const playerVoiceStatus = new Map(); // Tracks player voice status
const playerKickTimers = new Map(); // Tracks timers for kicking players
const playerMessageTimers = new Map(); // Tracks timers for sending messages
const activePlayers = new Set(); // Tracks active players to detect when everyone leaves to players

// Define allowed voice channel IDs
const VOICE_CHANNEL_IDS = [
    '1179321724785922088', // VC-1
    '1182188218716790885', // VC-2
    '1182188286232510605'  // VC-3
];

// Voice channel label mapping for prettier display
const VOICE_CHANNEL_LABELS = {
    '1179321724785922088': 'VC-1',
    '1182188218716790885': 'VC-2',
    '1182188286232510605': 'VC-3'
};

// Mapping of voice channels to command channels in Discord
const COMMAND_CHANNEL_MAPPING = {
    '1179321724785922088': '1359964669363617943', // VC-1 → Command channel 1
    '1182188218716790885': '1359964697352343804', // VC-2 → Command channel 2
    '1182188286232510605': '1359964716541149184'  // VC-3 → Command channel 3
};

// Bot instance
let bot = null;

// Add chat history tracking
let chatHistory = [];

// Store bot start time for uptime calculations
const startTime = Date.now();

// Anti-AFK variables
let antiAfkInterval = null;
const ANTI_AFK_DELAY = 30000; // 30 seconds between anti-AFK actions

/**
 * Starts the Minecraft bot and connects to the server
 * @param {string} server - The Minecraft server address
 * @param {string} username - The Minecraft bot username
 * @param {Object} discordBot - The Discord bot instance
 * @returns {Object} - The Minecraft bot instance
 */
async function startMinecraftBot(server, username, discordBot) {
    // Create bot instance with connection throttling prevention
    bot = mineflayer.createBot({
        host: server,
        username: username,
        auth: 'offline', // Offline mode (no authentication with Mojang servers)
        version: '1.20.4',
        checkTimeoutInterval: 60000, // 60 seconds
        connectTimeout: 30000,       // 30 seconds
        // Add client settings for lower traffic to reduce throttling risk
        viewDistance: 'tiny',        // Use smallest view distance
        chatLengthLimit: 100         // Limit chat message length
    });

    // Handle bot errors
    bot.on('error', (err) => {
        console.error('[Minecraft] Error:', err);
    });

    // Handle bot login
    bot.on('login', () => {
        console.log(`[Minecraft] Bot logged in as ${username} on ${server}`);

        // Set a timeout to perform login after joining (wait for server to be ready to receive commands)
        setTimeout(() => {
            console.log('[Minecraft] Attempting to login to server...');
            bot.chat('/login RCL9JLVL');

            // Mark this bot instance as connected
            isConnectedOk = true;
            console.log('[Minecraft] 🟢 Bot successfully connected and marked as active');

            // Save reference to global
            global.minecraftBot = bot;

            // Set up global kick function for cross-module access
            global.kickPlayerWithMessage = kickPlayerWithMessage;
            console.log('[Minecraft] 🔄 Registered kickPlayerWithMessage in global scope for cross-module access');
        }, 5000);

        // Start the anti-AFK system to keep the bot active
        startAntiAFK();
    });

    /**
     * Starts the anti-AFK system to keep the bot from being kicked
     * Performs random movements and actions to simulate activity
     */
    function startAntiAFK() {
        // Clear any existing interval
        if (antiAfkInterval) {
            clearInterval(antiAfkInterval);
        }

        // Log anti-AFK start
        console.log('[Minecraft] 🤖 Starting anti-AFK system');

        // Set up interval for anti-AFK actions
        antiAfkInterval = setInterval(() => {
            try {
                // Only perform actions if the bot is still connected
                if (!bot.entity) return;

                // Get a random number 0-10 to determine what action to take
                const action = Math.floor(Math.random() * 11);

                // Perform a random action
                switch (action) {
                    case 0:
                        // Look around randomly
                        const yaw = Math.random() * Math.PI * 2;
                        const pitch = Math.random() * Math.PI - (Math.PI / 2);
                        bot.look(yaw, pitch, false);
                        console.log('[Minecraft] 👀 Anti-AFK: Looking around');
                        break;
                    case 1:
                        // Small jump on the spot
                        bot.setControlState('jump', true);
                        setTimeout(() => {
                            bot.setControlState('jump', false);
                        }, 500);
                        console.log('[Minecraft] 🦘 Anti-AFK: Small jump');
                        break;
                    case 2:
                        // Swing arm
                        bot.swingArm();
                        console.log('[Minecraft] 💪 Anti-AFK: Swinging arm');
                        break;
                    case 3:
                        // Sneak briefly
                        bot.setControlState('sneak', true);
                        setTimeout(() => {
                            bot.setControlState('sneak', false);
                        }, 1000);
                        console.log('[Minecraft] 🐱 Anti-AFK: Sneaking');
                        break;
                    default:
                        // Small movements (forward/back/left/right)
                        const moveAction = action % 4;
                        let direction = '';

                        switch (moveAction) {
                            case 0:
                                bot.setControlState('forward', true);
                                direction = 'forward';
                                break;
                            case 1:
                                bot.setControlState('back', true);
                                direction = 'back';
                                break;
                            case 2:
                                bot.setControlState('left', true);
                                direction = 'left';
                                break;
                            case 3:
                                bot.setControlState('right', true);
                                direction = 'right';
                                break;
                        }

                        // Stop moving after a short time
                        setTimeout(() => {
                            bot.setControlState('forward', false);
                            bot.setControlState('back', false);
                            bot.setControlState('left', false);
                            bot.setControlState('right', false);
                        }, 500);

                        console.log(`[Minecraft] 🚶 Anti-AFK: Small movement ${direction}`);
                        break;
                }
            } catch (err) {
                console.error('[Minecraft] ❌ Error in anti-AFK system:', err);
            }
        }, ANTI_AFK_DELAY);
    }

    // Track connection information
    const connectionState = {
        reconnectAttempts: 0,
        maxReconnectAttempts: 10,
        lastConnectionTime: Date.now(),
        connectionThrottled: false,
        initialReconnectDelay: 60000,  // Start with 1 minute delay
        maxReconnectDelay: 600000      // Maximum delay of 10 minutes
    };

    // Check if bot is already connected successfully and working
    let isConnectedOk = false;

    // Function to check if a bot is actually functional
    const isBotFunctional = () => {
        try {
            // Check if we have a properly connected bot
            if (bot && bot.entity && bot.entity.username) {
                return true;
            }
            return false;
        } catch (err) {
            return false;
        }
    };

    // Function to handle reconnect with adaptive delay 
    // This will ALWAYS reconnect to keep the bot running forever
    const handleReconnect = (reason) => {
        // Check if another bot instance is already working
        if (global.minecraftBot && isBotFunctional()) {
            console.log('[Minecraft] ⚠️ Another bot instance is already running. Skipping reconnection.');
            return;
        }

        // Skip reconnection if this bot instance is already flagged as connected
        if (isConnectedOk) {
            console.log('[Minecraft] ⚠️ This bot instance is already connected. Skipping redundant reconnection.');
            return;
        }

        const currentTime = Date.now();
        const timeSinceLastConnection = currentTime - connectionState.lastConnectionTime;
        let reconnectTime = 10000; // Default 10 seconds

        // Check for throttling messages
        if (String(reason).includes('throttled')) {
            // Use exponential backoff for throttling (min: 60s, max: 5 minutes)
            reconnectTime = Math.min(60000 * Math.pow(1.5, connectionState.reconnectAttempts), 300000);
            console.log(`[Minecraft] ⚠️ Connection throttled detected! Using longer delay of ${reconnectTime/1000} seconds`);
        }

        // Reset reconnect attempts if the bot was connected for more than 5 minutes
        if (timeSinceLastConnection > 300000) {
            connectionState.reconnectAttempts = 0;
            console.log('[Minecraft] 🔄 Resetting reconnection counter due to previous stable connection');
        }

        connectionState.reconnectAttempts++;
        connectionState.lastConnectionTime = currentTime;

        // Log attempt number with consistent formatting
        console.log(`[Minecraft] 🔌 Attempt ${connectionState.reconnectAttempts}. Reconnecting in ${reconnectTime/1000} seconds...`);

        // Set timeout to reconnect
        setTimeout(() => {
            // Double-check before reconnecting
            if (global.minecraftBot && isBotFunctional()) {
                console.log('[Minecraft] ⚠️ Bot already reconnected by another instance. Skipping reconnection.');
                return;
            }

            console.log('[Minecraft] 🔄 Attempting to reconnect now...');
            startMinecraftBot(server, username, discordBot);
        }, reconnectTime);
    };

    // Handle bot kicked from server
    bot.on('kicked', (reason) => {
        console.log(`[Minecraft] Bot was kicked from the server: ${reason}`);
        handleReconnect(reason);
    });

    // Handle bot disconnected from server
    bot.on('end', () => {
        console.log('[Minecraft] Bot disconnected from the server');
        handleReconnect('disconnected');
    });

    // Handle chat messages
    bot.on('message', async (message) => {
        const messageStr = message.toString();

        // Filter out coordinate and temperature messages to keep console clean
        if (!messageStr.match(/XYZ: .+ [0-9]{1,2}:[0-9]{2}/) && 
            !messageStr.match(/\[ -?[0-9]{1,2}°C \]/)) {
            console.log(`[Minecraft] Chat: ${messageStr}`);
        }

        // Store message in chat history
        chatHistory.push(messageStr);

        // Keep chat history limited to the last 10 messages
        if (chatHistory.length > 10) {
            chatHistory.shift();
        }

        // Check for "devil pls" commands from players
        const devilPlsMatch = messageStr.match(/<([^>]+)>\s+devil\s+pls\s+(.*)/i);
        if (devilPlsMatch) {
            const sender = devilPlsMatch[1];
            const commandContent = devilPlsMatch[2];

            console.log(`[Minecraft] Detected "devil pls" command from ${sender}: ${commandContent}`);

            try {
                // Get player data to find their Discord ID
                const playerData = await getPlayerByMinecraftUsername(sender);

                if (playerData && playerData.discordId) {
                    // Get the player's voice channel using their Discord ID
                    const voiceChannelId = await getPlayerVoiceChannel(playerData.discordId);

                    console.log(`[Minecraft] Player ${sender} voice channel lookup result: ${voiceChannelId || 'Not in voice'}`);

                    if (voiceChannelId) {
                        const commandChannelId = COMMAND_CHANNEL_MAPPING[voiceChannelId];

                        if (commandChannelId) {
                            // Create formatted message for Discord
                            const channelLabel = VOICE_CHANNEL_LABELS[voiceChannelId] || 'Unknown Channel';
                            const formattedMessage = `${playerData.discordId} : ${sender} : ${commandContent}`;

                            console.log(`[Minecraft] Forwarding message from ${sender} in ${channelLabel} to Discord command channel ${commandChannelId}`);

                            // Forward message to Discord if Discord bot is available
                            if (discordBot && typeof discordBot.sendToChannel === 'function') {
                                await discordBot.sendToChannel(commandChannelId, formattedMessage);
                            } else {
                                console.error('[Minecraft] Cannot forward message: Discord bot not available or missing sendToChannel function');
                            }
                        } else {
                            console.log(`[Minecraft] No command channel mapping found for voice channel ${voiceChannelId}`);
                        }
                    } else {
                        console.log(`[Minecraft] Player ${sender} found but not in a voice channel`);
                    }
                } else {
                    console.log(`[Minecraft] Player ${sender} not found in database`);
                }
            } catch (err) {
                console.error(`[Minecraft] Error forwarding "devil pls" command:`, err);
            }
        }

        // SIMPLIFIED APPROACH: Check if message has @SHUBHAMOS in it
        if (messageStr.includes('@SHUBHAMOS') || messageStr.toLowerCase().includes('@shubhamos')) {
            console.log(`[Minecraft] Command detected: ${messageStr}`);

            // Simple extract of sender using <PLAYER> format
            let sender = null;
            let discordId = null;

            // Most Minecraft chat formats have <PLAYER> at the beginning
            const chatMatch = messageStr.match(/<([^>]+)>/);
            if (chatMatch && chatMatch[1]) {
                sender = chatMatch[1];
                console.log(`[Minecraft] Command from player: ${sender}`);

                // Look up the Discord ID for this player
                try {
                    const playerData = await readPlayerData();
                    for (const [id, data] of Object.entries(playerData)) {
                        const username = typeof data === 'object' ? data.minecraftUsername : data;
                        if (username === sender) {
                            discordId = id;
                            console.log(`[Minecraft] Found Discord ID ${discordId} for player ${sender}`);
                            break;
                        }
                    }
                } catch (err) {
                    console.error('[Minecraft] Error looking up Discord ID:', err);
                }
            }

            // Store the entire original message for logging
            let fullMessage = messageStr;

            // Print full raw message for debugging
            console.log(`[Minecraft] 📝 Raw message received: "${messageStr}"`);

            // The messageStr format from screenshots appears to be "<PLAYER> @SHUBHAMOS message"
            // We need to capture the ENTIRE message, not just the part up to @SHUBHAMOS

            // Extract the command text after @SHUBHAMOS for command processing
            let command = "";
            let commandName = "";
            let args = [];

            // Initialize permission flag - define outside the if block so it's accessible throughout
            let hasPermission = false;

            // Owner and bot always have permission
            if (sender === 'DEVILKINGS_07' || discordId === '635399541742632960' || 
                sender && sender.toUpperCase() === 'SHUBHAMOS') {
                hasPermission = true;
            } else if (discordId) {
                // Check if player is in voice channel
                const voiceChannelId = await getPlayerVoiceChannel(discordId);
                if (voiceChannelId && VOICE_CHANNEL_IDS.includes(voiceChannelId)) {
                    hasPermission = true;
                }
            }

            if (messageStr.includes('@SHUBHAMOS')) {
                command = messageStr.split('@SHUBHAMOS')[1] ? messageStr.split('@SHUBHAMOS')[1].trim() : "";
            } else if (messageStr.toLowerCase().includes('@shubhamos')) {
                command = messageStr.split('@shubhamos')[1] ? messageStr.split('@shubhamos')[1].trim() : "";
            }

            console.log(`[Minecraft] Extracted command content for processing: "${command}"`);
            console.log(`[Minecraft] Full message for storage: "${fullMessage}"`);
            console.log(`[Minecraft] Player ${sender} permission status: ${hasPermission ? 'Has permission' : 'No permission'}`);

            // Special debug checks to show exact message content
            if (fullMessage) {
                console.log(`[Minecraft] 🔍 Message components check:`);
                console.log(`   - Message length: ${fullMessage.length}`);
                console.log(`   - Full hex: ${Buffer.from(fullMessage).toString('hex')}`);

                // If message contains @SHUBHAMOS, show the parts
                if (fullMessage.includes('@SHUBHAMOS')) {
                    const parts = fullMessage.split('@SHUBHAMOS');
                    console.log(`   - Before @SHUBHAMOS: "${parts[0]}"`);
                    console.log(`   - After @SHUBHAMOS: "${parts[1] || ''}"`);
                }
            }

            // Process commands with a more structured approach
            if (command && command.length > 0) {
                // Split the command into parts (command name and arguments)
                const parts = command.trim().split(/\s+/);
                commandName = parts[0].toLowerCase();
                args = parts.slice(1);

                // Process commands
                switch (commandName) {
                    case 'refresh':
                        console.log(`[Minecraft] Processing refresh command: ${command}`);

                        // Check if there's a specific username mentioned
                        const targetUsername = args.join(' ').trim();

                        if (targetUsername && targetUsername.length > 0) {
                            // Try to find Discord ID for this username
                            let targetDiscordId = null;
                            try {
                                const playerData = await readPlayerData();
                                for (const [id, data] of Object.entries(playerData)) {
                                    const username = typeof data === 'object' ? data.minecraftUsername : data;
                                    if (username && username.toLowerCase() === targetUsername.toLowerCase()) {
                                        targetDiscordId = id;
                                        break;
                                    }
                                }

                                if (targetDiscordId) {
                                    console.log(`[Minecraft] Refreshing data for player ${targetUsername} (${targetDiscordId})`);
                                    await refreshPlayerData(targetUsername, targetDiscordId, discordBot);
                                    bot.chat(`Refreshed data for player ${targetUsername}`);
                                } else {
                                    console.log(`[Minecraft] Could not find Discord ID for player ${targetUsername}`);
                                    bot.chat(`Could not find Discord ID for player ${targetUsername}`);
                                }
                            } catch (err) {
                                console.error(`[Minecraft] Error finding player data for refresh:`, err);
                                bot.chat(`Error refreshing data for player ${targetUsername}`);
                            }
                        } else {
                            // Refresh data for all known players
                            try {
                                console.log(`[Minecraft] Refreshing data for all players`);
                                const playerData = await readPlayerData();
                                let refreshCount = 0;

                                for (const [id, data] of Object.entries(playerData)) {
                                    const username = typeof data === 'object' ? data.minecraftUsername : data;
                                    if (username) {
                                        await refreshPlayerData(username, id, discordBot);
                                        refreshCount++;
                                    }
                                }

                                bot.chat(`Refreshed data for ${refreshCount} players`);
                            } catch (err) {
                                console.error(`[Minecraft] Error refreshing all player data:`, err);
                                bot.chat(`Error refreshing player data: ${err.message}`);
                            }
                        }
                        break;

                    case 'help':
                        // Send help information about available commands
                        bot.chat(`Available commands: refresh, help, status, players`);
                        break;

                    case 'status':
                        // Send status information about the bot
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = uptime % 60;

                        bot.chat(`Bot Status: Running for ${hours}h ${minutes}m ${seconds}s | Players monitored: ${playerVoiceStatus.size}`);
                        break;

                    case 'players':
                        // Send information about players in voice chat
                        try {
                            const playerData = await readPlayerData();
                            const playersInVoice = [];

                            for (const [id, data] of Object.entries(playerData)) {
                                const username = typeof data === 'object' ? data.minecraftUsername : data;
                                const voiceChannel = await getPlayerVoiceChannel(id);
                                if (voiceChannel && VOICE_CHANNEL_IDS.includes(voiceChannel)) {
                                    const channelLabel = VOICE_CHANNEL_LABELS[voiceChannel] || voiceChannel;
                                    playersInVoice.push(`${username} (${channelLabel})`);
                                }
                            }

                            if (playersInVoice.length > 0) {
                                bot.chat(`Players in voice: ${playersInVoice.join(', ')}`);
                            } else {
                                bot.chat(`No players are currently in voice channels.`);
                            }
                        } catch (err) {
                            console.error(`[Minecraft] Error getting player voice data:`, err);
                            bot.chat(`Error retrieving player data.`);
                        }
                        break;

                    default:
                        // For unrecognized commands, simply acknowledge
                        if (hasPermission) {
                            bot.chat(`Received command: ${commandName}`);
                        } else {
                            bot.chat(`You must be in a voice channel to use commands!`);
                        }
                }
            }

            // Save the command with enhanced metadata (timestamp added automatically in the function)
            const { saveCommand } = require('./db-manager');
            await saveCommand(command, sender, discordId);

            // If we have a sender and their Discord ID, try to save to their voice channel file
            if (sender && discordId) {
                try {
                    const { savePlayerMessageToChannelFile } = require('./mongodb-manager');

                    // In our simplified approach, we just use the full message directly
                    const messageToSave = fullMessage;

                    // Log what we're about to save
                    console.log(`[Minecraft] 💾 Saving complete message to database: "${messageToSave}"`);

                    // This is critical - we want to save the full message including any text after @SHUBHAMOS
                    // We're passing the same string for both message and commandContent parameters
                    const saved = await savePlayerMessageToChannelFile(discordId, sender, messageToSave, messageToSave);

                    if (saved) {
                        console.log(`[Minecraft] ✅ Saved the entire message to voice channel file for player ${sender}`);
                        console.log(`[Minecraft] ✅ Message saved: "${messageToSave}"`);
                    }
                } catch (err) {
                    console.error('[Minecraft] Error saving to channel file:', err);
                }
            }

            // Only send a generic confirmation if we haven't already handled the command
            if (!command.toLowerCase().startsWith('refresh') && 
                !command.toLowerCase().startsWith('help') && 
                !command.toLowerCase().startsWith('status') && 
                !command.toLowerCase().startsWith('players')) {

                // Different response based on permission
                if (sender && discordId) {
                    if (hasPermission) {
                        bot.chat(`Command "${commandName}" received from ${sender}!`);
                    } else {
                        bot.chat(`${sender}, you need to be in a voice channel to use commands.`);
                    }
                } else {
                    bot.chat(`Command received and saved!`);
                }
            }
        }

        // Add chat history to the bot for easy reference
        bot.chatHistory = chatHistory;

        // We've already handled @SHUBHAMOS messages with the primary handler above,
        // so no need to process them again here.

        // Check for player response - Processing the specific format shown in the image
        if (messageStr.includes('Interpreted target as Minecraft player')) {
            try {
                console.log('[Minecraft] Processing player identification message:', messageStr);

                // We'll process this message specifically as it contains Minecraft username and Discord ID
                // Format from image: "Interpreted target as Minecraft player\n- Player: Legendslayer_07 (5610079a-50de-35d9-ac39-81e1afbc13be)\n- Discord: legendslayer_07 (#1355041621850194000) (legendslayer_07#0) 1355041621850194000"

                // Extract the Minecraft username
                const playerMatch = messageStr.match(/- Player:\s*([^\s(]+)/);
                let minecraftUsername = null;
                if (playerMatch && playerMatch[1]) {
                    minecraftUsername = playerMatch[1];
                    console.log(`[Minecraft] Extracted Minecraft username: ${minecraftUsername}`);
                }

                // Extract Discord ID - it's the numeric ID at the end of the Discord line
                const discordMatch = messageStr.match(/\(#(\d+)\)|(\d+)$/);
                let discordId = null;
                if (discordMatch) {
                    // Use the first capture group that matched
                    discordId = discordMatch[1] || discordMatch[2];
                    console.log(`[Minecraft] Extracted Discord ID: ${discordId}`);
                }

                if (minecraftUsername && discordId) {
                    console.log(`[Minecraft] Linked player ${minecraftUsername} with Discord ID ${discordId}`);

                    // Update player data and check voice status
                    await writePlayerData(discordId, minecraftUsername);
                    await checkPlayerVoiceStatus(minecraftUsername, discordId, discordBot);
                } else {
                    console.log('[Minecraft] Could not extract both Minecraft username and Discord ID from message');
                }
            } catch (err) {
                console.error('[Minecraft] Error processing player identification:', err);
            }
        }

        // Keep the old handler for backward compatibility
        else if (messageStr.includes('- Discord:')) {
            try {
                console.log('[Minecraft] Processing Discord user info (legacy format):', messageStr);

                // Format example: "- Discord: legendslayer_07 (#1355041621850194000) (legendslayer_07#0) 1355041621850194000"
                // Extract the Discord ID, which is the last number in the line
                const discordMatch = messageStr.match(/(\d+)\s*$/);

                if (discordMatch && discordMatch[1]) {
                    const discordId = discordMatch[1];
                    console.log(`[Minecraft] Extracted Discord ID: ${discordId}`);

                    // Get the most recent player name from previous message
                    // Find the latest "- Player:" message in chat history
                    let minecraftUsername = null;

                    // Print the chat history for debugging
                    console.log('[Minecraft] Scanning chat history for player info:');
                    chatHistory.forEach((msg, idx) => {
                        console.log(`[Minecraft] Chat history [${idx}]: ${msg}`);
                    });

                    // Look through recent chat history for player info
                    for (let i = chatHistory.length - 2; i >= 0; i--) {
                        const historyMessage = chatHistory[i];
                        if (historyMessage.includes('- Player:')) {
                            // Format example: "- Player: Legendslayer_07 (5610079a-50de-35d9-ac39-81e1afbc13be)"
                            const playerMatch = historyMessage.match(/- Player:\s*([^\s(]+)/);
                            if (playerMatch && playerMatch[1]) {
                                minecraftUsername = playerMatch[1];
                                console.log(`[Minecraft] Found Minecraft username in chat history: ${minecraftUsername}`);
                                break;
                            }
                        }
                    }

                    if (minecraftUsername) {
                        console.log(`[Minecraft] Linked player ${minecraftUsername} with Discord ID ${discordId}`);

                        // Update player data and check voice status
                        await writePlayerData(discordId, minecraftUsername);
                        await checkPlayerVoiceStatus(minecraftUsername, discordId, discordBot);
                    } else {
                        console.log('[Minecraft] Could not find Minecraft username in recent chat history');
                    }
                }
            } catch (err) {
                console.error('[Minecraft] Error processing Discord info:', err);
            }
        }
    });

    // Handle player joining server
    bot.on('playerJoined', async (player) => {
        console.log(`[Minecraft] Player joined: ${player.username}`);

        // Add player to active players list (don't track bot itself)
        if (player.username.toUpperCase() !== 'SHUBHAMOS') {
            activePlayers.add(player.username);
            console.log(`[Minecraft] Active players: ${Array.from(activePlayers).join(', ')}`);
        }

        // Send command to check Discord link
        setTimeout(() => {
            bot.chat(`/discord linked ${player.username}`);
        }, 1000);

        // Check if this is a known player
        try {
            const playerData = await readPlayerData();
            let discordId = null;

            // Find player's Discord ID
            for (const [id, data] of Object.entries(playerData)) {
                const username = typeof data === 'object' ? data.minecraftUsername : data;
                if (username === player.username) {
                    discordId = id;
                    break;
                }
            }

            if (discordId) {
                console.log(`[Minecraft] Found existing Discord ID for player ${player.username}: ${discordId}`);

                // Check the player's voice channel using direct Discord API first for real-time data
                if (discordBot) {
                    // Get the specific guild by ID
                    const TARGET_GUILD_ID = '784763845763006474';
                    const guild = discordBot.guilds.cache.get(TARGET_GUILD_ID);

                    if (guild) {
                        console.log(`[Minecraft] Checking Discord guild ${TARGET_GUILD_ID} for player ${player.username}`);

                        // Fetch guild member for fresh voice state
                        const member = await guild.members.fetch(discordId).catch(err => {
                            console.error(`[Discord] Error fetching member ${discordId}:`, err);
                            return null;
                        });

                        if (member) {
                            const voiceChannel = member.voice.channel;

                            if (voiceChannel) {
                                console.log(`[Minecraft] Player ${player.username} is currently in voice channel: ${voiceChannel.id}`);

                                // Get a friendly channel label
                                // Use the local getChannelLabel function
                                const channelLabel = getChannelLabel(voiceChannel.id);

                                // Update player voice channel status in database
                                const { updatePlayerVoiceChannel } = require('./mongodb-manager');
                                await updatePlayerVoiceChannel(discordId, player.username, voiceChannel.id, null);

                                // DELAYED NOTIFICATION: Wait 5 seconds before sending "detected in" message
                                setTimeout(() => {
                                    console.log(`[Minecraft] 📢 Sending voice channel detection message to ${player.username}: ${channelLabel}`);
                                    bot.chat(`/msg ${player.username} You were detected in ${channelLabel}`);
                                }, 5000);

                                // Clear any existing timers for this player
                                if (playerKickTimers.has(player.username)) {
                                    clearTimeout(playerKickTimers.get(player.username));
                                    playerKickTimers.delete(player.username);
                                }

                                if (playerMessageTimers.has(player.username)) {
                                    clearTimeout(playerMessageTimers.get(player.username));
                                    playerMessageTimers.delete(player.username);
                                }

                                return;
                            } else {
                                // NOT IN VOICE CHANNEL: Start the 30-second warning immediately
                                console.log(`[Minecraft] IMMEDIATE CHECK: Player ${player.username} is not in any voice channel, starting 30-second warning`);

                                // Start countdown timer for voice requirements immediately
                                setTimeout(() => {
                                    //                                    // Send voice channel warning with specific countdown
                                    bot.chat(`/msg ${player.username} 🔴 Please join one of DevilSMP's voice channels (VC-1, VC-2, or VC-3) to continue playing.`);
                                    startVoiceReminderTimer(player.username, discordId);
                                }, 1000);
                            }
                        }
                    }
                }

                // Fallback to database if direct check fails
                const { getPlayerVoiceChannel } = require('./mongodb-manager');
                const currentChannel = await getPlayerVoiceChannel(discordId);

                if (currentChannel) {
                    console.log(`[Minecraft] Player ${player.username} is in voice channel (db): ${currentChannel}`);

                    // Get a friendly channel label using local function
                    const channelLabel = getChannelLabel(currentChannel);

                    // Use /msg command to send a direct message to the player
                    setTimeout(() => {
                        console.log(`[Minecraft] 📢 Sending voice channel status to ${player.username}: ${channelLabel}`);
                        bot.chat(`/msg ${player.username} You are connected to ${channelLabel}`);
                    }, 5000);
                } else {
                    console.log(`[Minecraft] Player ${player.username} is not in any voice channel (db check)`);

                    // Skip warning for whitelisted players
                    if (player.username.toUpperCase() === 'SHUBHAMOS' || 
                        player.username === 'DEVILKINGS_07' || 
                        discordId === '635399541742632960') {
                        console.log(`[Minecraft] Skipping voice channel warning for whitelisted player: ${player.username}`);
                    } else {
                        console.log(`[Minecraft] Player ${player.username} needs to join voice - starting countdown`);

                        // Start countdown timer for voice requirements
                        setTimeout(() => {
                            // Send voice channel warning with specific countdown
                            bot.chat(`/msg ${player.username} 🔴 Please join one of DevilSMP's voice channels (VC-1, VC-2, or VC-3) to continue playing.`);
                            startVoiceReminderTimer(player.username, discordId);
                        }, 3000);
                    }
                }
            }
        } catch (err) {
            console.error(`[Minecraft] Error checking voice status for player ${player.username}:`, err);
        }
    });

    // Handle player leaving server
    bot.on('playerLeft', async (player) => {
        console.log(`[Minecraft] Player left: ${player.username}`);

        // Clear any timers for this player
        if (playerKickTimers.has(player.username)) {
            clearTimeout(playerKickTimers.get(player.username));
            playerKickTimers.delete(player.username);
        }

        if (playerMessageTimers.has(player.username)) {
            clearTimeout(playerMessageTimers.get(player.username));
            playerMessageTimers.delete(player.username);
        }

        // Remove from tracking
        playerVoiceStatus.delete(player.username);

        // Remove from active players (don't track bot itself)
        if (player.username.toUpperCase() !== 'SHUBHAMOS') {
            // Find player's Discord ID to clear their specific data
            try {
                const playerData = await readPlayerData();
                let discordId = null;

                // Find player's Discord ID (case-insensitive for better matching)
                for (const [id, data] of Object.entries(playerData)) {
                    const username = typeof data === 'object' ? data.minecraftUsername : data;
                    if (username.toLowerCase() === player.username.toLowerCase()) {
                        discordId = id;
                        break;
                    }
                }

                if (discordId) {
                    console.log(`[Minecraft] Found Discord ID for leaving player ${player.username}: ${discordId}`);

                    // IMPORTANT: Clear this player's voice channel data when they leave the server
                    try {
                        // First, explicitly update voice status to null
                        await updateCommandsWithVoiceStatus(discordId, player.username, null);
                        console.log(`[Minecraft] Updated voice status to null for player ${player.username} who left the server`);

                        // Then clear their voice channel data from database
                        const { clearPlayerData } = require('./db-manager');
                        await clearPlayerData(discordId, player.username);
                        console.log(`[Minecraft] Successfully cleared voice channel data for player ${player.username} who left the server`);
                    } catch (err) {
                        console.error(`[Minecraft] Error clearing data for player ${player.username}:`, err);
                    }
                }
            } catch (err) {
                console.error(`[Minecraft] Error finding Discord ID for leaving player ${player.username}:`, err);
            }

            activePlayers.delete(player.username);
            console.log(`[Minecraft] Active players: ${Array.from(activePlayers).join(', ') || 'None'}`);

            // If there are no players left (besides the bot)
            if (activePlayers.size === 0) {
                console.log('[Minecraft] All players have left the server.');
                console.log('[Minecraft] Player data will be kept even when all players leave as requested.');
                console.log('[Minecraft] Anti-AFK system will continue running to maintain server connection.');
            }
        }
    });

    return bot;
}

/**
 * Refreshes all player data for a given Minecraft username or Discord ID
 * Used when inconsistencies or issues are detected
 * @param {string} minecraftUsername - The player's Minecraft username
 * @param {string} discordId - The player's Discord ID
 * @param {Object} discordBot - The Discord bot instance
 */
async function refreshPlayerData(minecraftUsername, discordId, discordBot) {
    console.log(`[Minecraft] Refreshing player data for ${minecraftUsername} (${discordId})`);

    try {
        // Get the specific guild
        const TARGET_GUILD_ID = '784763845763006474';
        const guild = discordBot.guilds.cache.get(TARGET_GUILD_ID);

        if (!guild) {
            console.error(`[Minecraft] Target Discord guild ${TARGET_GUILD_ID} not found during refresh`);
            return;
        }

        // Try to fetch the member directly from Discord
        let member;
        try {
            member = await guild.members.fetch(discordId);
        } catch (err) {
            console.error(`[Minecraft] Failed to fetch member ${discordId} during refresh:`, err.message);
            return;
        }

        if (!member) {
            console.log(`[Minecraft] Discord member ${discordId} not found in guild during refresh`);
            return;
        }

        // Re-save player data
        await writePlayerData(discordId, minecraftUsername);

        // Check if player is in a voice channel
        const voiceChannel = member.voice.channel;

        if (voiceChannel) {
            console.log(`[Minecraft] Refresh found player ${minecraftUsername} in voice channel: ${voiceChannel.id}`);
            const { updatePlayerVoiceChannel } = require('./mongodb-manager');
            await updatePlayerVoiceChannel(discordId, minecraftUsername, voiceChannel.id);
        } else {
            console.log(`[Minecraft] Refresh found player ${minecraftUsername} not in any voice channel`);
            const { updatePlayerVoiceChannel } = require('./mongodb-manager');
            await updatePlayerVoiceChannel(discordId, minecraftUsername, null);
        }

        console.log(`[Minecraft] Player data refresh completed for ${minecraftUsername}`);
    } catch (err) {
        console.error(`[Minecraft] Error refreshing player data for ${minecraftUsername}:`, err);
    }
}

/**
 * Checks a player's voice status and manages their access
 * @param {string} minecraftUsername - The player's Minecraft username
 * @param {string} discordId - The player's Discord ID
 * @param {Object} discordBot - The Discord bot instance
 */
async function checkPlayerVoiceStatus(minecraftUsername, discordId, discordBot) {
    try {
        // Don't enforce voice channel rules for the bot itself
        if (minecraftUsername.toUpperCase() === 'SHUBHAMOS') {
            console.log(`[Minecraft] Not checking voice status for bot account: ${minecraftUsername}`);
            return;
        }

        // Save player data
        await writePlayerData(discordId, minecraftUsername);
        console.log(`[Minecraft] Saved player data: ${discordId} = ${minecraftUsername}`);

        // Define target guild and allowed channels
        const TARGET_GUILD_ID = '784763845763006474';
        const ALLOWED_VOICE_CHANNELS = [
            '1179321724785922088',
            '1182188218716790885',
            '1182188286232510605'
        ];

        // Log player check
        console.log(`[Minecraft] Checking voice status for player: ${minecraftUsername} (${discordId})`);

        // This is a double-check mechanism: first check if player data shows they are in a voice channel
        // This uses the data that gets updated by the Discord bot's periodic scanning
        const playerData = await readPlayerData();
        const commandsData = await fs.readFile(`${DATA_FOLDER}/commands.txt`, 'utf8').catch(() => '');

        // Check all lines in commands.txt for this player's latest voice status
        const commandLines = commandsData.split('\n').filter(line => line.trim().length > 0);
        const playerVoiceLines = commandLines.filter(line => line.includes(discordId));

        // Look for any indication that the player is in an allowed voice channel
        let foundInAllowedChannel = false;

        if (playerVoiceLines.length > 0) {
            // Get the most recent entry
            const latestEntry = playerVoiceLines[playerVoiceLines.length - 1];

            // Check if the entry indicates the player is in a voice channel
            ALLOWED_VOICE_CHANNELS.forEach(channelId => {
                if (latestEntry.includes(channelId)) {
                    foundInAllowedChannel = true;
                    console.log(`[Minecraft] Found player ${minecraftUsername} in allowed voice channel from records: ${channelId}`);
                }
            });
        }

        // If we found them in a voice channel from records, clear any timers and update status
        if (foundInAllowedChannel) {
            // Clear any existing timers
            if (playerKickTimers.has(minecraftUsername)) {
                clearTimeout(playerKickTimers.get(minecraftUsername));
                playerKickTimers.delete(minecraftUsername);
                console.log(`[Minecraft] Cleared kick timer for ${minecraftUsername} - found in allowed voice channel`);
            }

            if (playerMessageTimers.has(minecraftUsername)) {
                clearTimeout(playerMessageTimers.get(minecraftUsername));
                playerMessageTimers.delete(minecraftUsername);
                console.log(`[Minecraft] Cleared message timer for ${minecraftUsername} - found in allowed voice channel`);
            }

            return;
        }

        // If we're here, we didn't find evidence of voice channel in files, so try direct Discord API check

        // Get the specific guild by ID
        const guild = discordBot.guilds.cache.get(TARGET_GUILD_ID);
        if (!guild) {
            console.error(`[Minecraft] Target Discord guild ${TARGET_GUILD_ID} not found`);
            return;
        }

        // Fetch guild member
        const member = await guild.members.fetch(discordId).catch(err => {
            console.error(`[Discord] Error fetching member ${discordId}:`, err);
            return null;
        });

        if (!member) {
            console.log(`[Minecraft] Discord member ${discordId} not found in guild ${TARGET_GUILD_ID}`);
            // Kick player if not in guild
            kickPlayerWithMessage(minecraftUsername, 'Discord account not found in server', discordId);
            return;
        }

        // Check if player is in a voice channel
        const voiceChannel = member.voice.channel;

        // Check if they're in one of the allowed voice channels
        const isInAllowedChannel = voiceChannel && ALLOWED_VOICE_CHANNELS.includes(voiceChannel.id);

        if (isInAllowedChannel) {
            console.log(`[Minecraft] Player ${minecraftUsername} found in allowed voice channel: ${voiceChannel.id}`);

            // Check if they had active warnings/timers
            const hadActiveTimers = playerKickTimers.has(minecraftUsername) || playerMessageTimers.has(minecraftUsername);

            // Clear any existing timers
            if (playerKickTimers.has(minecraftUsername)) {
                clearTimeout(playerKickTimers.get(minecraftUsername));
                playerKickTimers.delete(minecraftUsername);
                console.log(`[Minecraft] 👍 Cancelled kick timer for ${minecraftUsername} - joined voice channel`);
            }

            if (playerMessageTimers.has(minecraftUsername)) {
                clearInterval(playerMessageTimers.get(minecraftUsername));
                playerMessageTimers.delete(minecraftUsername);
                console.log(`[Minecraft] 👍 Cancelled warning messages for ${minecraftUsername} - joined voice channel`);
            }

            // Update player status
            playerVoiceStatus.set(minecraftUsername, voiceChannel.id);
            await updateCommandsWithVoiceStatus(discordId, minecraftUsername, voiceChannel.id);

            // Send welcome message only if this is their first join
            // or if they had active timers (meaning they joined after being warned)
            const isNewJoin = !playerVoiceStatus.has(minecraftUsername) || playerVoiceStatus.get(minecraftUsername) !== voiceChannel.id;

            if (isNewJoin || hadActiveTimers) {
                try {
                    // Get a friendly channel name for display
                    let channelName = "Unknown Channel";
                    if (voiceChannel.id === '1179321724785922088') channelName = "VC-1";
                    else if (voiceChannel.id === '1182188218716790885') channelName = "VC-2";
                    else if (voiceChannel.id === '1182188286232510605') channelName = "VC-3";

                    // Send confirmation message after a 1-second delay
                    setTimeout(() => {
                        bot.chat(`/msg ${minecraftUsername} ✅ You are connected to ${channelName}. You can continue playing!`);
                        console.log(`[Minecraft] Sent voice channel confirmation to ${minecraftUsername} for channel ${channelName}`);
                    }, 1000);
                } catch (err) {
                    console.error(`[Minecraft] Error sending welcome message:`, err);
                }
            }

            return;
        }

        // If we reach here, the player is not in an allowed voice channel
        // Double-check again that this is not the bot itself (extra safety)
        if (minecraftUsername.toUpperCase() === 'SHUBHAMOS') {
            console.log(`[Minecraft] Bot account ${minecraftUsername} is exempt from voice channel requirements`);
            return;
        }

        // No overrides - all players must be in a voice channel

        if (voiceChannel) {
            console.log(`[Minecraft] Player ${minecraftUsername} (${discordId}) is in non-allowed voice channel: ${voiceChannel.id}`);
            bot.chat(`/msg ${minecraftUsername} You must join one of the allowed voice channels to play`);
        } else {
            console.log(`[Minecraft] Player ${minecraftUsername} (${discordId}) is not in a voice channel`);
        }

        // Start the disconnect countdown (includes notification)
        startVoiceDisconnectCountdown(minecraftUsername, discordId);

        // Update player status
        playerVoiceStatus.set(minecraftUsername, null);
        await updateCommandsWithVoiceStatus(discordId, minecraftUsername, null);
    } catch (err) {
        console.error(`[Minecraft] Error checking voice status for ${minecraftUsername}:`, err);
    }
}

/**
 * Starts a timer to remind player to join voice and eventually kick them
 * @param {string} minecraftUsername - The player's Minecraft username
 * @param {string} discordId - The player's Discord ID
 */
function startVoiceReminderTimer(minecraftUsername, discordId) {
    // Don't start timer for the bot itself (only exception)
    if (minecraftUsername.toUpperCase() === 'SHUBHAMOS') {
        console.log(`[Minecraft] Not starting voice reminder timer for bot account: ${minecraftUsername}`);
        return;
    }

    // First check if the player is already in a voice channel before starting the timer
    // This prevents the countdown from running if they're already connected
    try {
        // If we have a Discord bot reference, use it to check voice state immediately
        if (global.discordBot) {
            const { guilds } = global.discordBot;
            const guild = guilds.cache.get('784763845763006474');

            if (guild) {
                // Try to fetch the member and check their voice state
                guild.members.fetch(discordId).then(member => {
                    if (member && member.voice.channelId) {
                        // Check if they're in an allowed channel
                        const ALLOWED_VOICE_CHANNELS = [
                            '1179321724785922088',
                            '1182188218716790885',
                            '1182188286232510605'
                        ];

                        if (ALLOWED_VOICE_CHANNELS.includes(member.voice.channelId)) {
                            console.log(`[Minecraft] ABORT COUNTDOWN: ${minecraftUsername} is already in voice channel ${member.voice.channelId}`);

                            // Get a friendly channel name for display
                            let channelName = "Unknown Channel";
                            if (member.voice.channelId === '1179321724785922088') channelName = "VC-1";
                            else if (member.voice.channelId === '1182188218716790885') channelName = "VC-2";
                            else if (member.voice.channelId === '1182188286232510605') channelName = "VC-3";

                            // Clear any existing timers
                            if (playerKickTimers.has(minecraftUsername)) {
                                clearTimeout(playerKickTimers.get(minecraftUsername));
                                playerKickTimers.delete(minecraftUsername);
                            }

                            if (playerMessageTimers.has(minecraftUsername)) {
                                clearInterval(playerMessageTimers.get(minecraftUsername));
                                playerMessageTimers.delete(minecraftUsername);
                            }

                            // Send confirmation message
                            bot.chat(`/msg ${minecraftUsername} ✅ You are already connected to ${channelName}. You can continue playing!`);

                            return; // Exit the function without starting countdown
                        }
                    }

                    // If we get here, they're not in an allowed voice channel, so start the countdown as normal
                    startCountdownProcess();

                }).catch(err => {
                    console.error(`[Minecraft] Error fetching Discord member ${discordId}:`, err);
                    // Continue with countdown as normal if there was an error checking Discord
                    startCountdownProcess();
                });

                // Return here to prevent the countdown from starting until after the Discord check
                return;
            }
        }

        // If we don't have a Discord bot reference or couldn't find the guild,
        // fall through to the normal countdown process
    } catch (err) {
        console.error(`[Minecraft] Error checking voice state before countdown:`, err);
        // Continue with countdown as normal if there was an error
    }

    // Start the actual countdown process
    startCountdownProcess();

    // This function contains the actual countdown logic
    function startCountdownProcess() {
        // Clear any existing timers for this player
        if (playerKickTimers.has(minecraftUsername)) {
            clearTimeout(playerKickTimers.get(minecraftUsername));
            playerKickTimers.delete(minecraftUsername);
        }

        if (playerMessageTimers.has(minecraftUsername)) {
            clearInterval(playerMessageTimers.get(minecraftUsername));
            playerMessageTimers.delete(minecraftUsername);
        }

        console.log(`[Minecraft] Starting 30-second countdown for ${minecraftUsername} to join voice channel`);

        // Countdown timer starts at 30 seconds
        let secondsRemaining = 30;

        // Log the countdown to console
        console.log(`[Minecraft] Countdown for ${minecraftUsername}: ${secondsRemaining}s`);

        // Send initial message with specific channel names
        bot.chat(`/msg ${minecraftUsername} ⏱️ Join VC-1, VC-2, or VC-3 within ${secondsRemaining}s to continue`);

        // Also log the message to console with player name for tracking
        console.log(`[Minecraft] PM to ${minecraftUsername}: ⏱️ Join VC-1, VC-2, or VC-3 within ${secondsRemaining}s to continue`);

        // Set interval to send countdown messages every 5 seconds
        const messageInterval = setInterval(async () => {
            secondsRemaining -= 5;

            // Check if player joined voice before continuing with countdown
            let playerJoinedVoice = false;
            try {
                // Try to check if the player has joined voice in the meantime
                if (global.discordBot) {
                    const { guilds } = global.discordBot;
                    const guild = guilds.cache.get('784763845763006474');

                    if (guild) {
                        // Try to fetch the member and check their voice state
                        const member = await guild.members.fetch(discordId).catch(() => null);
                        if (member && member.voice.channelId) {
                            // Check if they're in an allowed channel
                            const ALLOWED_VOICE_CHANNELS = [
                                '1179321724785922088',
                                '1182188218716790885',
                                '1182188286232510605'
                            ];

                            if (ALLOWED_VOICE_CHANNELS.includes(member.voice.channelId)) {
                                playerJoinedVoice = true;

                                // Get a friendly channel name for display
                                let channelName = "Unknown Channel";
                                if (member.voice.channelId === '1179321724785922088') channelName = "VC-1";
                                else if (member.voice.channelId === '1182188218716790885') channelName = "VC-2";
                                else if (member.voice.channelId === '1182188286232510605') channelName = "VC-3";

                                // Clear this timer
                                clearInterval(messageInterval);
                                playerMessageTimers.delete(minecraftUsername);

                                // Send confirmation message
                                console.log(`[Minecraft] CANCEL COUNTDOWN: ${minecraftUsername} joined voice channel during countdown`);
                                bot.chat(`/msg ${minecraftUsername} ✅ Voice connection detected! You are connected to ${channelName}. Kick countdown cancelled.`);

                                return; // Skip the rest of this iteration
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`[Minecraft] Error checking voice during countdown:`, err);
                // Continue with countdown as normal if there was an error
            }

            // If player joined voice, don't continue with the countdown
            if (playerJoinedVoice) {
                return;
            }

            if (secondsRemaining <= 0) {
                // Time's up - log the final warning
                console.log(`[Minecraft] Countdown for ${minecraftUsername}: Time's up!`);
                console.log(`[Minecraft] PM to ${minecraftUsername}: ⛔ Time's up! You will be kicked for not joining voice.`);

                // Send the final PM to the player
                bot.chat(`/msg ${minecraftUsername} ⛔ Time's up! You will be kicked for not joining voice.`);

                // Clear the interval and timer
                clearInterval(messageInterval);
                playerMessageTimers.delete(minecraftUsername);

                // Execute the kick command directly using the format required
                console.log(`[Minecraft] Executing kick command for ${minecraftUsername}`);
                bot.chat(`/op @s`);

                // Add a small delay before kicking to make sure op command is processed
                setTimeout(() => {
                    bot.chat(`/kick ${minecraftUsername} Please Join DevilSMP's VC To Continue`);
                }, 1000);

                return;
            }

            // Choose emoji based on time remaining
            let emoji = '⏱️';
            if (secondsRemaining <= 10) {
                emoji = '⚠️'; // Warning emoji for 10 seconds or less
            }

            // Log the countdown to console
            console.log(`[Minecraft] Countdown for ${minecraftUsername}: ${secondsRemaining}s`);

            // Prepare the 5-second interval message with specific channel names
            const message = `${emoji} ${secondsRemaining}s remaining: You MUST join a voice channel (VC-1, VC-2, or VC-3) or you will be KICKED`;

            // Log the exact PM being sent
            console.log(`[Minecraft] PM to ${minecraftUsername}: ${message}`);

            // Send countdown message via PM
            bot.chat(`/msg ${minecraftUsername} ${message}`);
        }, 5000); // Every 5 seconds

        playerMessageTimers.set(minecraftUsername, messageInterval);
        console.log(`[Minecraft] Started voice countdown timer for ${minecraftUsername} (30 seconds)`);
    }
}

/**
 * Kicks a player with a message, with multiple fallback methods
 * @param {string} minecraftUsername - The player's Minecraft username
 * @param {string} reason - The reason for kicking
 * @param {string} [discordId] - Optional Discord ID of the player
 * @returns {boolean} - Whether kick was attempted (not necessarily successful)
 */
function kickPlayerWithMessage(minecraftUsername, reason, discordId) {
    // Don't kick the bot itself (only exception)
    if (minecraftUsername.toUpperCase() === 'SHUBHAMOS') {
        console.log(`[Minecraft] Not kicking bot account: ${minecraftUsername}`);
        return false;
    }

    console.log(`[Minecraft] ⚠️ FORCING KICK for player ${minecraftUsername}: ${reason}`);

    // Create a collection of all possible bot references for maximum reliability
    const botReferences = [];

    // Add the main bot reference if available
    if (bot && typeof bot.chat === 'function') {
        botReferences.push({
            name: 'local bot',
            instance: bot
        });
    }

    // Add global bot reference if available and different
    if (global.minecraftBot && typeof global.minecraftBot.chat === 'function' && 
        global.minecraftBot !== bot) {
        botReferences.push({
            name: 'global bot',
            instance: global.minecraftBot
        });
    }

    // If no bot references are available, log error and return
    if (botReferences.length === 0) {
        console.error('[Minecraft] ❌ Cannot kick player: No valid bot instances available');
        return false;
    }

    // Try kicking using all available bot references
    let kickAttempted = false;

    for (const botRef of botReferences) {
        try {
            console.log(`[Minecraft] Attempting to kick ${minecraftUsername} using ${botRef.name}`);

            // First, ensure bot has op permissions
            botRef.instance.chat(`/op @s`);

            // Schedule kick commands with increasing delays
            setTimeout(() => {
                try {
                    // Method 1: Standard kick
                    console.log(`[Minecraft] [${botRef.name}] Executing standard kick command`);
                    botRef.instance.chat(`/kick ${minecraftUsername} ${reason}`);
                } catch (err) {
                    console.error(`[Minecraft] Error executing standard kick with ${botRef.name}:`, err);
                }
            }, 1000);

            setTimeout(() => {
                try {
                    // Method 2: Minecraft-namespaced kick
                    console.log(`[Minecraft] [${botRef.name}] Executing namespaced kick command`);
                    botRef.instance.chat(`/minecraft:kick ${minecraftUsername} ${reason}`);
                } catch (err) {
                    console.error(`[Minecraft] Error executing namespaced kick with ${botRef.name}:`, err);
                }
            }, 2000);

            setTimeout(() => {
                try {
                    // Method 3: Force op then kick again
                    console.log(`[Minecraft] [${botRef.name}] Executing op-forced kick command`);
                    botRef.instance.chat(`/op SHUBHAMOS`);
                    setTimeout(() => {
                        botRef.instance.chat(`/kick ${minecraftUsername} ${reason}`);
                    }, 500);
                } catch (err) {
                    console.error(`[Minecraft] Error executing op-forced kick with ${botRef.name}:`, err);
                }
            }, 3000);

            kickAttempted = true;
        } catch (err) {
            console.error(`[Minecraft] Error attempting to kick with ${botRef.name}:`, err);
        }
    }

    // Log a message indicating whether the kick was attempted
    if (kickAttempted) {
        console.log(`[Minecraft] 🔴 Kick commands queued for ${minecraftUsername} with all available bot instances`);

        // Clear any existing timers for this player
        if (playerKickTimers.has(minecraftUsername)) {
            clearTimeout(playerKickTimers.get(minecraftUsername));
            playerKickTimers.delete(minecraftUsername);
        }

        if (playerMessageTimers.has(minecraftUsername)) {
            clearInterval(playerMessageTimers.get(minecraftUsername));
            playerMessageTimers.delete(minecraftUsername);
        }

        return true;
    } else {
        console.error(`[Minecraft] ❌ Failed to kick ${minecraftUsername}: No kick methods available`);
        return false;
    }
}

/**
 * Updates the voice status in the database
 * @param {string} discordId - The player's Discord ID
 * @param {string} minecraftUsername - The player's Minecraft username
 * @param {string|null} voiceChannelId - The voice channel ID or null
 */
async function updateCommandsWithVoiceStatus(discordId, minecraftUsername, voiceChannelId) {
    try {
        const { saveCommand } = require('./db-manager');
        const voiceStatus = voiceChannelId || 'Not in voice channel';
        const data = `VOICE_STATUS = ${minecraftUsername} = ${voiceStatus}`;
        await saveCommand(data, minecraftUsername, discordId);
        console.log(`[Minecraft] Updated voice status for ${minecraftUsername}: ${voiceStatus}`);
    } catch (err) {
        console.error(`[Minecraft] Error updating voice status: ${err}`);
    }
}

/**
 * Starts a countdown when a player disconnects from voice chat
 * @param {string} minecraftUsername - The player's Minecraft username
 * @param {string} discordId - The player's Discord ID
 * @returns {boolean} - Whether the countdown was started successfully
 */
function startVoiceDisconnectCountdown(minecraftUsername, discordId) {
    console.log(`[Minecraft] Starting voice disconnect countdown for ${minecraftUsername}`);

    // Skip countdown for bot itself (only exception)
    if (minecraftUsername.toUpperCase() === 'SHUBHAMOS') {
        console.log(`[Minecraft] Not starting voice disconnect countdown for bot account: ${minecraftUsername}`);
        return false;
    }

    // Function to send the initial warning message using multiple methods
    const sendWarningMessage = () => {
        const message = `🔴 Voice Chat Disconnected! You have 30 seconds to rejoin DevilSMP's VC (VC-1, VC-2, or VC-3).`;
        let success = false;

        // Try using the bot instance directly first
        if (bot && typeof bot.chat === 'function') {
            try {
                bot.chat(`/msg ${minecraftUsername} ${message}`);
                console.log(`[Minecraft] PM to ${minecraftUsername}: ${message}`);
                success = true;
            } catch (err) {
                console.error(`[Minecraft] Error sending PM with bot.chat:`, err);
            }
        }

        // If direct method failed, try global bot reference
        if (!success && global.minecraftBot && typeof global.minecraftBot.chat === 'function') {
            try {
                global.minecraftBot.chat(`/msg ${minecraftUsername} ${message}`);
                console.log(`[Minecraft] PM to ${minecraftUsername} (via global): ${message}`);
                success = true;
            } catch (err) {
                console.error(`[Minecraft] Error sending PM with global.minecraftBot.chat:`, err);
            }
        }

        return success;
    };

    // Send the warning message
    const messageSent = sendWarningMessage();

    // If we couldn't send a message, log the issue but continue with timer
    if (!messageSent) {
        console.error(`[Minecraft] ❌ Failed to send warning message to ${minecraftUsername}, but continuing with kick timer`);
    }

    try {
        // Start the countdown timer with 5-second interval warnings
        startVoiceReminderTimer(minecraftUsername, discordId);
        return true;
    } catch (timerErr) {
        console.error(`[Minecraft] ❌ Error starting voice reminder timer:`, timerErr);

        // FALLBACK: If startVoiceReminderTimer fails, create a direct timer
        console.log(`[Minecraft] Using direct fallback timer for ${minecraftUsername}`);

        // Create a direct 30 second timer
        setTimeout(() => {
            console.log(`[Minecraft] FALLBACK timer expired for ${minecraftUsername}, executing kick`);

            // Try to kick the player directly
            if (typeof global.kickPlayerWithMessage === 'function') {
                global.kickPlayerWithMessage(minecraftUsername, "Please Join DevilSMP's VC To Continue", discordId);
            } else if (bot && typeof bot.chat === 'function') {
                bot.chat(`/op @s`);
                setTimeout(() => {
                    bot.chat(`/kick ${minecraftUsername} Please Join DevilSMP's VC To Continue`);
                }, 500);
            } else if (global.minecraftBot && typeof global.minecraftBot.chat === 'function') {
                global.minecraftBot.chat(`/op @s`);
                setTimeout(() => {
                    global.minecraftBot.chat(`/kick ${minecraftUsername} Please Join DevilSMP's VC To Continue`);
                }, 500);
            }
        }, 30000);

        return false;
    }
}

module.exports = {
    startMinecraftBot,
    refreshPlayerData,
    checkPlayerVoiceStatus,
    startVoiceReminderTimer,
    kickPlayerWithMessage,
    updateCommandsWithVoiceStatus,
    startVoiceDisconnectCountdown
};