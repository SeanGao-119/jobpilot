from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Sequence

ALIASES: dict[str, set[str]] = {
    "sql": {"sql", "postgresql", "mysql", "as400"},
    "python": {"python", "pandas", "geopandas", "numpy"},
    "etl": {"etl", "data engineering", "data_engineering", "data pipelines", "pipeline"},
    "linux": {"linux", "sre", "operations"},
    "git": {"git", "version control"},
    "docker": {"docker", "containers"},
    "stakeholder management": {"stakeholder management", "stakeholder_management", "ba", "qa"},
    "data quality": {"data quality", "data_quality", "reconciliation"},
    "reporting": {"reporting", "dashboard", "excel", "tableau"},
    "geospatial": {"geospatial", "postgis", "spatial joins", "crs management", "qgis"},
}


@dataclass(frozen=True, slots=True)
class RequirementMatch:
    requirement: str
    status: str
    evidence: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class MatchScore:
    overall_score: float
    technical_score: float
    experience_score: float
    education_score: float
    domain_score: float
    seniority_score: float
    location_score: float
    work_rights_score: float
    recommendation: str
    requirements: tuple[RequirementMatch, ...]


def _norm(value: str) -> str:
    return " ".join(value.lower().replace("_", " ").replace("-", " ").split())


def _tokens_for_requirement(requirement: str) -> set[str]:
    normalized = _norm(requirement)
    tokens = {normalized}
    for canonical, aliases in ALIASES.items():
        normalized_aliases = {_norm(x) for x in aliases}
        if normalized == canonical or normalized in normalized_aliases:
            tokens |= normalized_aliases | {canonical}
    return tokens


def flatten_profile_evidence(profile: Mapping) -> dict[str, list[str]]:
    """Index verified candidate evidence by normalized capability tag."""
    index: dict[str, list[str]] = {}

    skills = profile.get("skills", {})
    for group in skills.values():
        if not isinstance(group, Mapping):
            continue
        for level in ("verified", "familiar", "basic"):
            for skill in group.get(level, []) or []:
                key = _norm(str(skill))
                index.setdefault(key, []).append(f"skill:{skill} ({level})")

    for experience in profile.get("experience", []) or []:
        company = experience.get("company", "experience")
        for fact in experience.get("facts", []) or []:
            claim = fact.get("claim") if isinstance(fact, Mapping) else str(fact)
            for tag in fact.get("evidence_tags", []) if isinstance(fact, Mapping) else []:
                index.setdefault(_norm(str(tag)), []).append(f"{company}: {claim}")

    for project in profile.get("projects", []) or []:
        name = project.get("name", "project")
        for tech in project.get("technologies", []) or []:
            index.setdefault(_norm(str(tech)), []).append(f"project:{name}")
        category = project.get("category")
        if category:
            index.setdefault(_norm(str(category)), []).append(f"project:{name}")

    return index


def match_requirement(requirement: str, evidence_index: Mapping[str, Sequence[str]]) -> RequirementMatch:
    candidates = _tokens_for_requirement(requirement)
    evidence: list[str] = []
    exact = False
    partial = False

    for token in candidates:
        if token in evidence_index:
            evidence.extend(evidence_index[token])
            if token == _norm(requirement):
                exact = True
            else:
                partial = True

    if exact:
        status = "matched"
    elif evidence or partial:
        status = "partial"
    else:
        status = "gap"
    return RequirementMatch(requirement=requirement, status=status, evidence=tuple(dict.fromkeys(evidence)))


def _weighted_requirement_score(
    required: Iterable[RequirementMatch], preferred: Iterable[RequirementMatch]
) -> float:
    points = {"matched": 1.0, "partial": 0.55, "gap": 0.0}
    required_list = list(required)
    preferred_list = list(preferred)
    required_score = (
        sum(points[x.status] for x in required_list) / len(required_list) if required_list else 1.0
    )
    preferred_score = (
        sum(points[x.status] for x in preferred_list) / len(preferred_list) if preferred_list else 1.0
    )
    return round((required_score * 0.8 + preferred_score * 0.2) * 100, 2)


def recommendation_for(score: float) -> str:
    if score >= 80:
        return "apply"
    if score >= 65:
        return "consider"
    if score >= 45:
        return "low"
    return "skip"


def score_job(
    *,
    profile: Mapping,
    required_skills: Sequence[str],
    preferred_skills: Sequence[str] = (),
    experience_score: float = 70,
    education_score: float = 90,
    domain_score: float = 60,
    seniority_score: float = 70,
    location_score: float = 100,
    work_rights_score: float = 100,
) -> MatchScore:
    evidence_index = flatten_profile_evidence(profile)
    required_matches = tuple(match_requirement(r, evidence_index) for r in required_skills)
    preferred_matches = tuple(match_requirement(r, evidence_index) for r in preferred_skills)
    technical = _weighted_requirement_score(required_matches, preferred_matches)

    dimensions = {
        "technical": (technical, 0.40),
        "experience": (experience_score, 0.20),
        "education": (education_score, 0.10),
        "domain": (domain_score, 0.08),
        "seniority": (seniority_score, 0.10),
        "location": (location_score, 0.06),
        "work_rights": (work_rights_score, 0.06),
    }
    overall = round(sum(score * weight for score, weight in dimensions.values()), 2)

    return MatchScore(
        overall_score=overall,
        technical_score=technical,
        experience_score=experience_score,
        education_score=education_score,
        domain_score=domain_score,
        seniority_score=seniority_score,
        location_score=location_score,
        work_rights_score=work_rights_score,
        recommendation=recommendation_for(overall),
        requirements=required_matches + preferred_matches,
    )
