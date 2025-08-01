import requests
import json
import time

def fetch_all_departments():
    departments = set()
    page = 0
    per_page = 100
    consecutive_empty_pages = 0
    
    while consecutive_empty_pages < 3:  # Stop after 3 consecutive empty pages
        url = f"https://anteaterapi.com/v2/rest/courses?skip={page * per_page}&take={per_page}"
        
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            if not data.get('ok', False):
                print(f"API error: {data.get('message', 'Unknown error')}")
                break
                
            courses = data.get('data', [])
            if not courses:
                consecutive_empty_pages += 1
                print(f"Page {page + 1}: Empty page ({consecutive_empty_pages}/3)")
                page += 1
                continue
            else:
                consecutive_empty_pages = 0
                
            for course in courses:
                dept_code = course.get('department', '')
                dept_name = course.get('departmentName', '')
                if dept_code and dept_name:
                    departments.add((dept_code, dept_name))
            
            print(f"Page {page + 1}: Found {len(courses)} courses. Total unique departments: {len(departments)}")
            page += 1
            
            # Add small delay to be nice to the API
            time.sleep(0.1)
            
            # Safety check - don't fetch more than 200 pages
            if page > 200:
                print("Reached max pages limit")
                break
                
        except Exception as e:
            print(f"Error on page {page}: {e}")
            consecutive_empty_pages += 1
            page += 1
            continue
    
    return sorted(list(departments))

if __name__ == "__main__":
    print("Fetching ALL departments from AnteaterAPI...")
    departments = fetch_all_departments()
    
    print(f"\nFound {len(departments)} unique departments:")
    print("\nDepartment Code | Department Name")
    print("-" * 80)
    
    with open('complete_departments_list.txt', 'w') as f:
        f.write("Department Code | Department Name\n")
        f.write("-" * 80 + "\n")
        
        for dept_code, dept_name in departments:
            line = f"{dept_code:<15} | {dept_name}"
            print(line)
            f.write(line + "\n")
    
    print(f"\nComplete departments list saved to 'complete_departments_list.txt'")
    
    # Also create Python list format for easy copy-paste
    with open('departments_python_list.py', 'w') as f:
        f.write("# UCI Department Codes and Names\n")
        f.write("# Extracted from AnteaterAPI\n\n")
        f.write("DEPARTMENTS = [\n")
        for dept_code, dept_name in departments:
            f.write(f'    ("{dept_code}", "{dept_name}"),\n')
        f.write("]\n\n")
        f.write("DEPARTMENT_CODES = [\n")
        for dept_code, _ in departments:
            f.write(f'    "{dept_code}",\n')
        f.write("]\n")
    
    print("Python list format saved to 'departments_python_list.py'") 