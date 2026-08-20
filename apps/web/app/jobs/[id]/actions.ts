"use server";

import { revalidatePath } from "next/cache";

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
