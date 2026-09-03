from __future__ import annotations

from typing import Any

import httpx
import psycopg

from services.ingestion.job_page import fetch_public_job, public_job_identity
from services.ingestion.models import JobRecommendation
from services.ingestion.seek_job import SeekJobPage, fetch_seek_job
from services.ingestion.seek_link import ResolvedSeekLink, extract_seek_job_id
from services.pipeline.rank_email import RankBatchResult, RankFailure, _rank_one
from services.storage.postgres import PostgresJobRepository


def _identity_resolver(url: str) -> ResolvedSeekLink:
    return ResolvedSeekLink(
        input_url=url,
        final_url=url,
        seek_job_id=extract_seek_job_id(url),
    )


def _public_identity_resolver(url: str) -> ResolvedSeekLink:
    identity = public_job_identity(url)
    return ResolvedSeekLink(
        input_url=url,
        final_url=identity.canonical_url,
        seek_job_id=identity.external_id,
    )


def sync_manual_job_urls(
    *,
    database_url: str,
    profile: dict[str, Any],
    profile_version: str,
    limit: int = 25,
) -> dict[str, Any]:
    """Analyze supported manual URL imports that do not have a match record yet."""
    with psycopg.connect(database_url) as conn:
        rows = conn.execute(
            """
            select j.source_url, j.company, j.source::text, j.platform::text,
                   j.title, j.location, j.employment_type, j.salary_text, j.jd_clean
            from jobs j
            left join job_matches jm on jm.job_id = j.id
            where j.source in (
                'seek_url'::job_source, 'linkedin_url'::job_source,
                'zeil_url'::job_source, 'trademe_url'::job_source
              )
              and j.opportunity_kind = 'job'::opportunity_kind
              and j.source_url is not null
              and jm.id is null
            order by j.discovered_at asc
            limit %s
            """,
            (max(1, limit),),
        ).fetchall()

    repository = PostgresJobRepository(database_url)
    processed: list[str] = []
    failures: list[dict[str, str]] = []

    for source_url, company, source, platform, title, location, employment_type, salary_text, description in rows:
        recommendation = JobRecommendation(
            source_url=str(source_url),
            company=str(company or "SEEK job"),
        )
        try:
            is_seek = source == "seek_url"
            def public_fetcher(
                url: str,
                fallback_title: Any = title,
                fallback_company: Any = company,
                fallback_location: Any = location,
                fallback_employment_type: Any = employment_type,
                fallback_salary: Any = salary_text,
                fallback_description: Any = description,
            ) -> SeekJobPage:
                try:
                    return fetch_public_job(url)
                except (httpx.HTTPError, ValueError, OSError):
                    if not fallback_description or len(str(fallback_description).strip()) < 40:
                        raise
                    identity = public_job_identity(url)
                    return SeekJobPage(
                        source_url=identity.canonical_url,
                        seek_job_id=identity.external_id,
                        title=str(fallback_title),
                        company=str(fallback_company),
                        location=str(fallback_location) if fallback_location else None,
                        employment_type=(
                            str(fallback_employment_type) if fallback_employment_type else None
                        ),
                        salary_text=str(fallback_salary) if fallback_salary else None,
                        description=str(fallback_description),
                        date_posted=None,
                        valid_through=None,
                    )

            ranked = _rank_one(
                recommendation,
                profile,
                _identity_resolver if is_seek else _public_identity_resolver,
                fetch_seek_job if is_seek else public_fetcher,
            )
            batch = RankBatchResult(
                advertised_count=1,
                parsed_count=1,
                ranked_count=1,
                failed_count=0,
                jobs=(ranked,),
                failures=(),
            )
            ids = repository.persist_batch(
                batch,
                source_message_id=None,
                profile_version=profile_version,
                prompt_version="deterministic-v1",
                source=source,
                ingestion_mode="manual",
                source_category="manual_url",
                platform=platform,
                opportunity_kind="job",
            )
            processed.extend(ids)
        except (httpx.HTTPError, ValueError, OSError) as exc:
            failure = RankFailure(
                external_id=recommendation.external_id,
                company=recommendation.company,
                error_type=type(exc).__name__,
                message=str(exc)[:240],
            )
            failures.append(
                {
                    "external_id": failure.external_id,
                    "company": failure.company,
                    "error_type": failure.error_type,
                    "message": failure.message,
                }
            )

    return {
        "pending_found": len(rows),
        "processed_count": len(processed),
        "failed_count": len(failures),
        "job_ids": processed,
        "failures": failures,
    }


def sync_manual_seek_urls(
    *,
    database_url: str,
    profile: dict[str, Any],
    profile_version: str,
    limit: int = 25,
) -> dict[str, Any]:
    """Backward-compatible alias for the expanded manual opportunity sync."""
    return sync_manual_job_urls(
        database_url=database_url,
        profile=profile,
        profile_version=profile_version,
        limit=limit,
    )
