const axios = require('axios');

// Helper function to parse course strings from DegreeWorks format
function parseCourses(inputText) {
  if (!inputText || typeof inputText !== 'string') {
    return [];
  }

  // Split by commas and clean up each entry
  const courseStrings = inputText.split(',').map(s => s.trim());
  const courseMatches = [];

  for (const courseString of courseStrings) {
    // Match department code and course number
    const match = courseString.match(/([A-Za-z&\s]+)\s*(\d+[A-Za-z]?)/);
    if (match) {
      const dept = match[1].trim();
      const num = match[2].trim();
      courseMatches.push([dept, num]);
    }
  }

  return courseMatches;
}

// Format meeting times
function formatMeetingString(meeting) {
  if (!meeting) return 'No meeting information';
  
  const days = meeting.days || 'TBA';
  const time = meeting.time || 'TBA';
  const bldg = meeting.bldg || '';
  const room = meeting.room || '';
  
  const location = bldg && room ? `${bldg} ${room}` : 'TBA';
  return `${days} ${time} at ${location}`;
}

// Get sections from Anteater API
async function getSections(dept, num, year, quarter) {
  try {
    const API_KEY = process.env.ANTEATER_API_SECRET_KEY;
    if (!API_KEY) {
      throw new Error("API key not configured");
    }

    const url = `https://api.peterportal.org/rest/v0/schedule/soc?term=${year}-${quarter}&department=${dept}&courseNumber=${num}`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      },
      timeout: 10000
    });

    if (!response.data || !response.data.schools || response.data.schools.length === 0) {
      return { course: `${dept} ${num}`, sections: {}, error: "No data found" };
    }

    // Process the sections
    const sections = [];
    for (const school of response.data.schools) {
      for (const dept of school.departments) {
        for (const course of dept.courses) {
          for (const section of course.sections) {
            const sectionData = {
              sectionCode: section.sectionCode,
              sectionType: section.sectionType,
              units: section.units,
              instructors: section.instructors,
              meetings: section.meetings,
              statusHistory: [section.status]
            };
            sections.push(sectionData);
          }
        }
      }
    }

    // Group sections by type
    const groupedSections = {};
    for (const sec of sections) {
      const sectionData = {
        code: sec.sectionCode || 'N/A',
        type: sec.sectionType || 'N/A',
        instructors: sec.instructors && sec.instructors.length ? sec.instructors.join(', ') : 'TBA',
        status: sec.statusHistory && sec.statusHistory.length ? sec.statusHistory[sec.statusHistory.length - 1] : 'Unknown',
        meetings: sec.meetings ? sec.meetings.map(m => formatMeetingString(m)) : [],
        units: sec.units || 'N/A'
      };
      
      if (!groupedSections[sectionData.type]) {
        groupedSections[sectionData.type] = [];
      }
      groupedSections[sectionData.type].push(sectionData);
    }

    return { course: `${dept} ${num}`, sections: groupedSections, error: null };
  } catch (error) {
    console.error(`Error fetching ${dept} ${num}:`, error);
    return { 
      course: `${dept} ${num}`, 
      sections: {}, 
      error: error.message || "An error occurred while fetching course data"
    };
  }
}

exports.handler = async function(event) {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ type: "error", message: "Method not allowed" })
    };
  }

  try {
    const data = JSON.parse(event.body);
    const { input_text, year, quarter } = data;

    // Validate inputs
    if (!input_text || !year || !quarter) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          type: "error", 
          message: "Missing required fields (course string, year, or quarter)"
        })
      };
    }

    if (!/^\d{4}$/.test(year)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          type: "error", 
          message: "Invalid year format. Please use YYYY." 
        })
      };
    }

    const validQuarters = ["Fall", "Winter", "Spring", "Summer1", "Summer10wk", "Summer2"];
    if (!validQuarters.includes(quarter)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          type: "error", 
          message: `Invalid quarter selected: ${quarter}` 
        })
      };
    }

    // Parse courses
    const courses = parseCourses(input_text);
    if (courses.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ type: "complete", results: [] })
      };
    }

    // Process all courses
    const results = await Promise.all(
      courses.map(([dept, num]) => getSections(dept, num, year, quarter))
    );

    // Return results
    return {
      statusCode: 200,
      body: JSON.stringify({ type: "complete", results })
    };
  } catch (error) {
    console.error("Error processing request:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        type: "error", 
        message: "An unexpected server error occurred during processing." 
      })
    };
  }
}; 