from services.ingestion.linkedin_email import classify_linkedin_email, parse_linkedin_job_email


def test_linkedin_alert_classification_and_job_cards() -> None:
    body = """
[Data Engineer
Acme Analytics
Christchurch, Canterbury](https://www.linkedin.com/jobs/view/data-engineer-4123456789?trk=email)

[Platform Engineer
Example Cloud
Remote](https://www.linkedin.com/comm/jobs/view/4987654321?trackingId=abc)

[View all jobs](https://www.linkedin.com/jobs/collections/)
"""
    result = parse_linkedin_job_email(
        subject="Your job alert for Data Engineer in New Zealand",
        body=body,
        message_id="linkedin-message-1",
    )

    assert classify_linkedin_email("Your job alert for Data Engineer") == "job_alert"
    assert len(result.recommendations) == 2
    assert result.recommendations[0].title_hint == "Data Engineer"
    assert result.recommendations[0].company == "Acme Analytics"
    assert result.recommendations[1].location == "Remote"


def test_linkedin_recommendation_classification() -> None:
    assert classify_linkedin_email("Jobs you may be interested in") == "recommendation"
