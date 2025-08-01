import unittest
from app import parse_courses, expand_course_range, expand_course_placeholder, InvalidInputError, ParsingError

class ParserTests(unittest.TestCase):
    def test_parse_courses_with_ampersand(self):
        """Test handling of department codes with ampersands"""
        # Test the issue mentioned in the ticket
        result = parse_courses("1 Class in I&CSCI 45C")
        expected = [("I&C SCI", "45C")]
        self.assertEqual(result, expected)
        
        # Test multiple courses with ampersand
        result = parse_courses("2 Classes in I&CSCI 45C, I&CSCI 46")
        expected = [("I&C SCI", "45C"), ("I&C SCI", "46")]
        self.assertEqual(result, expected)

    def test_parse_courses_multi_word_departments(self):
        """Test handling of multi-word department codes"""
        result = parse_courses("2 Classes in BIO SCI 93, 94")
        expected = [("BIO SCI", "93"), ("BIO SCI", "94")]
        self.assertEqual(result, expected)
        
        result = parse_courses("1 Class in ART HIS 20A")
        expected = [("ART HIS", "20A")]
        self.assertEqual(result, expected)

    def test_parse_courses_mixed_departments(self):
        """Test parsing with multiple different departments"""
        result = parse_courses("3 Classes in COMPSCI 161, MATH 2A, PHYSICS 7A")
        expected = [("COMPSCI", "161"), ("MATH", "2A"), ("PHYSICS", "7A")]
        self.assertEqual(result, expected)

    def test_parse_courses_repeated_department(self):
        """Test parsing where department is mentioned once for multiple courses"""
        result = parse_courses("2 Classes in ANTHRO 2A, 20A")
        expected = [("ANTHRO", "2A"), ("ANTHRO", "20A")]
        self.assertEqual(result, expected)

    def test_parse_courses_complex_mixed(self):
        """Test complex parsing with mixed department patterns"""
        result = parse_courses("4 Classes in I&CSCI 45C, 46, MATH 2A, BIO SCI 93")
        expected = [("I&C SCI", "45C"), ("I&C SCI", "46"), ("MATH", "2A"), ("BIO SCI", "93")]
        self.assertEqual(result, expected)

    def test_parse_courses_with_prefixes(self):
        """Test that common prefixes are properly ignored"""
        result = parse_courses("1 Class in COMPSCI 161")
        expected = [("COMPSCI", "161")]
        self.assertEqual(result, expected)
        
        result = parse_courses("3 Classes in MATH 2A, 2B, 3A")
        expected = [("MATH", "2A"), ("MATH", "2B"), ("MATH", "3A")]
        self.assertEqual(result, expected)

    def test_parse_courses_edge_cases(self):
        """Test edge cases and error handling"""
        # Empty input
        with self.assertRaises(ParsingError):
            parse_courses("")
        
        # Only prefix
        with self.assertRaises(ParsingError):
            parse_courses("2 Classes in")
        
        # Invalid department
        with self.assertRaises(InvalidInputError):
            parse_courses("INVALIDdept 123")

    def test_parse_courses_course_number_formats(self):
        """Test various course number formats"""
        result = parse_courses("MATH 2A, 2B, 10, 140A, H1A")
        expected = [("MATH", "2A"), ("MATH", "2B"), ("MATH", "10"), ("MATH", "140A"), ("MATH", "H1A")]
        self.assertEqual(result, expected)

    def test_parse_courses_range_notation(self):
        """Test range notation like 111:121"""
        result = parse_courses("COMPSCI 111:115")
        expected = [("COMPSCI", "111"), ("COMPSCI", "112"), ("COMPSCI", "113"), ("COMPSCI", "114"), ("COMPSCI", "115")]
        self.assertEqual(result, expected)
        
        # Test with letter suffixes
        result = parse_courses("MATH 2A:2D")
        expected = [("MATH", "2A"), ("MATH", "2B"), ("MATH", "2C"), ("MATH", "2D")]
        self.assertEqual(result, expected)

    def test_parse_courses_placeholder_notation(self):
        """Test placeholder notation like 122@"""
        result = parse_courses("COMPSCI 122@")
        # Should expand to common variants
        expected_suffixes = ['A', 'B', 'C', 'D', 'E', 'W']
        expected = [("COMPSCI", f"122{suffix}") for suffix in expected_suffixes]
        expected.append(("COMPSCI", "122"))  # Base number without suffix
        self.assertEqual(result, expected)

    def test_parse_courses_complex_degreeworks_format(self):
        """Test complex DegreeWorks format with ranges and placeholders"""
        result = parse_courses("COMPSCI 103, 111:113, 122@")
        expected = [
            ("COMPSCI", "103"),
            ("COMPSCI", "111"), ("COMPSCI", "112"), ("COMPSCI", "113"),
            ("COMPSCI", "122A"), ("COMPSCI", "122B"), ("COMPSCI", "122C"), 
            ("COMPSCI", "122D"), ("COMPSCI", "122E"), ("COMPSCI", "122W"), ("COMPSCI", "122")
        ]
        self.assertEqual(result, expected)

    def test_expand_course_range(self):
        """Test the expand_course_range helper function"""
        # Test numeric range
        result = expand_course_range("111", "115")
        expected = ["111", "112", "113", "114", "115"]
        self.assertEqual(result, expected)
        
        # Test with letter suffixes
        result = expand_course_range("2A", "2D")
        expected = ["2A", "2B", "2C", "2D"]
        self.assertEqual(result, expected)
        
        # Test invalid range (different suffixes)
        result = expand_course_range("111A", "115B")
        expected = ["111A", "115B"]  # Should return endpoints
        self.assertEqual(result, expected)

    def test_expand_course_placeholder(self):
        """Test the expand_course_placeholder helper function"""
        result = expand_course_placeholder("122@")
        expected = [
            ("122A", True), ("122B", True), ("122C", True), 
            ("122D", True), ("122E", True), ("122W", True), ("122", True)
        ]
        self.assertEqual(result, expected)
