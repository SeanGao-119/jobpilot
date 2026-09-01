from __future__ import annotations

from typing import Any

import httpx
import psycopg

from services.ingestion.models import JobRecommendation
from services.ingestion.seek_job import fetch_seek_job
from services.ingestion.seek_link import ResolvedSeekLink, extract_seek_job_id
from services.pipeline.rank_email import RankBatchResult, RankFailure, _rank_one
from services.storage.postgres import PostgresJobRepository


def _identity_resolver(url: str) -> ResolvedSeekLink:
    return ResolvedSeekLink(
        input_url=url,
        final_url=url,
        seek_job_id=extract_seek_job_id(url),
    )


def sync_manual_seek_urls(
    *,
    database_url: str,
    profile: dict[str, Any],
    profile_version: str,
    limit: int = 25,
) -> dict[str, Any]:
    """Analyze manual URL imports that do not have a match record yet."""
    with psycopg.connect(database_url) as conn:
        rows = conn.execute(
            """
            select j.source_url, j.company
            from jobs j
            left join job_matches jm on jm.job_id = j.id
            where j.source = 'seek_url'::job_source
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

    for source_url, company in rows:
        recommendation = JobRecommendation(
            source_url=str(source_url),
            company=str(company or "SEEK job"),
        )
        try:
            ranked = _rank_one(
                recommendation,
                profile,
                _identity_resolver,
                fetch_seek_job,
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
                source="seek_url",
                ingestion_mode="manual",
                source_category="manual_url",
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
