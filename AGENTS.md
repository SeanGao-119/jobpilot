# JobPilot Agent Rules

## Product goal
JobPilot is a personal job-application operating system. It ingests roles from SEEK recommendation emails, SEEK URLs/search, and manual job descriptions; analyses fit; generates evidence-grounded LaTeX resumes and cover letters; and tracks the application pipeline and outcomes.

## Non-negotiable safety rule: never invent candidate facts
All resume and cover-letter claims must be grounded in `resume/facts/profile.yaml` or another explicitly approved factual source in this repository.

Allowed transformations:
- reorder existing experience and project evidence;
- rewrite wording without changing meaning;
- shorten or combine bullets;
- select the strongest evidence for a job description;
- infer relevance from verified facts.

Forbidden transformations:
- invent employers, dates, technologies, responsibilities, metrics, certifications, seniority, work rights, degrees, or outcomes;
- upgrade a familiarity-level skill to professional experience;
- copy a job-description requirement into the resume unless an approved fact supports it;
- create quantitative impact that is not already approved.

When evidence is weak or absent, record a gap instead of fabricating a match.

## Application workflow
1. Ingest job.
2. Normalize and deduplicate it.
3. Extract requirements and metadata.
4. Produce an explainable match score.
5. Select factual evidence.
6. Generate tailored resume and cover letter.
7. Require human review before an application is marked as submitted.
8. Track application events and email outcomes.

## Match scoring
Scores must be explainable and decomposed. Do not return a single opaque LLM number. At minimum evaluate:
- technical skills;
- experience relevance;
- education;
- domain relevance;
- seniority;
- location/work arrangement;
- work-right compatibility when known.

Store matched evidence and gaps alongside every score.

## Resume generation
- `resume/master/` contains presentation/template code.
- `resume/facts/profile.yaml` is the factual source of truth.
- generated files belong under `resume/generated/` and are not committed by default.
- preserve ATS readability.
- prefer one or two pages depending on role relevance; do not reduce readability merely to force one page.
- compile with XeLaTeX-compatible tooling.

## Cover letters
Cover letters should be concise, specific to the company and role, and based on approved evidence. Avoid generic enthusiasm, fake familiarity with the company, and unsupported claims.

## Application status model
Use these canonical states unless the schema explicitly changes:
`discovered`, `analyzed`, `shortlisted`, `documents_ready`, `applied`, `screening`, `interview`, `final_interview`, `offer`, `rejected`, `withdrawn`, `expired`, `skipped`.

## Source handling
For every job, retain provenance such as source type, source URL/message identifier when appropriate, discovery time, and raw job description. Never commit secrets, private OAuth tokens, Gmail credentials, or API keys.

## Code quality
- Prefer typed interfaces and explicit schemas.
- Add tests for parsers and scoring logic.
- Keep ingestion adapters separate from domain logic.
- Keep LLM prompts versioned under `prompts/`.
- Do not make network calls in unit tests.
- Prefer deterministic parsing before using an LLM.

## Git history
Use meaningful conventional commits such as `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `ci:` and `chore:`. Keep commits scoped enough to show how the system evolved.
