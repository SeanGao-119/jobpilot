"""Adapter layer for using career-ops as JobPilot's evaluation engine."""

from .adapter import (
    CareerOpsConfig,
    CareerOpsEvaluation,
    CareerOpsError,
    evaluate_job,
    parse_score_summary,
    render_profile_as_cv,
)

__all__ = [
    "CareerOpsConfig",
    "CareerOpsEvaluation",
    "CareerOpsError",
    "evaluate_job",
    "parse_score_summary",
    "render_profile_as_cv",
]
