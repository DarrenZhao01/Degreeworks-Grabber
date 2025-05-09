import sys
import json
import requests
from app import app, get_sections, APINoDataError, APIError, APITimeoutError

# Mock Flask app context
app.app_context().push()

def test_normal_case():
    """Test with a case that should return data"""
    try:
        print("Testing normal case (2023/Spring/COMPSCI/161)...")
        sections = get_sections("COMPSCI", "161", "2023", "Spring")
        print(f"Success! Found {len(sections)} sections")
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False

def test_empty_data_case():
    """Test with a case that should return empty data"""
    try:
        print("\nTesting empty data case (2025/Spring/COMLIT/3)...")
        sections = get_sections("COMLIT", "3", "2025", "Spring")
        print(f"Success! Found {len(sections)} sections (empty list)")
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    success = True
    
    if not test_normal_case():
        success = False
        
    if not test_empty_data_case():
        success = False
        
    print("\nSummary:")
    if success:
        print("All tests passed! The function is handling both normal and empty data cases correctly.")
        sys.exit(0)
    else:
        print("Some tests failed. Please review the error messages above.")
        sys.exit(1) 