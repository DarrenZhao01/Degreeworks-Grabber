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
import unittest
from custom_execs import *
from schedule_builder import ScheduleBuilder
# Load environment variables from .env file
load_dotenv(dotenv_path='.env')



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

# Load valid department codes from file
def load_department_codes():
    """
    Load valid department codes from the complete_departments_list.txt file.
    Returns a set of valid department codes for fast lookup.
    """
    dept_codes = set()
    try:
        with open('complete_departments_list.txt', 'r', encoding='utf-8') as f:
            for line in f:
                if '|' in line and not line.startswith('Department Code'):
                    dept_code = line.split('|')[0].strip()
                    if dept_code and dept_code != '--------------------------------------------------------------------------------':
                        dept_codes.add(dept_code)
    except FileNotFoundError:
        app.logger.warning("complete_departments_list.txt not found. Falling back to basic parsing.")
        # Fallback to some common department codes if file is missing
        dept_codes = {'COMPSCI', 'I&C SCI', 'MATH', 'PHYSICS', 'CHEM', 'BIO SCI', 'ENGLISH', 'HISTORY'}
    except Exception as e:
        app.logger.warning(f"Error loading department codes: {e}. Falling back to basic parsing.")
        dept_codes = {'COMPSCI', 'I&C SCI', 'MATH', 'PHYSICS', 'CHEM', 'BIO SCI', 'ENGLISH', 'HISTORY'}
    
    return dept_codes

# Load department codes once at startup
VALID_DEPT_CODES = load_department_codes()

def expand_course_range(start_num, end_num):
    """
    Expands a course number range like "111:121" into individual course numbers.
    Handles both numeric and alphanumeric course numbers.
    Returns a list of course number strings.
    """
    try:
        # Extract numeric parts and letters
        start_match = re.match(r'^([A-Z]?)(\d+)([A-Z]*)$', start_num.upper())
        end_match = re.match(r'^([A-Z]?)(\d+)([A-Z]*)$', end_num.upper())
        
        if not start_match or not end_match:
            # If we can't parse the range, return both endpoints
            return [start_num, end_num]
        
        start_prefix, start_digits, start_suffix = start_match.groups()
        end_prefix, end_digits, end_suffix = end_match.groups()
        
        # Only expand if prefixes match and numeric parts match
        if start_prefix != end_prefix or start_digits != end_digits:
            # If prefixes don't match OR numeric parts don't match, 
            # try numeric expansion if suffixes are empty
            if not start_suffix and not end_suffix:
                # Pure numeric range
                start_int = int(start_digits)
                end_int = int(end_digits)
                
                if start_int > end_int:
                    return [start_num, end_num]
                
                expanded = []
                for i in range(start_int, end_int + 1):
                    course_num = f"{start_prefix}{i}"
                    expanded.append(course_num)
                
                return expanded
            else:
                return [start_num, end_num]
        
        # If numeric parts match, expand by suffix
        if start_suffix and end_suffix and len(start_suffix) == 1 and len(end_suffix) == 1:
            # Single letter suffix expansion (e.g., 2A:2D)
            start_char = ord(start_suffix)
            end_char = ord(end_suffix)
            
            if start_char > end_char:
                return [start_num, end_num]
            
            expanded = []
            for char_code in range(start_char, end_char + 1):
                suffix = chr(char_code)
                course_num = f"{start_prefix}{start_digits}{suffix}"
                expanded.append(course_num)
            
            return expanded
        elif not start_suffix and not end_suffix:
            # No suffixes, should have been handled above
            return [start_num, end_num]
        else:
            # Complex suffixes or mismatched suffix lengths
            return [start_num, end_num]
        
    except (ValueError, AttributeError):
        # If anything goes wrong, return both endpoints
        return [start_num, end_num]

def expand_course_placeholder(base_num):
    """
    Expands a course placeholder like "122@" into likely course variants.
    Returns a list of (course_number, is_placeholder) tuples.
    """
    # Remove the @ symbol
    base = base_num.rstrip('@')
    
    # Common suffixes at UCI
    common_suffixes = ['A', 'B', 'C', 'D', 'E', 'W']
    
    expanded = []
    for suffix in common_suffixes:
        expanded.append((f"{base}{suffix}", True))  # Mark as placeholder-derived
    
    # Also include the base number without suffix
    expanded.append((base, True))
    
    return expanded

