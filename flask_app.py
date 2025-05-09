# This file is specifically for PythonAnywhere deployment
# It imports the Flask app object from our main app.py file

import sys
import os

# Add the project directory to the Python path
project_home = os.path.expanduser('~/mysite')
if project_home not in sys.path:
    sys.path = [project_home] + sys.path

# Import the Flask app object
from app import app as application

# PythonAnywhere looks for an 'application' object by default
# The above import sets up the application variable from our app.py's 'app' object 