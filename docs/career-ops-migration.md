# JobPilot V1.0 — career-ops migration map

This document defines how JobPilot adopts `career-ops` without giving up the NZ-specific ingestion, evidence provenance, PostgreSQL/Supabase persistence, or deployable Next.js experience already present in JobPilot.

## Target architecture

```text
SEEK / LinkedIn email     SEEK NZ URL     ZEIL / Trade Me / manual
        |                    |                    |
        +--------------------+--------------------+
                             |
                    JobPilot ingestion layer
                             |
                    PostgreSQL / Supabase
                             |
              +--------------+--------------+
              |                             |
      JobPilot evidence layer       career-ops engine adapter
      - profile.yaml                 - A-H evaluation
      - evidence controls            - legitimacy / ghost-job check
      - evidence selection           - level / compensation strategy
      - packet provenance            - interview preparation
              |                      - CV tailoring / ATS gates
              +--------------+--------------+
                             |
                    JobPilot application packet
                             |
                    Next.js dashboard / lifecycle
```

`career-ops` is an engine dependency, not the source of truth. It receives a temporary read-only projection of approved JobPilot facts and returns structured analysis. It must not own JobPilot persistence.

## Directory-by-directory decision

| Current JobPilot area | Decision | V1.0 role |
| --- | --- | --- |
| `apps/web/` | **KEEP** | Primary UX. Continue using Next.js and Postgres/Supabase. Borrow career-ops UX ideas selectively; do not replace with its alpha local-only web UI. |
| `database/` | **KEEP / EXTEND** | Canonical state, source provenance, evidence controls, packets and application history remain in PostgreSQL. Add career-ops evaluation payloads/version metadata later. |
| `services/ingestion/` | **KEEP** | Canonical NZ-facing ingestion. SEEK NZ, SEEK/LinkedIn email, ZEIL and Trade Me support stay here. career-ops scanner results can enter through an adapter as another source. |
| `services/storage/` | **KEEP** | Postgres remains the source of truth. career-ops Markdown tracker is not adopted as canonical storage. |
| `resume/facts/` | **KEEP** | Master Evidence Bank / approved candidate facts remain authoritative. |
| `services/career_ops/` | **NEW ADAPTER** | Converts approved facts into career-ops input, invokes the external engine in an isolated data root, validates its machine-readable result, maps score to JobPilot. |
| `services/matching/scorer.py` | **KEEP DURING SHADOW MODE; REPLACE LATER** | Deterministic scorer remains available for A/B comparison and fallback until career-ops output is calibrated on real NZ roles. |
| `services/analysis/requirements.py` | **KEEP DURING SHADOW MODE** | Useful for fast/filter-stage extraction. Long-form fit evaluation should move to career-ops after calibration. |
| `prompts/` | **REDUCE LATER** | Remove prompts that duplicate career-ops evaluation/tailoring once equivalent output is verified. Keep JobPilot-specific evidence and NZ prompts. |
| `resume/master/` XeLaTeX renderer | **REPLACE LATER** | Move final CV rendering to career-ops HTML + Playwright only after the JobPilot evidence packet can drive that renderer deterministically. |
| Salary Intelligence | **KEEP + AUGMENT** | Preserve NZ-specific salary evidence and Serper/search integration; optionally ingest career-ops compensation research as another evidence source. |
| Application packet/evidence mapping | **KEEP** | This is stricter provenance than the upstream file model and remains a JobPilot differentiator. |

## What career-ops should replace

Once shadow-mode accuracy is accepted:

1. Long-form role evaluation and recommendation logic.
2. Requirement importance reasoning and mitigation strategy.
3. Posting legitimacy / scam / ghost-job analysis.
4. Generic compensation and level strategy.
5. Interview story selection and preparation.
6. Company research and contact discovery.
7. Follow-up and rejection-pattern analysis.
8. Generic ATS checks and eventually CV rendering.

## What career-ops should not replace

