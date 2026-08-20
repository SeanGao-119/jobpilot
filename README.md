# JobPilot

JobPilot is a personal job-application operating system for discovering roles, measuring fit, generating evidence-grounded application documents, estimating market compensation, and tracking outcomes.

## Current vertical slice

JobPilot has a working end-to-end path:

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
Next.js dashboard + job workspace
```

A real 12-job SEEK recommendation batch has been parsed, ranked and persisted successfully.

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
