from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

import yaml

from .adapter import CareerOpsError, evaluate_job


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m services.career_ops.cli",
        description="Evaluate a job through career-ops without changing JobPilot persistence.",
    )
    parser.add_argument("jd_file", help="Path to a text file containing the job description")
    parser.add_argument("--profile", default="resume/facts/profile.yaml")
    parser.add_argument("--posting-url", default="")
    parser.add_argument(
        "--report",
        action="store_true",
        help="Include the full A-H career-ops report in JSON output",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    profile = yaml.safe_load(Path(args.profile).read_text(encoding="utf-8"))
    jd_text = Path(args.jd_file).read_text(encoding="utf-8")
    try:
        result = evaluate_job(
            jd_text=jd_text,
            profile=profile,
            posting_url=args.posting_url,
        )
    except CareerOpsError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 2

    payload = asdict(result)
    payload["recommendation"] = result.recommendation
    if not args.report:
        payload.pop("report", None)
    print(json.dumps({"ok": True, "evaluation": payload}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
