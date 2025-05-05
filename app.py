# app.py
from flask import Flask, render_template, request, jsonify, Response
import requests
import re
import json
import time
from collections import defaultdict

# --- Custom Exception Classes (Moved from exceptions.py) ---

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

    # --- Corrected: Remove common DegreeWorks prefixes ---
    # Regex: Optional digits, optional space, "Class" or "Classes", one or more spaces, "in", zero or more spaces
    cleaned_text = re.sub(r'^\d*\s*Class(?:es)?\s+in\s*', '', input_text.strip(), flags=re.IGNORECASE)
    # --- End Corrected ---

    # Check if the string is empty after cleaning
    if not cleaned_text:
         raise ParsingError("Input course string contained only ignorable prefixes.")

    courses = []
    potential_errors = []
    # Split primarily by comma using the cleaned text
    parts = [part.strip() for part in cleaned_text.split(',') if part.strip()]
    current_dept = None # Track the department across comma-separated parts if needed

    for part in parts:
        # Split the part by space, removing empty strings
        tokens = [token for token in part.split() if token]
        if not tokens:
            continue # Skip empty parts after comma split

        dept_words = [] # Store potential department words for the current segment
        i = 0
        while i < len(tokens):
            token = tokens[i]

            # --- Heuristic Check: Is this token likely a course number? ---
            is_likely_num = bool(
                (re.search(r'\d', token) and not (token.isalpha() and len(token) > 5)) or
                re.match(r'^[A-Z]?\d+[A-Z]*$', token, re.IGNORECASE) or
                re.match(r'^\d+[A-Z]+$', token, re.IGNORECASE)
            )

            # --- Heuristic Check: Is this token likely part of a department name? ---
            is_likely_dept_word = bool(re.match(r'^[A-Z&/]+$', token, re.IGNORECASE))

            if is_likely_num:
                # Found something that looks like a course number.
                if dept_words:
                    # If we collected dept words just before this number, they form the department.
                    current_dept = " ".join(dept_words)
                    courses.append((current_dept, token.upper())) # Standardize course num case too
                    dept_words = [] # Reset dept words for this part
                elif current_dept:
                    # If no dept words immediately before, use the last known department.
                    courses.append((current_dept, token.upper())) # Standardize course num case too
                else:
                    # Found a number-like token without any preceding department identified.
                    potential_errors.append(f"Course number '{token}' found without preceding department.")
            elif is_likely_dept_word:
                # Found something that looks like a standard department word (or part of one).
                dept_words.append(token.upper()) # Collect potential dept words, standardize case
            else:
                # Token is neither a likely number nor a standard dept word.
                # Could it be a non-standard dept word like "STUDIES"? Assume yes if alphabetic.
                if token.isalpha():
                     dept_words.append(token.upper())
                else:
                    # Otherwise, it's likely an invalid token.
                    potential_errors.append(f"Skipping invalid token: '{token}'.")

            i += 1

        # --- After processing all tokens in a part ---
        if dept_words:
            # If dept_words remain, a department was named but not followed by a number *in this part*.
            # Update current_dept for subsequent parts (like "121" following "COMPSCI 111,").
            current_dept = " ".join(dept_words)
            # Do not log an error here, as the next part might contain the number.


    # --- After processing all parts ---
    if not courses:
        # If no courses were successfully parsed at all.
        error_message = "No valid courses could be parsed from the input string."
        critical_errors = [e for e in potential_errors if "without preceding department" in e or "invalid token" in e]
        if critical_errors:
            error_message += " Potential issues found: " + "; ".join(critical_errors)
        elif potential_errors: # Include non-critical if they are the only ones
             error_message += " Potential issues found: " + "; ".join(potential_errors)

        raise InvalidInputError(error_message)

    # Log less critical potential errors as warnings if any courses *were* parsed successfully.
    non_critical_errors = [e for e in potential_errors if "without preceding department" not in e and "invalid token" not in e]
    if courses and non_critical_errors:
        # Use print for simple logging in this context, or integrate with Flask's logger
        print(f"INFO: Parsing warnings for input '{input_text}': {'; '.join(non_critical_errors)}")

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
    try:
        # Increased timeout slightly, can be adjusted
        r = requests.get(BASE_URL, params=params, timeout=25)
        r.raise_for_status() # Check for 4xx/5xx errors

        try:
            data = r.json()
        except json.JSONDecodeError as e:
             # Raise specific APIError for JSON issues
             raise APIError(f"API returned non-JSON response for {dept} {num}. Content: {r.text[:100]}...", status_code=r.status_code) from e

        if not data.get("ok"):
            error_msg = data.get('message', f'API indicated failure for {dept} {num} but provided no specific message.')
            # Treat API failure message as a form of no data/error
            raise APINoDataError(error_msg)

        sections = data.get("data")
        if sections is None:
             # API returned ok:true but data is null - specific error case
             raise APINoDataError(f"API returned null data for {dept} {num}.")

        # If sections is an empty list [], that's valid (no sections found), return it.
        return sections

    except requests.exceptions.Timeout as e:
        raise APITimeoutError(f"Request timed out while fetching {dept} {num}.") from e
    except requests.exceptions.HTTPError as e:
        # Include response text if possible for more context on HTTP errors
        response_text = ""
        if e.response is not None:
            response_text = f" Response: {e.response.text[:200]}" # Limit length
        raise APIError(f"HTTP error fetching {dept} {num}: {e}.{response_text}", status_code=e.response.status_code if e.response else None) from e
    except requests.exceptions.RequestException as e:
        # Catch other potential requests errors (ConnectionError, etc.)
        print(f"Network error fetching {dept} {num}: {e}") # Log it
        raise APIError(f"Network error fetching {dept} {num}. Please check your connection or the API status.") from e
    # No broad 'except Exception' needed here, let unexpected errors propagate


