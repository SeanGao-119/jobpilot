# JobPilot

JobPilot is a personal job-application operating system for discovering roles, measuring fit, generating evidence-grounded application documents, estimating market compensation, and tracking outcomes.

## Current vertical slice

JobPilot has a working end-to-end path with multiple SEEK discovery channels:

```text
SEEK Recommendations ───────┐
SEEK Saved Search / Alerts ─┼──> Gmail ingestion ──┐
                            │                       │
Manual SEEK job URL ────────┴───────────────────────┤
                                                    ↓
                                      canonical SEEK job ID
                                                    ↓
                                      normalize + deduplicate
                                                    ↓
                                      SEEK job detail ingestion
                                                    ↓
                                      requirement extraction
                                                    ↓
                                      explainable profile matching
                                                    ↓
                                      PostgreSQL / Supabase
                                                    ↓
                                      Next.js dashboard + workspace
```

A real 12-job SEEK recommendation batch has been parsed, ranked and persisted successfully. The same ranking and persistence pipeline can now also be invoked for a manually supplied SEEK job URL, so jobs that SEEK did not recommend can still enter JobPilot.

## SEEK discovery strategy

Use SEEK's own discovery surfaces rather than making JobPilot depend on a site scraper:

1. Create several SEEK Saved Searches / Job Alerts covering the role families and locations you want.
2. Keep SEEK Recommendations enabled as an additional discovery source.
3. Paste any interesting SEEK URL into JobPilot's manual URL ingestion path when you find a role outside those feeds.

The default Gmail query is intentionally broad enough to include SEEK job mail while excluding SEEK Pass verification traffic:

```text
from:seek.co.nz -from:seekpass.co newer_than:14d
```

Override it with `GMAIL_SEEK_QUERY` or `--query` when needed.

All resolved SEEK roles are persisted with `source=seek_url` and the stable SEEK job ID as `source_external_id`. This is deliberate: the same role discovered through Recommendations, a Saved Search alert, or a manually pasted URL resolves to one canonical database row. Gmail message IDs are retained separately for provenance.

## Manual SEEK URL ingestion

For a SEEK role that was not recommended to you:

```bash
jobpilot add-url "https://www.seek.co.nz/job/12345678"
```

or, without installing the console script:

```bash
python -m services.cli add-url "https://www.seek.co.nz/job/12345678"
```

The command resolves the URL, fetches the job description, extracts requirements, calculates the same explainable match score used by email ingestion, deduplicates by SEEK job ID, and persists the result.

To ingest recent SEEK mail:

```bash
jobpilot sync-gmail
```

The regular daily flow remains:

```bash
jobpilot daily
```

## Database migration

When upgrading an existing JobPilot database, apply migrations in order. `database/migrations/003_canonical_seek_source.sql` converts existing SEEK email/search rows to the canonical `seek_url` source where safe, allowing future email and manual discoveries to deduplicate against the same SEEK job ID.

## Core design principle

The model is not the source of truth for candidate experience. `resume/facts/profile.yaml` is.

Every generated claim must be traceable to approved evidence. Missing evidence becomes a gap, not a fabricated resume bullet.

## AI and search architecture

JobPilot keeps language-model analysis separate from web search.

```text
Job / candidate facts ───────┐
                             ├──> AI provider ──> structured analysis / documents
Market evidence / web search ┘
```

DeepSeek is the default AI provider. The server uses its OpenAI-compatible chat-completions API directly, so the web app does not require the OpenAI SDK.

Salary Intelligence never asks the model to invent live market evidence. It analyses only supplied sources: salary-bearing jobs already stored in JobPilot plus optional live web-search results. Live search currently supports Serper when `SERPER_API_KEY` is configured.

## Stack

- **Web:** Next.js + TypeScript
- **Data/AI services:** Python + provider-agnostic LLM layer
- **Default LLM:** DeepSeek
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

Create an ignored `.env.local` from `.env.example`. For the default DeepSeek setup:

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY="your-key"
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

For live Salary Intelligence web evidence, optionally add:

```env
SERPER_API_KEY="your-key"
```

Without a search key, Salary Intelligence can still use salary evidence already present in the JobPilot jobs table; it must lower confidence when evidence is sparse.

Then run:

```bash
npm run dev
```

Open `http://localhost:3000`.

The dashboard queries Postgres and calls AI/search providers server-side; credentials are never exposed to browser JavaScript.

## Application lifecycle

`discovered -> analyzed -> shortlisted -> documents_ready -> applied -> screening -> interview -> final_interview -> offer`

Terminal/alternative states: `rejected`, `withdrawn`, `expired`, `skipped`.

## V0.2 workspace

Each job workspace includes:

- detailed match breakdown and evidence;
- `Generate Resume` and `Generate Cover Letter` workflow actions;
- `Mark as Applied` application tracking;
- Salary Intelligence with market range, recommended ask, confidence and evidence links.

The document generation actions currently create auditable generation requests. The strict LaTeX renderer is being connected next; it must preserve the approved template's fonts, macros and layout and may only change evidence-grounded content.

## Privacy

Never commit Gmail credentials, OAuth tokens, AI API keys, database passwords, generated private application documents, SEEK tracking tokens, or local font binaries. See `.gitignore` and `AGENTS.md`.
