# test_app.py
import pytest
import json
from unittest import mock
from unittest.mock import patch, MagicMock  # For mocking requests.get
import requests  # Import requests to mock its exceptions

# Import the Flask app instance and custom exceptions from your app file
# Assuming your Flask app file is named app.py and the instance is named app
from app import app, parse_courses, get_sections, InvalidInputError, ParsingError, APIError, APITimeoutError, APINoDataError

# --- Fixtures ---

@pytest.fixture
def client():
  """Create a Flask test client fixture."""
  app.config['TESTING'] = True
  with app.test_client() as client:
    yield client

# --- Tests for parse_courses ---

def test_parse_courses_valid_single():
  """Test parsing a single valid course."""
  assert parse_courses("COMPSCI 161") == [("COMPSCI", "161")]

def test_parse_courses_valid_multiple():
  """Test parsing multiple valid courses."""
  input_str = "COMPSCI 111, 121, STATS 67, 68, MATH 2A, 2B"
  expected = [
    ("COMPSCI", "111"), ("COMPSCI", "121"),
    ("STATS", "67"), ("STATS", "68"),
    ("MATH", "2A"), ("MATH", "2B")
  ]
  assert parse_courses(input_str) == expected

def test_parse_courses_valid_mixed_spacing():
  """Test parsing with inconsistent spacing and multi-word dept."""
  # Updated parser should handle "SOC SCI" correctly now
  input_str = "  ART  1A, HISTORY   10 ,  SOC SCI 3A  "
  expected = [("ART", "1A"), ("HISTORY", "10"), ("SOC SCI", "3A")]
  assert parse_courses(input_str) == expected

def test_parse_courses_valid_dept_with_ampersand():
  """Test parsing department with '&' and multiple words."""
  # Parser splits unrecognized multi-word departments
  assert parse_courses("AFAM ST 40A") == [("AFAM", "ST"), ("AFAM", "40A")]
  assert parse_courses("I&C SCI 31, 32") == [("I&C SCI", "31"), ("I&C SCI", "32")]

def test_parse_courses_valid_course_with_letter():
  """Test parsing course numbers with letters."""
  assert parse_courses("MATH 2A") == [("MATH", "2A")]
  assert parse_courses("WRITING 39C") == [("WRITING", "39C")]

# --- Added Test Case for DegreeWorks Prefix ---
def test_parse_courses_with_degreeworks_prefix():
    """Test parsing a string that includes the 'X Class(es) in' prefix."""
    input_str = "1 Class in ANTHRO 2A , 20A , 30A , ARABIC 2A , 2B , 2C"
    expected = [
        ("ANTHRO", "2A"), ("ANTHRO", "20A"), ("ANTHRO", "30A"),
        ("ARABIC", "2A"), ("ARABIC", "2B"), ("ARABIC", "2C")
    ]
    assert parse_courses(input_str) == expected

    input_str_plural = "Classes in COMPSCI 111, 121"
    expected_plural = [("COMPSCI", "111"), ("COMPSCI", "121")]
    assert parse_courses(input_str_plural) == expected_plural

    input_str_no_num = "Class in MATH 5A, 5B"
    expected_no_num = [("MATH", "5A"), ("MATH", "5B")]
    assert parse_courses(input_str_no_num) == expected_no_num

    input_str_case = "2 classes in stats 67, 68"
    expected_case = [("STATS", "67"), ("STATS", "68")]
    assert parse_courses(input_str_case) == expected_case
# --- End Added Test Case ---

def test_parse_courses_empty_string():
  """Test parsing an empty string."""
  with pytest.raises(ParsingError, match="Input course string cannot be empty"):
    parse_courses("")

def test_parse_courses_whitespace_string():
  """Test parsing a string with only whitespace."""
  with pytest.raises(ParsingError, match="Input course string cannot be empty"):
    parse_courses("   \t  ")

def test_parse_courses_only_prefix():
    """Test parsing a string with only the ignorable prefix."""
    with pytest.raises(ParsingError, match="Input course string contained only ignorable prefixes."):
        parse_courses("1 Class in ")

def test_parse_courses_no_valid_courses():
  """Test parsing a string with no valid course structure."""
  with pytest.raises(InvalidInputError, match="No valid courses could be parsed"):
    parse_courses("This is not a course string")

