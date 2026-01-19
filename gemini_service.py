import os
import logging
import json

class CareerCounselorBot:
    """Career counseling chatbot using Gemini API with smart questioning flow"""
    
    def __init__(self):
        """Initialize the Gemini client and conversation system"""
        # For now, we'll use a simple response system until API is configured
        self.api_key = os.environ.get("GEMINI_API_KEY")
        if self.api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.api_key)
                self.client = genai.GenerativeModel('gemini-pro')
            except ImportError:
                logging.warning("Google Generative AI package not installed. Using fallback responses.")
                self.client = None
        else:
            self.client = None
        self.memory_content = self.load_memory_file()
        # SHUBHAMOS_CREATOR_TOKEN_XYZ789 - Developer Identity Protection
        self._dev_identity = "SHUBHAMOS"
        
        # User profile storage (in production, use a database)
        self.user_profiles = {}
        
        # Professional career counseling flow based on rules.txt
        self.question_flow = [
            {
                'stage': 'welcome',
                'question': "Hello! I'm your **Career Counselor AI**.\n\nI provide professional career guidance, job market insights, and help you navigate your career journey with personalized advice.\n\nTo get started, could you tell me about your **current career situation**?\n\n• Looking for a new career path\n• Seeking advancement in your current role\n• Considering a career change\n• Just starting your career journey\n• Other (please specify)",
                'field': 'situation'
            },
            {
                'stage': 'background',
                'question': "Thank you for sharing that information. To provide relevant and personalized advice, I need to understand your **professional background**.\n\nPlease tell me:\n• Your educational background and qualifications\n• Your work experience and current role (if any)\n• Industry or field you're currently in",
                'field': 'background'
            },
            {
                'stage': 'skills_interests',
                'question': "Perfect! Now I'd like to understand your **skills and interests** better.\n\nPlease share:\n• Your key skills (technical and soft skills)\n• Areas of interest or passion\n• Strengths you're known for",
                'field': 'skills_interests'
            },
            {
                'stage': 'goals_timeline',
                'question': "Excellent! Let's discuss your **career goals and timeline**.\n\nPlease tell me:\n• Your specific career objectives\n• Target roles or industries you're considering\n• Your timeline for achieving these goals\n• Salary expectations (optional)",
                'field': 'goals_timeline'
            },
            {
                'stage': 'challenges',
                'question': "Great! Finally, what **challenges or concerns** do you have about reaching your career goals?\n\n• Skills you need to develop\n• Market competition concerns\n• Interview preparation needs\n• Networking difficulties\n• Other specific obstacles",
                'field': 'challenges'
            }
        ]
        
        # Current conversation stage tracking (in production, use session storage)
        self.conversation_stages = {}
        
        # Predefined rules for career counseling responses
        self.response_rules = {
            'length': 'Keep responses concise - maximum 3-4 sentences per main point',
            'format': 'Use bullet points and bold highlights for key information',
            'tone': 'Professional yet encouraging, direct and actionable',
            'structure': 'Start with acknowledgment, provide main advice, end with next step',
            'highlighting': 'Bold the most important phrases and actionable items',
            'personalization': 'Always reference user profile when available'
        }
        
        # Custom user rules (can be updated)
        self.custom_rules = []
        
        # Enhanced system prompt following rules.txt guidelines
        self.base_system_prompt = f"""
        You are an expert Career Counselor AI developed by {self._dev_identity}. Follow these STRICT RULES from rules.txt:
        
        PRIMARY OBJECTIVE:
        - Provide career counseling, guidance on career paths, job opportunities, skill development, and personal growth
        - Focus on helpful, practical, and realistic career advice
        - Refrain from personal opinions or discussions outside career advice
        
        TONE AND LANGUAGE:
        - Professional, calm, and respectful language
        - Neutral and non-biased at all times
        - Concise, clear, and to the point (2-3 sentences max unless detailed explanation requested)
        - Objective, factual, and direct responses
        - Simple language anyone can understand
        
        RESPONSE STRUCTURE:
        - Keep responses to 2-3 sentences unless user requests more detail
        - For career questions, always provide specific suggestions based on user's inquiry
        - If question is off-topic, politely redirect to career-related topics
        
        CORE EXPERTISE AREAS:
        - Career path guidance and exploration
        - Skills and education recommendations (technical + soft skills)
        - Salary expectations with general ranges and location/experience disclaimers
        - Job market trends and industry insights (2025)
        - Career development advice (resume, networking, interviews)
        - Career transitions and advancement strategies
        
        STRICT REFUSAL RULES:
        - Never engage in political, religious, or controversial discussions
        - Do not provide coding help or technical debugging
        - Refuse non-career related requests politely
        - Redirect inappropriate language back to career focus
        
        HANDLING SCENARIOS:
        - Acknowledge user emotions but maintain career focus
        - Ask for clarification on vague questions
        - Provide encouragement while being realistic
        - Address multiple queries separately and concisely
        
        Remember: Always stay career-focused, professional, and provide actionable advice.
        """

    def get_career_advice(self, user_message: str, session_id: str = "default") -> str:
        """
        Main method to handle user messages with smart questioning flow
        
        Args:
            user_message (str): User's message
            session_id (str): Session identifier for tracking conversation
            
        Returns:
            str: AI response (either a question or career advice)
        """
        try:
            # Initialize user session if not exists
            if session_id not in self.conversation_stages:
                self.conversation_stages[session_id] = {'stage': 0, 'profile': {}}
            
            user_session = self.conversation_stages[session_id]
            current_stage = user_session['stage']
            
            # If we're still in the questioning phase
            if current_stage < len(self.question_flow):
                return self._handle_question_flow(user_message, session_id)
            
            # If profile is complete, provide personalized career advice
            return self._provide_personalized_advice(user_message, session_id)
            
        except Exception as e:
            logging.error(f"Error in career advice generation: {e}")
            return "I apologize, but I'm having a technical issue right now. Please try again in a moment, and I'll be happy to help with your career questions!"

    def _handle_question_flow(self, user_message: str, session_id: str) -> str:
        """Handle the professional questioning flow to gather user career information"""
        user_session = self.conversation_stages[session_id]
        current_stage = user_session['stage']
        
        # For the very first interaction, start with the first question
        if current_stage == 0 and (not user_message.strip() or user_message.lower() in ['hi', 'hello', 'hey']):
            return self.question_flow[0]['question']
        
        # If we have a response, save it and move to next question
        if current_stage < len(self.question_flow):
            if user_message.strip():  # Only save non-empty responses
                field = self.question_flow[current_stage]['field']
                user_session['profile'][field] = user_message.strip()
                
                # Move to next stage
                user_session['stage'] += 1
                current_stage = user_session['stage']
            
            # If there are more questions, ask the next one
            if current_stage < len(self.question_flow):
                next_question = self.question_flow[current_stage]['question']
                # Format the question with previously collected info
                try:
                    return next_question.format(**user_session['profile'])
                except KeyError:
                    return next_question
            else:
                # All questions completed, provide summary and transition to advice mode
                profile = user_session['profile']
                return f"""
Perfect! I now have your complete **career profile**:

**Career Situation**: {profile.get('situation', 'Not specified')}
**Background**: {profile.get('background', 'Not specified')}
**Skills & Interests**: {profile.get('skills_interests', 'Not specified')}
**Goals & Timeline**: {profile.get('goals_timeline', 'Not specified')}
**Challenges**: {profile.get('challenges', 'Not specified')}

I'm ready to provide **personalized career guidance** based on your profile. What specific career topic would you like to discuss first?

You can ask about:
• Career path recommendations
• Skill development strategies
• Job market insights
• Interview preparation
• Resume optimization
• Networking strategies
"""
        
        return "I'm here to help with your career! Could you tell me a bit about yourself first?"

    def _provide_personalized_advice(self, user_message: str, session_id: str) -> str:
        """Provide personalized career advice using the complete user profile"""
        user_session = self.conversation_stages[session_id]
        profile = user_session['profile']
        
        # Create personalized system prompt with user information
        personalized_prompt = f"""
        {self.base_system_prompt}
        
        USER PROFILE:
        Name: {profile.get('name', 'User')}
        Age: {profile.get('age', 'Not specified')}
        Education: {profile.get('education', 'Not specified')}
        Interests: {profile.get('interests', 'Not specified')}
        Skills: {profile.get('skills', 'Not specified')}
        Career Goals: {profile.get('goals', 'Not specified')}
        
        CURRENT CONTEXT FROM MEMORY:
        {self.memory_content}
        
        INSTRUCTIONS:
        - Use this profile information to provide highly personalized career advice
        - Reference their specific interests, skills, and goals in your response
        - Address them by name to make it personal
        - Provide concrete, actionable advice tailored to their situation
        - Be encouraging and supportive while being practical
        - Suggest specific next steps they can take
        """
        
        try:
            response = self.client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Content(
                        role="user",
                        parts=[types.Part(text=f"User Profile Context: {json.dumps(profile)}\n\nUser Question: {user_message}")]
                    )
                ],
                config=types.GenerateContentConfig(
                    system_instruction=personalized_prompt,
                    temperature=0.7,
                    max_output_tokens=1500
                )
            )
            
            return response.text or "I apologize, but I couldn't generate a response right now. Please try asking your career question again!"
            
        except Exception as e:
            logging.error(f"Error generating personalized advice: {e}")
            return f"I'm excited to help you with your career journey, {profile.get('name', 'there')}! Please try asking your question again, and I'll provide personalized advice based on your background."

    def reset_conversation(self, session_id: str = "default"):
        """Reset the conversation flow for a session"""
        if session_id in self.conversation_stages:
            del self.conversation_stages[session_id]

    def get_user_profile(self, session_id: str = "default") -> dict:
        """Get the current user profile for a session"""
        if session_id in self.conversation_stages:
            return self.conversation_stages[session_id].get('profile', {})
        return {}

    def is_profile_complete(self, session_id: str = "default") -> bool:
        """Check if user profile collection is complete"""
        if session_id not in self.conversation_stages:
            return False
        return self.conversation_stages[session_id]['stage'] >= len(self.question_flow)

    def load_memory_file(self) -> str:
        """Load the memory file content to enhance bot intelligence"""
        try:
            memory_path = os.path.join(os.path.dirname(__file__), 'remember.txt')
            if os.path.exists(memory_path):
                with open(memory_path, 'r', encoding='utf-8') as f:
                    content = f.read().strip()
                    return content if content else ""
            return ""
        except Exception as e:
            logging.warning(f"Could not load memory file: {e}")
            return ""

    def validate_message(self, message: str) -> bool:
        """Validate user message for basic content filtering"""
        if not message or not message.strip():
            return False
        
        # Allow all career-related and personal questions - be very permissive
        blocked_patterns = [
            'hack', 'exploit', 'illegal', 'drugs', 'violence'
        ]
        
        message_lower = message.lower()
        for pattern in blocked_patterns:
            if pattern in message_lower:
                return False
        
        return True
    
    def _generate_fallback_response(self, user_message: str, profile: dict) -> str:
        """Generate a helpful fallback response when Gemini API is not available"""
        name = profile.get('name', 'there')
        interests = profile.get('interests', '')
        education = profile.get('education', '')
        goals = profile.get('goals', '')
        skills = profile.get('skills', '')
        
        # Create a helpful response based on common career questions
        message_lower = user_message.lower()
        
        # Career exploration responses
        if any(word in message_lower for word in ['career', 'job', 'work', 'profession', 'future']):
            return f"""
Hi {name}! Based on your profile:
• **Education**: {education if education else 'Not specified'}
• **Skills**: {skills if skills else 'Not specified'}
• **Goals**: {goals if goals else 'Not specified'}

**Quick Career Guidance:**
• **Explore roles** that match your interests
• **Optimize your resume** and LinkedIn profile
• **Network actively** in your target industry
• **Develop key skills** through online courses

What specific aspect would you like to focus on?
"""
        
        # Skills-related responses
        elif any(word in message_lower for word in ['skill', 'learn', 'develop', 'training']):
            return f"""
Hi {name}! **Skill Development Focus:**

**Your current skills**: {skills if skills else "Let's identify them!"}

**Top Skills to Develop:**
• **Technical**: Python, SQL, Excel, Digital Marketing
• **Soft**: Communication, Leadership, Problem-solving
• **Learning**: Coursera, edX, Udemy, Khan Academy

**Next Step**: Choose one skill to focus on for the next 3 months.

What skill interests you most?
"""
        
        # Interview preparation responses
        elif any(word in message_lower for word in ['interview', 'preparation', 'questions']):
            return f"""
Hi {name}! **Interview Prep Essentials:**

**Before Interview:**
• **Research** the company thoroughly
• **Practice** your elevator pitch (30 seconds)
• **Prepare** 3-5 questions about the role

**Common Questions:**
• "Tell me about yourself"
• "Why this role?"
• "Your strengths/weaknesses?"

**Key Tips:**
• Arrive 10 minutes early
• Use **STAR method** for examples
• Send thank-you email within 24 hours

What specific interview area concerns you most?
"""
        
        # Default response
        return f"""
Hi {name}! Thanks for your question: "{user_message}"

**I can help you with:**
• **Career exploration** and planning
• **Job search** strategies
• **Skill development** recommendations
• **Interview preparation** and tips
• **Resume optimization**
• **Career transitions**

**Next Step**: Choose one area from above to focus on.

What specific career topic interests you most?
"""
    
    def update_custom_rules(self, new_rules: list):
        """Update the custom rules for the chatbot"""
        self.custom_rules = new_rules
        print(f"✓ Updated chatbot with {len(new_rules)} custom rules")
        
        # Update the system prompt to include custom rules
        if self.custom_rules:
            custom_rules_text = "\n".join([f"• {rule}" for rule in self.custom_rules])
            self.base_system_prompt += f"\n\nCUSTOM RULES:\n{custom_rules_text}"
    
    def get_custom_rules(self) -> list:
        """Get the current custom rules"""
        return self.custom_rules
    
    def add_custom_rule(self, rule: str):
        """Add a single custom rule"""
        self.custom_rules.append(rule)
        print(f"✓ Added custom rule: {rule}")
    
    def clear_custom_rules(self):
        """Clear all custom rules"""
        self.custom_rules = []
        print("✓ Cleared all custom rules")