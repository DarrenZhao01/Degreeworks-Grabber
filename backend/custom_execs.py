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
