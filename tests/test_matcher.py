import yaml

from services.matching.scorer import recommendation_for, score_job


def _profile():
    with open("resume/facts/profile.yaml", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def test_matcher_uses_verified_profile_evidence():
    result = score_job(
        profile=_profile(),
        required_skills=["Python", "SQL", "ETL", "Linux"],
        preferred_skills=["Docker", "Databricks"],
        experience_score=78,
        education_score=95,
        domain_score=70,
        seniority_score=75,
    )

    statuses = {item.requirement: item.status for item in result.requirements}
    assert statuses["Python"] == "matched"
    assert statuses["SQL"] == "matched"
    assert statuses["Linux"] == "matched"
    assert statuses["Databricks"] == "gap"
    assert 0 <= result.overall_score <= 100


def test_recommendation_thresholds():
    assert recommendation_for(80) == "apply"
    assert recommendation_for(65) == "consider"
    assert recommendation_for(45) == "low"
    assert recommendation_for(44.99) == "skip"
