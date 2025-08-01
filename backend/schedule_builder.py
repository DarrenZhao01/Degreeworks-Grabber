# schedule_builder.py
from collections import defaultdict
from itertools import combinations, product
import concurrent.futures
from datetime import datetime, timedelta
import re
import logging
import hashlib

class ScheduleBuilder:
    def __init__(self, constraints):
        self.constraints = constraints
        self.all_sections = {}
        
    def generate_optimal_schedules(self, get_sections_func):
        """Generate optimal schedules based on constraints"""
        try:
            # Step 1: Fetch all available sections
            self._fetch_all_sections(get_sections_func)
            logging.info(f"DEBUG: Fetched sections for courses: {list(self.all_sections.keys())}")
            
            for course_key, course_data in self.all_sections.items():
                sections = course_data['sections']
                logging.info(f"DEBUG: {course_key} has {len(sections)} sections")
                for i, section in enumerate(sections):
                    logging.info(f"DEBUG:   Section {i+1}: {section['code']} ({section['type']}) - {len(section['meetings'])} meetings")
                    for j, meeting in enumerate(section['meetings']):
                        logging.info(f"DEBUG:     Meeting {j+1}: {meeting.get('formatted', 'No format')}")
            
            # Step 2: Generate valid schedule combinations
            valid_schedules = self._generate_valid_combinations()
            logging.info(f"DEBUG: Generated {len(valid_schedules)} valid schedule combinations")
            
            if len(valid_schedules) == 0:
                logging.warning("DEBUG: No valid schedules generated - checking why...")
                
                # Debug each course
                from app import parse_courses
                required_courses = parse_courses(self.constraints.get('required_courses', ''))
                required_course_keys = [f"{dept} {num}" for dept, num in required_courses]
                
                for course_key in required_course_keys:
                    if course_key not in self.all_sections:
                        logging.warning(f"DEBUG: Missing course data for {course_key}")
                    elif not self.all_sections[course_key]['sections']:
                        logging.warning(f"DEBUG: No sections found for {course_key}")
                    else:
                        sections = self.all_sections[course_key]['sections']
                        combinations = self._get_complete_course_combinations(sections)
                        logging.info(f"DEBUG: {course_key} has {len(combinations)} complete combinations")
                        
                        if len(combinations) == 0:
                            logging.warning(f"DEBUG: No complete combinations for {course_key} - checking sections...")
                            for section in sections:
                                logging.info(f"DEBUG:   Section {section['code']} type={section['type']} meetings={len(section['meetings'])}")
            
            # Step 3: Score and rank schedules
            ranked_schedules = self._score_and_rank(valid_schedules)
            
            return ranked_schedules[:int(self.constraints.get('max_schedules', 5))]
            
        except Exception as e:
            logging.error(f"Error generating schedules: {e}")
            raise
    
    def _fetch_all_sections(self, get_sections_func):
        """Fetch sections for all required and preferred courses"""
        from app import parse_courses  # Import here to avoid circular imports
        
        required_courses = parse_courses(self.constraints.get('required_courses', ''))
        preferred_courses = []
        if self.constraints.get('preferred_courses'):
            try:
                preferred_courses = parse_courses(self.constraints['preferred_courses'])
            except:
                pass  # If preferred courses can't be parsed, ignore them
        
        all_courses = required_courses + preferred_courses
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            future_to_course = {
                executor.submit(
                    get_sections_func, 
                    dept, num, 
                    self.constraints['year'], 
                    self.constraints['quarter']
                ): (dept, num, 'required' if (dept, num) in required_courses else 'preferred')
                for dept, num in all_courses
            }
            
            for future in concurrent.futures.as_completed(future_to_course):
                dept, num, course_type = future_to_course[future]
                try:
                    sections = future.result()
                    course_key = f"{dept} {num}"
                    processed_sections = self._process_sections(sections, course_key)
                    self.all_sections[course_key] = {
                        'sections': processed_sections,
                        'type': course_type
                    }
                except Exception as e:
                    logging.warning(f"Error fetching {dept} {num}: {e}")
                    self.all_sections[f"{dept} {num}"] = {
                        'sections': [],
                        'type': course_type
                    }
    
    def _process_sections(self, raw_sections, course_name):
        """Convert raw API sections to our internal format"""
        processed = []
        for section in raw_sections:
            # Parse meeting times
            meetings = []
            for meeting in section.get('meetings', []):
                parsed_meeting = self._parse_meeting_time(meeting)
                if parsed_meeting:
                    meetings.append(parsed_meeting)
            
            # Only include sections that have valid meeting times and are within time constraints
            if meetings:
                meets_constraints = self._section_meets_time_constraints(meetings)
                logging.info(f"DEBUG: Section {section.get('sectionCode')} has {len(meetings)} meetings, meets constraints: {meets_constraints}")
                
                if meets_constraints:
                    # Ensure units is always an integer
                    units_value = section.get('units', 0)
                    try:
                        units_int = int(units_value) if units_value is not None else 0
                    except (ValueError, TypeError):
                        units_int = 0
                    
                    processed.append({
                        'course': course_name,
                        'code': section.get('sectionCode'),
                        'type': section.get('sectionType'),
                        'instructor': ', '.join(section.get('instructors', [])) if section.get('instructors') else 'TBA',
                        'status': section.get('statusHistory', [])[-1] if section.get('statusHistory') else 'Unknown',
                        'meetings': meetings,
                        'units': units_int
                    })
                else:
                    logging.info(f"DEBUG: Section {section.get('sectionCode')} filtered out due to time constraints")
            else:
                logging.info(f"DEBUG: Section {section.get('sectionCode')} has no valid meetings")
        
        return processed
    
    def _parse_meeting_time(self, meeting):
        """Parse meeting time into a standardized format"""
        try:
            # Extract days (MWF, TuTh, etc.)
            days_raw = meeting.get('days', '').strip()
            logging.info(f"DEBUG: Parsing meeting - days_raw: '{days_raw}'")
            logging.info(f"DEBUG: Full meeting object: {meeting}")
            
            if not days_raw or days_raw.upper() == 'TBA':
                logging.info(f"DEBUG: Meeting has no days or is TBA")
                return None
                
            days = self._parse_days(days_raw)
            logging.info(f"DEBUG: Parsed days: {days}")
            
            if not days:
                logging.info(f"DEBUG: No valid days parsed")
                return None
            
            # Extract start and end times - handle different API formats
            start_time = meeting.get('beginTime') or meeting.get('startTime', '')
            end_time = meeting.get('endTime') or meeting.get('timeEnd', '')
            
            # If no separate start/end times, try to parse from combined 'time' field
            if not start_time or not end_time:
                time_str = meeting.get('time', '').strip()
                if time_str and '-' in time_str:
                    # Parse formats like " 6:30- 7:50p", "10:00-10:50 ", "12:00-12:50p"
                    try:
                        # Split on dash and clean up
                        parts = time_str.split('-')
                        if len(parts) == 2:
                            start_raw = parts[0].strip()
                            end_raw = parts[1].strip()
                            
                            # Handle AM/PM indicators
                            # If end time has 'p' but start doesn't, start is AM
                            if 'p' in end_raw.lower() and 'p' not in start_raw.lower() and 'a' not in start_raw.lower():
                                if not start_raw.endswith('a') and not start_raw.endswith('p'):
                                    # Check if start time suggests AM (before 12) or PM (same period as end)
                                    start_hour = int(start_raw.split(':')[0])
                                    end_hour = int(end_raw.replace('p', '').replace('P', '').split(':')[0])
                                    if end_hour < 12:  # PM time like 1:00p means 1 PM
                                        end_hour += 12
                                    if start_hour <= 12 and start_hour < end_hour - 12:
                                        start_raw += 'a'  # Morning class
                                    else:
                                        start_raw += 'p'  # Same period as end
                            
                            # If start has 'a' and end has no indicator, end is probably AM too
                            elif 'a' in start_raw.lower() and 'p' not in end_raw.lower() and 'a' not in end_raw.lower():
                                end_raw += 'a'
                            
                            # If neither has indicator, assume both are in same period
                            elif 'p' not in start_raw.lower() and 'a' not in start_raw.lower() and 'p' not in end_raw.lower() and 'a' not in end_raw.lower():
                                # Default to AM for morning times, PM for afternoon times
                                start_hour = int(start_raw.split(':')[0])
                                if start_hour >= 8 and start_hour <= 11:
                                    start_raw += 'a'
                                    end_raw += 'a'
                                else:
                                    start_raw += 'p'
                                    end_raw += 'p'
                            
                            start_time = start_raw
                            end_time = end_raw
                            
                    except (ValueError, IndexError) as e:
                        logging.warning(f"DEBUG: Failed to parse time string '{time_str}': {e}")
            
            # Debug: Show all available time fields in the meeting data
            time_fields = {k: v for k, v in meeting.items() if 'time' in k.lower() or 'begin' in k.lower() or 'end' in k.lower()}
            logging.info(f"DEBUG: All time-related fields in meeting: {time_fields}")
            logging.info(f"DEBUG: Times - start: '{start_time}', end: '{end_time}'")
            
            if not start_time or not end_time:
                logging.info(f"DEBUG: Missing start or end time")
                return None
                
            parsed_meeting = {
                'days': days,
                'start_time': start_time,
                'end_time': end_time,
                'building': meeting.get('bldgName', ''),
                'room': meeting.get('room', ''),
                'formatted': self._format_meeting_display(days, start_time, end_time, meeting.get('bldgName', ''), meeting.get('room', ''))
            }
            
            logging.info(f"DEBUG: Successfully parsed meeting: {parsed_meeting['formatted']}")
            return parsed_meeting
            
        except Exception as e:
            logging.warning(f"Error parsing meeting time: {e}")
            return None
    
    def _parse_days(self, days_str):
        """Convert day abbreviations to standardized format"""
        day_mapping = {
            'M': 'Monday', 'T': 'Tuesday', 'W': 'Wednesday', 
            'Th': 'Thursday', 'F': 'Friday', 'S': 'Saturday', 'Su': 'Sunday'
        }
        
        # Handle common patterns like "MWF", "TuTh"
        days = []
        i = 0
        while i < len(days_str):
            if i + 1 < len(days_str) and days_str[i:i+2] in ['Th', 'Tu', 'Su']:
                days.append(day_mapping.get(days_str[i:i+2], days_str[i:i+2]))
                i += 2
            elif days_str[i] in day_mapping:
                days.append(day_mapping[days_str[i]])
                i += 1
            else:
                i += 1
        
        return days
    
    def _format_meeting_display(self, days, start_time, end_time, building, room):
        """Format meeting info for display"""
        day_abbrev = {
            'Monday': 'M', 'Tuesday': 'Tu', 'Wednesday': 'W',
            'Thursday': 'Th', 'Friday': 'F', 'Saturday': 'S', 'Sunday': 'Su'
        }
        
        days_str = ''.join([day_abbrev.get(day, day[:2]) for day in days])
        location = f"{building} {room}".strip() if building else ''
        
        parts = [days_str, f"{start_time}-{end_time}"]
        if location:
            parts.append(location)
            
        return ' '.join(parts)
    
    def _section_meets_time_constraints(self, meetings):
        """Check if section meetings fit within time constraints"""
        earliest_minutes = self._time_to_minutes(self.constraints.get('earliest_time', '00:00'))
        latest_minutes = self._time_to_minutes(self.constraints.get('latest_time', '23:59'))
        
        for meeting in meetings:
            start_minutes = self._time_to_minutes(meeting['start_time'])
            end_minutes = self._time_to_minutes(meeting['end_time'])
            
            if start_minutes < earliest_minutes or end_minutes > latest_minutes:
                return False
        
        return True
    
    def _time_to_minutes(self, time_str):
        """Convert time string to minutes since midnight"""
        try:
            # Handle various time formats
            time_str = time_str.strip()
            
            # Handle 24-hour format (HH:MM)
            if ':' in time_str and not any(x in time_str.lower() for x in ['a', 'p']):
                time_obj = datetime.strptime(time_str, '%H:%M').time()
                return time_obj.hour * 60 + time_obj.minute
            
            # Handle 12-hour format with AM/PM
            if 'a' in time_str.lower() or 'p' in time_str.lower():
                # Clean up format
                time_str = time_str.replace(' ', '').upper()
                if time_str.endswith('A'):
                    time_str = time_str[:-1] + 'AM'
                elif time_str.endswith('P'):
                    time_str = time_str[:-1] + 'PM'
                
                try:
                    time_obj = datetime.strptime(time_str, '%I:%M%p').time()
                except ValueError:
                    time_obj = datetime.strptime(time_str, '%I%p').time()
                
                return time_obj.hour * 60 + time_obj.minute
            
            # Fallback: assume it's just hours
            try:
                hour = int(time_str)
                return hour * 60
            except:
                return 0
                
        except Exception as e:
            logging.warning(f"Error parsing time '{time_str}': {e}")
            return 0
    
    def _generate_valid_combinations(self):
        """Generate all valid schedule combinations"""
        from app import parse_courses
        
        required_courses = parse_courses(self.constraints.get('required_courses', ''))
        required_course_keys = [f"{dept} {num}" for dept, num in required_courses]
        
        # Group sections by course and build complete course options
        course_section_groups = []
        for course_key in required_course_keys:
            if course_key not in self.all_sections or not self.all_sections[course_key]['sections']:
                # If any required course has no valid sections, no valid schedules possible
                return []
            
            sections = self.all_sections[course_key]['sections']
            course_combinations = self._get_complete_course_combinations(sections)
            
            if not course_combinations:
                # No valid combinations for this course
                return []
                
            course_section_groups.append(course_combinations)
        
        if not course_section_groups:
            return []
        
        # Generate all combinations across courses
        valid_schedules = []
        for combination in product(*course_section_groups):
            # Flatten the combination (each element is a list of sections for one course)
            flattened_sections = []
            for course_sections in combination:
                flattened_sections.extend(course_sections)
            
            # Check for conflicts across all sections
            if not self._has_time_conflicts(flattened_sections):
                valid_schedules.append(flattened_sections)
        
        return valid_schedules
    
    def _get_complete_course_combinations(self, sections):
        """
        Get all valid combinations of sections that represent a complete course enrollment.
        At UCI, sections are grouped by section designations (A, B, C, etc.) where all 
        components (lecture, discussion, lab) with the same designation must be taken together.
        """
        # Group sections by type and extract section designations
        sections_by_type = defaultdict(list)
        section_designations = set()
        
        for section in sections:
            section_type = section['type'].upper()
            sections_by_type[section_type].append(section)
            
            # Extract section designation from section code or other identifier
            designation = self._extract_section_designation(section)
            if designation:
                section_designations.add(designation)
        
        # Determine what constitutes a "complete" enrollment for this course
        has_lecture = 'LEC' in sections_by_type
        has_discussion = 'DIS' in sections_by_type
        has_lab = 'LAB' in sections_by_type
        
        complete_combinations = []
        
        # Group sections by their designation within each type
        sections_by_designation = self._group_sections_by_designation(sections)
        
        # For each section designation, create complete combinations
        for designation in section_designations:
            if designation not in sections_by_designation:
                continue
                
            designation_sections = sections_by_designation[designation]
            designation_by_type = defaultdict(list)
            
            for section in designation_sections:
                section_type = section['type'].upper()
                designation_by_type[section_type].append(section)
            
            # Create combinations within this designation
            if has_lecture and has_discussion:
                # Course requires both lecture and discussion from same section
                if 'LEC' in designation_by_type and 'DIS' in designation_by_type:
                    for lecture in designation_by_type['LEC']:
                        for discussion in designation_by_type['DIS']:
                            combination = [lecture, discussion]
                            
                            # Add lab if available in this designation
                            if has_lab and 'LAB' in designation_by_type:
                                for lab in designation_by_type['LAB']:
                                    complete_combinations.append(combination + [lab])
                            else:
                                complete_combinations.append(combination)
                            
            elif has_lecture:
                # Lecture-only course
                if 'LEC' in designation_by_type:
                    for lecture in designation_by_type['LEC']:
                        combination = [lecture]
                        
                        # Add lab if available in this designation  
                        if has_lab and 'LAB' in designation_by_type:
                            for lab in designation_by_type['LAB']:
                                complete_combinations.append(combination + [lab])
                        else:
                            complete_combinations.append(combination)
                            
            elif has_discussion:
                # Discussion-only course (rare, but possible)
                if 'DIS' in designation_by_type:
                    for discussion in designation_by_type['DIS']:
                        complete_combinations.append([discussion])
            
            else:
                # Other section types (seminars, etc.) - treat each as standalone
                for section_type, type_sections in designation_by_type.items():
                    for section in type_sections:
                        complete_combinations.append([section])
        
        # If no designations were found, fall back to the old logic but log a warning
        if not section_designations:
            logging.warning("No section designations found, falling back to unrestricted combinations")
            return self._get_legacy_course_combinations(sections_by_type, has_lecture, has_discussion, has_lab)
        
        # Filter out combinations with time conflicts within the same course
        valid_combinations = []
        for combination in complete_combinations:
            if not self._has_time_conflicts(combination):
                valid_combinations.append(combination)
        
        return valid_combinations
    
    def _extract_section_designation(self, section):
        """
        Extract section designation (A, B, C, 1, 2, 3, etc.) from section data.
        UCI uses these designations to group related sections together.
        """
        section_code = section.get('code', '')
        instructor = section.get('instructor', '').strip()
        section_type = section.get('type', '').upper()
        course_name = section.get('course', '')
        
        logging.info(f"DEBUG: Extracting designation for {course_name} {section_type} - Code: {section_code}, Instructor: {instructor}")
        
        # Method 1: Check if there's an obvious section letter in meeting info or other fields
        # Look for patterns that suggest section groupings
        meetings = section.get('meetings', [])
        if meetings:
            # Sometimes section info is embedded in room or building names
            for meeting in meetings:
                building = meeting.get('building', '')
                room = meeting.get('room', '')
                if building or room:
                    # Look for section indicators in location
                    location_match = re.search(r'([A-Z]|\d{1,2})(?:\s|$)', f"{building} {room}")
                    if location_match:
                        potential_designation = location_match.group(1)
                        if self._is_valid_designation(potential_designation):
                            logging.info(f"DEBUG: Found designation '{potential_designation}' from location")
                            return potential_designation
        
        # Method 2: Look for letter/number patterns in section code
        if section_code:
            # Try multiple patterns that might indicate section designations
            patterns = [
                r'([A-Z])(?:\d*)?$',  # Letter at end (like 12345A)
                r'(\d{1,2})$',        # 1-2 digits at end (like 12345-1)
                r'([A-Z])\d*$',       # Letter followed by optional digits
            ]
            
            for pattern in patterns:
                match = re.search(pattern, section_code)
                if match:
                    designation = match.group(1)
                    if self._is_valid_designation(designation):
                        logging.info(f"DEBUG: Found designation '{designation}' from section code pattern")
                        return designation
        
        # Method 3: Use instructor-based grouping for sections of the same course
        # This is particularly useful when the same instructor teaches both lecture and discussion
        if instructor and instructor != 'TBA':
            # Split instructor names and use last name + first initial for consistency
            instructor_parts = instructor.replace(',', ' ').split()
            if instructor_parts:
                # Create a consistent key from instructor name
                instructor_key = ''.join(instructor_parts[:2])  # Use first two parts
                instructor_hash = hashlib.md5(instructor_key.encode()).hexdigest()
                designation = instructor_hash[0].upper()
                logging.info(f"DEBUG: Using instructor-based designation '{designation}' for {instructor}")
                return designation
        
        # Method 4: Fallback - create a designation based on section type and position
        # This ensures different section types get different designations when no other info is available
        type_char = section_type[0] if section_type else 'A'
        logging.info(f"DEBUG: Using fallback designation '{type_char}' based on section type")
        return type_char
    
    def _is_valid_designation(self, designation):
        """Check if a potential designation looks valid"""
        if not designation:
            return False
        
        # Single letters are always valid
        if designation.isalpha() and len(designation) == 1:
            return True
        
        # Small numbers (1-20) are valid
        if designation.isdigit():
            num = int(designation)
            return 1 <= num <= 20
        
        return False
    
    def _group_sections_by_designation(self, sections):
        """
        Group sections by their extracted designation.
        """
        sections_by_designation = defaultdict(list)
        
        for section in sections:
            designation = self._extract_section_designation(section)
            sections_by_designation[designation].append(section)
        
        # Log the grouping results for debugging
        course_name = sections[0].get('course', 'Unknown') if sections else 'Unknown'
        logging.info(f"DEBUG: Grouped {course_name} sections by designation:")
        for designation, designation_sections in sections_by_designation.items():
            section_types = [s.get('type', 'Unknown') for s in designation_sections]
            logging.info(f"DEBUG:   Designation '{designation}': {section_types}")
        
        return sections_by_designation
    
    def _get_legacy_course_combinations(self, sections_by_type, has_lecture, has_discussion, has_lab):
        """
        Fallback method that uses the old logic when section designations can't be determined.
        This creates all possible combinations without section consistency.
        """
        complete_combinations = []
        
        if has_lecture and has_discussion:
            # Course requires both lecture and discussion
            for lecture in sections_by_type['LEC']:
                for discussion in sections_by_type['DIS']:
                    combination = [lecture, discussion]
                    
                    # Add lab if required
                    if has_lab:
                        for lab in sections_by_type['LAB']:
                            complete_combinations.append(combination + [lab])
                    else:
                        complete_combinations.append(combination)
                        
        elif has_lecture:
            # Lecture-only course
            for lecture in sections_by_type['LEC']:
                combination = [lecture]
                
                # Add lab if available
                if has_lab:
                    for lab in sections_by_type['LAB']:
                        complete_combinations.append(combination + [lab])
                else:
                    complete_combinations.append(combination)
                    
        elif has_discussion:
            # Discussion-only course (rare, but possible)
            for discussion in sections_by_type['DIS']:
                complete_combinations.append([discussion])
                
        else:
            # Other section types (seminars, etc.) - treat each as standalone
            for section_type, type_sections in sections_by_type.items():
                for section in type_sections:
                    complete_combinations.append([section])
        
        # Filter out combinations with time conflicts within the same course
        valid_combinations = []
        for combination in complete_combinations:
            if not self._has_time_conflicts(combination):
                valid_combinations.append(combination)
        
        return valid_combinations
    
    def _has_time_conflicts(self, sections):
        """Check if sections have time conflicts"""
        for i, section1 in enumerate(sections):
            for section2 in sections[i+1:]:
                if self._sections_conflict(section1, section2):
                    return True
        return False
    
    def _sections_conflict(self, section1, section2):
        """Check if two sections have time conflicts"""
        for meeting1 in section1['meetings']:
            for meeting2 in section2['meetings']:
                if self._meetings_overlap(meeting1, meeting2):
                    return True
        return False
    
    def _meetings_overlap(self, meeting1, meeting2):
        """Check if two meetings overlap"""
        # Check if they share any days
        common_days = set(meeting1['days']).intersection(set(meeting2['days']))
        if not common_days:
            return False
        
        # Check time overlap
        start1 = self._time_to_minutes(meeting1['start_time'])
        end1 = self._time_to_minutes(meeting1['end_time'])
        start2 = self._time_to_minutes(meeting2['start_time'])
        end2 = self._time_to_minutes(meeting2['end_time'])
        
        return not (end1 <= start2 or end2 <= start1)
    
    def _score_and_rank(self, schedules):
        """Score and rank schedules based on preferences"""
        scored_schedules = []
        
        for schedule in schedules:
            score = self._calculate_schedule_score(schedule)
            
            # Convert to display format
            schedule_display = {
                'sections': schedule,
                'score': score,
                'total_units': sum(section['units'] for section in schedule),
                'days_on_campus': len(self._get_days_on_campus(schedule)),
                'earliest_class': self._get_earliest_class(schedule),
                'latest_class': self._get_latest_class(schedule),
                'summary': self._generate_schedule_summary(schedule)
            }
            
            scored_schedules.append(schedule_display)
        
        # Sort by score (descending)
        return sorted(scored_schedules, key=lambda x: x['score'], reverse=True)
    
    def _calculate_schedule_score(self, schedule):
        """Calculate score for a schedule based on user preferences"""
        score = 0
        style = self.constraints.get('schedule_style', 'balanced')
        
        days_on_campus = len(self._get_days_on_campus(schedule))
        
        # Style-based scoring
        if style == 'compact':
            score += max(0, 100 - (days_on_campus * 15))  # Prefer fewer days
        elif style == 'balanced':
            ideal_days = 3
            score += max(0, 100 - abs(days_on_campus - ideal_days) * 20)
        elif style == 'morning':
            score += self._score_morning_preference(schedule)
        elif style == 'afternoon':
            score += self._score_afternoon_preference(schedule)
        
        # Add other scoring factors
        score += self._score_gaps_between_classes(schedule)
        score += self._score_status_preference(schedule)
        
        return max(0, min(100, score))  # Keep score between 0-100
    
    def _score_morning_preference(self, schedule):
        """Score based on morning class preference"""
        total_score = 0
        count = 0
        
        for section in schedule:
            for meeting in section['meetings']:
                start_minutes = self._time_to_minutes(meeting['start_time'])
                # Earlier classes get higher scores (before 12 PM)
                if start_minutes < 720:  # Before 12:00 PM
                    total_score += 80
                elif start_minutes < 840:  # Before 2:00 PM
                    total_score += 60
                else:
                    total_score += 20
                count += 1
        
        return total_score / count if count > 0 else 50
    
    def _score_afternoon_preference(self, schedule):
        """Score based on afternoon class preference"""
        total_score = 0
        count = 0
        
        for section in schedule:
            for meeting in section['meetings']:
                start_minutes = self._time_to_minutes(meeting['start_time'])
                # Later classes get higher scores (after 12 PM)
                if start_minutes >= 840:  # After 2:00 PM
                    total_score += 80
                elif start_minutes >= 720:  # After 12:00 PM
                    total_score += 60
                else:
                    total_score += 20
                count += 1
        
        return total_score / count if count > 0 else 50
    
    def _score_gaps_between_classes(self, schedule):
        """Score based on gaps between classes (prefer reasonable gaps)"""
        # Group meetings by day
        day_schedules = defaultdict(list)
        
        for section in schedule:
            for meeting in section['meetings']:
                for day in meeting['days']:
                    day_schedules[day].append({
                        'start': self._time_to_minutes(meeting['start_time']),
                        'end': self._time_to_minutes(meeting['end_time'])
                    })
        
        total_gap_score = 0
        day_count = 0
        
        for day, meetings in day_schedules.items():
            if len(meetings) > 1:
                # Sort by start time
                meetings.sort(key=lambda x: x['start'])
                
                # Calculate gaps between consecutive meetings
                for i in range(len(meetings) - 1):
                    gap = meetings[i+1]['start'] - meetings[i]['end']
                    
                    # Ideal gap is 30-90 minutes
                    if 30 <= gap <= 90:
                        total_gap_score += 30
                    elif 15 <= gap <= 120:
                        total_gap_score += 20
                    elif gap < 15:
                        total_gap_score += 5  # Too short
                    else:
                        total_gap_score += 10  # Too long
                
                day_count += 1
        
        return total_gap_score / max(day_count, 1)
    
    def _score_status_preference(self, schedule):
        """Score based on section status (prefer open sections)"""
        total_score = 0
        
        for section in schedule:
            status = section['status'].upper()
            if 'OPEN' in status:
                total_score += 30
            elif 'WAITL' in status:
                total_score += 15
            else:
                total_score += 5
        
        return total_score / len(schedule) if schedule else 0
    
    def _get_days_on_campus(self, schedule):
        """Get unique days when student has classes"""
        days = set()
        for section in schedule:
            for meeting in section['meetings']:
                days.update(meeting['days'])
        return sorted(list(days))
    
    def _get_earliest_class(self, schedule):
        """Get earliest class time across all days"""
        earliest = float('inf')
        for section in schedule:
            for meeting in section['meetings']:
                start = self._time_to_minutes(meeting['start_time'])
                earliest = min(earliest, start)
        return self._minutes_to_time(earliest) if earliest != float('inf') else 'N/A'
    
    def _get_latest_class(self, schedule):
        """Get latest class time across all days"""
        latest = 0
        for section in schedule:
            for meeting in section['meetings']:
                end = self._time_to_minutes(meeting['end_time'])
                latest = max(latest, end)
        return self._minutes_to_time(latest) if latest > 0 else 'N/A'
    
    def _minutes_to_time(self, minutes):
        """Convert minutes since midnight to time string"""
        hours = minutes // 60
        mins = minutes % 60
        
        # Convert to 12-hour format
        if hours == 0:
            return f"12:{mins:02d} AM"
        elif hours < 12:
            return f"{hours}:{mins:02d} AM"
        elif hours == 12:
            return f"12:{mins:02d} PM"
        else:
            return f"{hours-12}:{mins:02d} PM"
    
    def _generate_schedule_summary(self, schedule):
        """Generate a human-readable summary"""
        courses = set()
        total_units = 0
        
        for section in schedule:
            # Extract course name from section code
            course_name = section['course']
            courses.add(course_name)
            total_units += section['units']
        
        course_list = ', '.join(sorted(courses))
        return f"{len(courses)} courses ({total_units} units): {course_list}" 