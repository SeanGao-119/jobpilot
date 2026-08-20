from __future__ import annotations

import json
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

import httpx

from .seek_link import extract_seek_job_id, validate_seek_url

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.4.1 Safari/605.1.15"
)

_DETAIL_QUERY = (
    "query jobDetails($jobId: ID!) { "
    "jobDetails(id: $jobId) { job { "
    "id title abstract content(platform: WEB) status isExpired phoneNumber "
    "expiresAt { dateTimeUtc } "
    "salary { label } "
    "workTypes { label } "
    "advertiser { id name isVerified } "
    "location { label } "
    'classifications { label(languageCode: "en") } '
    "} } }"
)


@dataclass(frozen=True, slots=True)
class SeekJobPage:
    source_url: str
    seek_job_id: str
    title: str
    company: str
    location: str | None
    employment_type: str | None
    salary_text: str | None
    description: str
    date_posted: str | None
    valid_through: str | None


class _ScriptExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._capture = False
        self._chunks: list[str] = []
        self._kind: str | None = None
        self.blocks: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "script":
            return
        attrs_map = {key.lower(): value for key, value in attrs}
        script_type = (attrs_map.get("type") or "").lower()
        script_id = (attrs_map.get("id") or "").lower()
        if script_type in {"application/ld+json", "application/json"} or script_id == "__next_data__":
            self._capture = True
            self._chunks = []
            self._kind = script_type or script_id

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._capture:
            self.blocks.append((self._kind or "", "".join(self._chunks).strip()))
            self._capture = False
            self._chunks = []
            self._kind = None


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        value = " ".join(data.split())
        if value:
            self.parts.append(value)


def _strip_html(value: str) -> str:
    parser = _TextExtractor()
    parser.feed(value)
    return "\n".join(parser.parts)


def _is_job_posting(node: Any) -> bool:
    if not isinstance(node, dict):
        return False
    node_type = node.get("@type")
    if isinstance(node_type, str):
        return node_type.lower() == "jobposting"
    if isinstance(node_type, list):
        return any(str(item).lower() == "jobposting" for item in node_type)
    return False


def _find_job_posting(node: Any) -> dict[str, Any] | None:
    if _is_job_posting(node):
        return node
    if isinstance(node, dict):
        for value in node.values():
            found = _find_job_posting(value)
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = _find_job_posting(value)
            if found:
                return found
    return None


def _string_value(node: Any, *keys: str) -> str | None:
    if not isinstance(node, dict):
        return None
    for key in keys:
        value = node.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _company_value(node: dict[str, Any]) -> str | None:
    direct = _string_value(node, "company", "companyName", "advertiserName")
    if direct:
        return direct
    for key in ("advertiser", "hiringOrganization", "companyProfile", "companyDetails"):
        value = node.get(key)
        if isinstance(value, dict):
            candidate = _string_value(value, "name", "description", "companyName")
            if candidate:
                return candidate
    return None


def _location_value(node: dict[str, Any]) -> str | None:
    value = node.get("location") or node.get("jobLocation")
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list) and value:
        value = value[0]
    if isinstance(value, dict):
        direct = _string_value(value, "label", "name", "description", "locationDescription")
        if direct:
            return direct
        address = value.get("address")
        if isinstance(address, dict):
            parts = [
                address.get("addressLocality"),
                address.get("addressRegion"),
                address.get("addressCountry"),
            ]
            text = ", ".join(str(part).strip() for part in parts if part)
            return text or None
    return None


def _embedded_description(node: dict[str, Any]) -> str | None:
    for key in ("description", "content", "jobDescription", "descriptionHtml"):
        value = node.get(key)
        if isinstance(value, str) and len(_strip_html(value).strip()) >= 40:
            return value
    return None


def _embedded_job_score(node: dict[str, Any]) -> int:
    score = 0
    if _string_value(node, "title", "jobTitle"):
        score += 3
    if _embedded_description(node):
        score += 4
    if _company_value(node):
        score += 2
    if _location_value(node):
        score += 1
    if any(key in node for key in ("workType", "employmentType", "salary", "salaryLabel")):
        score += 1
    return score


def _find_embedded_job(node: Any) -> dict[str, Any] | None:
    best: tuple[int, dict[str, Any]] | None = None

    def visit(value: Any) -> None:
        nonlocal best
        if isinstance(value, dict):
            score = _embedded_job_score(value)
            if score >= 7 and (best is None or score > best[0]):
                best = (score, value)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(node)
    return best[1] if best else None


def _salary_text(job: dict[str, Any]) -> str | None:
    direct = _string_value(job, "salary", "salaryLabel", "salaryText")
    if direct:
        return direct
    salary = job.get("baseSalary")
    if not isinstance(salary, dict):
        return None
    currency = salary.get("currency") or ""
    value = salary.get("value")
    if isinstance(value, dict):
        minimum = value.get("minValue")
        maximum = value.get("maxValue")
        unit = value.get("unitText")
        if minimum is not None and maximum is not None:
            suffix = f" {unit}" if unit else ""
            return f"{currency} {minimum}-{maximum}{suffix}".strip()
    return None


