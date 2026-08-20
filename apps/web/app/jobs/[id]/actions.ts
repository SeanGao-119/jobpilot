"use server";

import { revalidatePath } from "next/cache";

import { aiProviderName, generateJson } from "../../../lib/ai";
import { sql } from "../../../lib/db";
import { generateCoverLetter, generateResume } from "../../../lib/documents";
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

export async function requestDocument(jobId: string, documentType: "resume" | "cover_letter") {
  const applicationId = await ensureApplication(jobId);
  await sql`
    insert into application_events (
      application_id, event_type, source, details
    ) values (
      ${applicationId}::uuid,
      'document_generation_requested',
      'dashboard',
      ${JSON.stringify({ document_type: documentType, ai_provider: aiProviderName() })}::jsonb
    )
  `;

  const result = documentType === "resume"
    ? await generateResume(jobId)
    : await generateCoverLetter(jobId);

  await sql`
    insert into application_events (
      application_id, event_type, source, details
    ) values (
      ${applicationId}::uuid,
      'document_generated',
      'dashboard',
      ${JSON.stringify({ document_type: documentType, ...result })}::jsonb
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

function isSalaryResult(value: unknown): value is SalaryResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SalaryResult>;
  return (
    typeof item.estimate_min === "number" &&
    typeof item.estimate_max === "number" &&
    typeof item.recommended_ask === "number" &&
    item.currency === "NZD" &&
    ["hour", "day", "week", "month", "year"].includes(item.period ?? "") &&
    ["low", "medium", "high"].includes(item.confidence ?? "") &&
    typeof item.rationale === "string" &&
    Array.isArray(item.evidence)
  );
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

  const result = await generateJson<SalaryResult>({
    system: [
      "You are JobPilot Salary Intelligence for New Zealand employment.",
      "Use ONLY the supplied evidence. Never invent salary figures, employers, URLs, or job advertisements.",
      "If evidence is weak, sparse, or contains snippets without explicit salary figures, lower confidence accordingly.",
      "Return valid JSON only with keys: estimate_min, estimate_max, recommended_ask, currency, period, confidence, comparable_count, rationale, evidence.",
      "currency must be NZD. evidence must contain only sources actually used.",
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
      instructions: [
        "Estimate a defensible market compensation range for the target role.",
        "Prioritise same/similar title, location, seniority, responsibilities and technology stack.",
        "Normalise annual full-time salaries to NZD/year where possible.",
        "recommended_ask should be realistic for an application salary expectation, not simply the maximum.",
      ],
    }),
  });

  if (!isSalaryResult(result)) throw new Error("Salary Intelligence returned invalid JSON");
  if (result.estimate_min > result.estimate_max) {
    throw new Error("Salary Intelligence returned an invalid range");
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
