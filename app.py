from flask import Flask, render_template, request, jsonify
import requests
import re

app = Flask(__name__)

BASE_URL = "https://anteaterapi.com/v2/rest/enrollmentHistory"

def parse_courses(input_text):
    """
    Parses a DegreeWorks-style string into a list of (department, course_number) tuples.
    """
    tokens = re.split(r'(?:\s*,\s*|\s+)', input_text.strip())
    courses = []
    current_dept = None
    for token in tokens:
        if not token:
            continue
        if re.match(r'^[A-Z&/]+$', token):
            current_dept = token
        elif current_dept is not None:
            courses.append((current_dept, token))
    return courses

def get_sections(dept, num, year, quarter):
    params = {
        "year": year,
        "quarter": quarter,
        "department": dept,
        "courseNumber": num
    }
    r = requests.get(BASE_URL, params=params)
    if r.status_code != 200:
        return []
    data = r.json()
    if not data.get("ok"):
        return []
    return data.get("data", [])

def process_courses(input_text, year, quarter):
    courses = parse_courses(input_text)
    results = []
    total_courses = len(courses)
    processed_courses = 0
    
    for dept, num in courses:
        processed_courses += 1
        print(f"Searching for {dept} {num} ({processed_courses}/{total_courses})...")
        
        try:
            sections = get_sections(dept, num, year, quarter)
            if not sections:
                print(f"No sections found for {dept} {num}")
                results.append({
                    'course': f'{dept} {num}',
                    'sections': []
                })
                continue
                
            course_sections = []
            for sec in sections:
                section_data = {
                    'code': sec['sectionCode'],
                    'type': sec['sectionType'],
                    'instructors': ', '.join(sec['instructors']) if sec['instructors'] else 'TBA',
                    'status': sec['statusHistory'][-1] if sec['statusHistory'] else 'Unknown',
                    # Format each meeting object into a readable string
                    'meetings': [
                        m if isinstance(m, str) else
                        " ".join(
                            part for part in [
                                m.get('days') or m.get('dayOfWeek') or '',
                                f"{m.get('beginTime') or m.get('startTime') or ''}-{m.get('endTime') or m.get('timeEnd') or ''}".strip('-'),
                                (m.get('bldgName') or m.get('building') or '') + (f" {m.get('room')}" if m.get('room') else '')
                            ] if part
                        ).strip()
                        for m in sec.get('meetings', [])
                    ],
                    'units': sec['units']
                }
                course_sections.append(section_data)
            
            results.append({
                'course': f'{dept} {num}',
                'sections': course_sections
            })
            
            print(f"Found {len(course_sections)} sections for {dept} {num}")
            
        except Exception as e:
            print(f"Error processing {dept} {num}: {str(e)}")
            results.append({
                'course': f'{dept} {num}',
                'sections': [],
                'error': str(e)
            })
    
    return results

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/process', methods=['POST'])
def process():
    data = request.get_json()
    input_text = data.get('input_text', '')
    year = data.get('year', '')
    quarter = data.get('quarter', '')

    # Directly process courses synchronously
    results = process_courses(input_text, year, quarter)
    return jsonify({
        'status': 'complete',
        'results': results
    })

if __name__ == '__main__':
    app.run(debug=True)
