import pytest

from services.ingestion.seek_link import SeekUrlError, extract_seek_job_id, validate_seek_url


def test_extract_seek_job_id_from_legacy_canonical_url() -> None:
    url = "https://www.seek.co.nz/job/12345678?type=standard"
    assert extract_seek_job_id(url) == "12345678"


def test_extract_seek_job_id_from_current_nz_url() -> None:
    url = "https://nz.seek.com/job/87654321?type=standard"
    assert extract_seek_job_id(url) == "87654321"


def test_tracking_host_is_allowed() -> None:
    validate_seek_url("https://email.s.seek.co.nz/uni/ss/c/example")


def test_nested_seek_subdomain_is_allowed() -> None:
    validate_seek_url("https://tracking.email.s.seek.co.nz/redirect/example")


def test_current_seek_nz_host_is_allowed() -> None:
    validate_seek_url("https://nz.seek.com/job/12345678")


def test_non_seek_host_is_rejected() -> None:
    with pytest.raises(SeekUrlError, match="example.com"):
        validate_seek_url("https://example.com/job/12345678")


def test_lookalike_seek_hosts_are_rejected() -> None:
    with pytest.raises(SeekUrlError):
        validate_seek_url("https://seek.co.nz.example.com/job/12345678")
    with pytest.raises(SeekUrlError):
        validate_seek_url("https://seek.com.example.com/job/12345678")
