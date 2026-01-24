import inspect
import sys
import time
import datetime
from typing import Optional, Union

import discord
from discord.ui import View, Button, Select, Modal, TextInput

from bot import ModerationBot
from commands.base import Command
from helpers.embed_builder import EmbedBuilder
from helpers.misc_functions import author_is_mod, is_integer
from helpers.notification import send_moderation_dm


class ManageUserView(View):
    def __init__(self, bot: ModerationBot, target_user: discord.Member, author: discord.Member, original_message: discord.Message):
        super().__init__(timeout=200)  # 200 seconds timeout to save storage
        self.message = None  # Store message reference
        self.bot = bot
        self.target_user = target_user
        self.author = author
        self.guild = target_user.guild
        self.guild_id = str(self.guild.id)
        self.original_message = original_message

        # Default duration for actions that need it
        self.selected_duration = "10m"  # A reasonable default
        self.duration_seconds = 10 * 60

        # Check if user is currently voice muted, deafened or timed out
        is_vc_muted = target_user.voice and target_user.voice.mute
        is_vc_deaf = target_user.voice and target_user.voice.deaf
        is_timed_out = target_user.is_timed_out()

        # Add toggle buttons based on current state
        self.add_item(self.create_button(
            "Unmute VC" if is_vc_muted else "Mute VC", 
            "toggle_voice_mute", 
            discord.ButtonStyle.success if is_vc_muted else discord.ButtonStyle.danger, 
            row=0
        ))

        self.add_item(self.create_button(
            "Undeafen" if is_vc_deaf else "Deafen", 
            "toggle_voice_deaf", 
            discord.ButtonStyle.success if is_vc_deaf else discord.ButtonStyle.danger, 
            row=0
        ))

        self.add_item(self.create_button(
            "Remove Timeout" if is_timed_out else "Timeout", 
            "toggle_timeout", 
            discord.ButtonStyle.success if is_timed_out else discord.ButtonStyle.danger, 
            row=0
        ))

        # Add kick and ban buttons
        self.add_item(self.create_button("Kick", "kick", discord.ButtonStyle.danger, row=0))
        self.add_item(self.create_button("Ban", "ban", discord.ButtonStyle.danger, row=0))

    def create_button(self, label: str, custom_id: str, style: discord.ButtonStyle, row: int = 0) -> Button:
        """Helper method to create a button with callback"""
        button = Button(label=label, custom_id=custom_id, style=style, row=row)
        button.callback = self.button_callback
        return button

    async def button_callback(self, interaction: discord.Interaction) -> None:
        """Handle button press events"""
        # Verify that the user pressing the button is the original author
        if interaction.user.id != self.author.id:
            await interaction.response.send_message("Only the user who requested this panel can use these actions.", ephemeral=True)
            return

        # Verify that the user is a mod
        if not await author_is_mod(interaction.user, self.bot.storage):
            await interaction.response.send_message("You must be a moderator to use these actions.", ephemeral=True)
            return

        # Get the button custom ID
        button_id = interaction.data["custom_id"]
        # Save message reference for later deletion
        self.message = interaction.message

        try:
            if button_id == "toggle_voice_mute":
                # Check current state
                is_muted = self.target_user.voice and self.target_user.voice.mute
                if is_muted:
                    await self.handle_voice_unmute(interaction)
                else:
                    await self.handle_voice_mute(interaction)
            elif button_id == "toggle_voice_deaf":
                # Check current state
                is_deaf = self.target_user.voice and self.target_user.voice.deaf
                if is_deaf:
                    await self.handle_voice_undeafen(interaction)
                else:
                    await self.handle_voice_deafen(interaction)
            elif button_id == "toggle_timeout":
                # Check current state
                is_timed_out = self.target_user.is_timed_out()
                if is_timed_out:
                    await self.handle_remove_timeout(interaction)
                else:
                    # For timeout, we need to ask for duration
                    await self.ask_for_duration(interaction, "timeout")
            elif button_id == "kick":
                await self.handle_kick(interaction)
            elif button_id == "ban":
                # For ban, we need to ask for duration
                await self.ask_for_duration(interaction, "ban")
        except discord.errors.Forbidden:
            await interaction.response.send_message(
                "I don't have permission to perform this action. Make sure I have the necessary permissions.", 
                ephemeral=True
            )

    async def handle_text_mute(self, interaction: discord.Interaction) -> None:
        """Handle text mute button press"""
        # Get the muted role
        muted_role_id = int(self.bot.storage.settings["guilds"][self.guild_id]["muted_role_id"])
        muted_role = discord.utils.get(self.guild.roles, id=muted_role_id)

        if muted_role is None:
            await self.bot.check_for_muted_role(self.guild)
            muted_role_id = int(self.bot.storage.settings["guilds"][self.guild_id]["muted_role_id"])
            muted_role = discord.utils.get(self.guild.roles, id=muted_role_id)

        # Get reason
        reason = f"Text muted by {self.author.name}"

        # Add the role
        await self.target_user.add_roles(muted_role, reason=reason)

        # Store in settings
        expire_time = int(time.time()) + self.duration_seconds if self.duration_seconds > 0 else -1

        self.bot.storage.settings["guilds"][self.guild_id]["muted_users"][str(self.target_user.id)] = {
            "duration": expire_time,
            "reason": reason,
            "normal_duration": self.selected_duration
        }
        await self.bot.storage.write_file_to_disk()

        # Try to send DM notification
        try:
            await send_moderation_dm(
                user=self.target_user,
                action_type="mute",
                guild_name=self.guild.name,
                reason=reason,
                duration=self.duration_seconds if self.duration_seconds > 0 else None,
                moderator_name=self.author.name,
                guild=self.guild,
                moderator=self.author,
                moderator_id=self.author.id
            )
            dm_status = "✅ DM Sent"
        except Exception as e:
            print(f"Error sending DM: {e}")
            dm_status = "❌ Couldn't send DM"

        # Log the action
        await self.log_action("text_mute", f"**Text muted for:** `{self.selected_duration}`")

        try:
            # Delete the old message if it exists
            if hasattr(interaction, 'message') and interaction.message:
                try:
                    await interaction.message.delete()
                except discord.NotFound:
                    # Message was already deleted, continue
                    pass
                except Exception as e:
                    print(f"Error deleting message: {e}")

            # Create a new embed with updated user info
            embed = await self.create_user_info_embed(self.target_user, self.guild)

            # Create a new view with updated buttons
            new_view = ManageUserView(self.bot, self.target_user, self.author, self.original_message)

            # Send a new message as a reply to the original message
            mute_message = ""
            if self.duration_seconds > 0:
                mute_message = f"**{self.target_user.name}** has been text muted for **{self.selected_duration}**. {dm_status}"
            else:
                mute_message = f"**{self.target_user.name}** has been permanently text muted. {dm_status}"

            await self.original_message.reply(mute_message, embed=embed, view=new_view, mention_author=False)
        except Exception as e:
            print(f"Error in handle_text_mute: {e}")


    async def handle_text_unmute(self, interaction: discord.Interaction) -> None:
        """Handle text unmute button press"""
        # Get the muted role
        muted_role_id = int(self.bot.storage.settings["guilds"][self.guild_id]["muted_role_id"])
        muted_role = discord.utils.get(self.guild.roles, id=muted_role_id)

        if muted_role is None:
            await interaction.response.send_message("Muted role not found.", ephemeral=True)
            return

        # Get reason
        reason = f"Text unmuted by {self.author.name}"

        # Remove the role
        await self.target_user.remove_roles(muted_role, reason=reason)

        # Remove from settings
        if str(self.target_user.id) in self.bot.storage.settings["guilds"][self.guild_id]["muted_users"]:
            self.bot.storage.settings["guilds"][self.guild_id]["muted_users"].pop(str(self.target_user.id))
            await self.bot.storage.write_file_to_disk()

        # Try to send DM notification
        try:
            await send_moderation_dm(
                user=self.target_user,
                action_type="unmute",
                guild_name=self.guild.name,
                reason=reason,
                moderator_name=self.author.name,
                guild=self.guild,
                moderator=self.author,
                moderator_id=self.author.id
            )
            dm_status = "✅ DM Sent"
        except Exception as e:
            print(f"Error sending DM: {e}")
            dm_status = "❌ Couldn't send DM"

        # Log the action
        await self.log_action("text_unmute")

        try:
            # Delete the old message if it exists
            if hasattr(interaction, 'message') and interaction.message:
                try:
                    await interaction.message.delete()
                except discord.NotFound:
                    # Message was already deleted, continue
                    pass
                except Exception as e:
                    print(f"Error deleting message: {e}")

            # Create a new embed with updated user info
            embed = await self.create_user_info_embed(self.target_user, self.guild)

            # Create a new view with updated buttons
            new_view = ManageUserView(self.bot, self.target_user, self.author, self.original_message)

            # Send a new message as a reply to the original message
            await self.original_message.reply(
                f"**{self.target_user.name}** has been text unmuted. {dm_status}", 
                embed=embed,
                view=new_view,
                mention_author=False
            )
        except Exception as e:
            print(f"Error in handle_text_unmute: {e}")

    async def handle_voice_mute(self, interaction: discord.Interaction) -> None:
        """Handle voice mute button press"""
        if self.target_user.voice is None:
            await interaction.response.send_message(
                f"**{self.target_user.name}** is not in a voice channel.", 
                ephemeral=True
            )
            return

        # Get reason
        reason = f"Voice muted by {self.author.name}"

        # Mute the user in voice
        await self.target_user.edit(mute=True, reason=reason)

        # Send DM notification to the user
        try:
            await send_moderation_dm(
                user=self.target_user,
                action_type="voice_mute",
                guild_name=self.guild.name,
                reason=reason,
                moderator_name=self.author.name,
                guild=self.guild,
                moderator=self.author,
                moderator_id=self.author.id
            )
            dm_status = "✅ DM Sent"
        except Exception as e:
            print(f"Error sending DM: {e}")
            dm_status = "❌ Couldn't send DM"

        # Log the action
        await self.log_action("voice_mute")

        try:
            # Delete the old message if it exists
            if hasattr(interaction, 'message') and interaction.message:
                try:
                    await interaction.message.delete()
                except discord.NotFound:
                    # Message was already deleted, continue
                    pass
                except Exception as e:
                    print(f"Error deleting message: {e}")

            # Create a new embed with updated user info
            embed = await self.create_user_info_embed(self.target_user, self.guild)

            # Create a new view with updated buttons
            new_view = ManageUserView(self.bot, self.target_user, self.author, self.original_message)

            # Send the response as a reply to the original message
            await self.original_message.reply(
                f"**{self.target_user.name}** has been voice muted. {dm_status}", 
                embed=embed,
                view=new_view,
                mention_author=False
            )
        except Exception as e:
            print(f"Error in handle_voice_mute: {e}")

    async def create_user_info_embed(self, user: Union[discord.Member, discord.User], guild: discord.Guild) -> discord.Embed:
        """Create an embed with user information"""
        embed = discord.Embed(title="SHUBHAMOS ADMIN PANEL", color=0x5865F2)
        embed.set_thumbnail(url=user.display_avatar.url)

        # Set footer with requester info
        embed.set_footer(text=f"Requested by {self.author.name}")

        # Add user information
        embed.add_field(name="Username", value=user.name, inline=True)
        embed.add_field(name="User ID", value=user.id, inline=True)
        embed.add_field(name="Account Created", value=user.created_at.strftime("%b %d, %Y"), inline=True)

        # Add member-specific info if available
        if isinstance(user, discord.Member):
            # Add join date
            embed.add_field(name="Joined Server", value=user.joined_at.strftime("%b %d, %Y"), inline=True)

            # Add roles
            role_list = [role.mention for role in user.roles if role.name != "@everyone"]
            if role_list:
                embed.add_field(name=f"Roles [{len(role_list)}]", value=" ".join(role_list[:10]), inline=False)
            else:
                embed.add_field(name="Roles", value="No roles", inline=False)

            # Add status
            status_map = {
                "online": "🟢 Online",
                "idle": "🟡 Idle",
                "dnd": "🔴 Do Not Disturb",
                "offline": "⚫ Offline"
            }
            status_text = status_map.get(str(user.status), "⚫ Offline")
            embed.add_field(name="Status", value=status_text, inline=True)

        return embed

    async def handle_voice_unmute(self, interaction: discord.Interaction) -> None:
        """Handle voice unmute button press"""
        if self.target_user.voice is None:
            await interaction.response.send_message(
                f"**{self.target_user.name}** is not in a voice channel.", 
                ephemeral=True
            )
            return

        # Get reason
        reason = f"Voice unmuted by {self.author.name}"

        # Unmute the user in voice
        await self.target_user.edit(mute=False, reason=reason)

        # Send DM notification to the user
        try:
            await send_moderation_dm(
                user=self.target_user,
                action_type="voice_unmute",
                guild_name=self.guild.name,
                reason=reason,
                moderator_name=self.author.name,
                guild=self.guild,
                moderator=self.author,
                moderator_id=self.author.id
            )
            dm_status = "✅ DM Sent"
        except Exception as e:
            print(f"Error sending DM: {e}")
            dm_status = "❌ Couldn't send DM"

        # Log the action
        await self.log_action("voice_unmute")

        try:
            # Delete the old message if it exists
            if hasattr(interaction, 'message') and interaction.message:
                try:
                    await interaction.message.delete()
                except discord.NotFound:
                    # Message was already deleted, continue
                    pass
                except Exception as e:
                    print(f"Error deleting message: {e}")

            # Create a new embed with updated user info
            embed = await self.create_user_info_embed(self.target_user, self.guild)

            # Create a new view with updated buttons
            new_view = ManageUserView(self.bot, self.target_user, self.author, self.original_message)

            # Send a new message as a reply to the original message
            await self.original_message.reply(
                f"**{self.target_user.name}** has been voice unmuted. {dm_status}", 
                embed=embed,
                view=new_view,
                mention_author=False
            )
        except Exception as e:
            print(f"Error in handle_voice_unmute: {e}")

    async def handle_voice_deafen(self, interaction: discord.Interaction) -> None:
        """Handle voice deafen button press"""
        if self.target_user.voice is None:
            await interaction.response.send_message(
                f"**{self.target_user.name}** is not in a voice channel.", 
                ephemeral=True
            )
            return

        # Get reason
        reason = f"Voice deafened by {self.author.name}"

        # Deafen the user in voice
        await self.target_user.edit(deafen=True, reason=reason)

        # Send DM notification to the user
        try:
            await send_moderation_dm(
                user=self.target_user,
                action_type="voice_deafen",
                guild_name=self.guild.name,
                reason=reason,
                moderator_name=self.author.name,
                guild=self.guild,
                moderator=self.author,
                moderator_id=self.author.id
            )
            dm_status = "✅ DM Sent"
        except Exception as e:
            print(f"Error sending DM: {e}")
            dm_status = "❌ Couldn't send DM"

        # Log the action
        await self.log_action("voice_deafen")

        try:
            # Delete the old message if it exists
            if hasattr(interaction, 'message') and interaction.message:
                try:
                    await interaction.message.delete()
                except discord.NotFound:
                    # Message was already deleted, continue
                    pass
                except Exception as e:
                    print(f"Error deleting message: {e}")

            # Create a new embed with updated user info
            embed = await self.create_user_info_embed(self.target_user, self.guild)

            # Create a new view with updated buttons
            new_view = ManageUserView(self.bot, self.target_user, self.author, self.original_message)

            # Send the response as a reply to the original message
            await self.original_message.reply(
                f"**{self.target_user.name}** has been voice deafened. {dm_status}", 
                embed=embed,
                view=new_view,
                mention_author=False
            )
        except Exception as e:
            print(f"Error in handle_voice_deafen: {e}")

    async def handle_voice_undeafen(self, interaction: discord.Interaction) -> None:
        """Handle voice undeafen button press"""
        if self.target_user.voice is None:
            await interaction.response.send_message(
                f"**{self.target_user.name}** is not in a voice channel.", 
                ephemeral=True
            )
            return

        # Get reason
        reason = f"Voice undeafened by {self.author.name}"

        # Undeafen the user in voice
        await self.target_user.edit(deafen=False, reason=reason)

        # Send DM notification to the user
        try:
            await send_moderation_dm(
                user=self.target_user,
                action_type="voice_undeafen",
                guild_name=self.guild.name,
                reason=reason,
                moderator_name=self.author.name,
                guild=self.guild,
                moderator=self.author,
                moderator_id=self.author.id
            )
            dm_status = "✅ DM Sent"
        except Exception as e:
            print(f"Error sending DM: {e}")
            dm_status = "❌ Couldn't send DM"

        # Log the action
        await self.log_action("voice_undeafen")

        try:
            # Delete the old message if it exists
            if hasattr(interaction, 'message') and interaction.message:
                try:
                    await interaction.message.delete()
                except discord.NotFound:
                    # Message was already deleted, continue
                    pass
                except Exception as e:
                    print(f"Error deleting message: {e}")

            # Create a new embed with updated user info
            embed = await self.create_user_info_embed(self.target_user, self.guild)

            # Create a new view with updated buttons
            new_view = ManageUserView(self.bot, self.target_user, self.author, self.original_message)

            # Send a new message as a reply to the original message
            await self.original_message.reply(
                f"**{self.target_user.name}** has been voice undeafened. {dm_status}", 
                embed=embed,
                view=new_view,
                mention_author=False
            )
        except Exception as e:
            print(f"Error in handle_voice_undeafen: {e}")

    async def ask_for_duration(self, interaction: discord.Interaction, action_type: str) -> None:
        """Ask the user for a custom duration in 1d1h1m1s format"""
        class DurationInputModal(discord.ui.Modal):
            def __init__(self, parent_view):
                super().__init__(title=f"Enter Duration for {action_type.title()}")
                self.parent_view = parent_view

                self.duration_input = discord.ui.TextInput(
                    label="Duration (format: 1d1h1m1s)",
                    placeholder="Example: 3d12h30m (3 days, 12 hours, 30 minutes)",
                    required=True
                )
                self.add_item(self.duration_input)

            async def on_submit(self, modal_interaction: discord.Interaction):
                duration_str = self.duration_input.value

                # Parse the duration
                seconds = 0
                current_num = ""
                for char in duration_str:
                    if char.isdigit():
                        current_num += char
                    elif char in ['d', 'h', 'm', 's']:
                        if current_num:
                            time_value = int(current_num)
                            if char == 'd':
                                seconds += time_value * 86400
                            elif char == 'h':
                                seconds += time_value * 3600
                            elif char == 'm':
                                seconds += time_value * 60
                            elif char == 's':
                                seconds += time_value
                            current_num = ""

                # If there's no valid duration, use default
                if seconds == 0:
                    await modal_interaction.response.send_message("Invalid duration format. Please use format like 1d2h3m4s.", ephemeral=True)
                    return

                # Store the selected duration
                self.parent_view.duration_seconds = seconds
                self.parent_view.selected_duration = duration_str

                # Execute the appropriate action based on type
                if action_type == "timeout":
                    await self.parent_view.handle_timeout(modal_interaction)
                elif action_type == "ban":
                    await self.parent_view.handle_ban(modal_interaction)

        # Show the modal
        await interaction.response.send_modal(DurationInputModal(self))

    async def handle_timeout(self, interaction: discord.Interaction) -> None:
        """Handle timeout button press"""
        # Calculate timeout duration
        if self.duration_seconds <= 0:
            await interaction.response.send_message(
                "Permanent timeouts are not supported. Please select a duration.", 
                ephemeral=True
            )
            return

        # Max timeout is 28 days
        if self.duration_seconds > 2419200:  # 28 days in seconds
            self.duration_seconds = 2419200
            self.selected_duration = "28d"

        # Get reason
        reason = f"Timed out by {self.author.name}"

        # Apply timeout
        until = discord.utils.utcnow() + datetime.timedelta(seconds=self.duration_seconds)
        await self.target_user.timeout(until, reason=reason)

        # Send DM notification to the user
        try:
            await send_moderation_dm(
                user=self.target_user,
                action_type="timeout",
                guild_name=self.guild.name,
                reason=reason,
                duration=self.duration_seconds,
                moderator_name=self.author.name,
                guild=self.guild,
                moderator=self.author,
                moderator_id=self.author.id
            )
            dm_status = "✅ DM Sent"
        except Exception as e:
            print(f"Error sending DM: {e}")
            dm_status = "❌ Couldn't send DM"

        # Log the action
        await self.log_action("timeout", f"**Timeout duration:** `{self.selected_duration}`")

        # Respond to interaction as a reply
        await self.original_message.reply(
            f"**{self.target_user.name}** has been timed out for **{self.selected_duration}**. {dm_status}", 
            mention_author=False
        )

    async def handle_remove_timeout(self, interaction: discord.Interaction) -> None:
        """Handle remove timeout button press"""
        # Get reason
        reason = f"Timeout removed by {self.author.name}"

        # Remove timeout
        await self.target_user.timeout(None, reason=reason)

        # Send DM notification to the user
        try:
            await send_moderation_dm(
                user=self.target_user,
                action_type="remove_timeout",
                guild_name=self.guild.name,
                reason=reason,
                moderator_name=self.author.name,
                guild=self.guild,
                moderator=self.author,
                moderator_id=self.author.id
            )
            dm_status = "✅ DM Sent"
        except Exception as e:
            print(f"Error sending DM: {e}")
            dm_status = "❌ Couldn't send DM"

        # Log the action
        await self.log_action("timeout_remove")

        # Respond to interaction as a reply
        await self.original_message.reply(
            f"**{self.target_user.name}**'s timeout has been removed. {dm_status}", 
            mention_author=False
        )

    async def handle_kick(self, interaction: discord.Interaction) -> None:
        """Handle kick button press"""
        # Ask for confirmation
        confirm_view = ConfirmActionView(self.bot, self.target_user, self.author, "kick", self.original_message)
        await interaction.response.send_modal(confirm_view)


    async def handle_ban(self, interaction: discord.Interaction) -> None:
        """Handle ban button press"""
        # Ask for confirmation
        confirm_view = ConfirmActionView(self.bot, self.target_user, self.author, "ban", self.selected_duration, self.original_message)
        await interaction.response.send_modal(confirm_view)

    async def on_timeout(self) -> None:
        """Handle timeout of the view"""
        if self.message:
            try:
                # Delete the original message
                await self.message.delete()

                # Send new timeout message as a reply to the original message
                embed = discord.Embed(
                    title="⏰ Interaction Timed Out",
                    description=f"The moderation panel for **{self.target_user.name}** has expired.\nUse the command again to create a new one.",
                    color=0xFF5555
                )
                embed.set_footer(text=f"Requested by {self.author.name}")

                await self.original_message.reply(embed=embed, mention_author=False)
            except:
                pass  # Ignore any errors during cleanup

    async def handle_unban(self, interaction: discord.Interaction) -> None:
        """Handle unban button press"""
        # Check if user is banned
        try:
            # Try to get ban information
            ban_entry = await self.guild.fetch_ban(self.target_user)

            # Get reason
            reason = f"Unbanned by {self.author.name}"

            # Unban the user
            await self.guild.unban(self.target_user, reason=reason)

            # Remove from settings if they're in the banned users list
            if str(self.target_user.id) in self.bot.storage.settings["guilds"][self.guild_id]["banned_users"]:
                self.bot.storage.settings["guilds"][self.guild_id]["banned_users"].pop(str(self.target_user.id))
                await self.bot.storage.write_file_to_disk()

            # Try to send a DM to the user about being unbanned
            try:
                await send_moderation_dm(
                    user=self.target_user,
                    action_type="unban",
                    guild_name=self.guild.name,
                    reason=reason,
                    moderator_name=self.author.name,
                    guild=self.guild,
                    moderator=self.author,
                    moderator_id=self.author.id
                )
                dm_status = "✅ DM Sent"
            except Exception as e:
                print(f"Error sending DM: {e}")
                dm_status = "❌ Couldn't send DM"

            # Log the action
            await self.log_action("unban")

            # Respond to interaction as a reply
            await self.original_message.reply(
                f"**{self.target_user.name}** has been unbanned. {dm_status}", 
                mention_author=False
            )
        except discord.NotFound:
            await interaction.response.send_message(
                f"**{self.target_user.name}** is not banned.", 
                ephemeral=True
            )

    async def log_action(self, action_type: str, additional_info: str = "", duration: int = None) -> None:
        """Log a moderation action to MongoDB and the log channel"""
        # Log to MongoDB first
        extra_data = {}
        if additional_info:
            extra_data["additional_info"] = additional_info

        await self.bot.storage.log_moderation_action(
            action_type=action_type,
            guild_id=self.guild_id,
            user_id=str(self.target_user.id),
            moderator_id=str(self.author.id),
            reason=additional_info or f"Action taken by {self.author.name}",
            duration=duration,
            extra_data=extra_data
        )

        # Create Discord embed for the specified log channel
        embed_builder = EmbedBuilder(event="user_manage")

        # Add common fields
        await embed_builder.add_field(name="**Executor**", value=f"`{self.author.name}`")
        await embed_builder.add_field(name="**Target User**", value=f"`{self.target_user.name}`")
        await embed_builder.add_field(name="**Action**", value=f"`{action_type}`")

        # Add additional info if provided
        if additional_info:
            await embed_builder.add_field(name="**Details**", value=additional_info)

        # Get the embed and send to log channel
        embed = await embed_builder.get_embed()
        # Use the hard-coded channel ID
        log_channel = self.guild.get_channel(1249380931781791855)

        if log_channel:
            await log_channel.send(embed=embed)


