from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import httpx

from services.analysis.requirements import ExtractedRequirements, extract_requirements
from services.ingestion.models import JobRecommendation
from services.ingestion.seek_email import parse_seek_recommendation_email
from services.ingestion.seek_job import SeekJobPage, fetch_seek_job
from services.ingestion.seek_link import ResolvedSeekLink, resolve_seek_tracking_url
from services.matching.scorer import MatchScore, score_job

ResolveFn = Callable[[str], ResolvedSeekLink]
FetchFn = Callable[[str], SeekJobPage]


@dataclass(frozen=True, slots=True)
class RankedSeekJob:
    external_id: str
    seek_job_id: str
    seek_url: str
    title: str
    company: str
    location: str | None
    salary_text: str | None
    employment_type: str | None
    requirements: ExtractedRequirements
    match: MatchScore


@dataclass(frozen=True, slots=True)
class RankFailure:
    external_id: str
    company: str
    error_type: str
    message: str


@dataclass(frozen=True, slots=True)
class RankBatchResult:
    advertised_count: int | None
    parsed_count: int
    ranked_count: int
    failed_count: int
    jobs: tuple[RankedSeekJob, ...]
    failures: tuple[RankFailure, ...]


def _candidate_experience_years(profile: Mapping) -> float:
    months: set[tuple[int, int]] = set()
    for role in profile.get("experience", []) or []:
        start = str(role.get("start", ""))
        end = str(role.get("end", ""))
        if not re.fullmatch(r"\d{4}-\d{2}", start) or not re.fullmatch(r"\d{4}-\d{2}", end):
            continue
        sy, sm = (int(part) for part in start.split("-"))
        ey, em = (int(part) for part in end.split("-"))
        cursor_y, cursor_m = sy, sm
        while (cursor_y, cursor_m) < (ey, em):
            months.add((cursor_y, cursor_m))
            cursor_m += 1
            if cursor_m == 13:
                cursor_y += 1
                cursor_m = 1
    return round(len(months) / 12, 2)


def _required_years(description: str) -> int | None:
    patterns = (
        r"\b(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+)?experience\b",
        r"\bminimum\s+(?:of\s+)?(\d+)\s*(?:years?|yrs?)\b",
    )
    values: list[int] = []
    for pattern in patterns:
        values.extend(int(value) for value in re.findall(pattern, description, flags=re.IGNORECASE))
    return max(values) if values else None


def _seniority_threshold(title: str) -> int | None:
    low = title.lower()
    if any(token in low for token in ("principal", "head of", "director")):
        return 7
    if "lead" in low:
        return 5
    if "senior" in low:
        return 4
    return None


def _experience_dimensions(profile: Mapping, job: SeekJobPage) -> tuple[float, float]:
    candidate_years = _candidate_experience_years(profile)
    required_years = _required_years(job.description)
    title_threshold = _seniority_threshold(job.title)

    if required_years:
        experience_score = min(100.0, round(candidate_years / required_years * 100, 2))
    elif title_threshold:
        experience_score = min(100.0, round(candidate_years / title_threshold * 100, 2))
    else:
        experience_score = 75.0

    if title_threshold:
        seniority_score = min(100.0, round(candidate_years / title_threshold * 100, 2))
    else:
        seniority_score = 85.0
    return experience_score, seniority_score


def _rank_one(
    recommendation: JobRecommendation,
    profile: Mapping,
    resolver: ResolveFn,
    fetcher: FetchFn,
) -> RankedSeekJob:
    resolved = resolver(recommendation.source_url)
    job = fetcher(resolved.final_url)
    requirements = extract_requirements(job.description)
    experience_score, seniority_score = _experience_dimensions(profile, job)
    match = score_job(
        profile=profile,
        required_skills=requirements.required_skills,
        preferred_skills=requirements.preferred_skills,
        experience_score=experience_score,
        education_score=90.0,
        domain_score=65.0,
        seniority_score=seniority_score,
        location_score=100.0,
        work_rights_score=100.0,
    )
    return RankedSeekJob(
        external_id=recommendation.external_id,
        seek_job_id=job.seek_job_id,
        seek_url=job.source_url,
        title=job.title,
        company=job.company,
        location=job.location or recommendation.location,
        salary_text=job.salary_text or recommendation.salary_text,
        employment_type=job.employment_type,
        requirements=requirements,
        match=match,
    )


def rank_seek_email(
    *,
    subject: str,
    body: str,
    profile: Mapping,
    message_id: str | None = None,
    max_workers: int = 4,
    resolver: ResolveFn = resolve_seek_tracking_url,
    fetcher: FetchFn = fetch_seek_job,
) -> RankBatchResult:
    """Resolve, fetch, extract, and rank all jobs from one SEEK recommendation email."""
    parsed = parse_seek_recommendation_email(subject=subject, body=body, message_id=message_id)
    recommendations = list(parsed.recommendations)
    jobs: list[RankedSeekJob] = []
    failures: list[RankFailure] = []

    worker_count = max(1, min(max_workers, len(recommendations) or 1))
    with ThreadPoolExecutor(max_workers=worker_count) as pool:
        future_map = {
            pool.submit(_rank_one, item, profile, resolver, fetcher): item
            for item in recommendations
        }
        for future in as_completed(future_map):
            item = future_map[future]
            try:
                jobs.append(future.result())
            except (httpx.HTTPError, ValueError, OSError) as exc:
                failures.append(
                    RankFailure(
                        external_id=item.external_id,
                        company=item.company,
                        error_type=type(exc).__name__,
                        message=str(exc)[:240],
                    )
                )

    jobs.sort(key=lambda item: (-item.match.overall_score, item.company.lower(), item.title.lower()))
    failures.sort(key=lambda item: (item.company.lower(), item.external_id))
    return RankBatchResult(
        advertised_count=parsed.advertised_count,
        parsed_count=len(recommendations),
        ranked_count=len(jobs),
        failed_count=len(failures),
        jobs=tuple(jobs),
        failures=tuple(failures),
    )
