import os
import discord
import asyncio
import secrets
import datetime
import time
from functools import wraps
from flask import Flask, render_template, redirect, url_for, request, session, flash, jsonify

# Bot instance is managed in bot_helpers.py
from bot_helpers import (
    get_bot, get_storage, get_bot_user, get_guild,
    has_storage, safe_run_coroutine
)

# Flask app setup
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", secrets.token_hex(16))
app.config['SESSION_TYPE'] = 'filesystem'
app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(hours=24)

# Filter out Flask's werkzeug logs to keep console clean
import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)  # Only show errors, not info messages

# Admin credentials configuration - using werkzeug.security for password hashing
import os
from werkzeug.security import generate_password_hash, check_password_hash

# Use environment variables or fallback to default (but hashed) credentials
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
# Store the hashed password, not the plain text
ADMIN_PASSWORD_HASH = generate_password_hash(os.environ.get("ADMIN_PASSWORD", "admin"))

# Login required decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

# Routes
@app.route('/')
@login_required
def index():
    # Use our helper function to check if bot is ready
    bot = get_bot()
    if not bot:
        return render_template('index.html', servers=[], bot_status="Disconnected")
    
    servers = []
    for guild in bot.guilds:
        servers.append({
            'id': guild.id,
            'name': guild.name,
            'member_count': len(guild.members),
            'icon_url': guild.icon.url if guild.icon else None
        })
    
    return render_template('index.html', servers=servers, bot_status="Connected")

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if username == ADMIN_USERNAME and check_password_hash(ADMIN_PASSWORD_HASH, password):
            session['logged_in'] = True
            session.permanent = True
            # Set the last login time for additional security tracking
            session['last_login'] = datetime.datetime.now().isoformat()
            
            next_page = request.args.get('next')
            # Validate the next parameter to prevent open redirect vulnerabilities
            if next_page and next_page.startswith('/'):
                return redirect(next_page)
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error='Invalid username or password')
    
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/server/<int:server_id>')
@login_required
def server_detail(server_id):
    # Use our helper function to check if bot is ready
    bot = get_bot()
    if not bot:
        flash('Bot is not connected', 'danger')
        return redirect(url_for('index'))
    
    guild = get_guild(server_id)
    if not guild:
        flash('Server not found', 'danger')
        return redirect(url_for('index'))
    
    server_data = {
        'id': guild.id,
        'name': guild.name,
        'member_count': len(guild.members),
        'channel_count': len(guild.channels),
        'icon_url': guild.icon.url if guild.icon else None
    }
    
    members = []
    for member in guild.members:
        status = "offline"
        if member.status == discord.Status.online:
            status = "online"
        elif member.status == discord.Status.idle:
            status = "idle"
        elif member.status == discord.Status.dnd:
            status = "dnd"
            
        roles = []
        for role in member.roles[1:]:  # Skip @everyone
            roles.append({
                'id': role.id,
                'name': role.name,
                'color': f'#{role.color.value:06x}' if role.color.value else None
            })
        
        members.append({
            'id': member.id,
            'name': member.name,
            'discriminator': member.discriminator,
            'avatar_url': member.avatar.url if member.avatar else member.default_avatar.url,
            'bot': member.bot,
            'status': status,
            'joined_at': member.joined_at.strftime('%Y-%m-%d %H:%M') if member.joined_at else 'Unknown',
            'roles': roles
        })
    
    # Sort members: online first, then alphabetically
    members.sort(key=lambda m: (0 if m['status'] != 'offline' else 1, m['name'].lower()))
    
    return render_template('server.html', server=server_data, members=members)

