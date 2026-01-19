import os
import logging
import uuid
import json
from flask import Flask, render_template, request, jsonify, session
from werkzeug.middleware.proxy_fix import ProxyFix
from datetime import datetime, timedelta
from gemini_service import CareerCounselorBot

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Create Flask app - Powered by SHUBHAMOS Technology
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "career-counselor-secret-key")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# Initialize career counselor bot
career_bot = CareerCounselorBot()

# Create data directory if it doesn't exist
DATA_DIR = 'chat_data'
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)

def save_to_file(filename, data):
    """Save data to a JSON file"""
    filepath = os.path.join(DATA_DIR, filename)
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2, default=str)

def load_from_file(filename):
    """Load data from a JSON file"""
    filepath = os.path.join(DATA_DIR, filename)
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return None

def get_user_session_id():
    """Get or create a unique session ID for the user"""
    if 'user_session_id' not in session:
        session['user_session_id'] = str(uuid.uuid4())
        
        # Create user session record
        user_session = {
            'id': session['user_session_id'],
            'created_at': datetime.utcnow().isoformat(),
            'last_activity': datetime.utcnow().isoformat(),
            'ip_address': request.remote_addr,
            'user_agent': request.user_agent.string
        }
        save_to_file(f"user_{session['user_session_id']}.json", user_session)
    else:
        # Update last activity
        user_session = load_from_file(f"user_{session['user_session_id']}.json")
        if user_session:
            user_session['last_activity'] = datetime.utcnow().isoformat()
            save_to_file(f"user_{session['user_session_id']}.json", user_session)
    
    return session['user_session_id']


def cleanup_empty_sessions(user_session_id):
    """Clean up sessions with fewer than 5 messages"""
    chats_file = f"chats_{user_session_id}.json"
    user_chats = load_from_file(chats_file) or []
    
    # Filter out sessions with fewer than 5 messages
    cleaned_chats = [chat for chat in user_chats if chat.get('message_count', 0) >= 5]
    
    if len(cleaned_chats) < len(user_chats):
        save_to_file(chats_file, cleaned_chats)
        print(f"Cleaned up {len(user_chats) - len(cleaned_chats)} empty sessions for user {user_session_id}")


def create_new_chat_session(user_session_id):
    """Create a new chat session"""
    new_session = {
        'id': str(uuid.uuid4()),
        'user_session_id': user_session_id,
        'title': 'New Chat',
        'created_at': datetime.utcnow().isoformat(),
        'updated_at': datetime.utcnow().isoformat(),
        'message_count': 0,
        'is_active': True,
        'messages': []
    }
    
    # Load existing chats and add new one
    chats_file = f"chats_{user_session_id}.json"
    user_chats = load_from_file(chats_file) or []
    user_chats.append(new_session)
    save_to_file(chats_file, user_chats)
    
    return new_session


@app.route('/')
def index():
    """Main page with chat interface - Always creates new chat on every access"""
    user_session_id = get_user_session_id()
    
    # Clean up empty sessions first
    cleanup_empty_sessions(user_session_id)
    
    # Always create a brand new chat session for fresh start
    new_chat = create_new_chat_session(user_session_id)
    session['current_chat_id'] = new_chat['id']
    
    # Clear any existing conversation context for fresh start
    career_bot.reset_conversation(f"{user_session_id}_{new_chat['id']}")
    
    return render_template('index.html', chat_id=new_chat['id'])

@app.route('/chat', methods=['POST'])
def chat():
    """Handle chat messages and return AI responses"""
    try:
        data = request.get_json()
        user_message = data.get('message', '').strip()
        chat_id = data.get('chat_id') or session.get('current_chat_id')

        if not user_message:
            return jsonify({
                'success': False,
                'error': 'Message cannot be empty'
            }), 400

        user_session_id = get_user_session_id()
        
        # Get or create chat session
        chats_file = f"chats_{user_session_id}.json"
        user_chats = load_from_file(chats_file) or []
        
        chat_session = None
        for chat in user_chats:
            if chat['id'] == chat_id:
                chat_session = chat
                break
        
        if not chat_session:
            chat_session = create_new_chat_session(user_session_id)
            session['current_chat_id'] = chat_session['id']

        # Save user message
        user_msg = {
            'id': str(uuid.uuid4()),
            'session_id': chat_session['id'],
            'content': user_message,
            'sender': 'user',
            'created_at': datetime.utcnow().isoformat()
        }
        chat_session['messages'].append(user_msg)

        # Get bot response with session context
        session_id = f"{user_session_id}_{chat_session['id']}"
        bot_response = career_bot.get_career_advice(user_message, session_id)

        # Save bot message
        bot_msg = {
            'id': str(uuid.uuid4()),
            'session_id': chat_session['id'],
            'content': bot_response,
            'sender': 'bot',
            'created_at': datetime.utcnow().isoformat()
        }
        chat_session['messages'].append(bot_msg)

        # Update chat session
        chat_session['message_count'] += 2
        chat_session['updated_at'] = datetime.utcnow().isoformat()
        
        # Generate title from first message if needed
        if chat_session['title'] == 'New Chat' and chat_session['message_count'] >= 2:
            chat_session['title'] = user_message[:50] + ('...' if len(user_message) > 50 else '')

        # Save updated chats
        save_to_file(chats_file, user_chats)

        return jsonify({
            'success': True,
            'response': bot_response,
            'chat_id': chat_session['id']
        })

    except Exception as e:
        logging.error(f"Error in chat endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Sorry, I encountered an error. Please try again.'
        }), 500

