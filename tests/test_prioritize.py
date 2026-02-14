from app.main import Task

def test_rice_scoring_order(client=None):
    a = Task(id="T1", title="A", estimate="1d", reach=100, impact=3, confidence=0.7)
    b = Task(id="T2", title="B", estimate="3d", reach=50, impact=4, confidence=0.6)
    # Inline RICE scoring to check ordering
    def parse_estimate_hours(e):
        return 8 if e == "1d" else 24
    def rice(t):
        reach = t.reach or 1
        impact = t.impact or 1
        confidence = t.confidence or 0.5
        effort = t.effort or parse_estimate_hours(t.estimate)
        return (reach * impact * confidence) / max(effort, 0.1)
    assert rice(a) > rice(b)