@app.route('/user/<int:server_id>/<int:user_id>')
@login_required
def user_detail(server_id, user_id):
    # Use helper function to check if bot is ready
    bot = get_bot()
    if not bot:
        flash('Bot is not connected', 'danger')
        return redirect(url_for('index'))
    
    # Use helper function to get guild
    guild = get_guild(server_id)
    if not guild:
        flash('Server not found', 'danger')
        return redirect(url_for('index'))
    
    member = guild.get_member(user_id)
    if not member:
        flash('User not found in this server', 'danger')
        return redirect(url_for('server_detail', server_id=server_id))
    
    # Server data
    server_data = {
        'id': guild.id,
        'name': guild.name
    }
    
    # User data
    status = "offline"
    if member.status == discord.Status.online:
        status = "online"
    elif member.status == discord.Status.idle:
        status = "idle"
    elif member.status == discord.Status.dnd:
        status = "dnd"
    
    roles = []
    for role in member.roles[1:]:  # Skip @everyone
        roles.append({
            'id': role.id,
            'name': role.name,
            'color': f'#{role.color.value:06x}' if role.color.value else None
        })
    
    user_data = {
        'id': member.id,
        'name': member.name,
        'discriminator': member.discriminator,
        'avatar_url': member.avatar.url if member.avatar else member.default_avatar.url,
        'bot': member.bot,
        'status': status,
        'joined_at': member.joined_at.strftime('%Y-%m-%d %H:%M') if member.joined_at else 'Unknown',
        'roles': roles,
        'is_timed_out': member.is_timed_out(),
        'timeout_until': member.timed_out_until.strftime('%Y-%m-%d %H:%M') if member.is_timed_out() else None,
        'nick': member.nick,
        'voice_muted': member.voice and member.voice.mute
    }
    
    # All server roles for the role management
    all_roles = []
    for role in guild.roles[1:]:  # Skip @everyone
        # Skip roles higher than bot's highest role
        if role < guild.me.top_role:
            all_roles.append({
                'id': role.id,
                'name': role.name,
                'color': f'#{role.color.value:06x}' if role.color.value else None
            })
    
    # Get moderation history
    moderation_history = []
    # Use helper function to check if storage is available
    storage = get_storage()
    if storage:
        try:
            # Use helper function to safely run the coroutine
            mod_history = safe_run_coroutine(
                storage.get_user_moderation_history(str(guild.id), str(member.id)),
                []  # Default to empty list if storage call fails
            )
            
            for entry in mod_history:
                moderator = None
                try:
                    moderator_id = int(entry.get('moderator_id', 0))
                    moderator = guild.get_member(moderator_id) or bot.get_user(moderator_id)
                except:
                    pass
                
                moderation_history.append({
                    'action_type': entry.get('action_type', 'unknown'),
                    'reason': entry.get('reason', 'No reason provided'),
                    'created_at': datetime.datetime.fromtimestamp(entry.get('timestamp', 0)).strftime('%Y-%m-%d %H:%M'),
                    'moderator_name': moderator.name if moderator else 'Unknown'
                })
        except Exception as e:
            print(f"Error fetching moderation history: {e}")
    
    return render_template('user.html', server=server_data, user=user_data, 
                           all_roles=all_roles, moderation_history=moderation_history)

# Action routes
@app.route('/action/<int:server_id>/<int:user_id>/timeout', methods=['POST'])
@login_required
def action_timeout(server_id, user_id):
    # Use helper function to check if bot is ready
    bot = get_bot()
    if not bot:
        flash('Bot is not connected', 'danger')
        return redirect(url_for('index'))
    
    # Use helper function to get guild
    guild = get_guild(server_id)
    member = guild.get_member(user_id) if guild else None
    
    if not guild or not member:
        flash('Server or user not found', 'danger')
        return redirect(url_for('index'))
    
    remove_timeout = request.form.get('remove_timeout')
    reason = request.form.get('reason')
    
    if remove_timeout:
        # Remove timeout
        safe_run_coroutine(apply_timeout(guild, member, None, reason))
        flash(f'Timeout removed from {member.name}', 'success')
    else:
        # Apply timeout
        duration = int(request.form.get('duration', 300))
        until = datetime.datetime.now() + datetime.timedelta(seconds=duration)
        
        safe_run_coroutine(apply_timeout(guild, member, until, reason))
        
        if duration < 60:
            duration_text = f"{duration} seconds"
        elif duration < 3600:
            duration_text = f"{duration // 60} minute(s)"
        elif duration < 86400:
            duration_text = f"{duration // 3600} hour(s)"
        else:
            duration_text = f"{duration // 86400} day(s)"
            
        flash(f'{member.name} has been timed out for {duration_text}', 'success')
    
    return redirect(url_for('user_detail', server_id=server_id, user_id=user_id))

@app.route('/action/<int:server_id>/<int:user_id>/kick', methods=['POST'])
@login_required
def action_kick(server_id, user_id):
    # Use helper function to check if bot is ready
    bot = get_bot()
    if not bot:
        flash('Bot is not connected', 'danger')
        return redirect(url_for('index'))
    
    # Use helper function to get guild
    guild = get_guild(server_id)
    member = guild.get_member(user_id) if guild else None
    
    if not guild or not member:
        flash('Server or user not found', 'danger')
        return redirect(url_for('index'))
    
    reason = request.form.get('reason')
    
    # Use helper function to safely run coroutine
    safe_run_coroutine(kick_member(guild, member, reason))
    
    flash(f'{member.name} has been kicked from the server', 'success')
    return redirect(url_for('server_detail', server_id=server_id))

