import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { sql } from "./db";
import { evidenceBankFixture } from "./qa-fixtures";
import {
  applyEvidenceControls,
  evidenceRegistry,
  type EvidenceControl,
  type EvidenceItem,
  type EvidenceStatus,
  type Profile,
} from "./evidence";

const repositoryRoot = () =>
  process.env.JOBPILOT_REPOSITORY_ROOT?.trim() || path.resolve(process.cwd(), "../..");

export type EvidenceBankItem = EvidenceItem & {
  content_hash: string;
  notes: string | null;
};

export type EvidenceSelection = {
  mode: "auto" | "manual";
  evidence_ids: string[];
};

export function evidenceContentHash(item: Pick<EvidenceItem, "id" | "text" | "tags">) {
  return createHash("sha256")
    .update(JSON.stringify({ id: item.id, text: item.text, tags: item.tags }))
    .digest("hex");
}

export async function loadProfile(): Promise<Profile> {
  return YAML.parse(
    await readFile(path.join(repositoryRoot(), "resume/facts/profile.yaml"), "utf8"),
  ) as Profile;
}

export async function loadEvidenceControls(): Promise<EvidenceControl[]> {
  if (process.env.JOBPILOT_QA_FIXTURE === "1") return [];
  return sql<EvidenceControl[]>`
    select evidence_id, status::text, locked, content_hash, notes
    from evidence_controls
    order by evidence_id
  `;
}

export async function getEvidenceBank(): Promise<EvidenceBankItem[]> {
  if (process.env.JOBPILOT_QA_FIXTURE === "1") return evidenceBankFixture();
  const [profile, controls] = await Promise.all([loadProfile(), loadEvidenceControls()]);
  const controlsById = new Map(controls.map((control) => [control.evidence_id, control]));
  return evidenceRegistry(profile).map((item) => {
    const control = controlsById.get(item.id);
    return {
      ...item,
      status: control?.status ?? item.status,
      locked: control?.locked ?? item.locked,
      content_hash: evidenceContentHash(item),
      notes: control?.notes ?? null,
    };
  });
}

export async function saveEvidenceControl(input: {
  evidenceId: string;
  status: EvidenceStatus;
  locked: boolean;
  notes: string;
}) {
  const bank = await getEvidenceBank();
  const item = bank.find((candidate) => candidate.id === input.evidenceId);
  if (!item) throw new Error("Evidence item not found");
  if (!(["verified", "draft", "needs_review"] as string[]).includes(input.status)) {
    throw new Error("Unsupported evidence status");
  }
  await sql`
    insert into evidence_controls (evidence_id, status, locked, content_hash, notes)
    values (
      ${item.id}, ${input.status}::evidence_status, ${input.locked},
      ${item.content_hash}, ${input.notes.trim() || null}
    )
    on conflict (evidence_id) do update set
      status = excluded.status,
      locked = excluded.locked,
      content_hash = excluded.content_hash,
      notes = excluded.notes,
      updated_at = now()
  `;
}

export async function getJobEvidenceSelection(jobId: string): Promise<EvidenceSelection> {
  if (process.env.JOBPILOT_QA_FIXTURE === "1") return { mode: "auto", evidence_ids: [] };
  const preferences = await sql<Array<{ selection_mode: "auto" | "manual" }>>`
    select selection_mode::text
    from job_evidence_preferences
    where job_id = ${jobId}::uuid
    limit 1
  `;
  if (preferences[0]?.selection_mode !== "manual") {
    return { mode: "auto", evidence_ids: [] };
  }
  const rows = await sql<Array<{ evidence_id: string }>>`
    select evidence_id
    from job_evidence_selections
    where job_id = ${jobId}::uuid
    order by evidence_id
  `;
  return { mode: "manual", evidence_ids: rows.map((row) => row.evidence_id) };
}

export async function saveJobEvidenceSelection(jobId: string, evidenceIds: string[]) {
  const bank = await getEvidenceBank();
  const usable = new Set(bank.filter((item) => item.status === "verified").map((item) => item.id));
  const selected = [...new Set(evidenceIds)].filter((id) => usable.has(id));
  await sql.begin(async (transaction) => {
    await transaction`
      insert into job_evidence_preferences (job_id, selection_mode)
      values (${jobId}::uuid, 'manual'::evidence_selection_mode)
      on conflict (job_id) do update set selection_mode = excluded.selection_mode, updated_at = now()
    `;
    await transaction`delete from job_evidence_selections where job_id = ${jobId}::uuid`;
    for (const evidenceId of selected) {
      await transaction`
        insert into job_evidence_selections (job_id, evidence_id)
        values (${jobId}::uuid, ${evidenceId})
      `;
    }
  });
}

export async function resetJobEvidenceSelection(jobId: string) {
  await sql.begin(async (transaction) => {
    await transaction`
      insert into job_evidence_preferences (job_id, selection_mode)
      values (${jobId}::uuid, 'auto'::evidence_selection_mode)
      on conflict (job_id) do update set selection_mode = excluded.selection_mode, updated_at = now()
    `;
    await transaction`delete from job_evidence_selections where job_id = ${jobId}::uuid`;
  });
}

export async function generationEvidence(jobId: string) {
  const [profile, controls, selection] = await Promise.all([
    loadProfile(),
    loadEvidenceControls(),
    getJobEvidenceSelection(jobId),
  ]);
  const manualSelection = selection.mode === "manual" ? new Set(selection.evidence_ids) : null;
  const registry = applyEvidenceControls(evidenceRegistry(profile), controls, manualSelection);
  return { profile, registry, selection };
}
