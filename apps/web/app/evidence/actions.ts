"use server";

import { revalidatePath } from "next/cache";

import {
  resetJobEvidenceSelection,
  saveEvidenceControl,
  saveJobEvidenceSelection,
} from "../../lib/evidence-store";
import type { EvidenceStatus } from "../../lib/evidence";

export async function updateEvidenceControl(formData: FormData) {
  const evidenceId = String(formData.get("evidence_id") ?? "").trim();
  const status = String(formData.get("status") ?? "verified") as EvidenceStatus;
  const locked = formData.get("locked") === "on";
  const notes = String(formData.get("notes") ?? "").slice(0, 500);
  await saveEvidenceControl({ evidenceId, status, locked, notes });
  revalidatePath("/evidence");
}

export async function updateJobEvidence(jobId: string, formData: FormData) {
  const evidenceIds = formData.getAll("evidence_ids").map(String);
  await saveJobEvidenceSelection(jobId, evidenceIds);
  revalidatePath(`/jobs/${jobId}`);
}

export async function useAutomaticEvidence(jobId: string) {
  await resetJobEvidenceSelection(jobId);
  revalidatePath(`/jobs/${jobId}`);
}
