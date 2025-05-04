# Import necessary libraries
from flask import Flask, render_template, request, jsonify
import requests
import re
from collections import defaultdict # Import defaultdict for easier grouping

# Initialize Flask application
app = Flask(__name__)

# Base URL for the Anteater API
BASE_URL = "https://anteaterapi.com/v2/rest/enrollmentHistory"

def parse_courses(input_text):
    """
    Parses a DegreeWorks-style string into a list of (department, course_number) tuples.
    Handles various delimiters and ensures department context is maintained.
    Example input: 'ANTHRO 2A , 20A , 30A , ARABIC 2A , 2B , 2C , 51'
    Output: [('ANTHRO', '2A'), ('ANTHRO', '20A'), ..., ('ARABIC', '51')]
    """
    # Split the input string by commas or spaces, handling potential extra whitespace
    tokens = re.split(r'(?:\s*,\s*|\s+)', input_text.strip())
    courses = []
    current_dept = None
    for token in tokens:
        if not token: # Skip empty tokens resulting from multiple delimiters
            continue
        # Check if the token consists only of uppercase letters (and possibly '&' or '/') - likely a department code
        if re.match(r'^[A-Z&/]+$', token):
            current_dept = token
        # If we have a current department context and the token is not a department code, treat it as a course number
        elif current_dept is not None:
            # Simple validation to avoid things like just '&' being treated as course number
            if re.search(r'\d', token) or len(token) <= 3: # Allow short codes like '1A' or numbers
                 courses.append((current_dept, token))
            else:
                 print(f"Skipping potentially invalid course number token: {token} under department {current_dept}")

        # Ignore tokens that appear before the first department code
    return courses

def get_sections(dept, num, year, quarter):
    """
    Fetches section data for a specific course, year, and quarter from the Anteater API.
    Returns a list of section dictionaries or an empty list if an error occurs or no data is found.
    """
    params = {
        "year": year,
        "quarter": quarter,
        "department": dept,
        "courseNumber": num
    }
    try:
        # Make the GET request to the API
        r = requests.get(BASE_URL, params=params, timeout=15) # Increased timeout slightly
        r.raise_for_status() # Raise an exception for bad status codes (4xx or 5xx)
        data = r.json()
        # Check the 'ok' flag in the API response
        if not data.get("ok"):
            print(f"API error for {dept} {num}: {data.get('message', 'Unknown API error')}")
            return []
        # Return the list of sections from the 'data' field, or an empty list if 'data' is missing/empty
        return data.get("data", [])
    except requests.exceptions.Timeout:
        print(f"Timeout error fetching {dept} {num}")
        return []
    except requests.exceptions.RequestException as e:
        # Handle potential network errors, timeouts, or bad responses
        print(f"Network/HTTP error fetching {dept} {num}: {e}")
        return []
    except Exception as e:
        # Catch any other unexpected errors during the request or JSON parsing
        print(f"Unexpected error fetching {dept} {num}: {e}")
        return []


