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


class _JsonLdExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._capture = False
        self._chunks: list[str] = []
        self.blocks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "script":
            return
        attrs_map = {key.lower(): value for key, value in attrs}
        if (attrs_map.get("type") or "").lower() == "application/ld+json":
            self._capture = True
            self._chunks = []

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._capture:
            self.blocks.append("".join(self._chunks).strip())
            self._capture = False
            self._chunks = []


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


def _location_text(job: dict[str, Any]) -> str | None:
    location = job.get("jobLocation")
    if isinstance(location, list):
        location = location[0] if location else None
    if not isinstance(location, dict):
        return None
    address = location.get("address")
    if isinstance(address, str):
        return address.strip() or None
    if not isinstance(address, dict):
        return None
    parts = [
        address.get("addressLocality"),
        address.get("addressRegion"),
        address.get("addressCountry"),
    ]
    text = ", ".join(str(part).strip() for part in parts if part)
    return text or None


def _salary_text(job: dict[str, Any]) -> str | None:
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


def parse_seek_job_page(html: str, *, source_url: str) -> SeekJobPage:
    """Parse a SEEK job page using schema.org JobPosting JSON-LD."""
    validate_seek_url(source_url)
    parser = _JsonLdExtractor()
    parser.feed(html)

    posting: dict[str, Any] | None = None
    for block in parser.blocks:
        if not block:
            continue
        try:
            payload = json.loads(block)
        except json.JSONDecodeError:
            continue
        posting = _find_job_posting(payload)
        if posting:
            break

    if not posting:
        raise ValueError("No JobPosting JSON-LD found")

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


def fetch_seek_job(url: str, *, timeout: float = 15.0) -> SeekJobPage:
    """Fetch and parse a canonical SEEK job URL."""
    validate_seek_url(url)
    headers = {"User-Agent": "JobPilot/0.3 (+https://github.com/SeanGao-119/jobpilot)"}
    with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        final_url = str(response.url)
        validate_seek_url(final_url)
        return parse_seek_job_page(response.text, source_url=final_url)