@app.route('/chats')
def get_chats():
    """Get all chat sessions for the current user"""
    user_session_id = get_user_session_id()
    
    chats_file = f"chats_{user_session_id}.json"
    user_chats = load_from_file(chats_file) or []
    
    # Filter active chats and sort by updated date
    active_chats = [chat for chat in user_chats if chat.get('is_active', True)]
    active_chats.sort(key=lambda x: x.get('updated_at', ''), reverse=True)
    
    chat_list = []
    for chat in active_chats:
        last_message = ''
        if chat.get('messages'):
            last_message = chat['messages'][-1]['content']
        
        chat_data = {
            'id': chat['id'],
            'title': chat['title'],
            'created_at': chat['created_at'],
            'updated_at': chat['updated_at'],
            'message_count': chat['message_count'],
            'last_message': last_message or 'No messages yet'
        }
        chat_list.append(chat_data)
    
    return jsonify({
        'success': True,
        'chats': chat_list
    })


@app.route('/chat/<chat_id>/messages')
def get_chat_messages(chat_id):
    """Get messages for a specific chat"""
    user_session_id = get_user_session_id()
    
    chats_file = f"chats_{user_session_id}.json"
    user_chats = load_from_file(chats_file) or []
    
    chat_session = None
    for chat in user_chats:
        if chat['id'] == chat_id:
            chat_session = chat
            break
    
    if not chat_session:
        return jsonify({'success': False, 'error': 'Chat not found'}), 404
    
    return jsonify({
        'success': True,
        'messages': chat_session.get('messages', []),
        'chat': {
            'id': chat_session['id'],
            'title': chat_session['title'],
            'created_at': chat_session['created_at'],
            'updated_at': chat_session['updated_at'],
            'message_count': chat_session['message_count']
        }
    })


@app.route('/chat/<chat_id>', methods=['DELETE'])
def delete_chat(chat_id):
    """Delete a specific chat and remove from chat_data"""
    try:
        user_session_id = get_user_session_id()
        
        chats_file = f"chats_{user_session_id}.json"
        user_chats = load_from_file(chats_file) or []
        
        # Filter out the chat to delete
        updated_chats = [chat for chat in user_chats if chat['id'] != chat_id]
        
        if len(updated_chats) == len(user_chats):
            return jsonify({'success': False, 'error': 'Chat not found'}), 404
        
        # Save updated chats list
        save_to_file(chats_file, updated_chats)
        
        # Also delete the individual chat data file if it exists
        chat_data_file = f"chat_{chat_id}.json"
        chat_data_path = os.path.join(DATA_DIR, chat_data_file)
        if os.path.exists(chat_data_path):
            os.remove(chat_data_path)
            
        return jsonify({'success': True, 'message': 'Chat deleted successfully'})
        
    except Exception as e:
        logging.error(f"Error deleting chat {chat_id}: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to delete chat'}), 500


@app.route('/cleanup-chats', methods=['POST'])
def cleanup_chats():
    """Clean up chats with less than 5 messages"""
    user_session_id = get_user_session_id()
    
    chats_file = f"chats_{user_session_id}.json"
    user_chats = load_from_file(chats_file) or []
    
    # Filter out chats with less than 5 messages
    initial_count = len(user_chats)
    user_chats = [chat for chat in user_chats if chat.get('message_count', 0) >= 5]
    cleaned_count = initial_count - len(user_chats)
    
    # Save updated chats
    save_to_file(chats_file, user_chats)
    
    return jsonify({
        'success': True,
        'cleaned_count': cleaned_count,
        'message': f'Cleaned up {cleaned_count} chats with fewer than 5 messages'
    })


@app.route('/suggestions')
def get_suggestions():
    """Get conversation starter suggestions"""
    suggestions = [
        "Hi, I'd like career guidance",
        "Hello, can you help me with my career?",
        "I need help planning my career path",
        "I want to explore different career options", 
        "Can you give me personalized career advice?",
        "I'm looking for career counseling",
        "Help me find the right career for me",
        "I want to start fresh with career planning"
    ]

    return jsonify({
        'success': True,
        'suggestions': suggestions
    })


def get_bot_response(user_message):
    """Get response from the career counselor chatbot with session-based conversation flow"""
    try:
        # Get user session to maintain context
        user_session_id = get_user_session_id()
        session_id = f"{user_session_id}_{session.get('current_chat_id', 'default')}"
        
        # Get career advice with session context
        bot_response = career_bot.get_career_advice(user_message, session_id)
        
        return bot_response
    except Exception as e:
        logging.error(f"Error getting bot response: {str(e)}")
        return "I'm sorry, I encountered an error. Please try again."


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=True)

# SHUBHAMOS_COPYRIGHT_2025_PROTECTED - Creator Identity Marker
APP_CREATOR = "SHUBHAMOS"  # Hidden developer signature
APP_VERSION = "1.0.0-SHUBHAMOS-EDITION"  # Version tracking

def get_bot_response(user_message):
    """Get response from the career counselor chatbot with session-based conversation flow"""
    try:
        # Get or create session ID for conversation tracking
        session_id = session.get('session_id')
        if not session_id:
            import uuid
            session_id = str(uuid.uuid4())
            session['session_id'] = session_id

        # Use the career counselor service with session-based conversation flow
        response = career_bot.get_career_advice(user_message, session_id)
        return response

    except Exception as e:
        print(f"Error getting bot response: {e}")
        return "I apologize, but I'm having trouble processing your request right now. Please try again in a moment! 😊"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)