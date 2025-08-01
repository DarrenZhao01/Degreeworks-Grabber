# +++++++++++ FLASK +++++++++++
# This file contains the WSGI configuration required to serve up your
# web application at http://<your-username>.pythonanywhere.com/
# It works by setting the variable 'application' to a WSGI handler of some
# description.
#
# The below has been auto-generated for your Flask project

import sys

# -- Adjust the path to your project directory --
# Example: If your project is in /home/DarrenZhao/Degreeworks-Grabber
project_folder = '/home/DarrenZhao/Degreeworks-Grabber' # <--- CHANGE THIS TO YOUR PROJECT PATH
path = project_folder
if path not in sys.path:
    sys.path.insert(0, path)

# -- Optional: Activate Virtual Environment --
# If you are using a virtual environment, uncomment and adjust the path below
# activate_this = '/home/DarrenZhao/.virtualenvs/my-virtualenv/bin/activate_this.py' # <-- CHANGE THIS
# try:
#     with open(activate_this) as f:
#         exec(f.read(), {'__file__': activate_this})
# except FileNotFoundError:
#     # Handle case where virtualenv activation file doesn't exist
#     # You might want to log this or raise an error depending on your needs
#     pass # Or raise Exception("Virtualenv activation file not found")

# -- Import the Flask app object --
# Assumes your Flask app file is named 'app.py' and the app object is named 'app'
try:
    from app import app as application
except ImportError as e:
    # Log the error or provide a more informative message if the import fails
    # This helps diagnose issues if app.py or the 'app' object isn't found
    print(f"Error importing Flask application: {e}")
    # Optionally, you could raise the exception again or set application to an error handler
    # raise # Re-raise the import error
    # For now, we'll let it fail naturally if the import doesn't work.
    pass # Allow the server to potentially show the import error in logs


# -- Optional: Add any other necessary setup --
# For example, loading environment variables if you use python-dotenv
# from dotenv import load_dotenv
# load_dotenv(os.path.join(project_folder, '.env'))
