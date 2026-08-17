from services.analysis.requirements import ExtractedRequirements
from services.matching.scorer import MatchScore, RequirementMatch
from services.pipeline.rank_email import RankedSeekJob
from services.storage.records import job_record_from_ranked, match_record_from_ranked


def _ranked_job() -> RankedSeekJob:
    return RankedSeekJob(
        external_id="abc123",
        seek_job_id="12345678",
        seek_url="https://www.seek.co.nz/job/12345678",
        title="Data Engineer",
        company="Example Co",
        location="Auckland, NZ",
        salary_text="NZD 100000 YEAR",
        employment_type="FULL_TIME",
        description="Required Python and SQL. Databricks is preferred.",
        requirements=ExtractedRequirements(
            required_skills=("Python", "SQL"),
            preferred_skills=("Databricks",),
            detected_skills=("Databricks", "Python", "SQL"),
        ),
        match=MatchScore(
            overall_score=78.5,
            technical_score=80.0,
            experience_score=75.0,
            education_score=90.0,
            domain_score=65.0,
            seniority_score=85.0,
            location_score=100.0,
            work_rights_score=100.0,
            recommendation="consider",
            requirements=(
                RequirementMatch("Python", "matched", ("skill:Python (verified)",)),
                RequirementMatch("SQL", "partial", ("project:SQL toolkit",)),
                RequirementMatch("Databricks", "gap", ()),
            ),
        ),
    )


def test_job_record_preserves_jd_and_source_identity() -> None:
    record = job_record_from_ranked(_ranked_job(), source_message_id="gmail-message")

    assert record["source"] == "seek_email"
    assert record["source_external_id"] == "12345678"
    assert record["source_message_id"] == "gmail-message"
    assert record["jd_raw"].startswith("Required Python")
    assert record["requirements"]["preferred_skills"] == ("Databricks",)


def test_match_record_separates_evidence_and_gaps() -> None:
    record = match_record_from_ranked(
        _ranked_job(),
        job_id="job-uuid",
        profile_version="profile-v1",
    )

    assert record["job_id"] == "job-uuid"
    assert record["recommendation"] == "consider"
    assert record["matched_evidence"][0]["requirement"] == "Python"
    assert record["partial_evidence"][0]["requirement"] == "SQL"
    assert record["gaps"] == [{"requirement": "Databricks"}]
