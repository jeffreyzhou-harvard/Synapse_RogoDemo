import pytest

from app.main import parse_estimate_hours, compute_critical_path, Task


def test_parse_estimate_hours():
    assert parse_estimate_hours("1h") == 1
    assert parse_estimate_hours("2d") == 16
    assert parse_estimate_hours("1w") == 40
    assert parse_estimate_hours("1m") == 160
    assert parse_estimate_hours(None) == 8
    assert parse_estimate_hours("weird") == 8


def test_compute_critical_path_linear():
    tasks = [
        Task(id="A", title="A", estimate="1d"),
        Task(id="B", title="B", estimate="2d", dependencies=["A"]),
        Task(id="C", title="C", estimate="1d", dependencies=["B"]),
    ]
    cp = compute_critical_path(tasks)
    assert cp == ["A", "B", "C"]


def test_compute_critical_path_branch():
    tasks = [
        Task(id="A", title="A", estimate="1d"),
        Task(id="B1", title="B1", estimate="1d", dependencies=["A"]),
        Task(id="B2", title="B2", estimate="4d", dependencies=["A"]),
        Task(id="C", title="C", estimate="1d", dependencies=["B1", "B2"]),
    ]
    cp = compute_critical_path(tasks)
    # path should include the longer branch B2
    assert cp[0] == "A" and "B2" in cp and cp[-1] == "C"

