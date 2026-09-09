from __future__ import annotations

import os
import re
import subprocess
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import yaml


class CareerOpsError(RuntimeError):
    """Raised when the external career-ops engine cannot produce a valid evaluation."""


@dataclass(frozen=True, slots=True)
class CareerOpsConfig:
    checkout: Path
    node_binary: str = "node"
    timeout_seconds: int = 300
    base_url: str = "https://api.deepseek.com/v1"
    model: str = "deepseek-chat"
    api_key: str = ""

    @classmethod
    def from_env(cls) -> "CareerOpsConfig":
        checkout_raw = os.environ.get("JOBPILOT_CAREER_OPS_ROOT", "").strip()
        if not checkout_raw:
            raise CareerOpsError(
                "JOBPILOT_CAREER_OPS_ROOT is required and must point to a career-ops checkout"
            )
        timeout_raw = os.environ.get("JOBPILOT_CAREER_OPS_TIMEOUT", "300").strip() or "300"
        try:
            timeout_seconds = int(timeout_raw)
        except ValueError as exc:
            raise CareerOpsError("JOBPILOT_CAREER_OPS_TIMEOUT must be an integer") from exc
        if timeout_seconds <= 0:
            raise CareerOpsError("JOBPILOT_CAREER_OPS_TIMEOUT must be positive")

        return cls(
            checkout=Path(checkout_raw).expanduser().resolve(),
            node_binary=os.environ.get("JOBPILOT_CAREER_OPS_NODE", "node").strip() or "node",
            timeout_seconds=timeout_seconds,
            base_url=(
                os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
                .strip()
                .rstrip("/")
                + "/v1"
            ),
            model=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat").strip() or "deepseek-chat",
            api_key=os.environ.get("DEEPSEEK_API_KEY", "").strip(),
        )


@dataclass(frozen=True, slots=True)
class CareerOpsEvaluation:
    company: str
    role: str
    score_5: float
    score_100: float
    archetype: str
    legitimacy: str
    report: str

    @property
    def recommendation(self) -> str:
        if self.score_5 >= 4.0:
            return "apply"
        if self.score_5 >= 3.25:
            return "consider"
        if self.score_5 >= 2.25:
            return "low"
        return "skip"


_SUMMARY_RE = re.compile(
    r"---SCORE_SUMMARY---\s*(?P<body>[\s\S]*?)\s*---END_SUMMARY---",
    re.IGNORECASE,
)


def parse_score_summary(text: str) -> CareerOpsEvaluation:
    match = _SUMMARY_RE.search(text)
    if not match:
        raise CareerOpsError("career-ops output did not contain a SCORE_SUMMARY block")

    values: dict[str, str] = {}
    for line in match.group("body").splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        values[key.strip().upper()] = value.strip()

    required = ("COMPANY", "ROLE", "SCORE", "ARCHETYPE", "LEGITIMACY")
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise CareerOpsError("career-ops summary is missing: " + ", ".join(missing))

    try:
        score_5 = float(values["SCORE"])
    except ValueError as exc:
        raise CareerOpsError(f"Invalid career-ops score: {values['SCORE']!r}") from exc
    if not 0 <= score_5 <= 5:
        raise CareerOpsError(f"career-ops score must be between 0 and 5, got {score_5}")

    report = text[: match.start()].strip()
    return CareerOpsEvaluation(
        company=values["COMPANY"],
        role=values["ROLE"],
        score_5=score_5,
        score_100=round(score_5 * 20, 2),
        archetype=values["ARCHETYPE"],
        legitimacy=values["LEGITIMACY"],
        report=report,
    )


def _safe_list(value: object) -> Sequence:
    return value if isinstance(value, Sequence) and not isinstance(value, (str, bytes)) else ()


def _claim_with_verified_metrics(fact: Mapping) -> str:
    claim = str(fact.get("claim", "")).strip()
    if not claim:
        return ""
    metrics = [str(item).strip() for item in _safe_list(fact.get("metrics")) if str(item).strip()]
    if metrics and fact.get("metrics_status") == "verified":
        return claim.rstrip(".") + "; " + "; ".join(metrics)
    return claim


