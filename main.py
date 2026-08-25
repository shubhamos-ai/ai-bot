import os
import logging
from threading import Thread
from simple_web import app  # Import the app object for gunicorn
from bot_helpers import set_bot_instance

# Configure minimal logging - only show important messages
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    handlers=[logging.StreamHandler()]
)

# Silence verbose loggers
for logger_name in ['werkzeug', 'discord', 'urllib3', 'asyncio', 'urllib3.connectionpool']:
    logging.getLogger(logger_name).setLevel(logging.ERROR)

def read_token():
    """Read token from token.txt file"""
    try:
        with open("token.txt", "r") as f:
            token = f.read().strip()
            if not token:
                print("ERROR: Empty token.txt. Add your Discord bot token to this file.")
            return token
    except FileNotFoundError:
        print("ERROR: token.txt not found. Create this file with your Discord bot token.")
        return None

def run():
    """Run the Discord bot with a simple status web page for 24/7 uptime"""
    # Get bot token
    token = read_token()
    if not token:
        return
    
    try:
        # Import here to avoid early loading
        import discord
        from bot import ModerationBot
        from simple_web import start_flask
        
        # Start Flask in a background thread when running directly (not via gunicorn)
        # This is only used when running "python main.py" directly
        print("Starting minimal web interface at http://0.0.0.0:5000")
        flask_thread = Thread(target=start_flask)
        flask_thread.daemon = True
        flask_thread.start()
        
        # Set up Discord bot
        intents = discord.Intents.default()
        intents.members = True
        intents.message_content = True
        intents.presences = True
        
        # Create and start bot
        print("Starting Discord bot...")
        bot = ModerationBot(intents)
        set_bot_instance(bot)
        bot.run(token)
        
    except Exception as e:
        print(f"Error running application: {e}")

# Simple entry point
if __name__ == "__main__":
    run()