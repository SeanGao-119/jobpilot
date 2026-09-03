# JobPilot

JobPilot is a personal job-application operating system for discovering roles, measuring fit, generating evidence-grounded application documents, estimating market compensation, and tracking outcomes.

## Current vertical slice

JobPilot has a working end-to-end path:

```text
SEEK + LinkedIn job-alert email
        ↓
manual SEEK / LinkedIn / ZEIL / Trade Me URL
        ↓
platform-safe job detail ingestion
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

## V0.6 application workspace

Each job workspace includes:

- detailed match breakdown and evidence;
- a Master Evidence Bank with `Verified`, `Draft`, `Needs review`, and exact-fact locks;
- automatic or per-job manual evidence selection;
- one `Generate Application` action that freezes the resume before writing the cover letter;
- requirement-to-evidence mapping and evidence coverage;
- duplicate work/project suppression and evidence-backed skill selection;
- resume/cover-letter consistency checks and visible quality gates;
- normalized application-packet and evidence-mapping records in PostgreSQL;
- `Mark as Applied` application tracking;
- Salary Intelligence with market range, recommended ask, confidence and evidence links.

Generated documents use a deterministic A4 XeLaTeX renderer with section-level line budgets and PDF balance inspection. The cover letter can only use evidence IDs present in the frozen final resume; copied resume phrases, broken locks, invalid contact details, timeline errors, unsupported claims, and layout failures block `Ready to apply`.

Manual imports accept SEEK, LinkedIn, ZEIL and Trade Me Jobs URLs. LinkedIn recruiter and network links can also be retained in the pool. The daily Gmail sync imports both SEEK and LinkedIn job-alert emails; override its LinkedIn query with `GMAIL_LINKEDIN_QUERY` when needed.

Apply the V0.6 database migration before opening the updated dashboard:

```bash
psql "$DATABASE_URL" -f database/migrations/004_application_packets_and_sources.sql
```

Run the document regression test with XeLaTeX and Poppler installed:

```bash
cd apps/web
npm run test:documents
```

## Privacy

Never commit Gmail credentials, OAuth tokens, AI API keys, database passwords, generated private application documents, SEEK tracking tokens, or local font binaries. See `.gitignore` and `AGENTS.md`.
