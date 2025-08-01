import requests

# This is the key that works in our curl tests (this is insecure for a real app but fine for testing)
API_KEY = "XXC-asIh0yOAb8APo0idFR71dKL931Ix-YhEKjz9HwI.sk.uqy0qpj0hyzl90dh7450nctt"
BASE_URL = "https://anteaterapi.com/v2/rest/enrollmentHistory"

# Test with a case we know returns data
def test_valid_case():
    params = {
        "year": "2023", 
        "quarter": "Spring", 
        "department": "COMPSCI", 
        "courseNumber": "161"
    }
    headers = {
        "Authorization": f"Bearer {API_KEY}"  # Note the capitalized Authorization - this might be important
    }
    
    print(f"Testing valid case: {params}")
    try:
        r = requests.get(BASE_URL, params=params, headers=headers, timeout=25)
        print(f"Status code: {r.status_code}")
        
        if r.status_code == 200:
            data = r.json()
            if data.get("ok"):
                print(f"Success! Found {len(data.get('data', []))} sections")
            else:
                print(f"API reported not OK: {data}")
        else:
            print(f"Error response: {r.text}")
    except Exception as e:
        print(f"Exception: {e}")

# Test with a case that returns empty data
def test_empty_case():
    params = {
        "year": "2025", 
        "quarter": "Spring", 
        "department": "COMLIT", 
        "courseNumber": "3"
    }
    headers = {
        "Authorization": f"Bearer {API_KEY}"  # Note the capitalized Authorization
    }
    
    print(f"\nTesting empty case: {params}")
    try:
        r = requests.get(BASE_URL, params=params, headers=headers, timeout=25)
        print(f"Status code: {r.status_code}")
        
        if r.status_code == 200:
            data = r.json()
            if data.get("ok"):
                print(f"Success! Found {len(data.get('data', []))} sections")
            else:
                print(f"API reported not OK: {data}")
        else:
            print(f"Error response: {r.text}")
    except Exception as e:
        print(f"Exception: {e}")

# Run tests
if __name__ == "__main__":
    test_valid_case()
    test_empty_case() 