from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from .seek_job import (
    SeekJobPage,
    _company_value,
    _find_job_posting,
    _location_value,
    _salary_text,
    _ScriptExtractor,
    _string_value,
    _strip_html,
)
from .seek_link import ResolvedSeekLink

_ROOTS = {
    "linkedin": ("linkedin.com",),
    "zeil": ("zeil.com",),
    "trademe": ("trademe.co.nz",),
}


@dataclass(frozen=True, slots=True)
class PublicJobIdentity:
    platform: str
    external_id: str
    canonical_url: str


def _host_matches(host: str, root: str) -> bool:
    return host == root or host.endswith(f".{root}")


def platform_for_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Job URL must use HTTP or HTTPS")
    host = parsed.hostname.lower().rstrip(".")
    for platform, roots in _ROOTS.items():
        if any(_host_matches(host, root) for root in roots):
            return platform
    raise ValueError(f"Unsupported job platform host: {host}")


def public_job_identity(url: str) -> PublicJobIdentity:
    platform = platform_for_url(url)
    parsed = urlparse(url)
    text = f"{parsed.path}?{parsed.query}"
    patterns = {
        "linkedin": (
            r"/jobs/view/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)",
            r"[?&]currentJobId=(\d+)",
        ),
        "zeil": (r"/jobs?/([^/?#]+)",),
        "trademe": (r"/listing/(\d+)", r"/jobs/[^/?#]+/(\d+)"),
    }
    external_id = next(
        (
            match.group(1)
            for pattern in patterns[platform]
            if (match := re.search(pattern, text, flags=re.IGNORECASE))
        ),
        None,
    )
    if not external_id:
        external_id = hashlib.sha256(f"{platform}:{parsed.netloc}{text}".encode()).hexdigest()[:24]
    if platform == "linkedin" and external_id.isdigit():
        canonical = f"https://www.linkedin.com/jobs/view/{external_id}"
    else:
        canonical = url
    return PublicJobIdentity(platform=platform, external_id=external_id, canonical_url=canonical)


def resolve_public_job_url(url: str, *, timeout: float = 15.0) -> ResolvedSeekLink:
    identity = public_job_identity(url)
    headers = {"User-Agent": "Mozilla/5.0 JobPilot/0.6"}
    with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
    final_url = str(response.url)
    final_identity = public_job_identity(final_url)
    if final_identity.platform != identity.platform:
        raise ValueError("Job URL redirected to another platform")
    return ResolvedSeekLink(
        input_url=url,
        final_url=final_identity.canonical_url,
        seek_job_id=final_identity.external_id,
    )


def _job_from_posting(posting: dict[str, Any], source_url: str) -> SeekJobPage:
    identity = public_job_identity(source_url)
    title = _string_value(posting, "title")
    company = _company_value(posting)
    description = posting.get("description")
    if not title or not company or not isinstance(description, str) or not description.strip():
        raise ValueError("JobPosting is missing title, company, or description")
    employment_type = posting.get("employmentType")
    if isinstance(employment_type, list):
        employment_type = ", ".join(str(item) for item in employment_type)
    return SeekJobPage(
        source_url=identity.canonical_url,
        seek_job_id=identity.external_id,
        title=title,
        company=company,
        location=_location_value(posting),
        employment_type=str(employment_type).strip() if employment_type else None,
        salary_text=_salary_text(posting),
        description=_strip_html(description),
        date_posted=_string_value(posting, "datePosted"),
        valid_through=_string_value(posting, "validThrough"),
    )


def parse_public_job_page(html: str, *, source_url: str) -> SeekJobPage:
    public_job_identity(source_url)
    parser = _ScriptExtractor()
    parser.feed(html)
    for kind, block in parser.blocks:
        if kind != "application/ld+json" or not block:
            continue
        try:
            posting = _find_job_posting(json.loads(block))
        except json.JSONDecodeError:
            continue
        if posting:
            return _job_from_posting(posting, source_url)
    raise ValueError("No JobPosting data found on the public job page")


def fetch_public_job(url: str, *, timeout: float = 20.0) -> SeekJobPage:
    identity = public_job_identity(url)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
    }
    with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
    final_identity = public_job_identity(str(response.url))
    if final_identity.platform != identity.platform:
        raise ValueError("Job page redirected to another platform")
    return parse_public_job_page(response.text, source_url=final_identity.canonical_url)
