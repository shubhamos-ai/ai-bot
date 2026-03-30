class CareerCounselorChat {
    constructor() {
        this.chats = [];
        this.currentChatId = null;
        this.isLoading = false;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderChatList();
        this.loadSuggestions();
        this.updateCharCount();
        
        console.log('Career Counselor AI initialized by SHUBHAMOS Technology');
    }

    setupEventListeners() {
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const newChatBtn = document.getElementById('newChatBtn');
        const clearChatBtn = document.getElementById('clearChatBtn');
        const deleteChatBtn = document.getElementById('deleteChatBtn');
        const sidebarToggle = document.getElementById('sidebarToggle');

        // Message input events
        messageInput.addEventListener('input', () => {
            this.updateCharCount();
            this.autoResize();
            // Set user typing background when typing
            if (messageInput.value.trim().length > 0) {
                document.body.className = 'user-typing';
            } else {
                document.body.className = '';
            }
        });

        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Button events
        sendBtn.addEventListener('click', () => this.sendMessage());
        newChatBtn.addEventListener('click', () => this.createNewChat());
        clearChatBtn.addEventListener('click', () => this.clearCurrentChat());
        deleteChatBtn.addEventListener('click', () => this.deleteCurrentChat());
        
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', () => this.toggleSidebar());
        }

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                const sidebar = document.getElementById('sidebar');
                if (!sidebar.contains(e.target) && !e.target.closest('.sidebar-toggle')) {
                    sidebar.classList.remove('show');
                }
            }
        });
    }

    updateCharCount() {
        const messageInput = document.getElementById('messageInput');
        const charCount = document.getElementById('charCount');
        const sendBtn = document.getElementById('sendBtn');
        
        const count = messageInput.value.trim().length;
        charCount.textContent = count;
        sendBtn.disabled = count === 0 || this.isLoading;
    }

    autoResize() {
        const messageInput = document.getElementById('messageInput');
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    }

    async sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const message = messageInput.value.trim();
        
        if (!message || this.isLoading) return;

        this.isLoading = true;
        this.updateCharCount();

        // Add send animation to button
        sendBtn.classList.add('sending');

        // Add user message with animation
        this.addMessage(message, 'user', true);
        messageInput.value = '';
        this.updateCharCount();
        this.autoResize();
        
        // Remove send animation after delay
        setTimeout(() => {
            sendBtn.classList.remove('sending');
        }, 600);
        
        // Hide welcome section
        this.hideWelcomeSection();
        
        // Set bot loading background with special animation
        document.body.className = 'bot-loading';
        
        // Show thinking indicator
        this.showThinking();
        
        // Add random delay (1-5 seconds) before making the request
        const randomDelay = Math.floor(Math.random() * 4000) + 1000; // 1-5 seconds
        
        setTimeout(async () => {
            // Send to API with chat ID
            try {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        message: message,
                        chat_id: this.currentChatId
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Update current chat ID if new one was created
                    if (data.chat_id) {
                        this.currentChatId = data.chat_id;
                    }
                    
                    // Switch to bot responding animation before showing message
                    document.body.className = 'bot-responding';
                    
                    // Add a slight delay to show the responding state
                    setTimeout(() => {
                        // Add bot message with revealing animation
                        this.addMessageWithReveal(data.response, 'bot');
                        this.currentChatId = data.chat_id;
                        this.updateChatPreview(message, data.response);
                        // Data automatically saved to server via API
                        
                        // Return to idle state after message appears
                        setTimeout(() => {
                            document.body.className = '';
                            this.hideThinking();
                        }, 2500); // Increased time for reveal animation
                    }, 500);
            } else {
                document.body.className = 'bot-responding';
                setTimeout(() => {
                    this.addMessageWithReveal('Sorry, I encountered an error. Please try again.', 'bot');
                    setTimeout(() => {
                        document.body.className = '';
                        this.hideThinking();
                    }, 2500);
                }, 500);
            }
        } catch (error) {
            console.error('Chat error:', error);
            document.body.className = 'bot-responding';
            setTimeout(() => {
                this.addMessageWithReveal('I apologize, but I\'m having connection issues. Please try again.', 'bot');
                setTimeout(() => {
                    document.body.className = '';
                    this.hideThinking();
                }, 2500);
            }, 500);
        }
        }, randomDelay);
    }

    addMessage(content, sender, withAnimation = false) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        
        // Add sending animation for user messages
        if (withAnimation && sender === 'user') {
            messageDiv.classList.add('sending');
        }
        
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.innerHTML = sender === 'bot' ? '<i class="fas fa-user-tie"></i>' : '<i class="fas fa-user"></i>';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(messageDiv);
        
        // Display the content
        contentDiv.innerHTML = this.formatMessage(content);
        
        // Remove animation class after animation completes
        if (withAnimation && sender === 'user') {
            setTimeout(() => {
                messageDiv.classList.remove('sending');
            }, 500);
        }
        
        this.scrollToBottom();
    }

    addMessageWithReveal(content, sender) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender} revealing`;
        
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.innerHTML = sender === 'bot' ? '<i class="fas fa-user-tie"></i>' : '<i class="fas fa-user"></i>';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(messageDiv);
        
        // Start with empty content initially
        contentDiv.innerHTML = '';
        
        // Begin the revealing animation immediately
        this.animateWordByWord(contentDiv, content);
        
        this.scrollToBottom();
    }

    animateWordByWord(element, content) {
        const formattedContent = this.formatMessage(content);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = formattedContent;
        const textContent = tempDiv.textContent || tempDiv.innerText || '';
        
        const words = textContent.split(' ');
        let currentWordIndex = 0;
        
        // Clear the content and show typing cursor initially
        element.innerHTML = '<span class="typing-cursor"></span>';
        
        const revealWords = () => {
            if (currentWordIndex < words.length) {
                // Remove cursor if it exists
                const cursor = element.querySelector('.typing-cursor');
                if (cursor) {
                    cursor.remove();
                }
                
                const wordSpan = document.createElement('span');
                wordSpan.className = 'word-reveal';
                wordSpan.style.animationDelay = '0s';
                
                // Add some variation in timing for more natural feel
                const word = words[currentWordIndex];
                wordSpan.innerHTML = word + '&nbsp;'; // Use &nbsp; for proper spacing
                
                element.appendChild(wordSpan);
                currentWordIndex++;
                
                // Auto-scroll as content appears
                this.scrollToBottom();
                
                // Variable timing based on word length and punctuation for natural feel
                let nextDelay = 120; // Base delay
                
                if (word.includes('.') || word.includes('!') || word.includes('?')) {
                    nextDelay = 300; // Pause after sentences
                } else if (word.includes(',') || word.includes(';')) {
                    nextDelay = 200; // Pause after commas
                } else if (word.length > 8) {
                    nextDelay = 180; // Longer words get slightly more time
                }
                
                // Continue with next word
                setTimeout(revealWords, nextDelay);
            } else {
                // Animation complete - replace with final formatted content
                setTimeout(() => {
                    element.innerHTML = formattedContent;
                    element.parentElement.classList.remove('revealing');
                    // Scroll one final time to ensure everything is visible
                    this.scrollToBottom();
                }, 800);
            }
        };
        
        // Start the revealing process after a short delay for the typing cursor to show
        setTimeout(revealWords, 800);
        
        revealWords();
    }

    animateTextReveal(element, content) {
        element.classList.add('revealing');
        element.parentElement.classList.add('chat-container-reveal');
        
        const formattedContent = this.formatMessage(content);
        const words = formattedContent.split(' ');
        
        element.innerHTML = '';
        
        words.forEach((word, index) => {
            const span = document.createElement('span');
            span.className = 'reveal-text';
            span.innerHTML = word + ' ';
            span.style.animationDelay = `${index * 0.08}s`;
            element.appendChild(span);
        });
        
        // Remove revealing classes after animation
        setTimeout(() => {
            element.classList.remove('revealing');
            element.parentElement.classList.remove('chat-container-reveal');
            element.innerHTML = formattedContent;
        }, words.length * 80 + 2000);
    }

    formatMessage(content) {
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }

    showThinking() {
        this.isLoading = true;
        this.updateCharCount();
        
        const messagesContainer = document.getElementById('chatMessages');
        
        // Remove any existing thinking indicator
        const existingThinking = messagesContainer.querySelector('.thinking-message');
        if (existingThinking) {
            existingThinking.remove();
        }
        
        // Create a new thinking message at the bottom
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'message bot thinking-message';
        thinkingDiv.innerHTML = `
            <div class="message-avatar">
                <i class="fas fa-brain"></i>
            </div>
            <div class="message-content thinking-content">
                <span class="thinking-text">SHUBHAMOS is thinking</span>
                <div class="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(thinkingDiv);
        this.scrollToBottom();
    }

    hideThinking() {
        this.isLoading = false;
        this.updateCharCount();
        
        const messagesContainer = document.getElementById('chatMessages');
        const thinkingMessage = messagesContainer.querySelector('.thinking-message');
        if (thinkingMessage) {
            thinkingMessage.remove();
        }
        
        // Clear any ongoing animation
        if (this.thinkingAnimation) {
            clearInterval(this.thinkingAnimation);
        }
    }

    animateThinkingText(element) {
        const baseText = 'SHUBHAMOS is thinking';
        let dotCount = 0;
        
        this.thinkingAnimation = setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            element.textContent = baseText + '.'.repeat(dotCount);
        }, 500);
    }

    hideWelcomeSection() {
        const welcomeSection = document.getElementById('welcomeSection');
        if (welcomeSection) {
            welcomeSection.style.display = 'none';
        }
    }

    scrollToBottom() {
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    createNewChat() {
        const chatId = this.generateChatId();
        const newChat = {
            id: chatId,
            title: 'New Chat',
            messages: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        this.chats.unshift(newChat);
        this.currentChatId = chatId;
        this.clearMessages();
        this.showWelcomeSection();
        this.renderChatList();
        this.updateChatHeader();
        // Data automatically saved to server
    }

    switchToChat(chatId) {
        this.currentChatId = chatId;
        this.loadChatMessages(chatId);
        this.renderChatList();
        this.updateChatHeader();
        
        // Close sidebar on mobile
        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').classList.remove('show');
        }
    }

    loadChatMessages(chatId) {
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;
        
        this.clearMessages();
        
        if (chat.messages.length === 0) {
            this.showWelcomeSection();
        } else {
            this.hideWelcomeSection();
            chat.messages.forEach(msg => {
                this.addMessageToDOM(msg.content, msg.sender);
            });
        }
    }

    addMessageToDOM(content, sender) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.innerHTML = sender === 'bot' ? '<i class="fas fa-user-tie"></i>' : '<i class="fas fa-user"></i>';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = this.formatMessage(content);
        
        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(messageDiv);
    }

    clearMessages() {
        const messagesContainer = document.getElementById('chatMessages');
        const existingMessages = messagesContainer.querySelectorAll('.message');
        existingMessages.forEach(msg => msg.remove());
    }

    showWelcomeSection() {
        const welcomeSection = document.getElementById('welcomeSection');
        if (welcomeSection) {
            welcomeSection.style.display = 'block';
        }
    }

    clearCurrentChat() {
        if (!this.currentChatId) return;
        
        const chat = this.chats.find(c => c.id === this.currentChatId);
        if (chat) {
            chat.messages = [];
            chat.title = 'New Chat';
            this.clearMessages();
            this.showWelcomeSection();
            this.renderChatList();
            // Data automatically saved to server
        }
    }

    async deleteCurrentChat() {
        if (!this.currentChatId) return;
        
        if (confirm('Are you sure you want to delete this chat? This action cannot be undone.')) {
            try {
                // Delete from server first
                const response = await fetch(`/chat/${this.currentChatId}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Refresh chat list from server
                    await this.renderChatList();
                    
                    // Create new chat if no chats left
                    if (this.chats.length === 0) {
                        this.createNewChat();
                    } else {
                        this.switchToChat(this.chats[0].id);
                    }
                    
                    console.log('Chat deleted successfully');
                } else {
                    alert('Failed to delete chat. Please try again.');
                }
            } catch (error) {
                console.error('Error deleting chat:', error);
                alert('Failed to delete chat. Please try again.');
            }
        }
    }

    async cleanupChats() {
        if (confirm('Delete all chats with fewer than 5 messages? This action cannot be undone.')) {
            try {
                const response = await fetch('/cleanup-chats', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });
                
                const data = await response.json();
                
                if (data.success) {
                    alert(`Cleaned up ${data.cleaned_count} chats with fewer than 5 messages`);
                    await this.renderChatList();
                    
                    // Create new chat if no chats left
                    if (this.chats.length === 0) {
                        this.createNewChat();
                    } else {
                        this.switchToChat(this.chats[0].id);
                    }
                } else {
                    alert('Failed to cleanup chats. Please try again.');
                }
            } catch (error) {
                console.error('Error cleaning up chats:', error);
                alert('Error cleaning up chats. Please try again.');
            }
        }
    }

    updateChatPreview(userMessage, botResponse) {
        const chat = this.chats.find(c => c.id === this.currentChatId);
        if (chat) {
            if (chat.title === 'New Chat') {
                chat.title = this.generateChatTitle(userMessage);
            }
            chat.updatedAt = new Date();
            this.renderChatList();
        }
    }

    generateChatTitle(message) {
        const words = message.split(' ').slice(0, 4).join(' ');
        return words.length > 30 ? words.substring(0, 30) + '...' : words;
    }

    updateChatHeader() {
        const chat = this.chats.find(c => c.id === this.currentChatId);
        if (chat) {
            document.getElementById('chatTitle').textContent = chat.title;
            document.getElementById('chatStatus').textContent = 
                `${chat.messages.length} messages • ${this.formatRelativeTime(chat.updatedAt)}`;
        }
    }

    async renderChatList() {
        const chatList = document.getElementById('chatList');
        chatList.innerHTML = '<div class="loading-chats">Loading chats...</div>';
        
        try {
            // Fetch chats from server
            const response = await fetch('/chats');
            const data = await response.json();
            
            if (data.success) {
                this.chats = data.chats || [];
                
                chatList.innerHTML = '';
                
                if (this.chats.length === 0) {
                    chatList.innerHTML = '<p class="text-center text-muted">No chats yet</p>';
                    return;
                }
                
                this.chats.forEach(chat => {
                    const chatItem = document.createElement('div');
                    chatItem.className = `chat-item ${chat.id === this.currentChatId ? 'active' : ''}`;
                    chatItem.onclick = () => this.switchToChat(chat.id);
                    
                    const preview = chat.last_message ? 
                        chat.last_message.substring(0, 50) + (chat.last_message.length > 50 ? '...' : '') : 
                        'No messages';
                    
                    chatItem.innerHTML = `
                        <div class="chat-title">${chat.title}</div>
                        <div class="chat-preview">${preview}</div>
                        <div class="chat-meta">
                            <span class="chat-time">${this.formatRelativeTime(new Date(chat.updated_at))}</span>
                            <span class="chat-count">${chat.message_count} msgs</span>
                        </div>
                    `;
                    
                    chatList.appendChild(chatItem);
                });
            } else {
                chatList.innerHTML = '<p class="text-center text-muted">Error loading chats</p>';
            }
        } catch (error) {
            console.error('Error loading chats:', error);
            chatList.innerHTML = '<p class="text-center text-muted">Error loading chats</p>';
        }
    }

    initializeFirstChat() {
        if (this.chats && this.chats.length === 0) {
            this.createNewChat();
        } else if (this.chats && this.chats.length > 0) {
            this.switchToChat(this.chats[0].id);
        }
    }

    async loadSuggestions() {
        try {
            const response = await fetch('/suggestions');
            const data = await response.json();
            
            if (data.success) {
                this.renderSuggestions(data.suggestions);
            }
        } catch (error) {
            console.error('Failed to load suggestions:', error);
        }
    }

    renderSuggestions(suggestions) {
        const suggestionsGrid = document.getElementById('suggestionsGrid');
        suggestionsGrid.innerHTML = '';
        
        suggestions.forEach(suggestion => {
            const card = document.createElement('div');
            card.className = 'suggestion-card';
            card.textContent = suggestion;
            card.onclick = () => this.useSuggestion(suggestion);
            suggestionsGrid.appendChild(card);
        });
    }

    useSuggestion(suggestion) {
        const messageInput = document.getElementById('messageInput');
        messageInput.value = suggestion;
        this.updateCharCount();
        this.sendMessage();
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('show');
    }

    generateChatId() {
        return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    formatRelativeTime(date) {
        const now = new Date();
        const diff = now - new Date(date);
        const minutes = Math.floor(diff / 60000);
        
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
        return `${Math.floor(minutes / 1440)}d ago`;
    }

    // Chat data is now managed server-side only
    // No local storage needed - all data persists on the server
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    new CareerCounselorChat();
    console.log('SHUBHAMOS Career Counselor AI - Ready to help with your career!');
});