@app.route('/action/<int:server_id>/<int:user_id>/ban', methods=['POST'])
@login_required
def action_ban(server_id, user_id):
    # Use helper function to check if bot is ready
    bot = get_bot()
    if not bot:
        flash('Bot is not connected', 'danger')
        return redirect(url_for('index'))
    
    # Use helper function to get guild
    guild = get_guild(server_id)
    member = guild.get_member(user_id) if guild else None
    
    if not guild or not member:
        flash('Server or user not found', 'danger')
        return redirect(url_for('index'))
    
    reason = request.form.get('reason')
    duration = int(request.form.get('duration', 0))
    delete_message_days = int(request.form.get('delete_message_days', 0))
    
    # Use helper function to safely run coroutine
    safe_run_coroutine(ban_member(guild, member, reason, duration, delete_message_days))
    
    flash(f'{member.name} has been banned from the server', 'success')
    return redirect(url_for('server_detail', server_id=server_id))

@app.route('/action/<int:server_id>/<int:user_id>/voice-mute', methods=['POST'])
@login_required
def action_voice_mute(server_id, user_id):
    # Use helper function to check if bot is ready
    bot = get_bot()
    if not bot:
        flash('Bot is not connected', 'danger')
        return redirect(url_for('index'))
    
    # Use helper function to get guild
    guild = get_guild(server_id)
    member = guild.get_member(user_id) if guild else None
    
    if not guild or not member:
        flash('Server or user not found', 'danger')
        return redirect(url_for('index'))
    
    is_muted = member.voice and member.voice.mute
    
    # Use helper function to safely run coroutine
    safe_run_coroutine(voice_mute(guild, member, not is_muted))
    
    action_text = "muted" if not is_muted else "unmuted"
    flash(f'{member.name} has been {action_text} in voice channels', 'success')
    return redirect(url_for('user_detail', server_id=server_id, user_id=user_id))

@app.route('/action/<int:server_id>/<int:user_id>/roles', methods=['POST'])
@login_required
def action_roles(server_id, user_id):
    if not bot_instance or not bot_instance.is_ready():
        flash('Bot is not connected', 'danger')
        return redirect(url_for('index'))
    
    guild = bot_instance.get_guild(server_id)
    member = guild.get_member(user_id) if guild else None
    
    if not guild or not member:
        flash('Server or user not found', 'danger')
        return redirect(url_for('index'))
    
    # Get selected roles
    selected_role_ids = request.form.getlist('roles[]')
    selected_role_ids = [int(role_id) for role_id in selected_role_ids]
    
    # Get manageable roles
    manageable_roles = []
    for role in guild.roles:
        if role < guild.me.top_role and role.name != "@everyone":
            manageable_roles.append(role)
    
    # Determine roles to add and remove
    roles_to_add = []
    roles_to_remove = []
    
    for role in manageable_roles:
        if role.id in selected_role_ids and role not in member.roles:
            roles_to_add.append(role)
        elif role.id not in selected_role_ids and role in member.roles:
            roles_to_remove.append(role)
    
    # Apply role changes
    asyncio.run_coroutine_threadsafe(
        manage_roles(guild, member, roles_to_add, roles_to_remove),
        bot_instance.loop
    ).result()
    
    flash(f'Roles updated for {member.name}', 'success')
    return redirect(url_for('user_detail', server_id=server_id, user_id=user_id))

@app.route('/action/<int:server_id>/<int:user_id>/nick', methods=['POST'])
@login_required
def action_nick(server_id, user_id):
    if not bot_instance or not bot_instance.is_ready():
        flash('Bot is not connected', 'danger')
        return redirect(url_for('index'))
    
    guild = bot_instance.get_guild(server_id)
    member = guild.get_member(user_id) if guild else None
    
    if not guild or not member:
        flash('Server or user not found', 'danger')
        return redirect(url_for('index'))
    
    nickname = request.form.get('nickname', '')
    reason = request.form.get('reason', 'Nickname change via web dashboard')
    
    # If nickname is empty, set to None to reset
    if not nickname:
        nickname = None
    
    asyncio.run_coroutine_threadsafe(
        change_nickname(guild, member, nickname, reason),
        bot_instance.loop
    ).result()
    
    if nickname:
        flash(f'Nickname for {member.name} changed to {nickname}', 'success')
    else:
        flash(f'Nickname for {member.name} has been reset', 'success')
    
    return redirect(url_for('user_detail', server_id=server_id, user_id=user_id))

