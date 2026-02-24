
import discord
import datetime
from typing import Optional, Union

async def send_moderation_dm(
    user: Union[discord.Member, discord.User],
    action_type: str,
    guild_name: str,
    reason: str,
    duration: Optional[int] = None,
    moderator_name: Optional[str] = None,
    guild: Optional[discord.Guild] = None,
    moderator: Optional[discord.Member] = None,
    moderator_id: Optional[int] = None
) -> bool:
    """
    Send a direct message to a user about a moderation action
    
    Args:
        user: The user to send the DM to
        action_type: The type of moderation action (ban, kick, timeout, etc.)
        guild_name: The name of the server where the action occurred
        reason: The reason for the moderation action
        duration: Duration in seconds (for timeout, temporary ban)
        moderator_name: Name of the moderator who took the action
    
    Returns:
        bool: True if the message was sent successfully, False otherwise
    """
    try:
        # Create embed
        embed = discord.Embed(color=get_action_color(action_type))
        
        # Set author with server icon if available
        if guild and guild.icon:
            embed.set_author(name=f"Moderation Action in {guild_name}", icon_url=guild.icon.url)
        else:
            embed.set_author(name=f"Moderation Action in {guild_name}")

        # Set thumbnail to moderator's avatar if available  
        if moderator and moderator.avatar:
            embed.set_thumbnail(url=moderator.avatar.url)

        # Format action title with emojis
        action_emoji = {
            "ban": "🔨",
            "kick": "👢", 
            "timeout": "⏰",
            "mute": "🔇",
            "unmute": "🔊",
            "voice_mute": "🎤❌",
            "voice_unmute": "🎤✅",
            "voice_deafen": "🔇❌",
            "voice_undeafen": "🔇✅",
            "warning": "⚠️"
        }

        emoji = action_emoji.get(action_type.lower(), "📝")
        
        # Create action description
        if action_type.lower() == "ban":
            if duration and duration > 0:
                duration_str = format_duration(duration)
                description = f"{emoji} You have been **banned** for {duration_str}"
            else:
                description = f"{emoji} You have been **permanently banned**"
                
        elif action_type.lower() == "kick":
            description = f"{emoji} You have been **kicked** from the server"
            
        elif action_type.lower() == "timeout" or action_type.lower() == "mute":
            if duration and duration > 0:
                duration_str = format_duration(duration)
                description = f"{emoji} You have been **timed out** for {duration_str}"
            else:
                description = f"{emoji} You have been **timed out**"
                
        elif action_type.lower() == "voice_mute":
            description = f"{emoji} You have been **muted** in voice channels"
            
        elif action_type.lower() == "voice_unmute":
            description = f"{emoji} You have been **unmuted** in voice channels"
            
        elif action_type.lower() == "voice_deafen":
            description = f"{emoji} You have been **deafened** in voice channels"
            
        elif action_type.lower() == "voice_undeafen":
            description = f"{emoji} You have been **undeafened** in voice channels"
            
        else:
            description = f"{emoji} Action: **{action_type}**"

        embed.description = description

        # Add fields
        embed.add_field(name="📝 Reason", value=reason or "No reason provided", inline=False)
        
        if moderator_name:
            embed.add_field(name="👤 Moderator", value=moderator_name, inline=True)

        if duration and action_type.lower() in ["timeout", "ban", "mute"]:
            end_time = datetime.datetime.utcnow() + datetime.timedelta(seconds=duration)
            embed.add_field(
                name="⏳ Duration", 
                value=f"Ends <t:{int(end_time.timestamp())}:R>",
                inline=True
            )

        # Add server info
        if guild:
            member_count = guild.member_count or 0
            embed.add_field(
                name="🏠 Server Info",
                value=f"Members: {member_count:,}\nID: {guild.id}",
                inline=True
            )

        # Set footer
        embed.set_footer(text="If you believe this was a mistake, use the Appeal button below")
        embed.timestamp = datetime.datetime.utcnow()

        # Create appeal button
        class AppealButton(discord.ui.View):
            def __init__(self, mod_id: int):
                super().__init__(timeout=None)
                self.mod_id = mod_id

            @discord.ui.button(label="Request Appeal", style=discord.ButtonStyle.primary)
            async def appeal_button(self, interaction: discord.Interaction, button: discord.ui.Button):
                # Create modal for appeal text
                class AppealModal(discord.ui.Modal):
                    def __init__(self, mod_id):
                        super().__init__(title="Submit Appeal")
                        self.mod_id = mod_id
                        self.appeal_text = discord.ui.TextInput(
                            label="Why should this action be reversed?",
                            style=discord.TextStyle.paragraph,
                            max_length=1000
                        )
                        self.add_item(self.appeal_text)

                    async def on_submit(self, modal_interaction: discord.Interaction):
                        # Send appeal to moderator
                        try:
                            mod = await interaction.client.fetch_user(self.mod_id)
                            appeal_embed = discord.Embed(
                                title="Moderation Appeal",
                                description=f"Appeal from {interaction.user.mention}",
                                color=0xFFA500
                            )
                            appeal_embed.add_field(name="Appeal Text", value=self.appeal_text.value)
                            
                            # Create approve/deny buttons
                            class ModeratorResponse(discord.ui.View):
                                def __init__(self, mod_id):
                                    super().__init__(timeout=None)
                                    self.mod_id = mod_id

                                @discord.ui.button(label="Approve Appeal", style=discord.ButtonStyle.success)
                                async def approve(self, btn_interaction: discord.Interaction, button: discord.ui.Button):
                                    if btn_interaction.user.id != self.mod_id:
                                        await btn_interaction.response.send_message("You cannot respond to this appeal.", ephemeral=True)
                                        return

                                    # Undo the moderation action
                                    if action_type == "timeout":
                                        await user.timeout(None, reason="Appeal approved")
                                    elif action_type == "voice_mute":
                                        await user.edit(mute=False, reason="Appeal approved")
                                    elif action_type == "voice_deafen":
                                        await user.edit(deafen=False, reason="Appeal approved")

                                    await btn_interaction.response.send_message(f"Appeal approved for {interaction.user.mention}")
                                    await interaction.user.send("Your appeal has been approved! The moderation action has been reversed.")
                                    self.disable_all_buttons()
                                    await btn_interaction.message.edit(view=self)

                                @discord.ui.button(label="Deny Appeal", style=discord.ButtonStyle.danger)
                                async def deny(self, btn_interaction: discord.Interaction, button: discord.ui.Button):
                                    if btn_interaction.user.id != self.mod_id:
                                        await btn_interaction.response.send_message("You cannot respond to this appeal.", ephemeral=True)
                                        return

                                    await btn_interaction.response.send_message(f"Appeal denied for {interaction.user.mention}")
                                    await interaction.user.send("Your appeal has been denied.")
                                    self.disable_all_buttons()
                                    await btn_interaction.message.edit(view=self)

                                def disable_all_buttons(self):
                                    for child in self.children:
                                        child.disabled = True

                            await mod.send(embed=appeal_embed, view=ModeratorResponse(self.mod_id))
                            await modal_interaction.response.send_message("Your appeal has been submitted!", ephemeral=True)
                        except Exception as e:
                            print(f"Error sending appeal: {e}")
                            await modal_interaction.response.send_message("Error submitting appeal. Please try again later.", ephemeral=True)

                await interaction.response.send_modal(AppealModal(self.mod_id))

        # Send the embed with appeal button
        try:
            await user.send(embed=embed, view=AppealButton(moderator.id if moderator else None))
            return True
        except discord.Forbidden:
            return False
            
    except Exception as e:
        print(f"Error sending DM to {user}: {e}")
        return False

def get_action_color(action_type: str) -> int:
    """Get the appropriate color for the action type"""
    colors = {
        "ban": 0xFF0000,  # Red
        "kick": 0xFFA500,  # Orange
        "timeout": 0xFFFF00,  # Yellow
        "mute": 0xFFA500,  # Orange
        "unmute": 0x00FF00,  # Green
        "voice_mute": 0xFFA500,  # Orange
        "voice_unmute": 0x00FF00,  # Green
        "voice_deafen": 0xFFA500,  # Orange
        "voice_undeafen": 0x00FF00,  # Green
        "warning": 0xFFFF00  # Yellow
    }
    return colors.get(action_type.lower(), 0x7289DA)  # Default to Discord blue

def format_duration(seconds: int) -> str:
    """Format a duration in seconds to a human-readable string"""
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    elif seconds < 3600:
        minutes = seconds // 60
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    elif seconds < 86400:
        hours = seconds // 3600
        return f"{hours} hour{'s' if hours != 1 else ''}"
    else:
        days = seconds // 86400
        return f"{days} day{'s' if days != 1 else ''}"
