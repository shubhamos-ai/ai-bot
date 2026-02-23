import discord
import asyncio
import datetime
from typing import Optional, Dict, Any, List, Union

class DMManager:
    """
    Class to handle direct messages to users including:
    - Profile command responses
    - Warning notifications
    - Custom notifications
    - Welcome messages
    - Moderation notifications
    """
    
    def __init__(self, bot):
        self.bot = bot  # ModerationBot instance
        self.dm_cooldowns = {}  # Prevent spam
        
    async def send_dm(self, user_id: Union[int, str], message: str, embed: discord.Embed = None) -> bool:
        """
        Send a DM to a user
        
        Args:
            user_id: User ID to send the message to
            message: Text message to send
            embed: Optional embed to include with the message
            
        Returns:
            Boolean indicating if the message was sent successfully
        """
        user_id = str(user_id)
        
        # Implement dynamic cooldowns based on message content
        current_time = datetime.datetime.now().timestamp()
        if user_id in self.dm_cooldowns:
            # Base cooldown of 5 seconds, but adjust based on content
            cooldown_time = 5
            
            # Longer messages need longer cooldowns
            if message and len(message) > 200:
                cooldown_time += 2
                
            # Embeds are complex content, need extra cooldown
            if embed:
                cooldown_time += 1
                
            if current_time - self.dm_cooldowns[user_id] < cooldown_time:
                print(f"DM on cooldown for user {user_id} ({cooldown_time}s)")
                return False  # On cooldown
                
        # Update cooldown
        self.dm_cooldowns[user_id] = current_time
        
        try:
            # First try to get the user from cache
            user = self.bot.get_user(int(user_id))
            if not user:
                # If not in cache, fetch user from API
                user = await self.bot.fetch_user(int(user_id))
            if not user:
                return False
                
            # Check user preferences if available
            try:
                if hasattr(self.bot, 'storage') and self.bot.storage:
                    profile = await self.bot.storage.get_user_profile(user_id)
                    if profile and not profile.get("preferences", {}).get("dm_notifications", True):
                        # User has opted out of DMs
                        print(f"User {user_id} has opted out of DM notifications")
                        return False
            except Exception as e:
                print(f"Error checking DM preferences: {e}")
                
            # Send the message
            if embed:
                await user.send(message, embed=embed)
            else:
                await user.send(message)
            
            # Log this DM in user stats
            try:
                if hasattr(self.bot, 'storage') and self.bot.storage:
                    await self.bot.storage.increment_user_stat(user_id, "dm_messages_received", 1)
            except Exception as e:
                print(f"Error updating DM stats: {e}")
                
            return True
        except discord.Forbidden:
            # User has DMs disabled or blocked the bot
            print(f"Cannot send DM to user {user_id} (forbidden - DMs closed)")
            return False
        except Exception as e:
            print(f"Error sending DM to user {user_id}: {e}")
            return False
            
    async def send_welcome_message(self, user_id: Union[int, str], guild_name: str) -> bool:
        """
        Send a welcome message to a new user
        
        Args:
            user_id: User ID to send the message to
            guild_name: Name of the guild the user joined
            
        Returns:
            Boolean indicating if the message was sent successfully
        """
        embed = discord.Embed(
            title=f"Welcome to {guild_name}! 👋",
            description="Thank you for joining our server! Here's some information to help you get started.",
            color=0x3498DB  # Blue color
        )
        
        embed.add_field(
            name="Server Rules",
            value="Please make sure to read the server rules to ensure a positive experience for everyone.",
            inline=False
        )
        
        embed.add_field(
            name="Bot Commands",
            value=f"Use `{self.bot.prefix}help` to see available commands.",
            inline=False
        )
        
        embed.add_field(
            name="User Profile",
            value=f"You can check your profile with `{self.bot.prefix}profile`.",
            inline=False
        )
        
        embed.set_footer(text="If you have any questions, feel free to ask a moderator!")
        
        return await self.send_dm(
            user_id, 
            f"Welcome to **{guild_name}**! We're glad to have you with us.",
            embed
        )
        
    async def send_warning_notification(self, user_id: Union[int, str], warning_type: str, 
                                        details: str, warning_count: int, guild_name: str) -> bool:
        """
        Send a warning notification to a user
        
        Args:
            user_id: User ID to send the message to
            warning_type: Type of warning (curse_word, spam, etc.)
            details: Details about the warning
            warning_count: Current warning count for the user
            guild_name: Name of the guild where the warning occurred
            
        Returns:
            Boolean indicating if the message was sent successfully
        """
        warning_title = "⚠️ Server Warning"
        color = 0xE74C3C  # Red color
        
        if warning_type == "curse_word":
            warning_desc = f"Your message was removed for containing inappropriate language in **{guild_name}**."
        elif warning_type == "spam":
            warning_desc = f"You've been warned for spamming in **{guild_name}**."
        elif warning_type == "mass_mentions":
            warning_desc = f"You've been warned for excessive mentions in **{guild_name}**."
        else:
            warning_desc = f"You've received a warning in **{guild_name}**."
            
        embed = discord.Embed(
            title=warning_title,
            description=warning_desc,
            color=color
        )
        
        embed.add_field(
            name="Details",
            value=details,
            inline=False
        )
        
        embed.add_field(
            name="Warning Count",
            value=f"This is warning #{warning_count}",
            inline=True
        )
        
        # Add consequences based on warning count
        if warning_count >= 6:
            consequence = "Role demotion and extended timeout"
        elif warning_count >= 3:
            consequence = "Temporary timeout"
        elif warning_count >= 2:
            consequence = "Brief timeout"
        else:
            consequence = "None for first warning"
            
        embed.add_field(
            name="Consequence",
            value=consequence,
            inline=True
        )
        
        embed.set_footer(text=f"Please review the server rules to avoid further warnings.")
        
        return await self.send_dm(
            user_id,
            "You've received a warning in the server.",
            embed
        )
        
    async def send_profile_info(self, user_id: Union[int, str], profile_data: Dict[str, Any]) -> bool:
        """
        Send user profile information via DM
        
        Args:
            user_id: User ID to send the profile to
            profile_data: User's profile data from MongoDB
            
        Returns:
            Boolean indicating if the message was sent successfully
        """
        if not profile_data:
            return await self.send_dm(user_id, "You don't have a profile yet.")
            
        embed = discord.Embed(
            title="🧩 Your Profile",
            description=profile_data.get("bio", "No bio set"),
            color=0x9B59B6  # Purple color
        )
        
        # Add username and join date
        embed.add_field(
            name="Username",
            value=profile_data.get("username", "Unknown"),
            inline=True
        )
        
        created_at = profile_data.get("created_at")
        if created_at:
            # Format the date nicely
            if isinstance(created_at, datetime.datetime):
                date_str = created_at.strftime("%b %d, %Y")
            else:
                date_str = str(created_at)
                
            embed.add_field(
                name="Profile Created",
                value=date_str,
                inline=True
            )
            
        # Add statistics
        stats = profile_data.get("stats", {})
        stats_text = (
            f"Messages: {stats.get('messages_sent', 0)}\n"
            f"Commands: {stats.get('commands_used', 0)}\n"
            f"Warnings: {stats.get('warnings_received', 0)}"
        )
        
        embed.add_field(
            name="Statistics",
            value=stats_text,
            inline=False
        )
        
        # Add badges if any
        badges = profile_data.get("badges", [])
        if badges:
            badge_text = "\n".join([f"{badge.get('icon', '🏆')} {badge.get('name', 'Unknown Badge')}" for badge in badges])
            embed.add_field(
                name="Badges",
                value=badge_text,
                inline=False
            )
            
        # Add preferences
        prefs = profile_data.get("preferences", {})
        pref_text = (
            f"DM Notifications: {'Enabled' if prefs.get('dm_notifications', True) else 'Disabled'}\n"
            f"Theme: {prefs.get('theme', 'dark').capitalize()}\n"
            f"Language: {prefs.get('language', 'en').upper()}"
        )
        
        embed.add_field(
            name="Preferences",
            value=pref_text,
            inline=False
        )
        
        # Set avatar if available
        if profile_data.get("avatar_url"):
            embed.set_thumbnail(url=profile_data["avatar_url"])
            
        embed.set_footer(text=f"User ID: {user_id}")
        
        return await self.send_dm(
            user_id,
            "Here's your profile information!",
            embed
        )
        
    async def send_moderation_notification(self, user_id: Union[int, str], action_type: str, 
                                          reason: str, duration: int = None, 
                                          guild_name: str = "the server") -> bool:
        """
        Send a moderation action notification to a user
        
        Args:
            user_id: User ID to send the notification to
            action_type: Type of moderation action (ban, kick, timeout, etc.)
            reason: Reason for the action
            duration: Duration of the action in seconds (for timeout)
            guild_name: Name of the guild where the action occurred
            
        Returns:
            Boolean indicating if the message was sent successfully
        """
        # Create appropriate title and color based on action
        if action_type == "ban":
            title = f"🔨 Banned from {guild_name}"
            color = 0x992D22  # Dark red
            description = f"You have been banned from **{guild_name}**."
        elif action_type == "kick":
            title = f"👢 Kicked from {guild_name}"
            color = 0xE67E22  # Orange
            description = f"You have been kicked from **{guild_name}**."
        elif action_type == "timeout":
            title = f"⏱️ Timed Out in {guild_name}"
            color = 0xF1C40F  # Yellow
            
            # Format duration for human readability
            if duration:
                if duration < 60:
                    duration_text = f"{duration} seconds"
                elif duration < 3600:
                    duration_text = f"{duration // 60} minutes"
                elif duration < 86400:
                    duration_text = f"{duration // 3600} hours"
                else:
                    duration_text = f"{duration // 86400} days"
                    
                description = f"You have been timed out in **{guild_name}** for **{duration_text}**."
            else:
                description = f"You have been timed out in **{guild_name}**."
        elif action_type == "mute":
            title = f"🔇 Muted in {guild_name}"
            color = 0xF39C12  # Amber
            description = f"You have been muted in **{guild_name}**."
        elif action_type == "unmute":
            title = f"🔊 Unmuted in {guild_name}"
            color = 0x2ECC71  # Green
            description = f"You have been unmuted in **{guild_name}**."
        else:
            title = f"Moderation Action in {guild_name}"
            color = 0x7F8C8D  # Gray
            description = f"A moderation action has been taken against you in **{guild_name}**."
            
        embed = discord.Embed(
            title=title,
            description=description,
            color=color
        )
        
        embed.add_field(
            name="Reason",
            value=reason or "No reason provided",
            inline=False
        )
        
        if duration and action_type == "timeout":
            # Calculate when the timeout will end
            end_time = datetime.datetime.utcnow() + datetime.timedelta(seconds=duration)
            embed.add_field(
                name="Timeout Ends",
                value=f"<t:{int(end_time.timestamp())}:R>",  # Discord timestamp format with relative time
                inline=False
            )
            
        embed.set_footer(text="If you believe this action was taken in error, please contact a server administrator.")
        
        return await self.send_dm(
            user_id,
            f"A moderation action has been taken against you in {guild_name}.",
            embed
        )