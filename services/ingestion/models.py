from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from hashlib import sha256


@dataclass(frozen=True, slots=True)
class JobRecommendation:
    source_url: str
    company: str
    location: str | None = None
    salary_text: str | None = None
    work_arrangement: str | None = None
    highlights: tuple[str, ...] = field(default_factory=tuple)
    title_hint: str | None = None
    source_message_id: str | None = None

    @property
    def external_id(self) -> str:
        """Stable id before the final SEEK job id has been resolved."""
        return sha256(self.source_url.encode("utf-8")).hexdigest()[:24]


def dedupe_recommendations(items: Iterable[JobRecommendation]) -> list[JobRecommendation]:
    seen: set[str] = set()
    result: list[JobRecommendation] = []
    for item in items:
        if item.external_id in seen:
            continue
        seen.add(item.external_id)
        result.append(item)
    return result
