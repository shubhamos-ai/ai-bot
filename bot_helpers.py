"""
Helper module to centralize bot-related functions for web application
"""
import logging

# Global bot instance
_bot_instance = None

def set_bot_instance(bot):
    """Set the bot instance for use across the application"""
    global _bot_instance
    _bot_instance = bot
    logging.info(f"Bot instance set: {bot.user if bot and hasattr(bot, 'user') else 'No user yet'}")

def get_bot():
    """Get the bot instance if it exists and is ready"""
    if not _bot_instance or not hasattr(_bot_instance, 'is_ready') or not _bot_instance.is_ready():
        return None
    return _bot_instance

def has_storage():
    """Check if the bot has storage available"""
    bot = get_bot()
    if not bot:
        return False
    return hasattr(bot, 'storage') and bot.storage is not None

def get_storage():
    """Get storage if available, otherwise return None"""
    bot = get_bot()
    if not bot or not hasattr(bot, 'storage'):
        return None
    return bot.storage

def get_bot_user():
    """Get bot user if available"""
    bot = get_bot()
    if not bot or not hasattr(bot, 'user'):
        return None
    return bot.user

def get_guild(guild_id):
    """Get guild by ID if available"""
    bot = get_bot()
    if not bot:
        return None
    return bot.get_guild(guild_id)

def safe_run_coroutine(coro, default_value=None):
    """Safely run a coroutine in the bot event loop if available
    
    Args:
        coro: The coroutine to run
        default_value: Value to return if execution fails
        
    Returns:
        The result of the coroutine or default_value if it fails
    """
    bot = get_bot()
    if not bot or not hasattr(bot, 'loop'):
        return default_value
        
    import asyncio
    try:
        return asyncio.run_coroutine_threadsafe(coro, bot.loop).result()
    except Exception as e:
        logging.error(f"Error running coroutine: {e}")
        return default_value