def _job_from_schema(posting: dict[str, Any], source_url: str) -> SeekJobPage:
    company = _company_value(posting)
    title = _string_value(posting, "title")
    description = posting.get("description")
    if not title or not company or not description:
        raise ValueError("JobPosting is missing title, company, or description")
    employment_type = posting.get("employmentType")
    if isinstance(employment_type, list):
        employment_type = ", ".join(str(item) for item in employment_type)
    return SeekJobPage(
        source_url=source_url,
        seek_job_id=extract_seek_job_id(source_url),
        title=title,
        company=company,
        location=_location_value(posting),
        employment_type=str(employment_type).strip() if employment_type else None,
        salary_text=_salary_text(posting),
        description=_strip_html(str(description)),
        date_posted=_string_value(posting, "datePosted"),
        valid_through=_string_value(posting, "validThrough"),
    )


def _job_from_embedded(node: dict[str, Any], source_url: str) -> SeekJobPage:
    title = _string_value(node, "title", "jobTitle")
    company = _company_value(node)
    description = _embedded_description(node)
    if not title or not company or not description:
        raise ValueError("Embedded SEEK job data is missing title, company, or description")
    return SeekJobPage(
        source_url=source_url,
        seek_job_id=extract_seek_job_id(source_url),
        title=title,
        company=company,
        location=_location_value(node),
        employment_type=_string_value(node, "workType", "employmentType", "workTypeLabel"),
        salary_text=_salary_text(node),
        description=_strip_html(description),
        date_posted=_string_value(node, "listedAt", "datePosted", "postedDate"),
        valid_through=_string_value(node, "expiresAt", "validThrough"),
    )


def parse_seek_job_page(html: str, *, source_url: str) -> SeekJobPage:
    """Parse SEEK job data from JSON-LD or embedded application JSON."""
    validate_seek_url(source_url)
    parser = _ScriptExtractor()
    parser.feed(html)
    decoded_payloads: list[Any] = []
    for kind, block in parser.blocks:
        if not block:
            continue
        try:
            payload = json.loads(block)
        except json.JSONDecodeError:
            continue
        decoded_payloads.append(payload)
        if kind == "application/ld+json":
            posting = _find_job_posting(payload)
            if posting:
                return _job_from_schema(posting, source_url)
    for payload in decoded_payloads:
        embedded = _find_embedded_job(payload)
        if embedded:
            return _job_from_embedded(embedded, source_url)
    raise ValueError("No supported SEEK job data found in page")


def _graphql_endpoint(url: str) -> str:
    host = urlparse(url).hostname or ""
    if host == "nz.seek.com" or host.endswith(".nz.seek.com"):
        return "https://nz.seek.com/graphql"
    if host == "seek.com.au" or host.endswith(".seek.com.au"):
        return "https://www.seek.com.au/graphql"
    # Legacy NZ links are resolved before this function is normally called.
    return "https://nz.seek.com/graphql"


def _job_from_graphql(job: dict[str, Any], source_url: str) -> SeekJobPage:
    title = _string_value(job, "title")
    advertiser = job.get("advertiser") or {}
    company = _string_value(advertiser, "name")
    content = job.get("content")
    if not title or not company or not isinstance(content, str) or not content.strip():
        raise ValueError("SEEK GraphQL job data is missing title, company, or description")

    salary = job.get("salary") or {}
    work_types = job.get("workTypes") or {}
    expires = job.get("expiresAt") or {}
    location = job.get("location") or {}
    return SeekJobPage(
        source_url=source_url,
        seek_job_id=str(job.get("id") or extract_seek_job_id(source_url)),
        title=title,
        company=company,
        location=_string_value(location, "label"),
        employment_type=_string_value(work_types, "label"),
        salary_text=_string_value(salary, "label"),
        description=_strip_html(content),
        date_posted=None,
        valid_through=_string_value(expires, "dateTimeUtc"),
    )


def _fetch_graphql_job(url: str, *, timeout: float) -> SeekJobPage:
    job_id = extract_seek_job_id(url)
    payload = {
        "operationName": "jobDetails",
        "variables": {"jobId": job_id},
        "query": _DETAIL_QUERY,
    }
    headers = {
        "User-Agent": _BROWSER_UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    response = httpx.post(
        _graphql_endpoint(url),
        json=payload,
        headers=headers,
        timeout=timeout,
        follow_redirects=True,
    )
    response.raise_for_status()
    body = response.json()
    errors = body.get("errors") if isinstance(body, dict) else None
    if errors:
        message = errors[0].get("message", "GraphQL error") if isinstance(errors[0], dict) else str(errors[0])
        raise ValueError(f"SEEK GraphQL error: {message}")
    job = (((body.get("data") or {}).get("jobDetails") or {}).get("job")) if isinstance(body, dict) else None
    if not isinstance(job, dict):
        raise ValueError(f"SEEK job {job_id} not found or expired")
    return _job_from_graphql(job, url)


def fetch_seek_job(url: str, *, timeout: float = 15.0) -> SeekJobPage:
    """Fetch a SEEK job, preferring the structured GraphQL detail endpoint.

    SEEK's rendered job pages may be Cloudflare/SPA shells. The GraphQL endpoint is
    what the site itself uses for structured job detail, so it is the primary path;
    HTML parsing remains a compatibility fallback.
    """
    validate_seek_url(url)
    try:
        return _fetch_graphql_job(url, timeout=timeout)
    except (httpx.HTTPError, ValueError, json.JSONDecodeError):
        headers = {
            "User-Agent": _BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-NZ,en;q=0.9",
        }
        with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
            response = client.get(url)
            response.raise_for_status()
            final_url = str(response.url)
            validate_seek_url(final_url)
            return parse_seek_job_page(response.text, source_url=final_url)