def format_meeting_string(m):
     """ Formats a single meeting object into a readable string. (Unchanged) """
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
    """Renders the main HTML page."""
    return render_template('index.html')

# SSE Route with updated error handling
@app.route('/stream_process', methods=['POST'])
def stream_process():
    """
    Handles the POST request, processes courses, and streams updates via SSE.
    Uses custom exceptions for clearer error reporting during setup and processing.
    """
    # --- Get data and validate OUTSIDE the generator ---
    try:
        data = request.get_json()
        if not data:
            # Use jsonify for error response before streaming starts
            return jsonify({"type": "error", "message": "Invalid request format. Expected JSON."}), 400

        input_text = data.get('input_text', '')
        year = data.get('year', '')
        quarter = data.get('quarter', '')

        # Basic validation
        if not all([input_text, year, quarter]):
             raise InvalidInputError("Missing required fields (course string, year, or quarter).")
        if not year.isdigit() or len(year) != 4:
             raise InvalidInputError("Invalid year format. Please use YYYY.")
        # Added more specific Summer options based on index.html
        valid_quarters = ["Fall", "Winter", "Spring", "Summer", "Summer1", "Summer10wk", "Summer2"]
        if quarter not in valid_quarters:
             raise InvalidInputError(f"Invalid quarter selected: {quarter}. Please select a valid term.")

        # Parse courses immediately to catch errors early
        courses_to_process = parse_courses(input_text) # This can raise ParsingError or InvalidInputError

    except (InvalidInputError, ParsingError) as e:
        # Catch specific validation/parsing errors before streaming
        print(f"Input/Validation Error before streaming: {e}")
        return jsonify({"type": "error", "message": str(e)}), 400 # Return 400 Bad Request
    except Exception as e:
        # Catch unexpected errors during setup
        print(f"Unhandled Error during setup in stream_process: {e}")
        # Log the full error traceback for debugging on the server
        app.logger.error("Unexpected error during stream_process setup", exc_info=True)
        return jsonify({"type": "error", "message": "An unexpected server error occurred during setup."}), 500


    # --- Generator function for streaming (accepts validated data) ---
    def generate_updates(course_list, req_year, req_quarter):
        all_results_data = [] # Store results for final message
        try:
            total_courses = len(course_list)
            processed_courses_count = 0

            for dept, num in course_list:
                processed_courses_count += 1
                progress = int((processed_courses_count / total_courses) * 100)
                log_message = f"Searching for {dept} {num} ({processed_courses_count}/{total_courses})..."

                # Send progress update
                yield f"data: {json.dumps({'type': 'progress', 'value': progress, 'message': log_message})}\n\n"

                course_result = {'course': f'{dept} {num}', 'sections': {}, 'error': None}
                api_error_message = None # Store specific API error message for this course

                try:
                    # Fetch sections for the current course
                    sections = get_sections(dept, num, req_year, req_quarter)

                    if not sections:
                        # API call was successful, but returned empty list
                        log_message = f"No sections found for {dept} {num}."
                        # No error, just no data; sections remain {}
                    else:
                        # Group fetched sections by type (Lec, Dis, Lab, etc.)
                        grouped_sections = defaultdict(list)
                        for sec in sections:
                            # Format meeting times for display
                            meeting_strings = [format_meeting_string(m) for m in sec.get('meetings', [])]
                            # Extract relevant section data
                            section_data = {
                                'code': sec.get('sectionCode', 'N/A'),
                                'type': sec.get('sectionType', 'N/A'),
                                'instructors': ', '.join(sec.get('instructors', [])) if sec.get('instructors') else 'TBA',
                                'status': sec.get('statusHistory', [])[-1] if sec.get('statusHistory') else 'Unknown',
                                'meetings': meeting_strings,
                                'units': sec.get('units', 'N/A')
                            }
                            grouped_sections[section_data['type']].append(section_data)
                        # Store the grouped sections in the result
                        course_result['sections'] = dict(grouped_sections)
                        log_message = f"Processed {dept} {num}."

                except (APIError, APITimeoutError, APINoDataError) as e:
                     # Handle specific API errors for this course
                     api_error_message = str(e)
                     log_message = f"Error for {dept} {num}: {api_error_message}"
                     course_result['error'] = api_error_message # Add error message to the course result
                     print(f"API Error encountered for {dept} {num}: {e}") # Log on server
                # Let other unexpected errors propagate to the outer except block

                # Append the result (success or error) for this course
                all_results_data.append(course_result)
                # Send log message (status or error)
                yield f"data: {json.dumps({'type': 'log', 'message': log_message})}\n\n"
                time.sleep(0.1) # Small delay to allow UI updates

            # Signal normal completion after processing all courses
            completion_data = {"type": "complete", "results": all_results_data}
            yield f"data: {json.dumps(completion_data)}\n\n"

        except Exception as e:
            # Catch truly unexpected errors during the generation loop
            print(f"Unhandled Error during generation in stream_process: {e}")
             # Log the full error traceback for debugging on the server
            app.logger.error("Unexpected error during stream generation", exc_info=True)
            # Send an error message via SSE to the client
            yield f"data: {json.dumps({'type': 'error', 'message': 'An unexpected server error occurred during processing.'})}\n\n"
            # Still send a 'complete' message with partial results to finalize the stream gracefully on the client
            yield f"data: {json.dumps({'type': 'complete', 'results': all_results_data})}\n\n"


    # Return the streaming response
    return Response(generate_updates(courses_to_process, year, quarter), mimetype='text/event-stream')


# Run the Flask app
if __name__ == '__main__':
    # Use debug=False in production! Keep True for development.
    app.run(debug=True)
