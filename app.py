# Import necessary libraries
from flask import Flask, render_template, request, jsonify, Response # Added Response
import requests
import re
import json # Added json
import time # Added time for potential delays/debugging
from collections import defaultdict

# Initialize Flask application
app = Flask(__name__)

# Base URL for the Anteater API
BASE_URL = "https://anteaterapi.com/v2/rest/enrollmentHistory"

# --- Helper Functions (Mostly Unchanged) ---

def parse_courses(input_text):
    """
    Parses a DegreeWorks-style string into a list of (department, course_number) tuples.
    """
    tokens = re.split(r'(?:\s*,\s*|\s+)', input_text.strip())
    courses = []
    current_dept = None
    for token in tokens:
        if not token: continue
        if re.match(r'^[A-Z&/]+$', token):
            current_dept = token
        elif current_dept is not None:
            if re.search(r'\d', token) or len(token) <= 4: # Allow codes like '1A', '199W'
                 courses.append((current_dept, token))
            else:
                 print(f"Skipping potentially invalid course number token: {token} under department {current_dept}")
    return courses

def get_sections(dept, num, year, quarter):
    """
    Fetches section data for a specific course, year, and quarter from the Anteater API.
    Returns a list of section dictionaries or an empty list if an error occurs or no data is found.
    """
    params = {"year": year, "quarter": quarter, "department": dept, "courseNumber": num}
    try:
        r = requests.get(BASE_URL, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
        if not data.get("ok"):
            print(f"API error for {dept} {num}: {data.get('message', 'Unknown API error')}")
            return {"error": data.get('message', 'Unknown API error'), "data": []} # Return error info
        return {"error": None, "data": data.get("data", [])} # Return data
    except requests.exceptions.Timeout:
        print(f"Timeout error fetching {dept} {num}")
        return {"error": "Request timed out.", "data": []}
    except requests.exceptions.RequestException as e:
        print(f"Network/HTTP error fetching {dept} {num}: {e}")
        return {"error": f"Network/HTTP error: {e}", "data": []}
    except Exception as e:
        print(f"Unexpected error fetching {dept} {num}: {e}")
        return {"error": f"Unexpected error: {e}", "data": []}

def format_meeting_string(m):
     """ Formats a single meeting object into a readable string. """
     if isinstance(m, str): return m

     days = m.get('days') or m.get('dayOfWeek') or ''
     start_time = m.get('beginTime') or m.get('startTime') or ''
     end_time = m.get('endTime') or m.get('timeEnd') or ''
     building = m.get('bldgName') or m.get('building') or ''
     room = m.get('room', '')

     time_str = f"{start_time}-{end_time}" if start_time and end_time else start_time or end_time or ''
     time_str = time_str.strip('-') # Remove trailing/leading hyphen if one time is missing

     location_str = f"{building} {room}".strip() if building else ''

     parts = [part for part in [days, time_str, location_str] if part]
     meeting_string = " ".join(parts).strip()

     return meeting_string if meeting_string else (m.get('meetingType') or 'Details TBA')

# --- Routes ---

@app.route('/')
def index():
    """Renders the main HTML page."""
    # Assumes index.html is in a 'templates' folder
    # Assumes style.css and script.js are in a 'static' folder
    return render_template('index.html')

# New SSE Route for processing courses and streaming updates
@app.route('/stream_process', methods=['POST'])
def stream_process():
    """
    Handles the POST request, processes courses, and streams updates via SSE.
    """
    data = request.get_json()
    if not data:
        # Cannot yield an error easily here before returning Response,
        # client-side validation should prevent this.
        # Log error server-side.
        print("Error: Invalid JSON payload received in /stream_process")
        # Return an empty stream or appropriate error response if possible,
        # but standard SSE expects a stream. Best to rely on client validation.
        return Response("data: {\"type\": \"error\", \"message\": \"Invalid request payload.\"}\n\n", mimetype='text/event-stream')


    input_text = data.get('input_text', '')
    year = data.get('year', '')
    quarter = data.get('quarter', '')

    # Basic validation (can yield error messages)
    if not all([input_text, year, quarter]):
         return Response("data: {\"type\": \"error\", \"message\": \"Missing required fields.\"}\n\n", mimetype='text/event-stream')
    if not year.isdigit() or len(year) != 4:
         return Response("data: {\"type\": \"error\", \"message\": \"Invalid year format.\"}\n\n", mimetype='text/event-stream')
    valid_quarters = ["Fall", "Winter", "Spring", "Summer", "Summer1", "Summer10wk", "Summer2"]
    if quarter not in valid_quarters:
         return Response(f"data: {{\"type\": \"error\", \"message\": \"Invalid quarter selected.\"}}\n\n", mimetype='text/event-stream')

    # --- Generator function for streaming ---
    def generate_updates():
        courses_to_process = []
        try:
            courses_to_process = parse_courses(input_text)
            if not courses_to_process:
                 yield f"data: {json.dumps({'type': 'error', 'message': 'No valid courses parsed from input.'})}\n\n"
                 yield f"data: {json.dumps({'type': 'complete', 'results': []})}\n\n" # Send complete signal
                 return # Stop generation
        except Exception as e:
            print(f"Error parsing courses: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': f'Error parsing input: {e}'})}\n\n"
            yield f"data: {json.dumps({'type': 'complete', 'results': []})}\n\n" # Send complete signal
            return # Stop generation


        total_courses = len(courses_to_process)
        processed_courses_count = 0
        all_results_data = [] # Accumulate results here

        for dept, num in courses_to_process:
            processed_courses_count += 1
            progress = int((processed_courses_count / total_courses) * 100)
            log_message = f"Searching for {dept} {num} ({processed_courses_count}/{total_courses})..."

            # Yield progress update
            progress_data = {
                "type": "progress",
                "value": progress,
                "message": log_message
            }
            yield f"data: {json.dumps(progress_data)}\n\n"
            # time.sleep(0.1) # Optional small delay for smoother UI update

            # Fetch and process sections for this course
            section_fetch_result = get_sections(dept, num, year, quarter)
            api_error = section_fetch_result.get("error")
            sections = section_fetch_result.get("data", [])

            course_result = {
                'course': f'{dept} {num}',
                'sections': {},
                'error': api_error # Include API error if any
            }

            if api_error:
                 log_message = f"Error fetching {dept} {num}: {api_error}"
            elif not sections:
                log_message = f"No sections found for {dept} {num}."
            else:
                grouped_sections = defaultdict(list)
                for sec in sections:
                    # Format section data
                    meeting_strings = [format_meeting_string(m) for m in sec.get('meetings', [])]
                    section_data = {
                        'code': sec.get('sectionCode', 'N/A'),
                        'type': sec.get('sectionType', 'N/A'),
                        'instructors': ', '.join(sec.get('instructors', [])) if sec.get('instructors') else 'TBA',
                        'status': sec.get('statusHistory', [])[-1] if sec.get('statusHistory') else 'Unknown',
                        'meetings': meeting_strings,
                        'units': sec.get('units', 'N/A')
                    }
                    grouped_sections[section_data['type']].append(section_data)
                course_result['sections'] = dict(grouped_sections)
                log_message = f"Processed {dept} {num}."

            # Accumulate result for this course
            all_results_data.append(course_result)

            # Yield log message update (can be combined with progress or sent separately)
            log_update = {
                "type": "log",
                "message": log_message
            }
            yield f"data: {json.dumps(log_update)}\n\n"
            # time.sleep(0.1) # Optional small delay

        # Signal completion and send all accumulated results
        completion_data = {
            "type": "complete",
            "results": all_results_data
        }
        yield f"data: {json.dumps(completion_data)}\n\n"

    # Return the generator function wrapped in a Response object
    return Response(generate_updates(), mimetype='text/event-stream')

# Keep the old /process route as a fallback or remove if not needed
# @app.route('/process', methods=['POST'])
# def process():
#     # ... (original synchronous implementation) ...
#     pass

# Run the Flask app
if __name__ == '__main__':
    app.run(debug=True) # debug=True helps with development, set to False for production