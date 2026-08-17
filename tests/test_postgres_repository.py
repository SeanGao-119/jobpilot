from contextlib import AbstractContextManager

from psycopg.types.json import Jsonb

from services.analysis.requirements import ExtractedRequirements
from services.matching.scorer import MatchScore
from services.pipeline.rank_email import RankBatchResult, RankedSeekJob
from services.storage.postgres import PostgresJobRepository


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeConnection(AbstractContextManager):
    def __init__(self):
        self.calls = []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.closed = True
        return False

    def execute(self, sql, params):
        self.calls.append((sql, params))
        if "insert into jobs" in sql:
            return _Result(("job-uuid-1",))
        return _Result(("match-uuid-1",))


def _ranked_job() -> RankedSeekJob:
    return RankedSeekJob(
        external_id="mail-card-1",
        seek_job_id="12345678",
        seek_url="https://www.seek.co.nz/job/12345678",
        title="Data Engineer",
        company="Example Co",
        location="Auckland, NZ",
        salary_text=None,
        employment_type="FULL_TIME",
        description="Required Python and SQL.",
        requirements=ExtractedRequirements(
            required_skills=("Python", "SQL"),
            preferred_skills=(),
            detected_skills=("Python", "SQL"),
        ),
        match=MatchScore(
            overall_score=80.0,
            technical_score=90.0,
            experience_score=75.0,
            education_score=90.0,
            domain_score=65.0,
            seniority_score=85.0,
            location_score=100.0,
            work_rights_score=100.0,
            recommendation="apply",
            requirements=(),
        ),
    )


def test_repository_uses_idempotent_upserts_and_jsonb() -> None:
    connection = _FakeConnection()
    repository = PostgresJobRepository("postgresql://example", connect=lambda _: connection)
    batch = RankBatchResult(
        advertised_count=1,
        parsed_count=1,
        ranked_count=1,
        failed_count=0,
        jobs=(_ranked_job(),),
        failures=(),
    )

    job_ids = repository.persist_batch(
        batch,
        source_message_id="gmail-message",
        profile_version="sha256:abc123",
        prompt_version="deterministic-v1",
    )

    assert job_ids == ("job-uuid-1",)
    assert connection.closed is True
    assert len(connection.calls) == 2

    job_sql, job_params = connection.calls[0]
    assert "on conflict (source, source_external_id)" in job_sql.lower()
    assert job_params["source_external_id"] == "12345678"
    assert isinstance(job_params["requirements"], Jsonb)

    match_sql, match_params = connection.calls[1]
    assert "on conflict (job_id, profile_version)" in match_sql.lower()
    assert match_params["job_id"] == "job-uuid-1"
    assert isinstance(match_params["matched_evidence"], Jsonb)
    assert isinstance(match_params["gaps"], Jsonb)


def test_repository_rejects_empty_database_url() -> None:
    try:
        PostgresJobRepository("   ")
    except ValueError as exc:
        assert "database_url" in str(exc)
    else:
        raise AssertionError("expected ValueError")
