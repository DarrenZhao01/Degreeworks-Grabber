import os
import sys
from dotenv import load_dotenv
import requests
import json

# Load .dotenv file
load_dotenv()

# Get API key from environment or use fallback
API_KEY = os.environ.get('ANTEATER_API_SECRET_KEY')
if not API_KEY:
    print("Using fallback API key")
    API_KEY = "XXC-asIh0yOAb8APo0idFR71dKL931Ix-YhEKjz9HwI.sk.uqy0qpj0hyzl90dh7450nctt"

BASE_URL = "https://anteaterapi.com/v2/rest/enrollmentHistory"

def test_empty_response_handling():
    """Test that the API handles empty responses correctly for problematic departments"""
    params = {
        "year": "2025", 
        "quarter": "Spring", 
        "department": "CLASSIC", 
        "courseNumber": "36B"
    }
    headers = {
        "Authorization": f"Bearer {API_KEY}"
    }
    
    print(f"Testing API with params: {params}")
    
    try:
        response = requests.get(BASE_URL, params=params, headers=headers, timeout=25)
        print(f"Status code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get("ok"):
                sections = data.get("data", [])
                print(f"Success! API returned ok:true with {len(sections)} sections")
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
    success = test_empty_response_handling()
    if success:
        print("\nSUCCESS: The API is correctly handling empty data responses!")
        sys.exit(0)
    else:
        print("\nFAILURE: There was a problem handling empty data responses from the API.")
        sys.exit(1) 