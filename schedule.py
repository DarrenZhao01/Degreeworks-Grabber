import re
from datetime import datetime

# Helper to parse days string like 'MWF' or 'TuTh'
DAY_CODES = ["M", "Tu", "W", "Th", "F", "Sa", "Su"]

def split_days(days_str):
    days = []
    i = 0
    while i < len(days_str):
        # Check two-letter codes first
        if days_str[i:i+2] in ["Tu", "Th", "Sa", "Su"]:
            days.append(days_str[i:i+2])
            i += 2
        else:
            days.append(days_str[i])
            i += 1
    return days

def parse_time(t):
    t = t.strip().lower()
    fmt = "%I:%M%p" if t.endswith("am") or t.endswith("pm") else "%H:%M"
    return datetime.strptime(t, fmt).hour * 60 + datetime.strptime(t, fmt).minute

def parse_meeting(meeting):
    m = re.match(r"([A-Za-z]+)\s+(\d{1,2}:\d{2}(?:am|pm)?)-(\d{1,2}:\d{2}(?:am|pm)?)", meeting)
    if not m:
        return []  # Could not parse
    days, start, end = m.groups()
    start_min = parse_time(start)
    end_min = parse_time(end)
    return [(d, start_min, end_min) for d in split_days(days)]

def sections_conflict(sec_a, sec_b):
    for day_a, start_a, end_a in sec_a:
        for day_b, start_b, end_b in sec_b:
            if day_a == day_b and not (end_a <= start_b or end_b <= start_a):
                return True
    return False

def generate_schedules(courses):
    schedules = []
    parsed = []
    for course in courses:
        parsed_sections = []
        for sec in course.get("sections", []):
            meetings = []
            for m in sec.get("meetings", []):
                meetings.extend(parse_meeting(m))
            parsed_sections.append((sec, meetings))
        parsed.append(parsed_sections)

    def backtrack(idx, current, current_meetings):
        if idx == len(parsed):
            schedules.append([sec for sec, _ in current])
            return
        for sec, meetings in parsed[idx]:
            conflict = False
            for mt in current_meetings:
                if sections_conflict(mt, meetings):
                    conflict = True
                    break
            if not conflict:
                backtrack(idx + 1, current + [(sec, meetings)], current_meetings + [meetings])

    backtrack(0, [], [])
    return schedules