def parse_courses(input_text):
    """
    Enhanced parser for DegreeWorks-style strings that handles:
    - Range notation (e.g., "111:121" expands to 111, 112, 113, ..., 121)
    - Placeholder notation (e.g., "122@" expands to 122A, 122B, 122C, etc.)
    - Multi-word department codes and various spacing/formatting issues
    - Common prefixes like "X Class(es) in"
    
    Example: "COMPSCI 103, 111:121, 122@"
    
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
    placeholder_warnings = []
    parts = [part.strip() for part in cleaned_text.split(',') if part.strip()]
    current_dept = None 

    for part in parts:
        tokens = [token.strip() for token in part.split() if token.strip()]
        if not tokens:
            continue 

        # Try to find the longest matching department code first
        best_dept_match = None
        best_match_length = 0
        
        # Check all possible combinations of tokens as potential department codes
        for i in range(len(tokens)):
            for j in range(i + 1, len(tokens) + 1):
                potential_dept = " ".join(tokens[i:j]).upper()
                
                # Direct match with valid department codes
                if potential_dept in VALID_DEPT_CODES:
                    if j - i > best_match_length:
                        best_dept_match = (potential_dept, i, j)
                        best_match_length = j - i
                
                # Handle special cases like "I&CSCI" -> "I&C SCI"
                if '&' in potential_dept and len(potential_dept) > 3:
                    # Try splitting after & + one character
                    for split_pos in range(1, len(potential_dept)):
                        if potential_dept[split_pos-1] == '&' and split_pos + 1 < len(potential_dept):
                            modified_dept = potential_dept[:split_pos+1] + " " + potential_dept[split_pos+1:]
                            if modified_dept in VALID_DEPT_CODES:
                                if j - i > best_match_length:
                                    best_dept_match = (modified_dept, i, j)
                                    best_match_length = j - i
        
        # If we found a department match, process the remaining tokens as course numbers
        if best_dept_match:
            dept_code, start_idx, end_idx = best_dept_match
            current_dept = dept_code
            
            # Look for course numbers in the remaining tokens
            remaining_tokens = tokens[:start_idx] + tokens[end_idx:]
            
            for token in remaining_tokens:
                token_upper = token.upper()
                
                # Check for range notation (e.g., "111:121")
                if ':' in token_upper:
                    range_parts = token_upper.split(':')
                    if len(range_parts) == 2:
                        start_course, end_course = range_parts
                        expanded_range = expand_course_range(start_course.strip(), end_course.strip())
                        for course_num in expanded_range:
                            courses.append((current_dept, course_num))
                        continue
                
                # Check for placeholder notation (e.g., "122@")
                if token_upper.endswith('@'):
                    placeholder_courses = expand_course_placeholder(token_upper)
                    for course_num, is_placeholder in placeholder_courses:
                        courses.append((current_dept, course_num))
                    placeholder_warnings.append(f"'{token}' is a DegreeWorks placeholder. Expanded to common variants: {', '.join([c[0] for c in placeholder_courses])}")
                    continue
                
                # Regular course number processing
                if re.match(r'^[A-Z]?\d+[A-Z]*$', token_upper) or re.match(r'^\d+[A-Z]*$', token_upper):
                    courses.append((current_dept, token_upper))
                elif re.search(r'\d', token) and len(token) <= 6:  # Likely a course number with mixed format
                    courses.append((current_dept, token_upper))
                else:
                    # Token doesn't look like a course number
                    if token.isalpha() and len(token) <= 3:
                        # Might be a course suffix, add it anyway
                        courses.append((current_dept, token_upper))
                    else:
                        potential_errors.append(f"Skipping unrecognized token '{token}' after department '{dept_code}'.")
        
        else:
            # No department match found, try to use current_dept for course numbers
            course_numbers_found = False
            for token in tokens:
                token_upper = token.upper()
                
                # Check for range notation
                if ':' in token_upper and current_dept:
                    range_parts = token_upper.split(':')
                    if len(range_parts) == 2:
                        start_course, end_course = range_parts
                        expanded_range = expand_course_range(start_course.strip(), end_course.strip())
                        for course_num in expanded_range:
                            courses.append((current_dept, course_num))
                        course_numbers_found = True
                        continue
                
                # Check for placeholder notation
                if token_upper.endswith('@') and current_dept:
                    placeholder_courses = expand_course_placeholder(token_upper)
                    for course_num, is_placeholder in placeholder_courses:
                        courses.append((current_dept, course_num))
                    placeholder_warnings.append(f"'{token}' is a DegreeWorks placeholder. Expanded to common variants: {', '.join([c[0] for c in placeholder_courses])}")
                    course_numbers_found = True
                    continue
                
                # Regular course number checks
                if re.match(r'^[A-Z]?\d+[A-Z]*$', token_upper) or re.match(r'^\d+[A-Z]*$', token_upper):
                    if current_dept:
                        courses.append((current_dept, token_upper))
                        course_numbers_found = True
                    else:
                        potential_errors.append(f"Course number '{token}' found without preceding department.")
                elif re.search(r'\d', token) and len(token) <= 6:  # Likely a course number
                    if current_dept:
                        courses.append((current_dept, token_upper))
                        course_numbers_found = True
                    else:
                        potential_errors.append(f"Course number '{token}' found without preceding department.")
            
            # If no course numbers were found, maybe this part contains an unrecognized department
            if not course_numbers_found:
                # Try to guess department by checking if tokens look like department codes
                potential_dept_tokens = []
                for token in tokens:
                    if (token.isalpha() and token.isupper()) or ('&' in token):
                        potential_dept_tokens.append(token.upper())
                
                if potential_dept_tokens:
                    guessed_dept = " ".join(potential_dept_tokens)
                    potential_errors.append(f"Unrecognized department code '{guessed_dept}'. Please check spelling.")
                else:
                    potential_errors.append(f"Could not parse tokens: {tokens}")
    
    if not courses:
        error_message = "No valid courses could be parsed from the input string."
        critical_errors = [e for e in potential_errors if "without preceding department" in e]
        if critical_errors:
            error_message += " Potential issues found: " + "; ".join(critical_errors)
        elif potential_errors: 
             error_message += " Potential issues found: " + "; ".join(potential_errors)
        raise InvalidInputError(error_message)

    # Log non-critical warnings including placeholder expansions
    all_warnings = []
    non_critical_errors = [e for e in potential_errors if "without preceding department" not in e]
    all_warnings.extend(non_critical_errors)
    all_warnings.extend(placeholder_warnings)
    
    if courses and all_warnings:
        app.logger.warning(f"Parsing warnings for input '{input_text}': {'; '.join(all_warnings)}")
    
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
    if isinstance(m, str):
        return m

    days = m.get('days') or m.get('dayOfWeek') or ''

    start_time = m.get('beginTime') or m.get('startTime') or ''
    end_time = m.get('endTime') or m.get('timeEnd') or ''

    if not (start_time or end_time):
        time_field = m.get('time')
        if isinstance(time_field, str):
            time_field = time_field.strip()
            if '-' in time_field:
                start_part, end_part = [p.strip() for p in time_field.split('-', 1)]
                am_pm = ''
                if end_part and end_part[-1].lower() in ['a', 'p']:
                    am_pm = 'am' if end_part[-1].lower() == 'a' else 'pm'
                    end_part = end_part[:-1]
                start_time = f"{start_part}{am_pm}" if start_part else ''
                end_time = f"{end_part}{am_pm}" if end_part else ''
            else:
                start_time = time_field

    building = m.get('bldgName') or m.get('building')
    if not building:
        bldg = m.get('bldg')
        if isinstance(bldg, list) and bldg:
            building = bldg[0]
        elif isinstance(bldg, str):
            building = bldg
        else:
            building = ''
    room = m.get('room', '')

    time_str = f"{start_time}-{end_time}" if start_time and end_time else start_time or end_time or ''
    time_str = time_str.strip('-')

    location_str = f"{building} {room}".strip() if building else ''

    parts = [part for part in [days, time_str, location_str] if part]
    meeting_string = " ".join(parts).strip()

    return meeting_string if meeting_string else (m.get('meetingType') or 'Details TBA')



@app.route('/')
def index():
    return render_template('index.html')

@app.route('/tutorial')
def tutorial():
    return render_template('tutorial.html')



@app.route('/stream_process', methods=['POST', 'GET'])
def stream_process():
    app.logger.info(f"Request to /stream_process received. Method: {request.method}, Headers: {request.headers}") # Log request
    try:
        if request.method == 'POST':
            # Handle POST request with JSON body
            data = request.get_json()
            if not data:
                app.logger.error("Invalid request format to /stream_process. Expected JSON.")
                return jsonify({"type": "error", "message": "Invalid request format. Expected JSON."}), 400
            
            input_text = data.get('input_text', '')
            year = data.get('year', '')
            quarter = data.get('quarter', '')
        else:
            # Handle GET request with query parameters (for EventSource)
            input_text = request.args.get('input_text', '')
            year = request.args.get('year', '')
            quarter = request.args.get('quarter', '')

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
        if request.method == 'POST':
            return jsonify({"type": "error", "message": str(e)}), 400
        else:
            # For GET requests (EventSource), return SSE error format
            def error_generator():
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return Response(error_generator(), mimetype='text/event-stream')
    except Exception as e:
        app.logger.error("Unexpected error during stream_process setup", exc_info=True)
        if request.method == 'POST':
            return jsonify({"type": "error", "message": "An unexpected server error occurred during setup."}), 500
        else:
            # For GET requests (EventSource), return SSE error format
            def error_generator():
                yield f"data: {json.dumps({'type': 'error', 'message': 'An unexpected server error occurred during setup.'})}\n\n"
            return Response(error_generator(), mimetype='text/event-stream')


    def generate_updates(course_list, req_year, req_quarter):
        '''
        This function is used to generate updates for the client.
        It is called by the stream_process function.
        It is a generator function that yields updates to the client.
        It is used to send updates to the client in real-time.
        '''
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
                        # Format according to SSE spec - event line must come before data line
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


@app.route('/build_schedule', methods=['POST'])
def build_schedule():
    """Build optimal schedules based on user constraints"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Invalid request format. Expected JSON.'}), 400
        
        # Validate required fields
        required_fields = ['required_courses', 'year', 'quarter']
        for field in required_fields:
            if not data.get(field):
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        # Validate year format
        try:
            year = str(data['year'])
            if not year.isdigit() or len(year) != 4:
                raise ValueError("Invalid year format")
        except (ValueError, TypeError):
            return jsonify({'success': False, 'error': 'Invalid year format. Please use YYYY.'}), 400
        
        # Validate quarter
        valid_quarters = ["Fall", "Winter", "Spring", "Summer1", "Summer10wk", "Summer2"]
        if data['quarter'] not in valid_quarters:
            return jsonify({'success': False, 'error': f'Invalid quarter. Must be one of: {", ".join(valid_quarters)}'}), 400
        
        # Build constraints object
        constraints = {
            'required_courses': data.get('required_courses', ''),
            'preferred_courses': data.get('preferred_courses', ''),
            'year': year,
            'quarter': data.get('quarter'),
            'earliest_time': data.get('earliest_time', '08:00'),
            'latest_time': data.get('latest_time', '18:00'),
            'schedule_style': data.get('schedule_style', 'balanced'),
            'max_schedules': int(data.get('max_schedules', 5))
        }
        
        app.logger.info(f"Building schedule with constraints: {constraints}")
        
        # Create schedule builder and generate schedules
        builder = ScheduleBuilder(constraints)
        schedules = builder.generate_optimal_schedules(get_sections)
        
        app.logger.info(f"Generated {len(schedules)} schedules")
        
        return jsonify({
            'success': True,
            'schedules': schedules,
            'message': f'Generated {len(schedules)} optimal schedule{"s" if len(schedules) != 1 else ""}'
        })
        
    except (InvalidInputError, ParsingError) as e:
        app.logger.error(f"Input/Validation Error in build_schedule: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        app.logger.error(f"Unexpected error in build_schedule: {e}", exc_info=True)
        return jsonify({'success': False, 'error': 'An unexpected server error occurred. Please try again.'}), 500


# Run the Flask app
if __name__ == '__main__':
    # Setup basic logging for when running directly (e.g., locally)
    # PythonAnywhere will use its own logging config for uWSGI
    import logging
    logging.basicConfig(level=logging.INFO)
    app.logger.info("Flask app starting in __main__ with threaded=True")
    
    # Run unit tests if in test mode
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == '--test':
        unittest.main(argv=['first-arg-is-ignored'])
    else:
        app.run(debug=False, threaded=True)
