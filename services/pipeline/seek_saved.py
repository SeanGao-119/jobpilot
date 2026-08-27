from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict
from typing import Any

import httpx
import psycopg
from psycopg.types.json import Jsonb

from services.ingestion.models import JobRecommendation
from services.ingestion.seek_job import fetch_seek_job
from services.ingestion.seek_link import ResolvedSeekLink, extract_seek_job_id
from services.ingestion.seek_saved import parse_saved_seek_urls
from services.pipeline.rank_email import RankBatchResult, RankedSeekJob, RankFailure, _rank_one
from services.storage.records import job_record_from_ranked, match_record_from_ranked


_JOB_INSERT_SQL = """
insert into jobs (
  source, source_external_id, source_url, source_message_id,
  title, company, location, employment_type, salary_text,
  jd_raw, jd_clean, requirements
) values (
  %(source)s, %(source_external_id)s, %(source_url)s, %(source_message_id)s,
  %(title)s, %(company)s, %(location)s, %(employment_type)s, %(salary_text)s,
  %(jd_raw)s, %(jd_clean)s, %(requirements)s
)
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
"""


def _identity_resolver(url: str) -> ResolvedSeekLink:
    return ResolvedSeekLink(input_url=url, final_url=url, seek_job_id=extract_seek_job_id(url))


def rank_saved_seek_jobs(
    *,
    urls: list[str] | tuple[str, ...],
    profile: Mapping,
) -> RankBatchResult:
    """Fetch and rank SEEK jobs collected from the signed-in Saved Jobs page."""
    saved = parse_saved_seek_urls(urls)
    jobs: list[RankedSeekJob] = []
    failures: list[RankFailure] = []

    for item in saved:
        recommendation = JobRecommendation(
            source_url=item.source_url,
            company="SEEK saved job",
        )
        try:
            jobs.append(
                _rank_one(
                    recommendation,
                    profile,
                    _identity_resolver,
                    fetch_seek_job,
                )
            )
        except (httpx.HTTPError, OSError, ValueError) as exc:
            failures.append(
                RankFailure(
                    external_id=item.seek_job_id,
                    company="SEEK saved job",
                    error_type=type(exc).__name__,
                    message=str(exc)[:240],
                )
            )

    jobs.sort(key=lambda job: (-job.match.overall_score, job.company.lower(), job.title.lower()))
    return RankBatchResult(
        advertised_count=len(saved),
        parsed_count=len(saved),
        ranked_count=len(jobs),
        failed_count=len(failures),
        jobs=tuple(jobs),
        failures=tuple(failures),
    )


def _json_payload(record: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    payload = dict(record)
    for field in fields:
        payload[field] = Jsonb(payload[field])
    return payload


def persist_saved_seek_jobs(
    *,
    database_url: str,
    batch: RankBatchResult,
    profile_version: str,
    prompt_version: str = "deterministic-v1",
) -> dict[str, Any]:
    """Persist saved jobs while deduplicating against jobs discovered from other sources."""
    imported: list[str] = []
    existing: list[str] = []

    with psycopg.connect(database_url) as conn:
        for job in batch.jobs:
            row = conn.execute(
                """
                select id
                from jobs
                where source_external_id = %s
                  and source_url like '%%seek%%'
                order by created_at asc
                limit 1
                """,
                (job.seek_job_id,),
            ).fetchone()

            if row:
                job_id = str(row[0])
                existing.append(job_id)
            else:
                job_record = job_record_from_ranked(job, source="seek_saved")
                row = conn.execute(
                    _JOB_INSERT_SQL,
                    _json_payload(job_record, ("requirements",)),
                ).fetchone()
                if not row:
                    raise RuntimeError("saved job insert did not return an id")
                job_id = str(row[0])
                imported.append(job_id)

            conn.execute(
                """
                insert into job_sources (
                  job_id, source, source_external_id, source_url, metadata
                ) values (%s, 'seek_saved'::job_source, %s, %s, %s)
                on conflict (job_id, source) do update set
                  source_external_id = excluded.source_external_id,
                  source_url = excluded.source_url,
                  discovered_at = now(),
                  metadata = excluded.metadata
                """,
                (
                    job_id,
                    job.seek_job_id,
                    job.seek_url,
                    Jsonb({"saved": True}),
                ),
            )

            match_record = match_record_from_ranked(
                job,
                job_id=job_id,
                profile_version=profile_version,
                prompt_version=prompt_version,
            )
            conn.execute(
                _MATCH_UPSERT_SQL,
                _json_payload(
                    match_record,
                    ("matched_evidence", "partial_evidence", "gaps"),
                ),
            )

    return {
        "ranked_count": batch.ranked_count,
        "failed_count": batch.failed_count,
        "imported_count": len(imported),
        "existing_count": len(existing),
        "imported_job_ids": imported,
        "existing_job_ids": existing,
        "failures": [asdict(item) for item in batch.failures],
    }