def render_profile_as_cv(profile: Mapping) -> str:
    """Render JobPilot's approved fact registry into career-ops' cv.md input.

    The adapter deliberately omits unverified metrics. JobPilot remains the source
    of truth for candidate facts; career-ops receives a read-only projection.
    """

    candidate = profile.get("candidate", {}) if isinstance(profile, Mapping) else {}
    lines: list[str] = [f"# {candidate.get('name', 'Candidate')}"]

    contact_bits = [
        candidate.get("location"),
        candidate.get("email"),
        candidate.get("phone"),
    ]
    contact = " | ".join(str(value) for value in contact_bits if value)
    if contact:
        lines.append(contact)

    work_rights = candidate.get("work_rights", {}) if isinstance(candidate, Mapping) else {}
    if isinstance(work_rights, Mapping) and work_rights.get("statement"):
        lines.extend(["", "## Work Rights", str(work_rights["statement"]).strip()])

    summary = [str(item).strip() for item in _safe_list(profile.get("summary_facts")) if str(item).strip()]
    if summary:
        lines.extend(["", "## Summary"])
        lines.extend(f"- {item}" for item in summary)

    experience = _safe_list(profile.get("experience"))
    if experience:
        lines.extend(["", "## Experience"])
        for item in experience:
            if not isinstance(item, Mapping):
                continue
            heading = " — ".join(
                value
                for value in (str(item.get("title", "")).strip(), str(item.get("company", "")).strip())
                if value
            )
            dates = " to ".join(
                value
                for value in (str(item.get("start", "")).strip(), str(item.get("end", "")).strip())
                if value
            )
            lines.append(f"### {heading or 'Experience'}")
            if dates:
                lines.append(dates)
            for fact in _safe_list(item.get("facts")):
                if isinstance(fact, Mapping):
                    claim = _claim_with_verified_metrics(fact)
                    if claim:
                        evidence_id = str(fact.get("id", "")).strip()
                        suffix = f" [evidence:{evidence_id}]" if evidence_id else ""
                        lines.append(f"- {claim}{suffix}")

    projects = _safe_list(profile.get("projects"))
    if projects:
        lines.extend(["", "## Projects"])
        for project in projects:
            if not isinstance(project, Mapping):
                continue
            name = str(project.get("name", "Project")).strip() or "Project"
            technologies = ", ".join(str(item) for item in _safe_list(project.get("technologies")))
            lines.append(f"### {name}")
            if technologies:
                lines.append(f"Technologies: {technologies}")
            summary_text = str(project.get("summary", "")).strip()
            if summary_text:
                lines.append(summary_text)
            for fact in _safe_list(project.get("facts")):
                if not isinstance(fact, Mapping):
                    continue
                if fact.get("status") == "needs_review":
                    continue
                claim = str(fact.get("claim", "")).strip()
                if claim:
                    evidence_id = str(fact.get("id", "")).strip()
                    suffix = f" [evidence:{evidence_id}]" if evidence_id else ""
                    lines.append(f"- {claim}{suffix}")

    education = _safe_list(profile.get("education"))
    if education:
        lines.extend(["", "## Education"])
        for item in education:
            if not isinstance(item, Mapping):
                continue
            degree = str(item.get("degree", "")).strip()
            institution = str(item.get("institution", "")).strip()
            text = " — ".join(value for value in (degree, institution) if value)
            dates = " to ".join(
                value
                for value in (str(item.get("start", "")).strip(), str(item.get("end", "")).strip())
                if value
            )
            lines.append(f"- {text}" + (f" ({dates})" if dates else ""))

    skills = profile.get("skills", {}) if isinstance(profile, Mapping) else {}
    skill_names: list[str] = []
    if isinstance(skills, Mapping):
        for group in skills.values():
            if not isinstance(group, Mapping):
                continue
            for level in ("verified", "familiar", "basic"):
                skill_names.extend(str(item) for item in _safe_list(group.get(level)))
    if skill_names:
        lines.extend(["", "## Skills", ", ".join(dict.fromkeys(skill_names))])

    return "\n".join(lines).strip() + "\n"


def _profile_config(profile: Mapping) -> dict:
    candidate = profile.get("candidate", {}) if isinstance(profile, Mapping) else {}
    return {
        "candidate": {
            "name": candidate.get("name", "Candidate"),
            "location": candidate.get("location", ""),
            "email": candidate.get("email", ""),
        },
        "output_language": "English",
    }


def _validate_checkout(config: CareerOpsConfig) -> Path:
    evaluator = config.checkout / "openai-eval.mjs"
    if not evaluator.is_file():
        raise CareerOpsError(
            f"career-ops evaluator not found at {evaluator}; check JOBPILOT_CAREER_OPS_ROOT"
        )
    return evaluator


def evaluate_job(
    *,
    jd_text: str,
    profile: Mapping,
    posting_url: str = "",
    config: CareerOpsConfig | None = None,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> CareerOpsEvaluation:
    """Run career-ops in an isolated data root and return its structured score.

    career-ops is treated as a replaceable external engine. It never writes to
    JobPilot's database or resume registry; only the returned report is consumed.
    """

    if not jd_text.strip():
        raise CareerOpsError("Job description is empty")

    resolved = config or CareerOpsConfig.from_env()
    evaluator = _validate_checkout(resolved)

    with tempfile.TemporaryDirectory(prefix="jobpilot-career-ops-") as temp_dir:
        data_root = Path(temp_dir)
        (data_root / "config").mkdir(parents=True)
        (data_root / "data").mkdir(parents=True)
        (data_root / "batch" / "tracker-additions").mkdir(parents=True)
        (data_root / "reports").mkdir(parents=True)
        (data_root / "cv.md").write_text(render_profile_as_cv(profile), encoding="utf-8")
        (data_root / "config" / "profile.yml").write_text(
            yaml.safe_dump(_profile_config(profile), sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        (data_root / "data" / "applications.md").write_text(
            "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n"
            "|---|---|---|---|---|---|---|---|---|\n",
            encoding="utf-8",
        )
        jd_path = data_root / "job-description.txt"
        jd_path.write_text(jd_text.strip() + "\n", encoding="utf-8")

        command = [
            resolved.node_binary,
            str(evaluator),
            "--file",
            str(jd_path),
            "--url",
            resolved.base_url,
            "--model",
            resolved.model,
            "--no-save",
        ]
        if posting_url:
            command.extend(["--posting-url", posting_url])

        env = os.environ.copy()
        env["CAREER_OPS_DATA_DIR"] = str(data_root)
        env["OPENAI_BASE_URL"] = resolved.base_url
        env["OPENAI_MODEL"] = resolved.model
        if resolved.api_key:
            env["OPENAI_API_KEY"] = resolved.api_key

        try:
            completed = runner(
                command,
                cwd=str(resolved.checkout),
                env=env,
                text=True,
                capture_output=True,
                timeout=resolved.timeout_seconds,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise CareerOpsError(f"career-ops execution failed: {exc}") from exc

        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "unknown error").strip()
            raise CareerOpsError(
                f"career-ops exited with status {completed.returncode}: {detail[-2000:]}"
            )

        return parse_score_summary(completed.stdout)
