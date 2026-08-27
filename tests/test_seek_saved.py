from __future__ import annotations

import pytest

from services.ingestion.seek_link import SeekUrlError
from services.ingestion.seek_saved import canonicalize_saved_seek_url, parse_saved_seek_urls


def test_canonicalizes_seek_saved_url_and_strips_tracking_query() -> None:
    item = canonicalize_saved_seek_url(
        "https://www.seek.co.nz/job/91234567?type=standard&ref=search-standalone"
    )
    assert item.seek_job_id == "91234567"
    assert item.source_url == "https://www.seek.co.nz/job/91234567"


def test_deduplicates_saved_urls_by_seek_job_id() -> None:
    items = parse_saved_seek_urls(
        [
            "https://www.seek.co.nz/job/91234567",
            "https://www.seek.co.nz/job/91234567?tracking=1",
            "https://www.seek.co.nz/job/97654321",
        ]
    )
    assert [item.seek_job_id for item in items] == ["91234567", "97654321"]


def test_rejects_non_seek_host() -> None:
    with pytest.raises(SeekUrlError):
        canonicalize_saved_seek_url("https://example.com/job/91234567")