# Discord bot action functions
async def apply_timeout(guild, member, until, reason):
    """Apply or remove timeout for a member"""
    try:
        await member.timeout(until, reason=reason)
        
        # Log to MongoDB if available
        storage = get_storage()
        bot_user = get_bot_user()
        if storage and bot_user:
            action_type = "remove_timeout" if until is None else "timeout"
            duration = None
            if until:
                now = datetime.datetime.now()
                duration = int((until - now).total_seconds())
            
            await storage.log_moderation_action(
                action_type=action_type,
                guild_id=str(guild.id),
                user_id=str(member.id),
                moderator_id=str(bot_user.id),
                reason=reason,
                duration=duration if duration else 0  # Convert None to 0 for API compatibility
            )
        
        # Send DM to user
        try:
            if until is None:
                await member.send(f"Your timeout in **{guild.name}** has been removed.\n**Reason:** {reason}")
            else:
                duration_str = format_duration((until - datetime.datetime.now()).total_seconds())
                await member.send(f"You have been timed out in **{guild.name}** for {duration_str}.\n**Reason:** {reason}")
        except:
            pass  # Cannot DM user
        
    except discord.Forbidden:
        print(f"Missing permissions to timeout {member}")
    except Exception as e:
        print(f"Error applying timeout: {e}")

async def kick_member(guild, member, reason):
    """Kick a member from the server"""
    try:
        # Send DM before kicking
        try:
            await member.send(f"You have been kicked from **{guild.name}**.\n**Reason:** {reason}")
        except:
            pass  # Cannot DM user
        
        await member.kick(reason=reason)
        
        # Log to MongoDB if available
        storage = get_storage()
        bot_user = get_bot_user()
        if storage and bot_user:
            await storage.log_moderation_action(
                action_type="kick",
                guild_id=str(guild.id),
                user_id=str(member.id),
                moderator_id=str(bot_user.id),
                reason=reason
            )
            
    except discord.Forbidden:
        print(f"Missing permissions to kick {member}")
    except Exception as e:
        print(f"Error kicking member: {e}")

async def ban_member(guild, member, reason, duration=0, delete_message_days=0):
    """Ban a member from the server"""
    try:
        # Send DM before banning
        try:
            if duration > 0:
                duration_str = format_duration(duration)
                await member.send(f"You have been banned from **{guild.name}** for {duration_str}.\n**Reason:** {reason}")
            else:
                await member.send(f"You have been permanently banned from **{guild.name}**.\n**Reason:** {reason}")
        except:
            pass  # Cannot DM user
        
        await guild.ban(member, reason=reason, delete_message_days=delete_message_days)
        
        # Log to MongoDB if available
        storage = get_storage()
        bot_user = get_bot_user()
        if storage and bot_user:
            await storage.log_moderation_action(
                action_type="ban",
                guild_id=str(guild.id),
                user_id=str(member.id),
                moderator_id=str(bot_user.id),
                reason=reason,
                duration=duration
            )
            
            # Store temp ban info if duration is specified
            if duration > 0:
                guild_id = str(guild.id)
                # Use storage API safely
                guild_settings = await storage.get_guild(guild_id)
                if guild_settings and "banned_users" not in guild_settings:
                    guild_settings["banned_users"] = {}
                
                ban_expiry = int(time.time()) + duration
                guild_settings["banned_users"][str(member.id)] = {
                    "duration": ban_expiry,
                    "reason": reason
                }
                await storage.update_guild(guild_id, {"banned_users": guild_settings["banned_users"]})
        
    except discord.Forbidden:
        print(f"Missing permissions to ban {member}")
    except Exception as e:
        print(f"Error banning member: {e}")

