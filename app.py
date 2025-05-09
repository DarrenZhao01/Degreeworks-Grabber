# app.py
from flask import Flask, render_template, request, jsonify, Response
import requests
import re
import json
import time
import os
from collections import defaultdict
import concurrent.futures
from dotenv import load_dotenv
import subprocess
import urllib.parse

# Load environment variables from .env file
load_dotenv(dotenv_path='.env')

# --- Custom Exception Classes ---

class DegreeWorksError(Exception):
    """Base class for exceptions in this application."""
    pass

class InvalidInputError(DegreeWorksError):
    """Exception raised for errors in user-provided input."""
    def __init__(self, message="Invalid input provided."):
        self.message = message
        super().__init__(self.message)

class ParsingError(DegreeWorksError):
    """Exception raised for errors during the parsing of the DegreeWorks string."""
    def __init__(self, message="Error parsing the course string."):
        self.message = message
        super().__init__(self.message)

class APIError(DegreeWorksError):
    """Exception raised for errors related to the external Anteater API."""
    def __init__(self, message="An error occurred while contacting the course API.", status_code=None):
        self.message = message
        self.status_code = status_code # Store status code if available
        full_message = f"{message}"
        if status_code:
            full_message += f" (Status Code: {status_code})"
        super().__init__(full_message)

class APITimeoutError(APIError):
    """Specific exception for API timeouts."""
    def __init__(self, message="The request to the course API timed out."):
        super().__init__(message)

class APINoDataError(APIError):
    """Specific exception when the API call is successful but returns no data unexpectedly."""
    def __init__(self, message="The course API returned no data when some was expected."):
        super().__init__(message)

# --- End Custom Exception Classes ---


# Initialize Flask application
app = Flask(__name__)

# Base URL for the Anteater API
BASE_URL = "https://anteaterapi.com/v2/rest/enrollmentHistory"

# Get API key from environment variables
API_KEY = os.environ.get('ANTEATER_API_SECRET_KEY')

# Proper handling for missing API key
if not API_KEY:
    app.logger.error("ANTEATER_API_SECRET_KEY is not set in environment. Check your .env file configuration.")
    # In a production environment, it might be appropriate to raise an exception here
    # to prevent the app from starting without proper credentials
    # Uncomment the following line in production
    # raise EnvironmentError("Required API key ANTEATER_API_SECRET_KEY is not configured")

# --- Helper Functions (Using Locally Defined Exceptions) ---

def parse_courses(input_text):
    """
    Parses a DegreeWorks-style string into a list of (department, course_number) tuples.
    Handles multi-word department codes, various spacing/formatting issues,
    and ignores common prefixes like "X Class(es) in".
    Example: "1 Class in ANTHRO 2A, 20A, ARABIC 2A, 2B"
    Raises:
        ParsingError: If the input text is empty or only whitespace after cleaning.
        InvalidInputError: If no valid courses can be extracted after processing.
    """
    if not input_text or not input_text.strip():
        raise ParsingError("Input course string cannot be empty.")

    cleaned_text = re.sub(r'^\d*\s*Class(?:es)?\s+in\s*', '', input_text.strip(), flags=re.IGNORECASE)
    
    if not cleaned_text:
         raise ParsingError("Input course string contained only ignorable prefixes.")

    courses = []
    potential_errors = []
    parts = [part.strip() for part in cleaned_text.split(',') if part.strip()]
    current_dept = None 

    for part in parts:
        tokens = [token for token in part.split() if token]
        if not tokens:
            continue 

        dept_words = [] 
        i = 0
        while i < len(tokens):
            token = tokens[i]

            is_likely_num = bool(
                (re.search(r'\d', token) and not (token.isalpha() and len(token) > 5)) or
                re.match(r'^[A-Z]?\d+[A-Z]*$', token, re.IGNORECASE) or
                re.match(r'^\d+[A-Z]+$', token, re.IGNORECASE)
            )

            is_likely_dept_word = bool(re.match(r'^[A-Z&/]+$', token, re.IGNORECASE))

            if is_likely_num:
                if dept_words:
                    current_dept = " ".join(dept_words)
                    courses.append((current_dept, token.upper())) 
                    dept_words = [] 
                elif current_dept:
                    courses.append((current_dept, token.upper())) 
                else:
                    potential_errors.append(f"Course number '{token}' found without preceding department.")
            elif is_likely_dept_word:
                dept_words.append(token.upper()) 
            else:
                if token.isalpha():
                     dept_words.append(token.upper())
                else:
                    potential_errors.append(f"Skipping invalid token: '{token}'.")
            i += 1
        
        if dept_words:
            current_dept = " ".join(dept_words)
    
    if not courses:
        error_message = "No valid courses could be parsed from the input string."
        critical_errors = [e for e in potential_errors if "without preceding department" in e or "invalid token" in e]
        if critical_errors:
            error_message += " Potential issues found: " + "; ".join(critical_errors)
        elif potential_errors: 
             error_message += " Potential issues found: " + "; ".join(potential_errors)
        raise InvalidInputError(error_message)

    non_critical_errors = [e for e in potential_errors if "without preceding department" not in e and "invalid token" not in e]
    if courses and non_critical_errors:
        app.logger.warning(f"Parsing warnings for input '{input_text}': {'; '.join(non_critical_errors)}")
    return courses


