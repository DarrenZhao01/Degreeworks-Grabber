import requests
import json
import time

def fetch_all_departments():
    departments = set()
    page = 0
    per_page = 100
    
    while True:
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
                break
                
            for course in courses:
                dept_code = course.get('department', '')
                dept_name = course.get('departmentName', '')
                if dept_code and dept_name:
                    departments.add((dept_code, dept_name))
            
            print(f"Page {page + 1}: Found {len(courses)} courses. Total unique departments: {len(departments)}")
            page += 1
            
            # Add small delay to be nice to the API
            time.sleep(0.1)
            
            # Safety check - don't fetch more than 50 pages
            if page > 50:
                print("Reached max pages limit")
                break
                
        except Exception as e:
            print(f"Error on page {page}: {e}")
            break
    
    return sorted(list(departments))

if __name__ == "__main__":
    print("Fetching all departments from AnteaterAPI...")
    departments = fetch_all_departments()
    
    print(f"\nFound {len(departments)} unique departments:")
    print("\nDepartment Code | Department Name")
    print("-" * 50)
    
    with open('departments_list.txt', 'w') as f:
        f.write("Department Code | Department Name\n")
        f.write("-" * 50 + "\n")
        
        for dept_code, dept_name in departments:
            line = f"{dept_code:<15} | {dept_name}"
            print(line)
            f.write(line + "\n")
    
    print(f"\nDepartments saved to 'departments_list.txt'")
    
    # Also create a simple list of department codes for programming use
    with open('department_codes.txt', 'w') as f:
        for dept_code, _ in departments:
            f.write(dept_code + "\n")
    
    print("Department codes saved to 'department_codes.txt'") 