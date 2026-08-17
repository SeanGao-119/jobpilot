from __future__ import annotations

import re
from dataclasses import dataclass

from .models import JobRecommendation, dedupe_recommendations

_LINK_RE = re.compile(r"\[(?P<label>.*?)\]\((?P<url>https?://[^)]+)\)", re.DOTALL)
_SUBJECT_RE = re.compile(
    r"^(?P<title>.+?)(?:\s+\+\s+(?P<count>\d+)\s+new jobs?)?$",
    re.IGNORECASE,
)
_LOCATION_HINTS = (
    "Auckland",
    "Wellington",
    "Christchurch",
    "Hamilton",
    "Tauranga",
    "Dunedin",
    "Remote",
)
_SKIP_LABELS = (
    "view more jobs",
    "how recommendations work",
    "rate your recent employer",
    "was this email useful",
)


@dataclass(frozen=True, slots=True)
class SeekEmailParseResult:
    subject_title_hint: str | None
    advertised_count: int | None
    recommendations: tuple[JobRecommendation, ...]


def parse_subject(subject: str) -> tuple[str | None, int | None]:
    match = _SUBJECT_RE.match(subject.strip())
    if not match:
        return None, None
    title = match.group("title").strip() or None
    extra = int(match.group("count")) if match.group("count") else None
    advertised_count = extra + 1 if extra is not None else None
    return title, advertised_count


def _clean_lines(label: str) -> list[str]:
    cleaned = re.sub(r"\[?logo\]?", "", label, flags=re.IGNORECASE)
    lines: list[str] = []
    for raw in cleaned.splitlines():
        line = raw.strip(" \t-*•")
        if not line or line.lower() == "recently posted":
            continue
        lines.append(line)
    return lines


def _looks_like_job(label: str, url: str) -> bool:
    low = label.lower()
    if any(skip in low for skip in _SKIP_LABELS):
        return False
    if "email.s.seek.co.nz" not in url and "seek.co.nz" not in url:
        return False
    lines = _clean_lines(label)
    if len(lines) < 2:
        return False
    return any(hint.lower() in " ".join(lines).lower() for hint in _LOCATION_HINTS)


def _split_metadata(
    lines: list[str],
) -> tuple[str, str | None, str | None, str | None, tuple[str, ...]]:
    company = lines[0]
    location = lines[1] if len(lines) > 1 else None
    salary: str | None = None
    arrangement: str | None = None
    highlights: list[str] = []

    if location:
        paren = re.search(
            r"\((Hybrid|Remote|On-site|Onsite)\)",
            location,
            re.IGNORECASE,
        )
        if paren:
            arrangement = paren.group(1).replace("Onsite", "On-site")

    for line in lines[2:]:
        low = line.lower()
        if salary is None and ("$" in line or "salary" in low or re.search(r"\b\d{5,6}\b", line)):
            salary = line
        else:
            highlights.append(line)
    return company, location, salary, arrangement, tuple(highlights)


def parse_seek_recommendation_email(
    *, subject: str, body: str, message_id: str | None = None
) -> SeekEmailParseResult:
    """Parse SEEK recommendation email Markdown returned by the Gmail connector.

    SEEK's recommendation emails expose company/location/highlights in the link label.
    The exact job title may require resolving the tracking URL; the email subject is used
    only as a title hint for the first recommendation and is never copied to every job.
    """
    title_hint, advertised_count = parse_subject(subject)
    items: list[JobRecommendation] = []

    for match in _LINK_RE.finditer(body):
        label, url = match.group("label"), match.group("url")
        if not _looks_like_job(label, url):
            continue
        lines = _clean_lines(label)
        company, location, salary, arrangement, highlights = _split_metadata(lines)
        items.append(
            JobRecommendation(
                source_url=url,
                company=company,
                location=location,
                salary_text=salary,
                work_arrangement=arrangement,
                highlights=highlights,
                title_hint=title_hint if not items else None,
                source_message_id=message_id,
            )
        )

    return SeekEmailParseResult(
        subject_title_hint=title_hint,
        advertised_count=advertised_count,
        recommendations=tuple(dedupe_recommendations(items)),
    )
