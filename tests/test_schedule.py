import pytest
from schedule import generate_schedules

simple_courses = [
    {
        "course": "C1",
        "sections": [
            {"code": "A", "meetings": ["MW 9:00am-9:50am"]}
        ]
    },
    {
        "course": "C2",
        "sections": [
            {"code": "B", "meetings": ["MW 10:00am-10:50am"]},
            {"code": "C", "meetings": ["TuTh 9:00am-9:50am"]},
        ]
    }
]

def test_generate_schedules_basic():
    schedules = generate_schedules(simple_courses)
    assert len(schedules) == 2
    codes = sorted([s[1]["code"] for s in schedules])
    assert codes == ["B", "C"]

def test_generate_schedules_no_options():
    courses = [
        {
            "course": "X",
            "sections": [
                {"code": "A", "meetings": ["MW 9:00am-9:50am"]}
            ]
        },
        {
            "course": "Y",
            "sections": [
                {"code": "B", "meetings": ["MW 9:30am-10:00am"]}
            ]
        }
    ]
    schedules = generate_schedules(courses)
    assert schedules == []