def process_courses(input_text, year, quarter):
    """
    Processes the parsed courses, fetches sections, and groups them by section type.
    Returns a list of dictionaries, where each dictionary represents a course
    and contains its sections grouped by type (e.g., {'Lec': [...], 'Dis': [...]}).
    """
    courses = parse_courses(input_text)
    results = []
    total_courses = len(courses)
    processed_courses = 0

    # Iterate through each parsed course (department and number)
    for dept, num in courses:
        processed_courses += 1
        # Use print to show progress in the server console, not directly to user
        print(f"Searching for {dept} {num} ({processed_courses}/{total_courses})...")

        try:
            # Fetch sections for the current course
            sections = get_sections(dept, num, year, quarter)

            # Use defaultdict to easily group sections by type
            grouped_sections = defaultdict(list)

            if not sections:
                print(f"No sections found for {dept} {num}")
                # Still add the course to results, but with empty grouped sections
                results.append({
                    'course': f'{dept} {num}',
                    'sections': {}, # Use an empty dict for consistency
                    'error': None # Explicitly set error to None
                })
                continue # Move to the next course

            # Process each section found
            for sec in sections:
                # Format meeting times into readable strings - REFINED LOGIC
                meeting_strings = []
                for m in sec.get('meetings', []):
                    if isinstance(m, str): # If meeting is already a string (e.g., "TBA")
                        meeting_strings.append(m)
                        continue

                    # Extract parts, handling missing data using .get with defaults
                    days = m.get('days') or m.get('dayOfWeek') or ''
                    start_time = m.get('beginTime') or m.get('startTime') or ''
                    end_time = m.get('endTime') or m.get('timeEnd') or ''
                    building = m.get('bldgName') or m.get('building') or ''
                    room = m.get('room', '') # Default to empty string if missing

                    # Construct time string carefully
                    time_str = ''
                    if start_time and end_time:
                        time_str = f"{start_time}-{end_time}"
                    elif start_time:
                        # Handle cases like only start time listed (less common)
                        time_str = f"From {start_time}"
                    elif end_time:
                         # Handle cases like only end time listed (less common)
                        time_str = f"Until {end_time}"
                    # If both are missing, time_str remains empty

                    # Construct location string
                    location_str = f"{building} {room}".strip() if building else '' # Only add room if building exists

                    # Combine parts, filtering out empty strings
                    parts = [part for part in [days, time_str, location_str] if part]
                    meeting_string = " ".join(parts).strip()

                    # If all parts were empty, use meeting type or a default placeholder
                    if not meeting_string:
                        meeting_string = m.get('meetingType') or 'Details TBA' # e.g., 'ASYNC' or 'Details TBA'

                    meeting_strings.append(meeting_string)
                # END REFINED MEETING LOGIC

                # Create the dictionary for the current section's details
                section_data = {
                    'code': sec.get('sectionCode', 'N/A'), # Use .get for safety
                    'type': sec.get('sectionType', 'N/A'),
                    'instructors': ', '.join(sec.get('instructors', [])) if sec.get('instructors') else 'TBA',
                    # Safely access the last element of statusHistory or provide 'Unknown'
                    'status': sec.get('statusHistory', [])[-1] if sec.get('statusHistory') else 'Unknown',
                    'meetings': meeting_strings, # Use the formatted meeting strings
                    'units': sec.get('units', 'N/A')
                }
                # Add the section data to the list corresponding to its type in the grouped_sections dictionary
                grouped_sections[section_data['type']].append(section_data)

            # Append the course details and its grouped sections to the overall results list
            results.append({
                'course': f'{dept} {num}',
                'sections': dict(grouped_sections), # Convert defaultdict back to regular dict for JSON
                'error': None # No error for this course
            })

            print(f"Found sections for {dept} {num}, grouped by type.")

        except Exception as e:
            # Catch unexpected errors during section processing for a specific course
            import traceback
            print(f"Error processing {dept} {num}: {str(e)}")
            print(traceback.format_exc()) # Print full traceback for debugging
            results.append({
                'course': f'{dept} {num}',
                'sections': {}, # Empty dict for consistency
                'error': f"Failed to process sections: {str(e)}" # Include error message
            })

    return results

# Route for the main page
@app.route('/')
def index():
    """Renders the main HTML page."""
    return render_template('index.html')

# Route to handle the form submission and process courses
@app.route('/process', methods=['POST'])
def process():
    """
    Handles the POST request from the frontend.
    Retrieves form data, calls process_courses, and returns results as JSON.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON payload received.'}), 400

        input_text = data.get('input_text', '')
        year = data.get('year', '')
        quarter = data.get('quarter', '')

        # Basic server-side validation
        if not input_text:
             return jsonify({'error': 'DegreeWorks string cannot be empty.'}), 400
        if not year:
             return jsonify({'error': 'Year cannot be empty.'}), 400
        if not quarter:
             return jsonify({'error': 'Quarter cannot be empty.'}), 400
        if not year.isdigit() or len(year) != 4:
             return jsonify({'error': 'Invalid year format. Please use YYYY.'}), 400
        # Allow more specific summer quarters if needed by API
        valid_quarters = ["Fall", "Winter", "Spring", "Summer", "Summer1", "Summer10wk", "Summer2"]
        if quarter not in valid_quarters:
             return jsonify({'error': f'Invalid quarter selected. Choose from: {", ".join(valid_quarters)}'}), 400


        # Process the courses using the updated function
        results = process_courses(input_text, year, quarter)

        # Return the results and a completion status
        return jsonify({
            'status': 'complete',
            'results': results
        })
    except Exception as e:
        # Catch any errors during request handling or processing
        import traceback
        print(f"Error in /process route: {e}")
        print(traceback.format_exc()) # Log full traceback
        # Provide a generic error message to the user
        return jsonify({'error': 'An unexpected error occurred on the server. Please try again later.'}), 500

# Run the Flask app
if __name__ == '__main__':
    # Enables debugging mode for development (auto-reloads, provides debug info)
    # Set debug=False for production
    app.run(debug=True)
