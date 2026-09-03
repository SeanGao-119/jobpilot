"use server";

import { revalidatePath } from "next/cache";

import { aiProviderName, generateJson } from "../../../lib/ai";
import { sql } from "../../../lib/db";
import { generateApplicationPacket } from "../../../lib/documents";
import { searchProviderName, searchWeb } from "../../../lib/search";

async function ensureApplication(jobId: string) {
  const rows = await sql<{ id: string }[]>`
    insert into applications (job_id, status)
    values (${jobId}::uuid, 'discovered'::application_status)
    on conflict (job_id) do update set updated_at = now()
    returning id::text
  `;
  return rows[0].id;
}

export async function markApplied(jobId: string) {
  const applicationId = await ensureApplication(jobId);
  await sql`
    update applications
    set status = 'applied'::application_status,
        applied_at = coalesce(applied_at, now()),
        application_method = coalesce(application_method, 'seek'),
        updated_at = now()
    where id = ${applicationId}::uuid
  `;
  await sql`
    insert into application_events (
      application_id, event_type, to_status, source, details
    ) values (
      ${applicationId}::uuid,
      'application_submitted',
      'applied'::application_status,
      'manual',
      '{"application_method":"seek"}'::jsonb
    )
  `;
  revalidatePath("/");
  revalidatePath(`/jobs/${jobId}`);
}

export async function generateApplication(jobId: string) {
  const applicationId = await ensureApplication(jobId);
  await sql`
    insert into application_events (
      application_id, event_type, source, details
    ) values (
      ${applicationId}::uuid,
      'application_packet_generation_requested',
      'dashboard',
      ${JSON.stringify({ documents: ["resume", "cover_letter"], ai_provider: aiProviderName() })}::jsonb
    )
  `;

  const result = await generateApplicationPacket(jobId);

  await sql`
    insert into application_events (
      application_id, event_type, source, details
    ) values (
      ${applicationId}::uuid,
      'application_packet_generation_completed',
      'dashboard',
      ${JSON.stringify({ ready: result.qa.ready, provider: result.provider })}::jsonb
    )
  `;

  revalidatePath("/");
  revalidatePath(`/jobs/${jobId}`);
}

type SalaryEvidence = {
  title: string;
  company: string;
  location: string;
  salary: string;
  source_url: string;
};

type SalaryResult = {
  estimate_min: number;
  estimate_max: number;
  recommended_ask: number;
  currency: "NZD";
  period: "hour" | "day" | "week" | "month" | "year";
  confidence: "low" | "medium" | "high";
  comparable_count: number;
  rationale: string;
  evidence: SalaryEvidence[];
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePeriod(value: unknown): SalaryResult["period"] | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (["hour", "hourly", "per hour", "hr"].includes(text)) return "hour";
  if (["day", "daily", "per day"].includes(text)) return "day";
  if (["week", "weekly", "per week"].includes(text)) return "week";
  if (["month", "monthly", "per month"].includes(text)) return "month";
  if (["year", "yearly", "annual", "annually", "per year", "pa", "p.a."].includes(text)) return "year";
  return null;
}

function normalizeConfidence(value: unknown): SalaryResult["confidence"] | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (["low", "medium", "high"].includes(text)) return text as SalaryResult["confidence"];
  if (["moderate", "mid"].includes(text)) return "medium";
  return null;
}

function normalizeEvidence(value: unknown): SalaryEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const title = String(row.title ?? "").trim();
    const company = String(row.company ?? "").trim();
    const location = String(row.location ?? "New Zealand").trim() || "New Zealand";
    const salary = String(row.salary ?? row.salary_text ?? "").trim();
    const sourceUrl = String(row.source_url ?? row.url ?? "").trim();
    if (!title || !salary || !sourceUrl) return [];
    return [{ title, company: company || "Unknown", location, salary, source_url: sourceUrl }];
  });
}

function normalizeSalaryResult(value: unknown): SalaryResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const estimateMin = asNumber(item.estimate_min ?? item.min_salary ?? item.salary_min);
  const estimateMax = asNumber(item.estimate_max ?? item.max_salary ?? item.salary_max);
  const recommendedAsk = asNumber(item.recommended_ask ?? item.ask ?? item.recommended_salary);
  const period = normalizePeriod(item.period ?? item.salary_period);
  const confidence = normalizeConfidence(item.confidence);
  const rationale = String(item.rationale ?? item.reasoning ?? "").trim();
  const evidence = normalizeEvidence(item.evidence ?? item.comparables ?? item.sources);

  if (estimateMin == null || estimateMax == null || recommendedAsk == null || !period || !confidence || !rationale) {
    return null;
  }

  return {
    estimate_min: estimateMin,
    estimate_max: estimateMax,
    recommended_ask: recommendedAsk,
    currency: "NZD",
    period,
    confidence,
    comparable_count: evidence.length,
    rationale,
    evidence,
  };
}

