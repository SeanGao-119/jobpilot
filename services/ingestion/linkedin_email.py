from __future__ import annotations

import re
from dataclasses import dataclass

from .models import JobRecommendation, dedupe_recommendations

_LINK_RE = re.compile(r"\[(?P<label>.*?)\]\((?P<url>https?://[^)]+)\)", re.DOTALL)
_JOB_URL_RE = re.compile(r"linkedin\.com/(?:comm/)?jobs/view/|[?&]currentJobId=", re.IGNORECASE)
_SKIP = ("view all jobs", "see more jobs", "unsubscribe", "job alert settings")


@dataclass(frozen=True, slots=True)
class LinkedInEmailParseResult:
    recommendations: tuple[JobRecommendation, ...]


def classify_linkedin_email(subject: str, body: str = "") -> str:
    text = f"{subject}\n{body[:3000]}".lower()
    if "job alert" in text or "new jobs" in text:
        return "job_alert"
    return "recommendation"


def _lines(label: str) -> list[str]:
    return [
        line.strip(" \t-*•")
        for line in label.replace("&amp;", "&").splitlines()
        if line.strip(" \t-*•")
    ]


def parse_linkedin_job_email(
    *, subject: str, body: str, message_id: str | None = None
) -> LinkedInEmailParseResult:
    items: list[JobRecommendation] = []
    for match in _LINK_RE.finditer(body):
        label = match.group("label")
        url = match.group("url")
        if not _JOB_URL_RE.search(url) or any(token in label.lower() for token in _SKIP):
            continue
        lines = _lines(label)
        if not lines:
            continue
        title = lines[0]
        company = lines[1] if len(lines) > 1 else "LinkedIn employer"
        location = lines[2] if len(lines) > 2 else None
        items.append(
            JobRecommendation(
                source_url=url,
                company=company,
                location=location,
                title_hint=title,
                source_message_id=message_id,
            )
        )
    return LinkedInEmailParseResult(recommendations=tuple(dedupe_recommendations(items)))
