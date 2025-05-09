import os
import sys
from dotenv import load_dotenv
import requests
import json

# Load .dotenv file
load_dotenv()

# Get API key from environment
API_KEY = os.environ.get('ANTEATER_API_SECRET_KEY')

if not API_KEY:
    print("ERROR: API_KEY is not set in environment. Please check your .dotenv file.")
    # Set a fallback key for testing
    API_KEY = "XXC-asIh0yOAb8APo0idFR71dKL931Ix-YhEKjz9HwI.sk.uqy0qpj0hyzl90dh7450nctt"
    print(f"Using fallback key for testing instead: {API_KEY[:10]}...")
else:
    print(f"Using API key: {API_KEY[:10]}...")  # Print part of the key for verification

BASE_URL = "https://anteaterapi.com/v2/rest/enrollmentHistory"

def test_api_call():
    params = {
        "year": "2023", 
        "quarter": "Spring", 
        "department": "COMPSCI", 
        "courseNumber": "161"
    }
    headers = {
        "Authorization": f"Bearer {API_KEY}"
    }
    
    print(f"Making request to API with params: {params}")
    print(f"Headers: {headers}")
    
    try:
        response = requests.get(BASE_URL, params=params, headers=headers, timeout=25)
        print(f"Status code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get("ok"):
                sections = data.get("data", [])
                print(f"Success! Found {len(sections)} sections")
                # Print a summary of the first section if available
                if sections:
                    first = sections[0]
                    print(f"First section: {first.get('sectionCode')} - {first.get('sectionType')} - {first.get('instructors')}")
                return True
            else:
                print(f"API reported not OK: {data}")
                return False
        else:
            print(f"Error response: {response.text}")
            return False
    except Exception as e:
        print(f"Exception during API call: {e}")
        return False

if __name__ == "__main__":
    success = test_api_call()
    sys.exit(0 if success else 1) 