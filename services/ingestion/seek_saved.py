from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

from .seek_link import extract_seek_job_id, validate_seek_url


@dataclass(frozen=True, slots=True)
class SavedSeekJob:
    seek_job_id: str
    source_url: str


def canonicalize_saved_seek_url(url: str) -> SavedSeekJob:
    """Validate and canonicalize a SEEK job URL collected from the signed-in browser."""
    value = url.strip()
    validate_seek_url(value)
    job_id = extract_seek_job_id(value)
    host = (urlparse(value).hostname or "www.seek.co.nz").lower()
    root = "seek.com" if host.endswith("seek.com") and not host.endswith("seek.co.nz") else "seek.co.nz"
    return SavedSeekJob(
        seek_job_id=job_id,
        source_url=f"https://www.{root}/job/{job_id}",
    )


def parse_saved_seek_urls(urls: list[str] | tuple[str, ...]) -> tuple[SavedSeekJob, ...]:
    """Validate, canonicalize, and deduplicate saved jobs by SEEK job id."""
    seen: set[str] = set()
    jobs: list[SavedSeekJob] = []
    for url in urls:
        item = canonicalize_saved_seek_url(url)
        if item.seek_job_id in seen:
            continue
        seen.add(item.seek_job_id)
        jobs.append(item)
    return tuple(jobs)
