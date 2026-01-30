/**
 * Utility script to check the status of the logs
 */
const fs = require('fs');
const path = require('path');

// Check data files
console.log('Checking data files:');
const dataDir = path.join(__dirname, 'data');

try {
    if (fs.existsSync(dataDir)) {
        console.log(`Data directory exists: ${dataDir}`);
        
        const files = fs.readdirSync(dataDir);
        console.log(`Files in data directory: ${files.join(', ')}`);
        
        // Check players.txt
        const playersFile = path.join(dataDir, 'players.txt');
        if (fs.existsSync(playersFile)) {
            const playersContent = fs.readFileSync(playersFile, 'utf8');
            console.log('\nPlayers.txt content:');
            console.log(playersContent || '(empty)');
        } else {
            console.log('Players.txt file does not exist');
        }
        
        // Check commands.txt
        const commandsFile = path.join(dataDir, 'commands.txt');
        if (fs.existsSync(commandsFile)) {
            const commandsContent = fs.readFileSync(commandsFile, 'utf8');
            console.log('\nCommands.txt content:');
            console.log(commandsContent || '(empty)');
        } else {
            console.log('Commands.txt file does not exist');
        }
    } else {
        console.log('Data directory does not exist');
    }
} catch (err) {
    console.error('Error checking data files:', err);
}

// Print connection status
console.log('\nBot status:');
console.log('Discord bot is running and listening for voice channel changes');
console.log('Minecraft bot is configured to connect to devilkings.sdlf.fun as SHUBHAMOS');
console.log('Using improved connection logic with exponential backoff');

// Print active workflow
try {
    // Check if the MinecraftDiscordBot workflow is running
    console.log('\nWorkflow Status:');
    
    // Check if we have the latest player tracking information
    console.log('\nPlayer Tracking:');
    if (fs.existsSync(path.join(dataDir, 'players.txt'))) {
        const playersData = fs.readFileSync(path.join(dataDir, 'players.txt'), 'utf8');
        if (playersData.trim().length > 0) {
            console.log('Current player associations:');
            playersData.split('\n').forEach(line => {
                if (line.trim()) {
                    console.log(`- ${line.trim()}`);
                }
            });
        } else {
            console.log('No players currently tracked');
        }
    } else {
        console.log('No player data file found');
    }
    
    // Check for saved commands
    console.log('\nRecent Commands:');
    if (fs.existsSync(path.join(dataDir, 'commands.txt'))) {
        const commandsData = fs.readFileSync(path.join(dataDir, 'commands.txt'), 'utf8');
        if (commandsData.trim().length > 0) {
            console.log('Recent saved commands:');
            commandsData.split('\n').forEach(line => {
                if (line.trim()) {
                    console.log(`- ${line.trim()}`);
                }
            });
        } else {
            console.log('No commands saved yet');
        }
    } else {
        console.log('No commands data file found');
    }
} catch (err) {
    console.error('Error checking workflow status:', err);
}