export async function refreshSalaryIntelligence(jobId: string) {
  const rows = await sql<{
    title: string;
    company: string;
    location: string | null;
    salary_text: string | null;
    jd_clean: string | null;
  }[]>`
    select title, company, location, salary_text, jd_clean
    from jobs
    where id = ${jobId}::uuid
    limit 1
  `;
  const job = rows[0];
  if (!job) throw new Error("Job not found");

  const localComparables = await sql<{
    title: string;
    company: string;
    location: string | null;
    salary_text: string | null;
    source_url: string | null;
  }[]>`
    select title, company, location, salary_text, source_url
    from jobs
    where id <> ${jobId}::uuid
      and salary_text is not null
      and trim(salary_text) <> ''
    order by discovered_at desc
    limit 20
  `;

  const query = `${job.title} ${job.location ?? "New Zealand"} salary jobs NZ SEEK`;
  const webHits = await searchWeb(query, 12);

  const sourceRows = [
    ...(job.salary_text ? [{
      title: job.title,
      company: job.company,
      location: job.location ?? "New Zealand",
      salary: job.salary_text,
      source_url: "target-job",
      source_type: "target_job"
    }] : []),
    ...localComparables.map((item) => ({
      title: item.title,
      company: item.company,
      location: item.location ?? "New Zealand",
      salary: item.salary_text ?? "",
      source_url: item.source_url ?? "",
      source_type: "jobpilot_database"
    })),
    ...webHits.map((item) => ({
      title: item.title,
      company: "Unknown until source is verified",
      location: job.location ?? "New Zealand",
      salary: item.snippet,
      source_url: item.source_url,
      source_type: "web_search"
    })),
  ];

  if (sourceRows.length === 0) {
    throw new Error(
      "No salary evidence is available. Add SERPER_API_KEY for live web search or ingest jobs with disclosed salaries.",
    );
  }

  const rawResult = await generateJson<Record<string, unknown>>({
    system: [
      "You are JobPilot Salary Intelligence for New Zealand employment.",
      "Use ONLY the supplied evidence. Never invent salary figures, employers, URLs, or job advertisements.",
      "Return ONE JSON object only, with no markdown.",
      "Use numeric JSON values, not strings, for estimate_min, estimate_max and recommended_ask.",
      "Use currency exactly NZD.",
      "Use period exactly one of: hour, day, week, month, year.",
      "Use confidence exactly one of: low, medium, high.",
      "Evidence must be an array of objects with exactly title, company, location, salary, source_url.",
      "If evidence is weak or sparse, use low confidence instead of inventing data.",
    ].join(" "),
    user: JSON.stringify({
      target_job: {
        title: job.title,
        company: job.company,
        location: job.location ?? "New Zealand",
        advertised_salary: job.salary_text ?? "Not disclosed",
        description: (job.jd_clean ?? "").slice(0, 12000),
      },
      evidence_sources: sourceRows,
      required_output_shape: {
        estimate_min: 70000,
        estimate_max: 85000,
        recommended_ask: 80000,
        currency: "NZD",
        period: "year",
        confidence: "medium",
        comparable_count: 3,
        rationale: "brief evidence-based explanation",
        evidence: [
          {
            title: "Example role",
            company: "Example company",
            location: "Auckland",
            salary: "$75,000-$85,000",
            source_url: "https://example.com/job"
          }
        ]
      },
      instructions: [
        "Estimate a defensible market compensation range for the target role.",
        "Prioritise same/similar title, location, seniority, responsibilities and technology stack.",
        "Normalise annual full-time salaries to NZD/year where possible.",
        "recommended_ask should be realistic for an application salary expectation, not simply the maximum.",
      ],
    }),
  });

  const result = normalizeSalaryResult(rawResult);
  if (!result) {
    console.error("Salary Intelligence raw result failed normalization", rawResult);
    throw new Error("Salary Intelligence returned an unsupported JSON shape; check the server terminal for the normalized-safe raw response.");
  }
  if (result.estimate_min > result.estimate_max) {
    [result.estimate_min, result.estimate_max] = [result.estimate_max, result.estimate_min];
  }

  const allowedUrls = new Set(sourceRows.map((item) => item.source_url).filter(Boolean));
  const evidence = result.evidence.filter((item) => item.source_url === "target-job" || allowedUrls.has(item.source_url));
  const comparableCount = evidence.filter((item) => item.source_url !== "target-job").length;

  await sql`
    insert into salary_estimates (
      job_id, estimate_min, estimate_max, recommended_ask, currency, period,
      confidence, comparable_count, evidence, rationale, source_model, calculated_at
    ) values (
      ${jobId}::uuid, ${result.estimate_min}, ${result.estimate_max}, ${result.recommended_ask},
      ${result.currency}, ${result.period}, ${result.confidence}, ${comparableCount},
      ${JSON.stringify(evidence)}::jsonb, ${result.rationale},
      ${`${aiProviderName()}:${process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || "default"}+search:${searchProviderName()}`}, now()
    )
    on conflict (job_id) do update set
      estimate_min = excluded.estimate_min,
      estimate_max = excluded.estimate_max,
      recommended_ask = excluded.recommended_ask,
      currency = excluded.currency,
      period = excluded.period,
      confidence = excluded.confidence,
      comparable_count = excluded.comparable_count,
      evidence = excluded.evidence,
      rationale = excluded.rationale,
      source_model = excluded.source_model,
      calculated_at = now()
  `;

  revalidatePath(`/jobs/${jobId}`);
}