1. PostgreSQL/Supabase.
2. JobPilot source taxonomy (`manual_url`, `job_alert`, `recommendation`, `recruiter`, `network`).
3. SEEK NZ ingestion and source classification.
4. LinkedIn alert ingestion.
5. ZEIL and Trade Me URL ingestion.
6. Evidence IDs, verification status, locks and hashes.
7. Resume-first freeze / cover-letter evidence restrictions.
8. JobPilot application lifecycle and event history.
9. NZ-specific salary evidence.
10. The deployable JobPilot Next.js dashboard.

## Phase plan

### Phase 1 — Shadow engine (this branch)

- Add `services/career_ops/adapter.py`.
- Keep the current deterministic `score_job()` untouched.
- Feed career-ops only a temporary projection of approved facts.
- Strip `needs_review` metrics before evaluation.
- Invoke `career-ops/openai-eval.mjs` with JobPilot's DeepSeek configuration.
- Parse the upstream `SCORE_SUMMARY` contract and map `0–5` to `0–100`.
- Do not write career-ops tracker/report files into JobPilot.
- Compare both engines on real NZ jobs before changing ranking behaviour.

### Phase 2 — Persist shadow results

Add a migration for a versioned evaluation store. Preferred shape:

```sql
create table job_engine_evaluations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  engine text not null,
  engine_version text,
  model text,
  score numeric(5,2),
  recommendation text,
  archetype text,
  legitimacy text,
  report jsonb,
  created_at timestamptz not null default now()
);
```

Do **not** overload `job_matches` until the new engine has been calibrated. The dashboard can show both scores side-by-side during shadow mode.

### Phase 3 — career-ops becomes primary evaluator

Promotion criteria:

- At least 30 representative NZ jobs evaluated through both engines.
- No unsupported candidate facts introduced in sampled reports.
- Work-rights blockers behave correctly.
- SEEK/LinkedIn/Trade Me/ZEIL source metadata remains intact.
- High-value roles manually judged as good fits are not systematically downgraded.
- Low-value/seniority-mismatched roles are filtered at least as well as the old scorer.

After promotion, deterministic matching becomes a fast pre-filter/fallback rather than the canonical recommendation.

### Phase 4 — document engine migration

Replace XeLaTeX only after:

- JobPilot packet evidence can be serialized into the career-ops CV builder without losing evidence IDs.
- Fact-gate failures are surfaced in the JobPilot workspace.
- Resume and cover-letter consistency remains at least as strict as V0.6.
- A4 output passes regression checks on representative roles.

Then remove the old font/XeLaTeX-specific maintenance path.

### Phase 5 — discovery and career lifecycle modules

Adopt selected upstream modules behind JobPilot adapters:

- company ATS scanning;
- company research;
- contact discovery;
- interview prep;
- follow-up cadence;
- rejection-pattern analytics;
- offer/negotiation helpers.

SEEK NZ remains a JobPilot-owned provider until upstream NZ behaviour is verified and its URL/site-key assumptions are fixed.

## Local shadow evaluation

Clone career-ops separately and install it:

```bash
git clone https://github.com/career-ops-hq/career-ops.git ../career-ops
cd ../career-ops
npm install
cd ../jobpilot
```

Configure JobPilot:

```bash
export JOBPILOT_CAREER_OPS_ROOT="$(cd ../career-ops && pwd)"
export DEEPSEEK_API_KEY="..."
export DEEPSEEK_BASE_URL="https://api.deepseek.com"
export DEEPSEEK_MODEL="deepseek-chat"
```

Evaluate a saved JD without touching Postgres:

```bash
python -m services.career_ops.cli /tmp/job.txt \
  --posting-url "https://www.seek.co.nz/job/12345678"
```

Add `--report` to include the full career-ops evaluation text.

## Upstream update policy

Do not vendor the entire career-ops repository into JobPilot. Keep it as an external versioned engine during the migration. This gives us:

- easy upstream upgrades;
- a small adapter surface;
- clear MIT attribution boundaries;
- no merge conflicts across thousands of unrelated upstream files;
- the ability to pin a known-good version before production use.

Before production promotion, add an explicit supported version/range check and pin the evaluated career-ops release in deployment documentation.