async def voice_mute(guild, member, mute_state):
    """Mute or unmute a member in voice channels"""
    try:
        if member.voice:
            await member.edit(mute=mute_state)
            
            # Log to MongoDB if available
            storage = get_storage()
            bot_user = get_bot_user()
            if storage and bot_user:
                action_type = "voice_mute" if mute_state else "voice_unmute"
                await storage.log_moderation_action(
                    action_type=action_type,
                    guild_id=str(guild.id),
                    user_id=str(member.id),
                    moderator_id=str(bot_user.id),
                    reason=f"Voice {'muted' if mute_state else 'unmuted'} via dashboard"
                )
            
            # Send DM to user
            try:
                if mute_state:
                    await member.send(f"You have been voice muted in **{guild.name}**.")
                else:
                    await member.send(f"Your voice mute in **{guild.name}** has been removed.")
            except:
                pass  # Cannot DM user
    except discord.Forbidden:
        print(f"Missing permissions to voice mute {member}")
    except Exception as e:
        print(f"Error changing voice mute state: {e}")

async def manage_roles(guild, member, roles_to_add, roles_to_remove):
    """Add and remove roles from a member"""
    try:
        if roles_to_add:
            for role in roles_to_add:
                await member.add_roles(role, reason="Role update via dashboard")
                
                # Log to MongoDB if available
                if hasattr(bot_instance, 'storage') and bot_instance.storage:
                    await bot_instance.storage.log_moderation_action(
                        action_type="role_add",
                        guild_id=str(guild.id),
                        user_id=str(member.id),
                        moderator_id=str(bot_instance.user.id),
                        reason=f"Added role {role.name}",
                        extra_data={"role_id": str(role.id), "role_name": role.name}
                    )
        
        if roles_to_remove:
            for role in roles_to_remove:
                await member.remove_roles(role, reason="Role update via dashboard")
                
                # Log to MongoDB if available
                if hasattr(bot_instance, 'storage') and bot_instance.storage:
                    await bot_instance.storage.log_moderation_action(
                        action_type="role_remove",
                        guild_id=str(guild.id),
                        user_id=str(member.id),
                        moderator_id=str(bot_instance.user.id),
                        reason=f"Removed role {role.name}",
                        extra_data={"role_id": str(role.id), "role_name": role.name}
                    )
        
        # Send DM to user about role changes
        try:
            if roles_to_add and roles_to_remove:
                added_roles = ", ".join([role.name for role in roles_to_add])
                removed_roles = ", ".join([role.name for role in roles_to_remove])
                await member.send(f"Your roles in **{guild.name}** have been updated.\n"
                                 f"**Added:** {added_roles}\n"
                                 f"**Removed:** {removed_roles}")
            elif roles_to_add:
                added_roles = ", ".join([role.name for role in roles_to_add])
                await member.send(f"You have been given the following roles in **{guild.name}**:\n"
                                 f"**Added:** {added_roles}")
            elif roles_to_remove:
                removed_roles = ", ".join([role.name for role in roles_to_remove])
                await member.send(f"The following roles have been removed from you in **{guild.name}**:\n"
                                 f"**Removed:** {removed_roles}")
        except:
            pass  # Cannot DM user
            
    except discord.Forbidden:
        print(f"Missing permissions to manage roles for {member}")
    except Exception as e:
        print(f"Error managing roles: {e}")

async def change_nickname(guild, member, nickname, reason):
    """Change a member's nickname"""
    try:
        await member.edit(nick=nickname, reason=reason)
        
        # Log to MongoDB if available
        if hasattr(bot_instance, 'storage') and bot_instance.storage:
            await bot_instance.storage.log_moderation_action(
                action_type="nickname",
                guild_id=str(guild.id),
                user_id=str(member.id),
                moderator_id=str(bot_instance.user.id),
                reason=reason,
                extra_data={"new_nickname": nickname}
            )
        
        # Send DM to user
        try:
            if nickname:
                await member.send(f"Your nickname in **{guild.name}** has been changed to **{nickname}**.\n"
                                 f"**Reason:** {reason}")
            else:
                await member.send(f"Your nickname in **{guild.name}** has been reset to your username.\n"
                                 f"**Reason:** {reason}")
        except:
            pass  # Cannot DM user
            
    except discord.Forbidden:
        print(f"Missing permissions to change nickname for {member}")
    except Exception as e:
        print(f"Error changing nickname: {e}")

# Helper functions
def format_duration(seconds):
    """Format duration in seconds to a human-readable string"""
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds} seconds"
    elif seconds < 3600:
        minutes = seconds // 60
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    elif seconds < 86400:
        hours = seconds // 3600
        return f"{hours} hour{'s' if hours != 1 else ''}"
    else:
        days = seconds // 86400
        return f"{days} day{'s' if days != 1 else ''}"