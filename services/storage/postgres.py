from __future__ import annotations

from collections.abc import Callable
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from services.pipeline.rank_email import RankBatchResult, RankedSeekJob
from services.storage.records import job_record_from_ranked, match_record_from_ranked

ConnectFn = Callable[[str], Any]

_JOB_UPSERT_SQL = """
insert into jobs (
  source, source_external_id, source_url, source_message_id,
  title, company, location, employment_type, salary_text,
  jd_raw, jd_clean, requirements
) values (
  %(source)s, %(source_external_id)s, %(source_url)s, %(source_message_id)s,
  %(title)s, %(company)s, %(location)s, %(employment_type)s, %(salary_text)s,
  %(jd_raw)s, %(jd_clean)s, %(requirements)s
)
on conflict (source, source_external_id) do update set
  source_url = excluded.source_url,
  source_message_id = excluded.source_message_id,
  title = excluded.title,
  company = excluded.company,
  location = excluded.location,
  employment_type = excluded.employment_type,
  salary_text = excluded.salary_text,
  jd_raw = excluded.jd_raw,
  jd_clean = excluded.jd_clean,
  requirements = excluded.requirements,
  updated_at = now()
returning id
"""

_MATCH_UPSERT_SQL = """
insert into job_matches (
  job_id, profile_version, prompt_version,
  overall_score, technical_score, experience_score, education_score,
  domain_score, seniority_score, location_score, work_rights_score,
  recommendation, matched_evidence, partial_evidence, gaps, explanation
) values (
  %(job_id)s, %(profile_version)s, %(prompt_version)s,
  %(overall_score)s, %(technical_score)s, %(experience_score)s, %(education_score)s,
  %(domain_score)s, %(seniority_score)s, %(location_score)s, %(work_rights_score)s,
  %(recommendation)s, %(matched_evidence)s, %(partial_evidence)s, %(gaps)s, %(explanation)s
)
on conflict (job_id, profile_version) do update set
  prompt_version = excluded.prompt_version,
  overall_score = excluded.overall_score,
  technical_score = excluded.technical_score,
  experience_score = excluded.experience_score,
  education_score = excluded.education_score,
  domain_score = excluded.domain_score,
  seniority_score = excluded.seniority_score,
  location_score = excluded.location_score,
  work_rights_score = excluded.work_rights_score,
  recommendation = excluded.recommendation,
  matched_evidence = excluded.matched_evidence,
  partial_evidence = excluded.partial_evidence,
  gaps = excluded.gaps,
  explanation = excluded.explanation,
  created_at = now()
returning id
"""


def _jsonb_fields(record: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    payload = dict(record)
    for field in fields:
        payload[field] = Jsonb(payload[field])
    return payload


class PostgresJobRepository:
    """Persist ranked jobs into PostgreSQL using idempotent upserts."""

    def __init__(self, database_url: str, *, connect: ConnectFn = psycopg.connect) -> None:
        if not database_url.strip():
            raise ValueError("database_url must not be empty")
        self.database_url = database_url
        self._connect = connect

    def persist_batch(
        self,
        batch: RankBatchResult,
        *,
        source_message_id: str | None,
        profile_version: str,
        prompt_version: str | None = None,
    ) -> tuple[str, ...]:
        """Persist a ranked batch atomically and return database job ids."""
        job_ids: list[str] = []
        with self._connect(self.database_url) as conn:
            for job in batch.jobs:
                job_ids.append(
                    self._persist_job(
                        conn,
                        job,
                        source_message_id=source_message_id,
                        profile_version=profile_version,
                        prompt_version=prompt_version,
                    )
                )
        return tuple(job_ids)

    @staticmethod
    def _persist_job(
        conn: Any,
        job: RankedSeekJob,
        *,
        source_message_id: str | None,
        profile_version: str,
        prompt_version: str | None,
    ) -> str:
        job_record = job_record_from_ranked(job, source_message_id=source_message_id)
        job_payload = _jsonb_fields(job_record, ("requirements",))
        row = conn.execute(_JOB_UPSERT_SQL, job_payload).fetchone()
        if not row:
            raise RuntimeError("job upsert did not return an id")
        job_id = str(row[0])

        match_record = match_record_from_ranked(
            job,
            job_id=job_id,
            profile_version=profile_version,
            prompt_version=prompt_version,
        )
        match_payload = _jsonb_fields(
            match_record,
            ("matched_evidence", "partial_evidence", "gaps"),
        )
        conn.execute(_MATCH_UPSERT_SQL, match_payload).fetchone()
        return job_id