def get_sections(dept, num, year, quarter):
    """
    Fetches section data for a specific course, year, and quarter from the Anteater API.
    Returns:
        list: A list of section dictionaries.
    Raises:
        APITimeoutError: If the request times out.
        APIError: For non-200 status codes or other request issues.
        APINoDataError: If the API responds successfully but with an empty 'data' field or 'ok: false'.
    """
    params = {"year": year, "quarter": quarter, "department": dept, "courseNumber": num}
    headers = {
        "Authorization": f"Bearer {API_KEY}"  # Capitalized Authorization header is important
    }
    app.logger.info(f"Fetching sections for {dept} {num} - Year: {year}, Quarter: {quarter}")
    try:
        r = requests.get(BASE_URL, params=params, headers=headers, timeout=25)
        
        # Handle HTTP errors
        r.raise_for_status() 

        try:
            data = r.json()
        except json.JSONDecodeError as e:
             app.logger.error(f"API returned non-JSON response for {dept} {num}. Content: {r.text[:200]}...", exc_info=True)
             raise APIError(f"API returned non-JSON response for {dept} {num}. Content: {r.text[:100]}...", status_code=r.status_code) from e

        # Check if API returned a valid response
        if not data.get("ok"):
            error_msg = data.get('message', f'API indicated failure for {dept} {num} but provided no specific message.')
            app.logger.warning(f"APINoDataError for {dept} {num}: {error_msg} (API ok:false)")
            raise APINoDataError(error_msg)

        # Get sections from data (even if empty)
        sections = data.get("data")
        if sections is None:  # Only raise error if data field is null/None, not if it's an empty list
             app.logger.warning(f"APINoDataError for {dept} {num}: API returned null data.")
             raise APINoDataError(f"API returned null data for {dept} {num}.")
        
        app.logger.info(f"Successfully fetched {len(sections)} sections for {dept} {num}")
        return sections  # This will return [] for empty data, which is valid

    except requests.exceptions.Timeout as e:
        app.logger.error(f"APITimeoutError for {dept} {num}", exc_info=True)
        raise APITimeoutError(f"Request timed out while fetching {dept} {num}.") from e
    except requests.exceptions.HTTPError as e:
        response_text = ""
        if e.response is not None:
            response_text = f" Response: {e.response.text[:200]}" 
        app.logger.error(f"API HTTPError for {dept} {num}: {e}.{response_text}", exc_info=True)
        raise APIError(f"HTTP error fetching {dept} {num}: {e}.{response_text}", status_code=e.response.status_code if e.response else None) from e
    except requests.exceptions.RequestException as e:
        app.logger.error(f"API RequestException for {dept} {num}", exc_info=True)
        raise APIError(f"Network error fetching {dept} {num}. Please check your connection or the API status.") from e


