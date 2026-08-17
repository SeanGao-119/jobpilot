from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

_SEEK_ROOT_DOMAINS = ("seek.co.nz", "seek.com")
_JOB_ID_RE = re.compile(r"/job/(?P<job_id>\d+)")


class SeekUrlError(ValueError):
    """Raised when a URL is not a supported SEEK URL."""


@dataclass(frozen=True, slots=True)
class ResolvedSeekLink:
    input_url: str
    final_url: str
    seek_job_id: str


def _host_is_allowed(host: str | None) -> bool:
    if not host:
        return False
    normalized = host.lower().rstrip(".")
    return any(
        normalized == root_domain or normalized.endswith(f".{root_domain}")
        for root_domain in _SEEK_ROOT_DOMAINS
    )


def validate_seek_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not _host_is_allowed(parsed.hostname):
        host = parsed.hostname or "<missing>"
        raise SeekUrlError(f"Only SEEK URLs are allowed (rejected host: {host})")


def extract_seek_job_id(url: str) -> str:
    validate_seek_url(url)
    match = _JOB_ID_RE.search(urlparse(url).path)
    if not match:
        raise SeekUrlError("No SEEK job id found in URL")
    return match.group("job_id")


def resolve_seek_tracking_url(url: str, *, timeout: float = 15.0) -> ResolvedSeekLink:
    """Resolve a SEEK recommendation tracking URL to the canonical job page.

    The initial and final hosts are constrained to SEEK-owned domains so this helper
    cannot be used as a generic redirect fetcher when exposed through an API.
    """
    validate_seek_url(url)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151 Safari/537.36"
        )
    }
    with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()

    final_url = str(response.url)
    validate_seek_url(final_url)
    return ResolvedSeekLink(
        input_url=url,
        final_url=final_url,
        seek_job_id=extract_seek_job_id(final_url),
    )
