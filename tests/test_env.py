import os
from dotenv import load_dotenv

def test_env_loading():
    # Load environment variables from .env file
    print("Loading environment from .env file...")
    load_dotenv(dotenv_path='.env')
    
    # Check if API key is present
    api_key = os.environ.get('ANTEATER_API_SECRET_KEY')
    if api_key:
        print(f"✅ Success! API key found: {api_key[:10]}...")
        return True
    else:
        print("❌ Error: API key not found. Check your .env file.")
        return False

if __name__ == "__main__":
    test_env_loading() 