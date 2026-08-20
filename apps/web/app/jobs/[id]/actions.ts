"use server";

import { revalidatePath } from "next/cache";
import OpenAI from "openai";

import { sql } from "../../../lib/db";

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
      ${JSON.stringify({ document_type: documentType })}::jsonb
    )
  `;
  revalidatePath(`/jobs/${jobId}`);
}

type SalaryResult = {
  estimate_min: number;
  estimate_max: number;
  recommended_ask: number;
  currency: "NZD";
  period: "hour" | "day" | "week" | "month" | "year";
  confidence: "low" | "medium" | "high";
  comparable_count: number;
  rationale: string;
  evidence: Array<{
    title: string;
    company: string;
    location: string;
    salary: string;
    source_url: string;
  }>;
};

export async function refreshSalaryIntelligence(jobId: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for Salary Intelligence");
  }

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

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5.6",
    store: false,
    tools: [{ type: "web_search" }],
    input: `Research current New Zealand market compensation for this job. Search recent comparable job advertisements and reliable salary sources, prioritising the same city, similar responsibilities, seniority and technology stack. Do not invent salaries when a source does not disclose one. Normalise the final estimate to NZD and choose the most appropriate pay period.\n\nRole: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location ?? "New Zealand"}\nAdvertised salary: ${job.salary_text ?? "Not disclosed"}\nJob description:\n${(job.jd_clean ?? "").slice(0, 12000)}\n\nReturn a market range, a realistic recommended ask for this candidate to use on an application form, confidence, and the comparable roles actually used.`,
    text: {
      format: {
        type: "json_schema",
        name: "salary_intelligence",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            estimate_min: { type: "number" },
            estimate_max: { type: "number" },
            recommended_ask: { type: "number" },
            currency: { type: "string", enum: ["NZD"] },
            period: { type: "string", enum: ["hour", "day", "week", "month", "year"] },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            comparable_count: { type: "integer", minimum: 0 },
            rationale: { type: "string" },
            evidence: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  company: { type: "string" },
                  location: { type: "string" },
                  salary: { type: "string" },
                  source_url: { type: "string" }
                },
                required: ["title", "company", "location", "salary", "source_url"]
              }
            }
          },
          required: [
            "estimate_min", "estimate_max", "recommended_ask", "currency", "period",
            "confidence", "comparable_count", "rationale", "evidence"
          ]
        }
      }
    }
  });

  const result = JSON.parse(response.output_text) as SalaryResult;
  if (result.estimate_min > result.estimate_max) {
    throw new Error("Salary Intelligence returned an invalid range");
  }

  await sql`
    insert into salary_estimates (
      job_id, estimate_min, estimate_max, recommended_ask, currency, period,
      confidence, comparable_count, evidence, rationale, source_model, calculated_at
    ) values (
      ${jobId}::uuid, ${result.estimate_min}, ${result.estimate_max}, ${result.recommended_ask},
      ${result.currency}, ${result.period}, ${result.confidence}, ${result.comparable_count},
      ${JSON.stringify(result.evidence)}::jsonb, ${result.rationale}, 'gpt-5.6-web-search', now()
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
