from __future__ import annotations

from dataclasses import asdict
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from services.ingestion.gmail_seek import fetch_seek_messages
from services.pipeline.rank_email import rank_seek_email
from services.storage.postgres import PostgresJobRepository


def _message_processed(database_url: str, message_id: str) -> bool:
    with psycopg.connect(database_url) as conn:
        return bool(
            conn.execute(
                "select 1 from jobs where source_message_id = %s limit 1",
                (message_id,),
            ).fetchone()
        )


def sync_seek_gmail(
    *,
    database_url: str,
    profile: dict[str, Any],
    profile_version: str,
    query: str | None = None,
    limit: int = 25,
    workers: int = 4,
) -> dict[str, Any]:
    repository = PostgresJobRepository(database_url)
    messages = fetch_seek_messages(query=query, limit=limit)
    output: dict[str, Any] = {
        "messages_found": len(messages),
        "messages_skipped": 0,
        "messages_processed": 0,
        "persisted_jobs": 0,
        "failed_jobs": 0,
        "database_failures": 0,
        "messages": [],
    }

    for message in reversed(messages):
        if _message_processed(database_url, message.message_id):
            output["messages_skipped"] += 1
            continue

        try:
            result = rank_seek_email(
                subject=message.subject,
                body=message.body,
                message_id=message.message_id,
                profile=profile,
                max_workers=workers,
            )
        except Exception as exc:
            output["messages_processed"] += 1
            output["failed_jobs"] += 1
            output["messages"].append(
                {
                    "message_id": message.message_id,
                    "subject": message.subject,
                    "ranked_count": 0,
                    "failed_count": 1,
                    "failures": [{"stage": "ranking", "error": str(exc)}],
                }
            )
            continue

        item = {
            "message_id": message.message_id,
            "subject": message.subject,
            "ranked_count": result.ranked_count,
            "failed_count": result.failed_count,
            "failures": [asdict(failure) for failure in result.failures],
        }

        if result.ranked_count:
            ids, db_failures = repository.persist_batch_resilient(
                result,
                source_message_id=message.message_id,
                profile_version=profile_version,
                prompt_version="deterministic-v1",
                statement_timeout_ms=60000,
                retries=3,
            )
            item["job_ids"] = list(ids)
            item["database_failures"] = list(db_failures)
            output["persisted_jobs"] += len(ids)
            output["database_failures"] += len(db_failures)

        output["failed_jobs"] += result.failed_count
        output["messages_processed"] += 1
        output["messages"].append(item)

    return output


def cleanup_stale_jobs(
    *,
    database_url: str,
    skip_score: float = 45.0,
    low_score: float = 65.0,
    skip_after_days: int = 3,
    low_after_days: int = 14,
) -> dict[str, Any]:
    with psycopg.connect(database_url) as conn:
        rows = conn.execute(
            """
            with latest_matches as (
              select distinct on (job_id) job_id, overall_score
              from job_matches
              order by job_id, created_at desc
            )
            select
              j.id,
              lm.overall_score,
              j.discovered_at,
              a.id as application_id,
              coalesce(a.status::text, 'discovered') as status
            from jobs j
            join latest_matches lm on lm.job_id = j.id
            left join applications a on a.job_id = j.id
            where coalesce(a.status::text, 'discovered') in ('discovered', 'analyzed')
              and a.resume_path is null
              and a.cover_letter_path is null
              and (
                (lm.overall_score < %s and j.discovered_at < now() - (%s * interval '1 day'))
                or
                (lm.overall_score >= %s and lm.overall_score < %s
                  and j.discovered_at < now() - (%s * interval '1 day'))
              )
            order by j.discovered_at asc
            """,
            (skip_score, skip_after_days, skip_score, low_score, low_after_days),
        ).fetchall()

        archived: list[dict[str, Any]] = []
        for job_id, score, discovered_at, application_id, previous_status in rows:
            if application_id:
                app_id = application_id
                conn.execute(
                    "update applications set status = 'skipped'::application_status, updated_at = now() where id = %s",
                    (app_id,),
                )
            else:
                app_id = conn.execute(
                    "insert into applications (job_id, status) values (%s, 'skipped'::application_status) returning id",
                    (job_id,),
                ).fetchone()[0]

            conn.execute(
                """
                insert into application_events (
                  application_id, event_type, from_status, to_status, source, details
                ) values (
                  %s, 'auto_archived', %s::application_status, 'skipped'::application_status,
                  'jobpilot_daily', %s
                )
                """,
                (
                    app_id,
                    previous_status,
                    Jsonb({
                        "overall_score": float(score),
                        "discovered_at": discovered_at.isoformat(),
                        "rule": f"<{skip_score:g} after {skip_after_days}d or {skip_score:g}-{low_score - 1:g} after {low_after_days}d",
                    }),
                ),
            )
            archived.append({"job_id": str(job_id), "score": float(score)})

    return {"archived_count": len(archived), "archived": archived}
