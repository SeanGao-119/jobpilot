from __future__ import annotations

from dataclasses import asdict
from typing import Any

from services.pipeline.rank_email import RankedSeekJob


def job_record_from_ranked(
    job: RankedSeekJob,
    *,
    source_message_id: str | None = None,
) -> dict[str, Any]:
    """Map a ranked SEEK job to the columns used by database.jobs.

    All SEEK discoveries use the canonical ``seek_url`` source so the stable SEEK job ID
    deduplicates the same role regardless of whether it was found in Recommendations,
    a saved-search/job-alert email, or through a manually pasted URL. Email provenance is
    retained separately in ``source_message_id``.
    """
    return {
        "source": "seek_url",
        "source_external_id": job.seek_job_id,
        "source_url": job.seek_url,
        "source_message_id": source_message_id,
        "title": job.title,
        "company": job.company,
        "location": job.location,
        "employment_type": job.employment_type,
        "salary_text": job.salary_text,
        "jd_raw": job.description,
        "jd_clean": job.description,
        "requirements": asdict(job.requirements),
    }


def match_record_from_ranked(
    job: RankedSeekJob,
    *,
    job_id: str,
    profile_version: str,
    prompt_version: str | None = None,
) -> dict[str, Any]:
    """Map a ranked result to database.job_matches without losing evidence provenance."""
    matched_evidence: list[dict[str, Any]] = []
    partial_evidence: list[dict[str, Any]] = []
    gaps: list[dict[str, str]] = []

    for item in job.match.requirements:
        payload = {
            "requirement": item.requirement,
            "evidence": list(item.evidence),
        }
        if item.status == "matched":
            matched_evidence.append(payload)
        elif item.status == "partial":
            partial_evidence.append(payload)
        else:
            gaps.append({"requirement": item.requirement})

    return {
        "job_id": job_id,
        "profile_version": profile_version,
        "prompt_version": prompt_version,
        "overall_score": job.match.overall_score,
        "technical_score": job.match.technical_score,
        "experience_score": job.match.experience_score,
        "education_score": job.match.education_score,
        "domain_score": job.match.domain_score,
        "seniority_score": job.match.seniority_score,
        "location_score": job.match.location_score,
        "work_rights_score": job.match.work_rights_score,
        "recommendation": job.match.recommendation,
        "matched_evidence": matched_evidence,
        "partial_evidence": partial_evidence,
        "gaps": gaps,
        "explanation": None,
    }
