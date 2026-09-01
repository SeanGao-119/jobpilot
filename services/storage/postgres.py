from __future__ import annotations

import time
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
  ingestion_mode, source_category,
  title, company, location, employment_type, salary_text,
  jd_raw, jd_clean, requirements
) values (
  %(source)s, %(source_external_id)s, %(source_url)s, %(source_message_id)s,
  %(ingestion_mode)s::ingestion_mode, %(source_category)s::source_category,
  %(title)s, %(company)s, %(location)s, %(employment_type)s, %(salary_text)s,
  %(jd_raw)s, %(jd_clean)s, %(requirements)s
)
on conflict (source, source_external_id) do update set
  source_url = excluded.source_url,
  source_message_id = excluded.source_message_id,
  ingestion_mode = excluded.ingestion_mode,
  source_category = excluded.source_category,
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

_MARK_APPLIED_SQL = """
with target_job as (
  select id
  from jobs
  where lower(company) = lower(%(company)s)
    and lower(title) = lower(%(title)s)
  order by discovered_at desc
  limit 1
), upserted as (
  insert into applications (job_id, status, applied_at, application_method, updated_at)
  select id, 'applied'::application_status, now(), %(application_method)s, now()
  from target_job
  on conflict (job_id) do update set
    status = 'applied'::application_status,
    applied_at = coalesce(applications.applied_at, now()),
    application_method = coalesce(excluded.application_method, applications.application_method),
    updated_at = now()
  returning id, job_id, applied_at
)
select id, job_id, applied_at from upserted
"""


def _jsonb_fields(record: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    payload = dict(record)
    for field in fields:
        payload[field] = Jsonb(payload[field])
    return payload


class PostgresJobRepository:
    """Persist ranked jobs and application state into PostgreSQL."""

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
        source: str = "seek_email",
        ingestion_mode: str = "automatic",
        source_category: str = "recommendation",
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
                        source=source,
                        ingestion_mode=ingestion_mode,
                        source_category=source_category,
                    )
                )
        return tuple(job_ids)

    def persist_batch_resilient(
        self,
        batch: RankBatchResult,
        *,
        source_message_id: str | None,
        profile_version: str,
        prompt_version: str | None = None,
        statement_timeout_ms: int = 60000,
        retries: int = 3,
        source: str = "seek_email",
        ingestion_mode: str = "automatic",
        source_category: str = "recommendation",
    ) -> tuple[tuple[str, ...], tuple[dict[str, str], ...]]:
        """Persist jobs independently, retrying transient PostgreSQL query cancellations."""
        job_ids: list[str] = []
        failures: list[dict[str, str]] = []
        timeout_value = f"{max(statement_timeout_ms, 1000)}ms"

        for job in batch.jobs:
            last_error: Exception | None = None
            for attempt in range(1, max(retries, 1) + 1):
                try:
                    with self._connect(self.database_url) as conn:
                        conn.execute(
                            "select set_config('statement_timeout', %s, true)",
                            (timeout_value,),
                        )
                        job_ids.append(
                            self._persist_job(
                                conn,
                                job,
                                source_message_id=source_message_id,
                                profile_version=profile_version,
                                prompt_version=prompt_version,
                                source=source,
                                ingestion_mode=ingestion_mode,
                                source_category=source_category,
                            )
                        )
                    last_error = None
                    break
                except psycopg.errors.QueryCanceled as exc:
                    last_error = exc
                    if attempt < retries:
                        time.sleep(min(2 ** (attempt - 1), 4))
                        continue
                    break
                except psycopg.Error as exc:
                    last_error = exc
                    break

            if last_error is not None:
                failures.append(
                    {
                        "title": job.title or "Unknown role",
                        "company": job.company or "Unknown company",
                        "source_url": job.seek_url or "",
                        "error": str(last_error),
                    }
                )

        return tuple(job_ids), tuple(failures)

    def mark_applied_by_company_title(
        self,
        *,
        company: str,
        title: str,
        application_method: str = "seek",
    ) -> dict[str, str]:
        """Mark the newest matching job as applied and record an application event."""
        with self._connect(self.database_url) as conn:
            row = conn.execute(
                _MARK_APPLIED_SQL,
                {
                    "company": company,
                    "title": title,
                    "application_method": application_method,
                },
            ).fetchone()
            if not row:
                raise ValueError(f"No matching job found for {company} / {title}")

            application_id, job_id, applied_at = row
            conn.execute(
                """
                insert into application_events (
                  application_id, event_type, to_status, source, details, occurred_at
                ) values (
                  %s, 'application_submitted', 'applied'::application_status,
                  'manual', %s, %s
                )
                """,
                (
                    application_id,
                    Jsonb({"application_method": application_method}),
                    applied_at,
                ),
            )
            return {
                "application_id": str(application_id),
                "job_id": str(job_id),
                "status": "applied",
                "applied_at": applied_at.isoformat(),
            }

    @staticmethod
    def _persist_job(
        conn: Any,
        job: RankedSeekJob,
        *,
        source_message_id: str | None,
        profile_version: str,
        prompt_version: str | None,
        source: str,
        ingestion_mode: str,
        source_category: str,
    ) -> str:
        job_record = job_record_from_ranked(
            job,
            source_message_id=source_message_id,
            source=source,
            ingestion_mode=ingestion_mode,
            source_category=source_category,
        )
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
