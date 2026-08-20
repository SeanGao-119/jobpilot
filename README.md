# JobPilot

JobPilot is a personal job-application operating system for discovering roles, measuring fit, generating evidence-grounded application documents, and tracking outcomes.

## Current vertical slice

JobPilot now has a working end-to-end path:

```text
SEEK recommendation email
        ↓
tracking-link resolution
        ↓
SEEK job detail ingestion
        ↓
requirement extraction
        ↓
explainable profile matching
        ↓
PostgreSQL / Supabase persistence
        ↓
Next.js dashboard
```

A real 12-job SEEK recommendation batch has been parsed, ranked and persisted successfully.

## Core design principle

The model is not the source of truth for candidate experience. `resume/facts/profile.yaml` is.

Every generated claim must be traceable to approved evidence. Missing evidence becomes a gap, not a fabricated resume bullet.

## Stack

- **Web:** Next.js + TypeScript
- **Data/AI services:** Python
- **Database:** PostgreSQL / Supabase
- **Documents:** LaTeX + XeLaTeX
- **Automation:** GitHub Actions
- **Hosting target:** Vercel + Supabase

## Repository layout

```text
apps/web/                 Live web dashboard
services/ingestion/       SEEK/email/manual adapters
services/analysis/        Requirement extraction
services/matching/        Explainable scoring
services/pipeline/        Batch orchestration
services/storage/         PostgreSQL persistence
resume/master/            LaTeX presentation layer
resume/facts/             Approved candidate facts
resume/generated/         Local generated application artifacts
prompts/                  Versioned LLM prompts
database/                 SQL schema and migrations
tests/                    Backend tests
```

## Run the dashboard

```bash
cd apps/web
npm install
```

Set `DATABASE_URL` in the shell or create an ignored `.env.local` from `.env.example`, then run:

```bash
npm run dev
```

Open `http://localhost:3000`.

The dashboard queries Postgres server-side; database credentials are never exposed to browser JavaScript.

## Application lifecycle

`discovered -> analyzed -> shortlisted -> documents_ready -> applied -> screening -> interview -> final_interview -> offer`

Terminal/alternative states: `rejected`, `withdrawn`, `expired`, `skipped`.

## Next milestones

1. job detail page with score breakdown, matched evidence and gaps;
2. application status actions and timeline;
3. evidence-grounded resume and cover-letter generation;
4. Gmail application-result tracking;
5. deployment to Vercel with Supabase transaction pooling.

## Privacy

Never commit Gmail credentials, OAuth tokens, OpenAI API keys, database passwords, generated private application documents, SEEK tracking tokens, or local font binaries. See `.gitignore` and `AGENTS.md`.