def format_meeting_string(m):
     if isinstance(m, str): return m
     days = m.get('days') or m.get('dayOfWeek') or ''
     start_time = m.get('beginTime') or m.get('startTime') or ''
     end_time = m.get('endTime') or m.get('timeEnd') or ''
     building = m.get('bldgName') or m.get('building') or ''
     room = m.get('room', '')
     time_str = f"{start_time}-{end_time}" if start_time and end_time else start_time or end_time or ''
     time_str = time_str.strip('-')
     location_str = f"{building} {room}".strip() if building else ''
     parts = [part for part in [days, time_str, location_str] if part]
     meeting_string = " ".join(parts).strip()
     return meeting_string if meeting_string else (m.get('meetingType') or 'Details TBA')

# --- Routes ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/tutorial')
def tutorial():
    return render_template('tutorial.html')

@app.route('/stream_process', methods=['POST'])
def stream_process():
    app.logger.info(f"Request to /stream_process received. Headers: {request.headers}") # Log request
    try:
        data = request.get_json()
        if not data:
            app.logger.error("Invalid request format to /stream_process. Expected JSON.")
            return jsonify({"type": "error", "message": "Invalid request format. Expected JSON."}), 400

        input_text = data.get('input_text', '')
        year = data.get('year', '')
        quarter = data.get('quarter', '')

        app.logger.info(f"Processing request: Text='{input_text}', Year='{year}', Quarter='{quarter}'")

        if not all([input_text, year, quarter]):
             raise InvalidInputError("Missing required fields (course string, year, or quarter).")
        if not year.isdigit() or len(year) != 4:
             raise InvalidInputError("Invalid year format. Please use YYYY.")
        
        # Ensure this list is accurate based on API's actual accepted values
        valid_quarters = ["Fall", "Winter", "Spring", "Summer1", "Summer10wk", "Summer2"]
        if quarter not in valid_quarters:
             # If you removed "Summer" from HTML, this check might be less critical,
             # but good for direct API calls or if HTML is bypassed.
             app.logger.warning(f"Invalid quarter '{quarter}' selected. API might reject.")
             # Depending on API behavior, you might choose to raise InvalidInputError here
             # or let the API call fail and report that specific error.
             # For now, let's assume the API will give a 422, which get_sections will handle.
             # raise InvalidInputError(f"Invalid quarter selected: {quarter}. Please select from: {', '.join(valid_quarters)}")


        courses_to_process = parse_courses(input_text) 
        app.logger.info(f"Parsed courses: {courses_to_process}")

    except (InvalidInputError, ParsingError) as e:
        app.logger.error(f"Input/Validation Error before streaming: {e}", exc_info=True)
        return jsonify({"type": "error", "message": str(e)}), 400
    except Exception as e:
        app.logger.error("Unexpected error during stream_process setup", exc_info=True)
        return jsonify({"type": "error", "message": "An unexpected server error occurred during setup."}), 500


    def generate_updates(course_list, req_year, req_quarter):
        all_results_data = []
        try:
            total_courses = len(course_list)
            if total_courses == 0:
                app.logger.info("No courses to process after parsing.")
                # Send with literal newlines to ensure proper formatting
                yield "data: " + json.dumps({'type': 'complete', 'results': []}) + "\n\n"
                return

            processed_courses_count = 0
            app.logger.info(f"Starting to generate updates for {total_courses} courses.")

            # Send initial progress update
            init_message = json.dumps({'type': 'progress', 'value': 0, 'message': "Starting search..."})
            yield f"data: {init_message}\n\n"

            # Use ThreadPoolExecutor for concurrent API calls
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(10, total_courses or 1)) as executor:
                future_to_course = {
                    executor.submit(get_sections, dept, num, req_year, req_quarter): (dept, num)
                    for dept, num in course_list
                }
                pending_futures = list(future_to_course.keys())
                KEEP_ALIVE_INTERVAL = 15.0  # seconds to wait before sending a keep-alive

                while pending_futures:
                    # Wait for any future to complete, or for the timeout
                    done_futures, pending_futures = concurrent.futures.wait(
                        pending_futures,
                        timeout=KEEP_ALIVE_INTERVAL,
                        return_when=concurrent.futures.FIRST_COMPLETED
                    )

                    if not done_futures:
                        # Timeout hit, no futures completed in this interval
                        app.logger.info("Sending SSE keep-alive event (event: keepalive).")
                        # Use explicit newlines instead of escaping
                        ping_data = json.dumps({'message': 'ping', 'timestamp': time.time()})
                        yield f"event: keepalive\ndata: {ping_data}\n\n"
                        continue # Continue to the next iteration of the while loop to wait again

                    # Process completed futures
                    for future in done_futures:
                        dept, num = future_to_course[future]
                        processed_courses_count += 1
                        progress = int((processed_courses_count / total_courses) * 100)
                        log_message_for_client = f"Fetching data for {dept} {num} ({processed_courses_count}/{total_courses})..."

                        app.logger.info(f"Client log: {log_message_for_client}")
                        prog_data = json.dumps({'type': 'progress', 'value': progress, 'message': log_message_for_client})
                        yield f"data: {prog_data}\n\n"

                        course_result = {'course': f'{dept} {num}', 'sections': {}, 'error': None}
                        # api_error_message = None # This variable is set within the try/except block

                        try:
                            sections = future.result() # Get result from the future

                            if not sections:
                                log_message_for_client = f"No sections found for {dept} {num}."
                            else:
                                grouped_sections = defaultdict(list)
                                for sec in sections:
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
                                log_message_for_client = f"Processed {dept} {num}."

                        except (APIError, APITimeoutError, APINoDataError) as e:
                            api_error_message = str(e)
                            log_message_for_client = f"Error for {dept} {num}: {api_error_message}"
                            course_result['error'] = api_error_message
                            app.logger.warning(f"API Error for {dept} {num} during stream generation: {e}")
                        except Exception as e: # Catch other exceptions from the future
                            api_error_message = f"An unexpected error occurred while fetching {dept} {num}."
                            log_message_for_client = f"Error for {dept} {num}: {api_error_message}"
                            course_result['error'] = api_error_message
                            app.logger.error(f"Unexpected error for {dept} {num} in thread: {e}", exc_info=True)

                        all_results_data.append(course_result)
                        app.logger.info(f"Client log: {log_message_for_client}")
                        log_data = json.dumps({'type': 'log', 'message': log_message_for_client})
                        yield f"data: {log_data}\n\n"
                        # Removed time.sleep(0.1) as keep-alive handles responsiveness

            # Sort all_results_data to match the original input order if necessary
            original_order_map = {f"{dept} {num}": i for i, (dept, num) in enumerate(course_list)}
            all_results_data.sort(key=lambda x: original_order_map.get(x['course'], float('inf')))

            app.logger.info("All courses processed. Sending 'complete' message.")
            completion_data = {"type": "complete", "results": all_results_data}
            
            # Send final complete message with literal newlines 
            app.logger.info("Sending final complete message")
            yield f"data: {json.dumps(completion_data)}\n\n"
            app.logger.info("'complete' message sent.")

        except Exception as e:
            app.logger.error("Unexpected error during stream generation loop", exc_info=True)
            error_data = json.dumps({'type': 'error', 'message': 'An unexpected server error occurred during processing.'})
            yield f"data: {error_data}\n\n"
            # Still send a 'complete' message with partial results to finalize the stream gracefully on the client
            app.logger.info("Sending 'complete' message after unexpected error in generation loop.")
            completion_data = {"type": "complete", "results": all_results_data}
            yield f"data: {json.dumps(completion_data)}\n\n"


    # Create the response object with explicit content type and headers
    response = Response(
        generate_updates(courses_to_process, year, quarter), 
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            'Content-Type': 'text/event-stream'
        }
    )
    
    app.logger.info("Returning streaming response with appropriate SSE headers.")
    return response


# Run the Flask app
if __name__ == '__main__':
    # Setup basic logging for when running directly (e.g., locally)
    # PythonAnywhere will use its own logging config for uWSGI
    import logging
    logging.basicConfig(level=logging.INFO)
    app.logger.info("Flask app starting in __main__ with threaded=True")
    app.run(debug=False, threaded=True)
