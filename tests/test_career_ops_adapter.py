from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from services.career_ops.adapter import (
    CareerOpsConfig,
    CareerOpsError,
    evaluate_job,
    parse_score_summary,
    render_profile_as_cv,
)


SAMPLE_OUTPUT = """
## Block A — Role Summary
Useful report text.

---SCORE_SUMMARY---
COMPANY: Example Co
ROLE: Data Engineer
SCORE: 4.25
ARCHETYPE: Data / Platform
LEGITIMACY: High Confidence
---END_SUMMARY---
"""


def _profile() -> dict:
    return {
        "candidate": {
            "name": "Sean Gao",
            "email": "sean@example.com",
            "location": "Christchurch, New Zealand",
            "work_rights": {"statement": "Valid New Zealand work visa"},
        },
        "summary_facts": ["Data Engineer"],
        "experience": [
            {
                "company": "Example",
                "title": "Database Engineer",
                "start": "2020-01",
                "end": "2021-01",
                "facts": [
                    {
                        "id": "verified_metric",
                        "claim": "Automated incident triage",
                        "metrics": ["reduced MTTR by 50%"],
                        "metrics_status": "verified",
                    },
                    {
                        "id": "unverified_metric",
                        "claim": "Improved data quality",
                        "metrics": ["99.9% integrity"],
                        "metrics_status": "needs_review",
                    },
                ],
            }
        ],
        "projects": [
            {
                "name": "Data Project",
                "technologies": ["Python", "SQL"],
                "facts": [
                    {"id": "project_ok", "claim": "Built a pipeline"},
                    {
                        "id": "project_review",
                        "claim": "Reduced work by 80%",
                        "status": "needs_review",
                    },
                ],
            }
        ],
        "skills": {"core": {"verified": ["Python", "SQL"], "familiar": ["dbt"]}},
    }


def test_parse_score_summary_maps_to_jobpilot_scale() -> None:
    result = parse_score_summary(SAMPLE_OUTPUT)
    assert result.company == "Example Co"
    assert result.role == "Data Engineer"
    assert result.score_5 == 4.25
    assert result.score_100 == 85.0
    assert result.recommendation == "apply"
    assert "Block A" in result.report


def test_parse_score_summary_rejects_missing_contract() -> None:
    with pytest.raises(CareerOpsError, match="SCORE_SUMMARY"):
        parse_score_summary("plain text")


def test_profile_projection_keeps_verified_facts_and_drops_unverified_metrics() -> None:
    rendered = render_profile_as_cv(_profile())
    assert "reduced MTTR by 50%" in rendered
    assert "99.9% integrity" not in rendered
    assert "Improved data quality" in rendered
    assert "Built a pipeline" in rendered
    assert "Reduced work by 80%" not in rendered
    assert "[evidence:verified_metric]" in rendered


def test_evaluate_job_runs_external_engine_in_isolated_data_root(tmp_path: Path) -> None:
    checkout = tmp_path / "career-ops"
    checkout.mkdir()
    evaluator = checkout / "openai-eval.mjs"
    evaluator.write_text("// fixture", encoding="utf-8")
    captured: dict = {}

    def fake_runner(command, **kwargs):
        captured["command"] = command
        captured.update(kwargs)
        data_root = Path(kwargs["env"]["CAREER_OPS_DATA_DIR"])
        assert data_root != checkout
        assert (data_root / "cv.md").read_text(encoding="utf-8").startswith("# Sean Gao")
        assert (data_root / "job-description.txt").read_text(encoding="utf-8").strip() == "JD"
        return subprocess.CompletedProcess(command, 0, stdout=SAMPLE_OUTPUT, stderr="")

    result = evaluate_job(
        jd_text="JD",
        profile=_profile(),
        posting_url="https://www.seek.co.nz/job/123",
        config=CareerOpsConfig(
            checkout=checkout,
            api_key="secret",
            base_url="https://api.deepseek.com/v1",
            model="deepseek-chat",
        ),
        runner=fake_runner,
    )

    assert result.score_100 == 85.0
    assert captured["cwd"] == str(checkout)
    assert "--no-save" in captured["command"]
    assert "--posting-url" in captured["command"]
    assert captured["env"]["OPENAI_API_KEY"] == "secret"
