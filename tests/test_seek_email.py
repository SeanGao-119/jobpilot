from services.ingestion.seek_email import parse_seek_recommendation_email, parse_subject


def test_parse_subject_counts_primary_plus_new_jobs():
    assert parse_subject("Senior Data Engineer + 11 new jobs") == ("Senior Data Engineer", 12)


def test_parse_seek_email_extracts_jobs_and_dedupes():
    body = """
[logo

Skills Group
Ellerslie, Auckland (Hybrid)
Salary + Benefits

- Lead and scale a modern Azure Databricks data platform.
- Hybrid working plus medical insurance.
Recently posted](https://email.s.seek.co.nz/job-a)

[logo

Massey University
Auckland (Hybrid)
$83818 - $117788 p.a.

- Build and optimise data pipelines and warehouses.
Recently posted](https://email.s.seek.co.nz/job-b)

[View more jobs](https://email.s.seek.co.nz/more)
"""
    result = parse_seek_recommendation_email(
        subject="Senior Data Engineer + 11 new jobs", body=body, message_id="gmail-1"
    )

    assert result.advertised_count == 12
    assert len(result.recommendations) == 2
    first, second = result.recommendations
    assert first.company == "Skills Group"
    assert first.location == "Ellerslie, Auckland (Hybrid)"
    assert first.work_arrangement == "Hybrid"
    assert first.title_hint == "Senior Data Engineer"
    assert first.source_message_id == "gmail-1"
    assert second.company == "Massey University"
    assert second.salary_text == "$83818 - $117788 p.a."
    assert second.title_hint is None


def test_parse_seek_alert_accepts_direct_job_link_with_short_label():
    body = """
[Data Analyst](https://www.seek.co.nz/job/12345678)
[Privacy](https://www.seek.co.nz/privacy)
"""

    result = parse_seek_recommendation_email(
        subject="New jobs for Data Analyst",
        body=body,
        message_id="gmail-alert-1",
    )

    assert len(result.recommendations) == 1
    recommendation = result.recommendations[0]
    assert recommendation.source_url == "https://www.seek.co.nz/job/12345678"
    assert recommendation.source_message_id == "gmail-alert-1"
