"""Analysis request correlation id schema tests.

Author: Qoder
"""
from app.schemas.game import AnalysisRequest


def test_correlation_id_optional_default_none():
    """correlation_id is an optional field: absent requests stay valid."""
    req = AnalysisRequest(moves=[])
    assert req.correlation_id is None


def test_correlation_id_forwarded():
    """correlation_id is preserved when the frontend supplies it."""
    req = AnalysisRequest(moves=[], correlation_id="anl-1722729600000-3f2a")
    assert req.correlation_id == "anl-1722729600000-3f2a"
