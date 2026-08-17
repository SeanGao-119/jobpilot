from services.analysis.requirements import extract_requirements


def test_extract_requirements_splits_required_and_preferred() -> None:
    description = """
    You must have Python, SQL and data pipeline experience.
    Databricks is preferred and Microsoft Fabric would be a nice to have.
    Experience with Git is essential.
    """

    result = extract_requirements(description)

    assert result.required_skills == ("ETL", "Git", "Python", "SQL")
    assert result.preferred_skills == ("Databricks", "Microsoft Fabric")
    assert "Databricks" in result.detected_skills