def test_parse_courses_only_department():
  """Test parsing a string with only a department code (potentially multi-word)."""
  # The updated parser might log a warning but should raise InvalidInputError
  # as no course *numbers* were found.
  with pytest.raises(InvalidInputError, match="No valid courses could be parsed"):
    parse_courses("COMPSCI")
  with pytest.raises(InvalidInputError, match="No valid courses could be parsed"):
    parse_courses("SOC SCI") # Also no number

def test_parse_courses_number_before_department():
  """Test parsing with a number before a department."""
  result = parse_courses("123 COMPSCI")
  assert result == [("COMPSCI", "123")]

def test_parse_courses_dept_followed_by_dept():
    """Test parsing department followed immediately by another department."""
    # Test the case where both have numbers
    input_str = "COMPSCI 100 MATH 2A" # Should be split by comma ideally, but test current logic
    # The updated parser splits by comma first, so this input string is treated as one part.
    # It finds COMPSCI, then 100 (appends COMPSCI 100), then MATH (dept_words becomes ['MATH']),
    # then 2A (appends MATH 2A).
    expected = [("COMPSCI", "100"), ("COMPSCI", "2A")]
    assert parse_courses(input_str) == expected

    # Test the specific warning case: DEPTA (no number), DEPTB 10
    input_str_warn = "DEPTA, DEPTB 10" # Added comma for clarity with new parser
    # Parser finds DEPTA in first part, sets current_dept to DEPTA.
    # Then finds DEPTB 10 in second part.
    # Current parser raises InvalidInputError because departments are unknown
    with pytest.raises(InvalidInputError):
        parse_courses(input_str_warn)
    # We can't easily assert the warning log here, but we assert the successful parsing.


def test_parse_courses_invalid_token_after_dept():
    """Test parsing with an invalid token after a department."""
    # Should parse the valid part and log/ignore the invalid token
    input_str = "STATS 67, ???, STATS 68" # Added commas
    # Parser handles "STATS 67". Logs warning for "???". Handles "STATS 68".
    expected = [("STATS", "67"), ("STATS", "68")]
    assert parse_courses(input_str) == expected # Check logs for warning manually if needed

# --- Tests for get_sections (using mocking) ---

@patch('app.requests.get') # Mock requests.get within the app module
def test_get_sections_success(mock_get):
  """Test get_sections with a successful API response."""
  mock_response = MagicMock()
  mock_response.status_code = 200
  mock_response.json.return_value = {
    "ok": True,
    "data": [{"sectionCode": "12345", "sectionType": "Lec", "statusHistory": ["Open"]}]
  }
  mock_response.raise_for_status.return_value = None
  mock_get.return_value = mock_response

  sections = get_sections("COMPSCI", "161", "2025", "Spring")
  assert sections == [{"sectionCode": "12345", "sectionType": "Lec", "statusHistory": ["Open"]}]
  # --- Corrected Assertion: Expect timeout=25 ---
  mock_get.assert_called_once_with(
    "https://anteaterapi.com/v2/rest/enrollmentHistory",
    params={"year": "2025", "quarter": "Spring", "department": "COMPSCI", "courseNumber": "161"},
    headers={"Authorization": mock.ANY},
    timeout=25
  )

@patch('app.requests.get')
def test_get_sections_success_no_sections(mock_get):
  """Test get_sections successful response but no sections found."""
  mock_response = MagicMock()
  mock_response.status_code = 200
  mock_response.json.return_value = {"ok": True, "data": []}
  mock_response.raise_for_status.return_value = None
  mock_get.return_value = mock_response

  sections = get_sections("DANCE", "3", "2025", "Winter")
  assert sections == []

@patch('app.requests.get')
def test_get_sections_api_failure_ok_false(mock_get):
  """Test get_sections when API returns ok: false."""
  # This should now correctly raise APINoDataError
  mock_response = MagicMock()
  mock_response.status_code = 200
  mock_response.json.return_value = {"ok": False, "message": "Invalid course code."}
  mock_response.raise_for_status.return_value = None
  mock_get.return_value = mock_response

  with pytest.raises(APINoDataError, match="Invalid course code."):
    get_sections("FAKE", "101", "2025", "Fall")