class ConfirmActionView(View):
    def __init__(self, bot: ModerationBot, target_user: discord.Member, author: discord.Member, action_type: str, duration: str = None, original_message: discord.Message = None):
        super().__init__(timeout=200)  # 200 seconds timeout to save storage
        self.bot = bot
        self.target_user = target_user
        self.author = author
        self.guild = target_user.guild
        self.guild_id = str(self.guild.id)
        self.action_type = action_type
        self.duration = duration
        self.original_message = original_message

        # Create reason input
        self.reason = "No reason provided"

    @discord.ui.button(label="Confirm", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Handle confirm button press"""
        if interaction.user.id != self.author.id:
            await interaction.response.send_message("This confirmation is not for you.", ephemeral=True)
            return

        # Set a default reason
        await self.reason_modal(interaction)

        if self.action_type == "kick":
            # Get role with ID 1076153405929689218
            target_role = discord.utils.get(self.guild.roles, id=1076153405929689218)

            if target_role and target_role in self.target_user.roles:
                # Get reason
                full_reason = f"Kicked by {self.author.name}: {self.reason}"

                # Remove the role instead of kicking
                await self.target_user.remove_roles(target_role, reason=full_reason)

                # Send DM notification
                try:
                    await send_moderation_dm(
                        user=self.target_user,
                        action_type="kick",
                        guild_name=self.guild.name,
                        reason=self.reason,
                        moderator_name=self.author.name,
                        guild=self.guild,
                        moderator=self.author,
                        moderator_id=self.author.id
                    )
                    dm_status = "✅ DM Sent"
                except Exception as e:
                    print(f"Error sending DM: {e}")
                    dm_status = "❌ Couldn't send DM"

                # Log to MongoDB
                extra_data = {
                    "action": f"Removed role {target_role.name}",
                    "role_id": str(target_role.id)
                }

                await self.bot.storage.log_moderation_action(
                    action_type="kick",
                    guild_id=self.guild_id,
                    user_id=str(self.target_user.id),
                    moderator_id=str(self.author.id),
                    reason=self.reason,
                    extra_data=extra_data
                )

                # Create Discord embed for logging
                embed_builder = EmbedBuilder(event="kick")
                await embed_builder.add_field(name="**Executor**", value=f"`{self.author.name}`")
                await embed_builder.add_field(name="**Kicked user**", value=f"`{self.target_user.name}`")
                await embed_builder.add_field(name="**Action**", value=f"`Removed role {target_role.name}`")
                await embed_builder.add_field(name="**Reason**", value=f"`{self.reason}`")
                embed = await embed_builder.get_embed()

                # Use hard-coded channel ID
                log_channel = self.guild.get_channel(1249380931781791855)

                if log_channel:
                    await log_channel.send(embed=embed)

                # Notify channel as a reply
                await self.original_message.reply(
                    f"**{self.target_user.name}** has been kicked (role {target_role.name} removed). Reason: **{self.reason}**. {dm_status}", 
                    mention_author=False
                )
            else:
                await interaction.response.send_message(
                    f"**{self.target_user.name}** doesn't have the required role to remove.", 
                    ephemeral=True
                )

        elif self.action_type == "ban":
            # Convert duration to seconds
            duration_seconds = -1
            if self.duration != "-1":
                time_map = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}
                duration_value = ""
                duration_unit = ""

                for char in self.duration:
                    if char.isdigit():
                        duration_value += char
                    else:
                        duration_unit = char
                        break

                if duration_unit in time_map:
                    duration_seconds = int(duration_value) * time_map[duration_unit]

            # Get the full reason
            full_reason = f"Kicked by {self.author.name}: {self.reason}"

            # Try to send DM notification before kicking the user
            try:
                await send_moderation_dm(
                    user=self.target_user,
                    action_type="ban",
                    guild_name=self.guild.name,
                    reason=self.reason,
                    duration=duration_seconds if duration_seconds > 0 else None,
                    moderator_name=self.author.name,
                    guild=self.guild,
                    moderator=self.author,
                    moderator_id=self.author.id
                )
                dm_status = "✅ DM Sent"
            except Exception as e:
                print(f"Error sending DM: {e}")
                dm_status = "❌ Couldn't send DM"

            # Instead of banning, kick the user from the server
            await self.guild.kick(self.target_user, reason=full_reason)

            # Store in MongoDB
            extra_data = {
                "action": "Kicked from server",
                "duration": duration_seconds,
                "normal_duration": self.duration,
                "kicked_not_banned": True  # Flag to indicate this user was kicked, not banned
            }

            await self.bot.storage.log_moderation_action(
                action_type="ban",
                guild_id=self.guild_id,
                user_id=str(self.target_user.id),
                moderator_id=str(self.author.id),
                reason=self.reason,
                duration=duration_seconds,
                extra_data=extra_data
            )

            # Create Discord embed for logging
            embed_builder = EmbedBuilder(event="ban")
            await embed_builder.add_field(name="**Executor**", value=f"`{self.author.name}`")
            await embed_builder.add_field(name="**Kicked user**", value=f"`{self.target_user.name}`")
            await embed_builder.add_field(name="**Action**", value="`Kicked from server`")
            await embed_builder.add_field(name="**Reason**", value=f"`{self.reason}`")

            if duration_seconds > 0:
                await embed_builder.add_field(name="**Duration**", value=f"`{self.duration}`")
            else:
                await embed_builder.add_field(name="**Duration**", value="`Permanent`")

            embed = await embed_builder.get_embed()

            # Use hard-coded channel ID
            log_channel = self.guild.get_channel(1249380931781791855)

            if log_channel:
                await log_channel.send(embed=embed)

            # Notify channel as a reply
            if duration_seconds > 0:
                await self.original_message.reply(
                    f"**{self.target_user.name}** has been kicked for **{self.duration}**. Reason: **{self.reason}**. {dm_status}", 
                    mention_author=False
                )
            else:
                await self.original_message.reply(
                    f"**{self.target_user.name}** has been permanently kicked. Reason: **{self.reason}**. {dm_status}", 
                    mention_author=False
                )

        # Disable all buttons and stop listening
        for item in self.children:
            item.disabled = True

        await interaction.message.edit(view=self)
        self.stop()

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Handle cancel button press"""
        if interaction.user.id != self.author.id:
            await interaction.response.send_message("This confirmation is not for you.", ephemeral=True)
            return

        await self.original_message.reply("Action cancelled.", mention_author=False)

        # Disable all buttons and stop listening
        for item in self.children:
            item.disabled = True

        await interaction.message.edit(view=self)
        self.stop()

    # Remove text input for now as we're using buttons
    # We'll use a simple approach for reason instead
    async def reason_modal(self, interaction: discord.Interaction):
        """Handle reason input"""
        # For now, just use a default reason
        self.reason = f"Action taken by {self.author.name}"


class ManageCommand(Command):
    def __init__(self, client_instance: ModerationBot) -> None:
        self.cmd = "manage"
        self.client = client_instance
        self.storage = client_instance.storage
        self.usage = f"Usage: {self.client.prefix}manage <user ID or @mention>"
        self.not_enough_arguments = "You must provide a user to manage. {usage}"
        self.not_found = "Could not find user with ID or mention: {user_id}. {usage}"

    def register_self(self) -> None:
        # Register the command with the bot
        from command_registry import registry
        registry.register(self.cmd, self.__class__)

    async def execute(self, message: discord.Message, **kwargs) -> None:
        """Execute the manage command"""
        command = kwargs.get("args")
        print(f"Executing command: manage with args: {command}")

        # Make sure guild is registered in MongoDB before proceeding
        guild_id = str(message.guild.id)
        guild_exists = await self.storage.has_guild(guild_id)

        if not guild_exists:
            print(f"Guild {guild_id} not found in database, adding it now")
            await self.storage.add_guild(guild_id)

        if await author_is_mod(message.author, self.storage):
            # Handle 'devil manage user' format (ignore it)
            if command and len(command) == 1 and command[0].lower() == "user":
                # Don't respond to incorrect format - just return silently
                print(f"Ignoring incorrect command format: {message.content}")
                return

            # Check if this is a reply to a message
            target_user = None

            # If message is a reply, get the user from the referenced message
            if hasattr(message, 'reference') and message.reference:
                try:
                    reply_msg = None
                    if message.reference.resolved:
                        reply_msg = message.reference.resolved
                    else:
                        # Try to manually fetch the message if not auto-resolved
                        reply_channel = self.client.get_channel(message.reference.channel_id)
                        if reply_channel:
                            reply_msg = await reply_channel.fetch_message(message.reference.message_id)

                    # Make sure it's a valid reply and not to self or a bot
                    if reply_msg and isinstance(reply_msg, discord.Message) and reply_msg.author != message.author and not reply_msg.author.bot:
                        target_user = reply_msg.author
                        print(f"Found target user via reply: {target_user.name} (ID: {target_user.id})")
                        # User found via reply, no need for further args
                        if not command:
                            command = []  # Empty list, but not None
                except Exception as e:
                    print(f"Error resolving reply reference: {e}")

            # If we don't have a target user yet (not a reply or invalid reply target)
            if not target_user:
                if not command:
                    await message.channel.send(self.not_enough_arguments.format(usage=self.usage))
                    return

                # Try to get the user - first check mentions
                if message.mentions:
                    target_user = message.mentions[0]
                    print(f"Found target user via mention: {target_user.name} (ID: {target_user.id}")
                else:
                    # Try by ID - print more detailed debug info
                    user_id_str = command[0]
                    print(f"Attempting to find user by ID: {user_id_str}")

                    # Clean up user ID from mention format if needed
                    user_id = user_id_str

                    try:
                        # Handle different mention formats
                        if user_id.startswith('<@') and user_id.endswith('>'):
                            # This is a mention in the format <@123456789>
                            user_id = user_id[2:-1]
                            print(f"Extracted ID from mention format: {user_id}")

                            # Handle nickname mentions with !
                            if user_id.startswith('!'):
                                user_id = user_id[1:]
                                print(f"Removed nickname prefix: {user_id}")

                        # Try to convert to integer, stripping any whitespace
                        user_id = user_id.strip()
                        print(f"Attempting to convert to integer: {user_id}")
                        user_id_int = int(user_id)

                        # Print the ID we're searching for
                        print(f"Looking up Discord user with ID: {user_id_int}")

                        # First try to get member from the guild
                        try:
                            print(f"Trying to fetch member from guild")
                            target_user = await message.guild.fetch_member(user_id_int)
                            print(f"Successfully found guild member: {target_user.name}")
                        except discord.errors.NotFound:
                            print(f"Member not found in guild, trying Discord API")
                            # If not found in guild, try to find user in Discord
                            try:
                                target_user = await self.client.fetch_user(user_id_int)
                                print(f"Found Discord user: {target_user.name}")
                            except discord.errors.NotFound:
                                print(f"User not found on Discord")
                                target_user = None
                            except Exception as e:
                                print(f"Error fetching user by ID: {str(e)}")
                                target_user = None
                    except (ValueError, AttributeError, TypeError) as e:
                        # Not a valid user ID format
                        print(f"Could not process user ID '{user_id_str}': {str(e)}")
                        target_user = None

                        # Try to find by username as fallback
                        try:
                            print(f"Trying to find user by username: {user_id_str}")
                            for member in message.guild.members:
                                if (member.name.lower() == user_id_str.lower() or 
                                    (member.nick and member.nick.lower() == user_id_str.lower())):
                                    target_user = member
                                    print(f"Found user by name: {target_user.name}")
                                    break
                        except Exception as name_error:
                            print(f"Error while searching by username: {str(name_error)}")

            if target_user is None:
                user_id_str = command[0] if command and len(command) > 0 else "unknown"
                await message.channel.send(self.not_found.format(user_id=user_id_str, usage=self.usage))
                return

            try:
                # Make sure guild is in database before passing it to create_user_info_embed
                guild_id = str(message.guild.id)

                # Ensure guild exists in MongoDB
                guild_exists = await self.storage.has_guild(guild_id)
                if not guild_exists:
                    print(f"Guild {guild_id} not found in database before embedding, adding it now")
                    await self.storage.add_guild(guild_id)

                # Create the user info embed with additional error handling
                try:
                    embed = await self.create_user_info_embed(target_user, message.guild)
                    self.author = message.author #set author for embed footer

                    # Create the buttons view and reply to the original message
                    if isinstance(target_user, discord.Member):
                        view = ManageUserView(self.client, target_user, message.author, message)
                        response = await message.reply(embed=embed, view=view, mention_author=False)
                        view.message = response  # Store message reference
                    else:
                        # If the user is not a member (banned), we can only show their info
                        await message.reply(embed=embed, content="This user is not a member of the server. Limited actions available.", mention_author=False)
                except KeyError as ke:
                    print(f"KeyError in create_user_info_embed: {ke}")
                    await message.reply(f"Error: Guild data not found. Please try again later.", mention_author=False)
                except Exception as inner_e:
                    print(f"Error in create_user_info_embed: {inner_e}")
                    await message.reply(f"Error creating user info: {str(inner_e)}. Please try again later.", mention_author=False)
            except Exception as e:
                # Log the error and send a more specific error message
                print(f"Error in manage command: {e}")
                await message.reply(f"Error processing command: {str(e)}. Please try again later.", mention_author=False)
        else:
            await message.reply("**You must be a moderator to use this command.**", mention_author=False)

    async def create_user_info_embed(self, user: Union[discord.Member, discord.User], guild: discord.Guild) -> discord.Embed:
        """Create an embed with user information"""
        embed = discord.Embed(title="SHUBHAMOS ADMIN PANEL", color=0x5865F2)
        embed.set_thumbnail(url=user.display_avatar.url)

        # For ManageUserView, use self.author
        if hasattr(self, 'author'):
            embed.set_footer(text=f"Requested by {self.author.name}")
        # For ManageCommand, we'll set this later at call time

        # Add user information
        embed.add_field(name="Username", value=user.name, inline=True)
        embed.add_field(name="User ID", value=user.id, inline=True)
        embed.add_field(name="Account Created", value=user.created_at.strftime("%b %d, %Y"), inline=True)

        # Add member-specific info if available
        if isinstance(user, discord.Member):
            # Add join date
            embed.add_field(name="Joined Server", value=user.joined_at.strftime("%b %d, %Y"), inline=True)

            # Add roles
            role_list = [role.mention for role in user.roles if role.name != "@everyone"]
            if role_list:
                embed.add_field(name=f"Roles [{len(role_list)}]", value=" ".join(role_list[:10]), inline=False)
            else:
                embed.add_field(name="Roles", value="No roles", inline=False)

            # Add status
            status_emojis = {
                discord.Status.online: "🟢",
                discord.Status.idle: "🟡",
                discord.Status.dnd: "🔴",
                discord.Status.offline: "⚫"
            }
            status = status_emojis.get(user.status, "⚫")
            embed.add_field(name="Status", value=f"{status} {user.status.name.capitalize()}", inline=True)

            # Check if they're timed out
            if user.is_timed_out():
                embed.add_field(name="Timeout", value=f"Until {user.timeout.strftime('%b %d, %Y %H:%M')}", inline=True)

            # Check if they're muted in the server - with guild validation
            guild_id = str(guild.id)

            # First check if guild exists in database, add it if not
            try:
                guild_data = self.storage.settings["guilds"].get(guild_id)
                if not guild_data:
                    print(f"Guild {guild_id} not found in database, adding it now")
                    # Add guild data to MongoDB
                    await self.storage.add_guild(guild_id)
                    # Refresh guild data
                    guild_data = await self.storage.get_guild(guild_id)

                # Get muted role ID with safeguards
                muted_role_id = 0
                if guild_data and "muted_role_id" in guild_data:
                    muted_role_id = int(guild_data["muted_role_id"])

                # Check if user has muted role
                if muted_role_id > 0:
                    muted_role = discord.utils.get(guild.roles, id=muted_role_id)

                    if muted_role and muted_role in user.roles:
                        # Get mute info
                        mute_info = "Permanent"
                        if guild_data and "muted_users" in guild_data and str(user.id) in guild_data["muted_users"]:
                            duration = guild_data["muted_users"][str(user.id)]["duration"]
                            if duration > 0:
                                remaining = duration - int(time.time())
                                if remaining > 0:
                                    hours, remainder = divmod(remaining, 3600)
                                    minutes, seconds = divmod(remainder, 60)
                                    mute_info = f"{int(hours)}h {int(minutes)}m {int(seconds)}s remaining"

                        embed.add_field(name="Text Muted", value=mute_info, inline=True)
            except Exception as e:
                print(f"Error checking mute status: {e}")
                # Just continue without the mute info

            # Check voice state
            if user.voice:
                voice_info = f"In {user.voice.channel.name}"
                if user.voice.mute:
                    voice_info += " (Server Muted)"
                embed.add_field(name="Voice", value=voice_info, inline=True)
        else:
            # This is for users who are not in the server (banned users)
            embed.add_field(name="Member Status", value="Not a server member", inline=False)

            # Check if they're banned
            try:
                ban_entry = await guild.fetch_ban(user)
                embed.add_field(name="Ban Status", value=f"Banned: {ban_entry.reason or 'No reason provided'}", inline=False)

                # Check if they have a temporary ban - with guild validation
                guild_id = str(guild.id)

                # First check if guild exists in database, add it if not
                try:
                    guild_data = self.storage.settings["guilds"].get(guild_id)
                    if not guild_data:
                        print(f"Guild {guild_id} not found in database for ban check, adding it now")
                        # Add guild data to MongoDB
                        await self.storage.add_guild(guild_id)
                        # Refresh guild data
                        guild_data = await self.storage.get_guild(guild_id)

                    if guild_data and "banned_users" in guild_data and str(user.id) in guild_data["banned_users"]:
                        ban_info = guild_data["banned_users"][str(user.id)]
                        duration = ban_info.get("duration", 0)

                        if duration > 0:
                            remaining = duration - int(time.time())
                            if remaining > 0:
                                hours, remainder = divmod(remaining, 3600)
                                minutes, seconds = divmod(remainder, 60)
                                embed.add_field(name="Ban Duration", value=f"{int(hours)}h {int(minutes)}m {int(seconds)}s remaining", inline=True)
                            else:
                                embed.add_field(name="Ban Duration", value="Ban expired (will be unbanned soon)", inline=True)
                        else:
                            embed.add_field(name="Ban Duration", value="Permanent", inline=True)
                    else:
                        # If no ban info is found in DB, just show permanent
                        embed.add_field(name="Ban Duration", value="Permanent (Manual ban)", inline=True)
                except Exception as e:
                    print(f"Error checking ban information: {e}")
                    # Add a default value
                    embed.add_field(name="Ban Duration", value="Unknown (Error fetching ban data)", inline=True)
            except discord.NotFound:
                # Not banned
                embed.add_field(name="Ban Status", value="Not banned", inline=False)

        # Add timestamp (footer already set above)
        embed.timestamp = discord.utils.utcnow()

        return embed


# Collects a list of classes in the file
classes = inspect.getmembers(sys.modules[__name__], lambda member: inspect.isclass(member) and member.__module__ == __name__)