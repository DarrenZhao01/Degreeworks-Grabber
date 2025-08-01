import requests
import time
import os
from dotenv import load_dotenv
import re

# Load environment variables from .env file
load_dotenv(dotenv_path='../.env')

# Get API key from environment variables
API_KEY = os.environ.get('ANTEATER_API_SECRET_KEY')

if not API_KEY:
    print("ERROR: ANTEATER_API_SECRET_KEY is not set in environment. Please check your .env file.")
    print("Create a .env file in the root directory with: ANTEATER_API_SECRET_KEY=your_api_key_here")
    exit(1)

def parse_courses(input_text):
    """
    Parses a DegreeWorks-style string into a list of (department, course_number) tuples.
    Example input: 'ANTHRO 2A , 20A , 30A , ARABIC 2A , 2B , 2C , 51'
    """
    tokens = re.split(r'(?:\s*,\s*|\s+)', input_text.strip())
    courses = []
    current_dept = None
    for token in tokens:
        if not token:
            continue
        # If token contains a letter and a number and is not just a number, it's probably a department
        if re.match(r'^[A-Z&/]+$', token):
            current_dept = token
        elif current_dept is not None:
            courses.append((current_dept, token))
        else:
            # If the very first token is a course number (shouldn't happen), skip it
            continue
    return courses

# Usage: paste your DegreeWorks string below, or read from a file
input_text = input("Paste your DegreeWorks class requirement string:\n")
courses = parse_courses(input_text)

BASE_URL = "https://anteaterapi.com/v2/rest/enrollmentHistory"

# Optionally, set these to the current or upcoming term
year = input("Enter the year (e.g., 2023): ")
quarter = input("Enter the quarter: ")

def get_sections(dept, num):
    params = {
        "year": year,
        "quarter": quarter,
        "department": dept,
        "courseNumber": num
    }
    headers = {
        "Authorization": f"Bearer {API_KEY}"
    }
    r = requests.get(BASE_URL, params=params, headers=headers, timeout=25)
    if r.status_code != 200:
        print(f"Error fetching {dept} {num}: {r.status_code} - {r.text}")
        return []
    data = r.json()
    if not data.get("ok"):
        print(f"API error for {dept} {num}: {data.get('message')}")
        return []
    return data.get("data", [])

def main():
    for dept, num in courses:
        print("\n" + "="*40)
        print(f"Available Sections for {dept} {num}:")
        print("="*40)
        sections = get_sections(dept, num)
        if not sections:
            print("No available sections found.")
            continue
        for idx, sec in enumerate(sections, start=1):
            print(f"\nSection {idx}")
            print(f"  Code       : {sec['sectionCode']}")
            print(f"  Type       : {sec['sectionType']}")
            instructors = ', '.join(sec['instructors']) if sec['instructors'] else 'TBA'
            print(f"  Instructors: {instructors}")
            status = sec['statusHistory'][-1] if sec['statusHistory'] else 'Unknown'
            print(f"  Status     : {status}")
            print("  Meetings   :")
            for meeting in sec['meetings']:
                print(f"    - {meeting}")
            print(f"  Units      : {sec['units']}")

if __name__ == "__main__":
    main()
