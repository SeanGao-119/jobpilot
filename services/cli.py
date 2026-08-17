from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

import yaml

from services.ingestion.seek_email import parse_seek_recommendation_email
from services.matching.scorer import score_job


def _load_json(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _cmd_parse_email(args: argparse.Namespace) -> int:
    payload = _load_json(args.input)
    result = parse_seek_recommendation_email(
        subject=payload["subject"],
        body=payload["body"],
        message_id=payload.get("message_id"),
    )
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
    return 0


def _cmd_score(args: argparse.Namespace) -> int:
    profile = yaml.safe_load(Path(args.profile).read_text(encoding="utf-8"))
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

    parse_email = subparsers.add_parser("parse-email", help="Parse a SEEK recommendation email JSON export")
    parse_email.add_argument("input", help="JSON with subject, body, and optional message_id")
    parse_email.set_defaults(func=_cmd_parse_email)

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
