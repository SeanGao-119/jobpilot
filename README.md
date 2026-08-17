# JobPilot

JobPilot is a personal job-application operating system for discovering roles, measuring fit, generating evidence-grounded application documents, and tracking outcomes.

## What it will do

- ingest jobs from SEEK recommendation emails, SEEK URLs/search, and manual job descriptions;
- normalize and deduplicate role data;
- extract skills, seniority, work arrangement, salary, and other requirements;
- produce an explainable job-match score with matched evidence and gaps;
- tailor a LaTeX resume without inventing experience;
- generate a role-specific cover letter from approved facts;
- track application status, timestamps, documents, notes, interviews, and outcomes;
- detect relevant application-result emails and suggest status updates;
- expose the pipeline and conversion metrics in a web dashboard;
- retain meaningful Git history so the project itself is portfolio-ready.

## Core design principle

The model is not the source of truth for candidate experience. `resume/facts/profile.yaml` is.

Every generated claim must be traceable to approved evidence. Missing evidence becomes a gap, not a fabricated resume bullet.

## Planned architecture

```text
SEEK email / SEEK URL / manual JD
              |
              v
       Ingestion adapters
              |
              v
      Job normalization
              |
              v
    Requirement extraction
              |
              v
  Explainable match engine
              |
       +------+------+
       |             |
       v             v
 Resume agent   Cover-letter agent
       |             |
       +------+------+
              |
        Human review
              |
              v
      Application tracker
              |
              v
       Web analytics UI
```

## Planned stack

- **Web:** Next.js + TypeScript
- **Data/AI services:** Python
- **Database:** PostgreSQL / Supabase
- **LLM:** OpenAI API with structured outputs
- **Documents:** LaTeX + XeLaTeX
- **Automation:** scheduled ingestion + GitHub Actions
- **Hosting:** Vercel + Supabase

## Repository layout

```text
apps/web/                 Web dashboard
services/ingestion/       SEEK/email/manual adapters
services/matching/        Requirement extraction and scoring
services/documents/       Resume and cover-letter generation
services/tracking/        Application event and email tracking
resume/master/            LaTeX presentation layer
resume/facts/             Approved candidate facts
resume/generated/         Local generated application artifacts
prompts/                  Versioned LLM prompts
database/                 SQL schema and migrations
tests/                    Parser/scoring/generation tests
```

## Application lifecycle

`discovered -> analyzed -> shortlisted -> documents_ready -> applied -> screening -> interview -> final_interview -> offer`

Terminal/alternative states: `rejected`, `withdrawn`, `expired`, `skipped`.

## Development status

JobPilot is under active development. The initial milestone is a working vertical slice:

1. ingest a SEEK recommendation email;
2. store a normalized job;
3. score it against the factual candidate profile;
4. generate a tailored LaTeX resume and cover letter;
5. mark the application as submitted;
6. display it in the dashboard.

## Privacy

Never commit Gmail credentials, OAuth tokens, OpenAI API keys, generated private application documents, or local font binaries. See `.gitignore` and `AGENTS.md`.
