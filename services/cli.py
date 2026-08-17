from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

import yaml

from services.analysis.requirements import extract_requirements
from services.ingestion.seek_email import parse_seek_recommendation_email
from services.ingestion.seek_job import fetch_seek_job
from services.ingestion.seek_link import resolve_seek_tracking_url
from services.matching.scorer import score_job
from services.pipeline.rank_email import rank_seek_email


def _load_json(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _load_profile(path: str) -> dict:
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


def _cmd_parse_email(args: argparse.Namespace) -> int:
    payload = _load_json(args.input)
    result = parse_seek_recommendation_email(
        subject=payload["subject"],
        body=payload["body"],
        message_id=payload.get("message_id"),
    )
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
    payload = {
        "job": asdict(job),
        "requirements": asdict(requirements),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def _cmd_rank_email(args: argparse.Namespace) -> int:
    payload = _load_json(args.input)
    profile = _load_profile(args.profile)
    result = rank_seek_email(
        subject=payload["subject"],
        body=payload["body"],
        message_id=payload.get("message_id"),
        profile=profile,
        max_workers=args.workers,
    )
    output = asdict(result)
    if args.top is not None:
        output["jobs"] = output["jobs"][: args.top]
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if result.ranked_count else 2


def _cmd_score(args: argparse.Namespace) -> int:
    profile = _load_profile(args.profile)
    requirements = _load_json(args.requirements)
    result = score_job(
        profile=profile,
        required_skills=requirements.get("required_skills", []),
        preferred_skills=requirements.get("preferred_skills", []),
        experience_score=float(requirements.get("experience_score", 70)),
        education_score=float(requirements.get("education_score", 90)),
        domain_score=float(requirements.get("domain_score", 60)),
        seniority_score=float(requirements.get("seniority_score", 70)),
        location_score=float(requirements.get("location_score", 100)),
        work_rights_score=float(requirements.get("work_rights_score", 100)),
    )
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="jobpilot")
    subparsers = parser.add_subparsers(dest="command", required=True)

    parse_email = subparsers.add_parser(
        "parse-email", help="Parse a SEEK recommendation email JSON export"
    )
    parse_email.add_argument("input", help="JSON with subject, body, and optional message_id")
    parse_email.set_defaults(func=_cmd_parse_email)

    resolve_url = subparsers.add_parser(
        "resolve-url", help="Resolve a SEEK recommendation tracking URL"
    )
    resolve_url.add_argument("url")
    resolve_url.set_defaults(func=_cmd_resolve_url)

    fetch_job = subparsers.add_parser(
        "fetch-job", help="Resolve, fetch, and parse a SEEK job page"
    )
    fetch_job.add_argument("url")
    fetch_job.set_defaults(func=_cmd_fetch_job)

    rank_email = subparsers.add_parser(
        "rank-email", help="Resolve and rank all jobs in a SEEK recommendation email"
    )
    rank_email.add_argument("input", help="JSON with subject, body, and optional message_id")
    rank_email.add_argument("--profile", default="resume/facts/profile.yaml")
    rank_email.add_argument("--workers", type=int, default=4)
    rank_email.add_argument("--top", type=int)
    rank_email.set_defaults(func=_cmd_rank_email)

    score = subparsers.add_parser(
        "score", help="Score structured job requirements against the fact registry"
    )
    score.add_argument("requirements", help="JSON with required_skills and preferred_skills")
    score.add_argument("--profile", default="resume/facts/profile.yaml")
    score.set_defaults(func=_cmd_score)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
