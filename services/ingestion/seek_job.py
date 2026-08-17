from __future__ import annotations

import json
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

import httpx

from .seek_link import extract_seek_job_id, validate_seek_url


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
        direct = _string_value(
            value,
            "label",
            "name",
            "description",
            "locationDescription",
            "areaDescription",
        )
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


def _location_text(job: dict[str, Any]) -> str | None:
    return _location_value(job)


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
        if value.get("value") is not None:
            suffix = f" {unit}" if unit else ""
            return f"{currency} {value['value']}{suffix}".strip()
    if value is not None:
        return f"{currency} {value}".strip()
    return None


def _job_from_schema(posting: dict[str, Any], source_url: str) -> SeekJobPage:
    organization = posting.get("hiringOrganization")
    company = organization.get("name") if isinstance(organization, dict) else None
    title = posting.get("title")
    description = posting.get("description")
    if not title or not company or not description:
        raise ValueError("JobPosting is missing title, company, or description")

    employment_type = posting.get("employmentType")
    if isinstance(employment_type, list):
        employment_type = ", ".join(str(item) for item in employment_type)

    return SeekJobPage(
        source_url=source_url,
        seek_job_id=extract_seek_job_id(source_url),
        title=str(title).strip(),
        company=str(company).strip(),
        location=_location_text(posting),
        employment_type=str(employment_type).strip() if employment_type else None,
        salary_text=_salary_text(posting),
        description=_strip_html(str(description)),
        date_posted=str(posting.get("datePosted")) if posting.get("datePosted") else None,
        valid_through=str(posting.get("validThrough")) if posting.get("validThrough") else None,
    )


def _job_from_embedded(node: dict[str, Any], source_url: str) -> SeekJobPage:
    title = _string_value(node, "title", "jobTitle")
    company = _company_value(node)
    description = _embedded_description(node)
    if not title or not company or not description:
        raise ValueError("Embedded SEEK job data is missing title, company, or description")

    employment_type = _string_value(node, "workType", "employmentType", "workTypeLabel")
    return SeekJobPage(
        source_url=source_url,
        seek_job_id=extract_seek_job_id(source_url),
        title=title,
        company=company,
        location=_location_value(node),
        employment_type=employment_type,
        salary_text=_salary_text(node),
        description=_strip_html(description),
        date_posted=_string_value(node, "listedAt", "datePosted", "postedDate"),
        valid_through=_string_value(node, "expiresAt", "validThrough"),
    )


def parse_seek_job_page(html: str, *, source_url: str) -> SeekJobPage:
    """Parse SEEK job data from JSON-LD or the site's embedded application JSON."""
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


def fetch_seek_job(url: str, *, timeout: float = 15.0) -> SeekJobPage:
    """Fetch and parse a canonical SEEK job URL."""
    validate_seek_url(url)
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
        final_url = str(response.url)
        validate_seek_url(final_url)
        return parse_seek_job_page(response.text, source_url=final_url)
