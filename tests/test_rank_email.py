from services.ingestion.seek_job import SeekJobPage
from services.ingestion.seek_link import ResolvedSeekLink
from services.pipeline.rank_email import rank_seek_email

EMAIL_BODY = """
[Acme Data
Auckland CBD, Auckland (Hybrid)

- Build reliable pipelines](https://email.s.seek.co.nz/job-a)
[Legacy Data
Auckland, Auckland

- Lead platform migration](https://email.s.seek.co.nz/job-b)
[Broken Co
Auckland, Auckland

- Data engineering role](https://email.s.seek.co.nz/job-c)
"""

PROFILE = {
    "experience": [
        {"start": "2020-09", "end": "2021-01"},
        {"start": "2021-06", "end": "2021-10"},
        {"start": "2021-10", "end": "2022-04"},
    ],
    "skills": {
        "languages": {"verified": ["Python", "SQL"]},
        "data": {"verified": ["ETL"]},
    },
    "projects": [],
}


def _resolver(url: str) -> ResolvedSeekLink:
    mapping = {
        "https://email.s.seek.co.nz/job-a": "https://www.seek.co.nz/job/11111111",
        "https://email.s.seek.co.nz/job-b": "https://www.seek.co.nz/job/22222222",
        "https://email.s.seek.co.nz/job-c": "https://www.seek.co.nz/job/33333333",
    }
    final = mapping[url]
    return ResolvedSeekLink(input_url=url, final_url=final, seek_job_id=final.rsplit("/", 1)[1])


def _fetcher(url: str) -> SeekJobPage:
    if url.endswith("33333333"):
        raise RuntimeError("synthetic fetch failure")
    if url.endswith("11111111"):
        return SeekJobPage(
            source_url=url,
            seek_job_id="11111111",
            title="Data Engineer",
            company="Acme Data",
            location="Auckland CBD, Auckland, NZ",
            employment_type="FULL_TIME",
            salary_text=None,
            description="Required Python, SQL and data pipelines experience.",
            date_posted="2026-08-16",
            valid_through=None,
        )
    return SeekJobPage(
        source_url=url,
        seek_job_id="22222222",
        title="Senior Data Engineer",
        company="Legacy Data",
        location="Auckland, NZ",
        employment_type="FULL_TIME",
        salary_text=None,
        description="Requires 5 years of experience with Azure, Databricks and Microsoft Fabric.",
        date_posted="2026-08-16",
        valid_through=None,
    )


def test_rank_seek_email_sorts_and_isolates_failures() -> None:
    result = rank_seek_email(
        subject="Data Engineer + 2 new jobs",
        body=EMAIL_BODY,
        profile=PROFILE,
        max_workers=2,
        resolver=_resolver,
        fetcher=_fetcher,
    )

    assert result.advertised_count == 3
    assert result.parsed_count == 3
    assert result.ranked_count == 2
    assert result.failed_count == 1
    assert result.jobs[0].company == "Acme Data"
    assert result.jobs[0].match.overall_score > result.jobs[1].match.overall_score
    assert result.jobs[1].match.experience_score < 30
    assert result.failures[0].company == "Broken Co"
    assert "synthetic fetch failure" in result.failures[0].message