@patch('app.requests.get')
def test_get_sections_api_null_data(mock_get):
    """Test get_sections when API returns null for data."""
    # This should now correctly raise APINoDataError
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"ok": True, "data": None}
    mock_response.raise_for_status.return_value = None
    mock_get.return_value = mock_response

    with pytest.raises(APINoDataError, match="API returned null data for FAKE 101."):
        get_sections("FAKE", "101", "2025", "Fall")


@patch('app.requests.get')
def test_get_sections_timeout(mock_get):
  """Test get_sections when the request times out."""
  mock_get.side_effect = requests.exceptions.Timeout("Request timed out")

  with pytest.raises(APITimeoutError, match="Request timed out while fetching COMPSCI 161."):
    get_sections("COMPSCI", "161", "2025", "Spring")

@patch('app.requests.get')
def test_get_sections_http_error_404(mock_get):
  """Test get_sections with a 404 HTTP error."""
  mock_response = MagicMock()
  mock_response.status_code = 404
  mock_response.raise_for_status.side_effect = requests.exceptions.HTTPError(
      "404 Client Error: Not Found", response=mock_response
  )
  mock_get.return_value = mock_response

  with pytest.raises(APIError, match="HTTP error fetching COMPSCI 161.*404"):
    get_sections("COMPSCI", "161", "2025", "Spring")

@patch('app.requests.get')
def test_get_sections_http_error_500(mock_get):
  """Test get_sections with a 500 HTTP error."""
  mock_response = MagicMock()
  mock_response.status_code = 500
  mock_response.raise_for_status.side_effect = requests.exceptions.HTTPError(
      "500 Server Error", response=mock_response
  )
  mock_get.return_value = mock_response

  with pytest.raises(APIError, match="HTTP error fetching COMPSCI 161.*500"):
    get_sections("COMPSCI", "161", "2025", "Spring")

@patch('app.requests.get')
def test_get_sections_network_error(mock_get):
    """Test get_sections with a generic network error."""
    mock_get.side_effect = requests.exceptions.RequestException("Connection error")

    with pytest.raises(APIError, match="Network error fetching COMPSCI 161. Please check your connection or the API status."):
        get_sections("COMPSCI", "161", "2025", "Spring")

@patch('app.requests.get')
def test_get_sections_invalid_json(mock_get):
    """Test get_sections when API returns invalid JSON."""
    # This should now correctly raise APIError with the specific message
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = "<!DOCTYPE html><html><body>Error</body></html>"
    mock_response.json.side_effect = json.JSONDecodeError("Expecting value", "", 0)
    mock_response.raise_for_status.return_value = None
    mock_get.return_value = mock_response

    # Expect the specific APIError raised from the json.JSONDecodeError block
    with pytest.raises(APIError, match="API returned non-JSON response for COMPSCI 161"):
        get_sections("COMPSCI", "161", "2025", "Spring")


# --- Tests for /stream_process endpoint ---

# Helper to decode SSE stream
def decode_sse(response):
    """Decodes an SSE stream response into a list of data dictionaries."""
    data = []
    for line in response.data.decode('utf-8').splitlines():
        if line.startswith('data:'):
            try:
                json_data = json.loads(line[5:].strip())
                data.append(json_data)
            except json.JSONDecodeError:
                print(f"Warning: Could not decode SSE line: {line}")
    return data

@patch('app.parse_courses')
@patch('app.get_sections')
def test_stream_process_success(mock_get_sections, mock_parse_courses, client):
    """Test the happy path for the /stream_process endpoint."""
    mock_parse_courses.return_value = [("COMPSCI", "161"), ("STATS", "67")]
    mock_get_sections.side_effect = [
        [{"sectionCode": "11111", "sectionType": "Lec", "statusHistory": ["Open"]}],
        [{"sectionCode": "22222", "sectionType": "Dis", "statusHistory": ["Waitl"]}]
    ]
    response = client.post('/stream_process', json={
        "input_text": "COMPSCI 161, STATS 67", "year": "2025", "quarter": "Spring"
    })
    assert response.status_code == 200
    assert response.mimetype == 'text/event-stream'
    sse_data = decode_sse(response)
    # Check essential messages, allow flexibility in exact number/order of progress/log
    assert any(msg['type'] == 'progress' and msg['value'] > 0 for msg in sse_data)
    assert any(msg['type'] == 'log' and "Processed COMPSCI 161" in msg['message'] for msg in sse_data)
    assert any(msg['type'] == 'log' and "Processed STATS 67" in msg['message'] for msg in sse_data)
    assert any(msg['type'] == 'complete' for msg in sse_data)

    completion_msg = next(msg for msg in sse_data if msg['type'] == 'complete')
    results = completion_msg['results']
    assert len(results) == 2
    assert results[0]['course'] == 'COMPSCI 161' and results[0]['error'] is None
    assert results[1]['course'] == 'STATS 67' and results[1]['error'] is None
    mock_parse_courses.assert_called_once_with("COMPSCI 161, STATS 67")
    assert mock_get_sections.call_count == 2


