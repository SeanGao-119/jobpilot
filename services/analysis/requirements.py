from __future__ import annotations

import re
from dataclasses import dataclass

_SKILL_PATTERNS: dict[str, tuple[str, ...]] = {
    "Python": (r"\bpython\b",),
    "SQL": (r"\bsql\b", r"\bpostgres(?:ql)?\b", r"\bmysql\b"),
    "Databricks": (r"\bdatabricks\b",),
    "Azure": (r"\bazure\b",),
    "Microsoft Fabric": (r"\bmicrosoft fabric\b", r"\bfabric\b"),
    "Spark": (r"\bspark\b", r"\bpyspark\b"),
    "ETL": (r"\betl\b", r"\bdata pipelines?\b", r"\bdata pipeline\b"),
    "dbt": (r"\bdbt\b",),
    "Airflow": (r"\bairflow\b",),
    "Docker": (r"\bdocker\b", r"\bcontainers?\b"),
    "AWS": (r"\baws\b", r"\bamazon web services\b"),
    "PostgreSQL": (r"\bpostgres(?:ql)?\b",),
    "Power BI": (r"\bpower\s?bi\b",),
    "Tableau": (r"\btableau\b",),
    "Git": (r"\bgit\b", r"\bversion control\b"),
    "Linux": (r"\blinux\b",),
    "REST APIs": (r"\brest(?:ful)? apis?\b", r"\brest apis?\b"),
}
_REQUIRED_MARKERS = (
    "must have",
    "required",
    "essential",
    "you will need",
    "you'll need",
    "we need",
)
_PREFERRED_MARKERS = (
    "nice to have",
    "preferred",
    "desirable",
    "advantage",
    "bonus",
)


@dataclass(frozen=True, slots=True)
class ExtractedRequirements:
    required_skills: tuple[str, ...]
    preferred_skills: tuple[str, ...]
    detected_skills: tuple[str, ...]


def _sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", text) if part.strip()]


def _skills_in_text(text: str) -> set[str]:
    found: set[str] = set()
    for skill, patterns in _SKILL_PATTERNS.items():
        if any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns):
            found.add(skill)
    return found


def extract_requirements(description: str) -> ExtractedRequirements:
    """Extract a deterministic first-pass skill set from a job description.

    This is deliberately conservative. A later LLM analysis layer can add structured
    responsibilities and seniority, but deterministic extraction keeps the scoring
    path reproducible and testable.
    """
    all_skills = _skills_in_text(description)
    required: set[str] = set()
    preferred: set[str] = set()

    for sentence in _sentences(description):
        low = sentence.lower()
        skills = _skills_in_text(sentence)
        if not skills:
            continue
        if any(marker in low for marker in _PREFERRED_MARKERS):
            preferred |= skills
        elif any(marker in low for marker in _REQUIRED_MARKERS):
            required |= skills

    undecided = all_skills - required - preferred
    required |= undecided
    preferred -= required

    return ExtractedRequirements(
        required_skills=tuple(sorted(required)),
        preferred_skills=tuple(sorted(preferred)),
        detected_skills=tuple(sorted(all_skills)),
    )
