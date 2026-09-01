from services.ingestion.seek_email import classify_seek_email


def test_classifies_job_alert_subject() -> None:
    assert classify_seek_email("Your job alert: 12 new data jobs") == "job_alert"


def test_classifies_recommendation_subject() -> None:
    assert classify_seek_email("Recommended jobs for you") == "recommendation"


def test_defaults_existing_seek_email_format_to_recommendation() -> None:
    assert classify_seek_email("Data Engineer + 5 new jobs") == "recommendation"