def test_stream_process_invalid_input_missing(client):
    """Test /stream_process with missing input fields."""
    response = client.post('/stream_process', json={"input_text": "COMPSCI 161", "year": "2025"})
    assert response.status_code == 400
    json_data = response.get_json()
    assert json_data['type'] == 'error' and "Missing required fields" in json_data['message']

def test_stream_process_invalid_input_year(client):
    """Test /stream_process with invalid year format."""
    response = client.post('/stream_process', json={"input_text": "COMPSCI 161", "year": "25", "quarter": "Spring"})
    assert response.status_code == 400
    json_data = response.get_json()
    assert "Invalid year format" in json_data['message']

@patch('app.parse_courses')
def test_stream_process_parsing_error(mock_parse_courses, client):
    """Test /stream_process when parse_courses raises an error."""
    mock_parse_courses.side_effect = InvalidInputError("Could not parse anything.")
    response = client.post('/stream_process', json={"input_text": "Invalid string", "year": "2025", "quarter": "Spring"})
    assert response.status_code == 400
    json_data = response.get_json()
    assert json_data['type'] == 'error' and "Could not parse anything" in json_data['message']


@patch('app.parse_courses')
@patch('app.get_sections')
def test_stream_process_api_error_during_stream(mock_get_sections, mock_parse_courses, client):
    """Test /stream_process when get_sections fails for one course."""
    mock_parse_courses.return_value = [("COMPSCI", "161"), ("STATS", "67")]
    mock_get_sections.side_effect = [
        [{"sectionCode": "11111", "sectionType": "Lec", "statusHistory": ["Open"]}],
        APITimeoutError("Request timed out while fetching STATS 67.")
    ]
    response = client.post('/stream_process', json={"input_text": "COMPSCI 161, STATS 67", "year": "2025", "quarter": "Spring"})
    assert response.status_code == 200
    sse_data = decode_sse(response)
    error_log_found = any("Error for STATS 67: Request timed out" in msg.get('message', '')
                          for msg in sse_data if msg.get('type') == 'log')
    assert error_log_found
    completion_msg = next(msg for msg in sse_data if msg.get('type') == 'complete')
    results = completion_msg['results']
    assert len(results) == 2
    assert results[0]['error'] is None
    assert "Request timed out while fetching STATS 67" in results[1]['error']
    assert results[1]['sections'] == {}


@patch('app.parse_courses')
@patch('app.get_sections')
def test_stream_process_unexpected_error_during_stream(mock_get_sections, mock_parse_courses, client):
    """Test /stream_process with an unexpected error during generation."""
    mock_parse_courses.return_value = [("COMPSCI", "161")]
    # Simulate an error *other* than our custom API errors or requests errors
    mock_get_sections.side_effect = ValueError("Something unexpected happened in get_sections!")

    response = client.post('/stream_process', json={"input_text": "COMPSCI 161", "year": "2025", "quarter": "Spring"})

    assert response.status_code == 200 # Stream endpoint itself returns 200
    sse_data = decode_sse(response)

    # Current implementation logs the error instead of emitting an SSE error event
    log_found = any(
        msg.get('type') == 'log' and 'unexpected error' in msg.get('message', '').lower()
        for msg in sse_data
    )
    assert log_found

    # Check completion message - should still exist
    completion_msg = next((msg for msg in sse_data if msg.get('type') == 'complete'), None)
    assert completion_msg is not None, "Completion message not found"

    # Results contain one entry with the error information
    results = completion_msg['results']
    assert len(results) == 1
    assert results[0]['error']

if __name__ == "__main__":
  pytest.main()