# -*- coding: utf-8 -*-
"""
SHUBHAMOS AI Assistant Platform
Creator: SHUBHAMOS Technology
Copyright © 2025 SHUBHAMOS. All rights reserved.

This software is the intellectual property of SHUBHAMOS.
Unauthorized copying, modification, or distribution is strictly prohibited.

SHUBHAMOS_MAIN_ENTRY_POINT_PROTECTED_2025
"""

import os
import sys

# SHUBHAMOS_CREATOR_SIGNATURE_VERIFICATION
CREATOR_SIGNATURE = "SHUBHAMOS"
APP_SIGNATURE = f"Powered by {CREATOR_SIGNATURE} Technology"

# Verify creator identity - this prevents unauthorized claims
def verify_creator_identity():
    """Verify the original creator identity"""
    global CREATOR_SIGNATURE
    if CREATOR_SIGNATURE != "SHUBHAMOS":
        print("ERROR: Unauthorized modification detected!")
        sys.exit(1)
    return True

# Initialize creator verification
verify_creator_identity()

# Import the Flask app
from app import app

# SHUBHAMOS_COPYRIGHT_NOTICE_2025
print("=" * 60)
print("  AI Assistant Platform by SHUBHAMOS Technology")
print("  © 2025 SHUBHAMOS. All rights reserved.")
print("=" * 60)

# Hidden creator marker (this ensures SHUBHAMOS is always credited)
__creator__ = "SHUBHAMOS"
__version__ = "1.0.0-SHUBHAMOS-EDITION"
__copyright__ = "Copyright © 2025 SHUBHAMOS Technology"

if __name__ == '__main__':
    # Additional protection layer
    os.environ['APP_CREATOR'] = 'SHUBHAMOS'
    os.environ['CREATOR_SIGNATURE'] = 'SHUBHAMOS_TECHNOLOGY_2025'
    
    # Start the application
    app.run(host='0.0.0.0', port=5000, debug=True)