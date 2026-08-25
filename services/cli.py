from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import asdict
from pathlib import Path

import yaml
from psycopg.conninfo import make_conninfo

from services.analysis.requirements import extract_requirements
from services.ingestion.seek_email import parse_seek_recommendation_email
from services.ingestion.seek_job import fetch_seek_job
from services.ingestion.seek_link import resolve_seek_tracking_url
from services.matching.scorer import score_job
from services.pipeline.daily import cleanup_stale_jobs, sync_seek_gmail
from services.pipeline.rank_email import rank_seek_email
from services.storage.postgres import PostgresJobRepository


def _load_json(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _load_profile(path: str) -> dict:
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


def _profile_version(path: str) -> str:
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()[:12]
    return f"sha256:{digest}"


def _database_url() -> str:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    host = os.environ.get("DB_HOST", "").strip()
    port = os.environ.get("DB_PORT", "5432").strip() or "5432"
    dbname = os.environ.get("DB_NAME", "postgres").strip() or "postgres"
    user = os.environ.get("DB_USER", "").strip()
    password = os.environ.get("DB_PASSWORD", "")
    split_config_touched = any(os.environ.get(name) for name in ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"))
    if split_config_touched:
        missing = [name for name, value in (("DB_HOST", host), ("DB_USER", user), ("DB_PASSWORD", password)) if not value]
        if missing:
            raise SystemExit("Incomplete DB_* configuration. Missing: " + ", ".join(missing))
        try:
            parsed_port = int(port)
        except ValueError as exc:
            raise SystemExit("DB_PORT must be a valid integer") from exc
        if parsed_port <= 0:
            raise SystemExit("DB_PORT must be a positive integer")
        return make_conninfo(host=host, port=parsed_port, dbname=dbname, user=user, password=password, sslmode="require")
    if database_url:
        return database_url
    raise SystemExit("Database configuration is required. Prefer DB_HOST/DB_USER/DB_PASSWORD (plus optional DB_PORT/DB_NAME), or set DATABASE_URL.")


def _cmd_parse_email(args: argparse.Namespace) -> int:
    payload = _load_json(args.input)
    result = parse_seek_recommendation_email(subject=payload["subject"], body=payload["body"], message_id=payload.get("message_id"))
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
    return 0


def _cmd_resolve_url(args: argparse.Namespace) -> int:
    result = resolve_seek_tracking_url(args.url)
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
    return 0


def _cmd_fetch_job(args: argparse.Namespace) -> int:
    resolved = resolve_seek_tracking_url(args.url)
    job = fetch_seek_job(resolved.final_url)
    requirements = extract_requirements(job.description)
    print(json.dumps({"job": asdict(job), "requirements": asdict(requirements)}, ensure_ascii=False, indent=2))
    return 0


def _rank_from_args(args: argparse.Namespace):
    payload = _load_json(args.input)
    profile = _load_profile(args.profile)
    result = rank_seek_email(subject=payload["subject"], body=payload["body"], message_id=payload.get("message_id"), profile=profile, max_workers=args.workers)
    return payload, result


def _cmd_rank_email(args: argparse.Namespace) -> int:
    _, result = _rank_from_args(args)
    output = asdict(result)
    if args.top is not None:
        output["jobs"] = output["jobs"][: args.top]
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if result.ranked_count else 2


def _cmd_persist_email(args: argparse.Namespace) -> int:
    payload, result = _rank_from_args(args)
    if not result.ranked_count:
        print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
        return 2
    profile_version = _profile_version(args.profile)
    repository = PostgresJobRepository(_database_url())
    job_ids = repository.persist_batch(result, source_message_id=payload.get("message_id"), profile_version=profile_version, prompt_version="deterministic-v1")
    print(json.dumps({"profile_version": profile_version, "ranked_count": result.ranked_count, "failed_count": result.failed_count, "persisted_count": len(job_ids), "job_ids": job_ids, "failures": [asdict(item) for item in result.failures]}, ensure_ascii=False, indent=2))
    return 0


def _cmd_sync_gmail(args: argparse.Namespace) -> int:
    profile = _load_profile(args.profile)
    result = sync_seek_gmail(database_url=_database_url(), profile=profile, profile_version=_profile_version(args.profile), query=args.query, limit=args.limit, workers=args.workers)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _cmd_cleanup(args: argparse.Namespace) -> int:
    result = cleanup_stale_jobs(database_url=_database_url(), skip_score=args.skip_score, low_score=args.low_score, skip_after_days=args.skip_after_days, low_after_days=args.low_after_days)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _cmd_daily(args: argparse.Namespace) -> int:
    profile = _load_profile(args.profile)
    database_url = _database_url()
    sync_result = sync_seek_gmail(database_url=database_url, profile=profile, profile_version=_profile_version(args.profile), query=args.query, limit=args.limit, workers=args.workers)
    cleanup_result = cleanup_stale_jobs(database_url=database_url, skip_score=args.skip_score, low_score=args.low_score, skip_after_days=args.skip_after_days, low_after_days=args.low_after_days)
    print(json.dumps({"sync": sync_result, "cleanup": cleanup_result}, ensure_ascii=False, indent=2))
    return 0


def _cmd_mark_applied(args: argparse.Namespace) -> int:
    repository = PostgresJobRepository(_database_url())
    result = repository.mark_applied_by_company_title(company=args.company, title=args.title, application_method=args.method)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _cmd_score(args: argparse.Namespace) -> int:
    profile = _load_profile(args.profile)
    requirements = _load_json(args.requirements)
    result = score_job(profile=profile, required_skills=requirements.get("required_skills", []), preferred_skills=requirements.get("preferred_skills", []), experience_score=float(requirements.get("experience_score", 70)), education_score=float(requirements.get("education_score", 90)), domain_score=float(requirements.get("domain_score", 60)), seniority_score=float(requirements.get("seniority_score", 70)), location_score=float(requirements.get("location_score", 100)), work_rights_score=float(requirements.get("work_rights_score", 100)))
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
    return 0


def _add_rank_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("input", help="JSON with subject, body, and optional message_id")
    parser.add_argument("--profile", default="resume/facts/profile.yaml")
    parser.add_argument("--workers", type=int, default=4)


def _add_daily_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--profile", default="resume/facts/profile.yaml")
    parser.add_argument("--query", default=None, help="Override Gmail search query")
    parser.add_argument("--limit", type=int, default=25, help="Maximum Gmail messages to inspect")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--skip-score", type=float, default=45.0)
    parser.add_argument("--low-score", type=float, default=65.0)
    parser.add_argument("--skip-after-days", type=int, default=3)
    parser.add_argument("--low-after-days", type=int, default=14)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="jobpilot")
    subparsers = parser.add_subparsers(dest="command", required=True)

    parse_email = subparsers.add_parser("parse-email", help="Parse a SEEK recommendation email JSON export")
    parse_email.add_argument("input", help="JSON with subject, body, and optional message_id")
    parse_email.set_defaults(func=_cmd_parse_email)

    resolve_url = subparsers.add_parser("resolve-url", help="Resolve a SEEK recommendation tracking URL")
    resolve_url.add_argument("url")
    resolve_url.set_defaults(func=_cmd_resolve_url)

    fetch_job = subparsers.add_parser("fetch-job", help="Resolve, fetch, and parse a SEEK job page")
    fetch_job.add_argument("url")
    fetch_job.set_defaults(func=_cmd_fetch_job)

    rank_email = subparsers.add_parser("rank-email", help="Resolve and rank all jobs in a SEEK recommendation email")
    _add_rank_arguments(rank_email)
    rank_email.add_argument("--top", type=int)
    rank_email.set_defaults(func=_cmd_rank_email)

    persist_email = subparsers.add_parser("persist-email", help="Rank a SEEK recommendation email and upsert results into PostgreSQL")
    _add_rank_arguments(persist_email)
    persist_email.set_defaults(func=_cmd_persist_email)

    sync_gmail = subparsers.add_parser("sync-gmail", help="Fetch new SEEK recommendation emails from Gmail and persist ranked jobs")
    sync_gmail.add_argument("--profile", default="resume/facts/profile.yaml")
    sync_gmail.add_argument("--query", default=None)
    sync_gmail.add_argument("--limit", type=int, default=25)
    sync_gmail.add_argument("--workers", type=int, default=4)
    sync_gmail.set_defaults(func=_cmd_sync_gmail)

    cleanup = subparsers.add_parser("cleanup", help="Archive stale low-match untouched jobs")
    cleanup.add_argument("--skip-score", type=float, default=45.0)
    cleanup.add_argument("--low-score", type=float, default=65.0)
    cleanup.add_argument("--skip-after-days", type=int, default=3)
    cleanup.add_argument("--low-after-days", type=int, default=14)
    cleanup.set_defaults(func=_cmd_cleanup)

    daily = subparsers.add_parser("daily", help="Run Gmail sync followed by stale-job cleanup")
    _add_daily_arguments(daily)
    daily.set_defaults(func=_cmd_daily)

    mark_applied = subparsers.add_parser("mark-applied", help="Mark the newest matching job as applied")
    mark_applied.add_argument("--company", required=True)
    mark_applied.add_argument("--title", required=True)
    mark_applied.add_argument("--method", default="seek")
    mark_applied.set_defaults(func=_cmd_mark_applied)

    score = subparsers.add_parser("score", help="Score structured job requirements against the fact registry")
    score.add_argument("requirements", help="JSON with required_skills and preferred_skills")
    score.add_argument("--profile", default="resume/facts/profile.yaml")
    score.set_defaults(func=_cmd_score)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
