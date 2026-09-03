import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";

import type { Profile } from "../lib/evidence";

process.env.DATABASE_URL ||= "postgres://jobpilot:jobpilot@127.0.0.1:5432/jobpilot";

const execFileAsync = promisify(execFile);
async function main() {
  const repository = path.resolve(process.cwd(), "../..");
  const output = path.join(repository, "tmp/pdfs/regression");
  await mkdir(output, { recursive: true });

  const evidence = await import("../lib/evidence");
  const documents = await import("../lib/documents");
  const jobSources = await import("../lib/job-sources");
  const profile = YAML.parse(await readFile(path.join(repository, "resume/facts/profile.yaml"), "utf8")) as Profile;
  const linkedIn = jobSources.detectPlatform("https://www.linkedin.com/jobs/view/data-engineer-4123456789?trk=email");
  if (linkedIn.platform !== "linkedin" || jobSources.externalIdForUrl(linkedIn.platform, linkedIn.url) !== "4123456789") {
    throw new Error("LinkedIn URL detection failed");
  }
  if (jobSources.detectPlatform("https://www.zeil.com/jobs/data-engineer").platform !== "zeil") throw new Error("ZEIL URL detection failed");
  if (jobSources.detectPlatform("https://www.trademe.co.nz/a/jobs/it/listing/5123456789").platform !== "trademe") throw new Error("Trade Me URL detection failed");
  const parsedPosting = jobSources.parseJobPostingHtml(`<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Data Engineer",
    description: "<p>Build reliable data pipelines.</p>",
    hiringOrganization: { name: "Example Co" },
    jobLocation: { address: { addressLocality: "Christchurch", addressCountry: "NZ" } },
  })}</script>`);
  if (parsedPosting.title !== "Data Engineer" || parsedPosting.company !== "Example Co") throw new Error("JobPosting parser failed");
  const registry = evidence.evidenceRegistry(profile);
  const terms = evidence.requirementTerms({}, "Data Engineer role requiring Python, SQL, ETL, Spark, Azure, data quality, Linux and stakeholder communication.");
  const requirementMap = evidence.mapRequirements(terms, registry);
  const plan = evidence.validateResumePlan(profile, {
  target_title: "Data Engineer",
  positioning: ["Python", "SQL", "ETL", "Spark", "Azure"],
  summary_fact_indexes: [0, 1, 2],
  experience: profile.experience.map((item) => ({ id: item.id, fact_ids: item.facts.map((fact) => fact.id) })),
  project_ids: ["as400_data_quality_toolkit", "db_ops_alert_triage", "kpi_dashboard_suite", "human_movement_data_integration"],
  selected_skills: ["Python", "SQL", "Spark", "Azure", "Airflow", "PostGIS", "dbt", "Linux", "Git", "Excel", "REST APIs"],
  }, requirementMap, registry);

  if (plan.project_ids.some((id) => ["as400_data_quality_toolkit", "db_ops_alert_triage", "kpi_dashboard_suite"].includes(id))) {
    throw new Error("Duplicate work-derived project survived validation");
  }
  if (plan.selected_skills.some((skill) => /Spark|Azure|Airflow/.test(skill))) {
    throw new Error("Unsupported skill survived evidence validation");
  }

  let compact = false;
  let snapshot = evidence.buildResumeSnapshot(profile, plan, compact);
  const texPath = path.join(output, "resume.tex");
  await writeFile(texPath, await documents.renderResumeTex(profile, snapshot), "utf8");
  await execFileAsync("xelatex", ["-interaction=nonstopmode", "-halt-on-error", "resume.tex"], {
    cwd: output,
    env: { ...process.env, TEXINPUTS: `${path.join(repository, "resume/master")}:` },
    timeout: 60000,
  });
  let layout = await documents.inspectPdf(
    path.join(output, "resume.pdf"),
    documents.estimateResumePageBudget(profile, snapshot),
  );
  if (layout.status === "fail") {
    compact = true;
    snapshot = evidence.buildResumeSnapshot(profile, plan, compact);
    await writeFile(texPath, await documents.renderResumeTex(profile, snapshot), "utf8");
    await execFileAsync("xelatex", ["-interaction=nonstopmode", "-halt-on-error", "resume.tex"], {
      cwd: output,
      env: { ...process.env, TEXINPUTS: `${path.join(repository, "resume/master")}:` },
      timeout: 60000,
    });
    layout = await documents.inspectPdf(
      path.join(output, "resume.pdf"),
      documents.estimateResumePageBudget(profile, snapshot),
    );
  }
  if (layout.status !== "pass") throw new Error(`Layout failed: ${JSON.stringify(layout)}`);
  const renderedEvidence = JSON.stringify({ experience: snapshot.experience, projects: snapshot.projects });
  if (renderedEvidence.includes("20% improvement in data accuracy") || renderedEvidence.includes("99.9% data integrity")) {
    throw new Error("A needs-review metric survived the verified evidence filter");
  }
  const profileValidation = documents.validateCandidateProfile(profile);
  if (profileValidation.contactIssues.length || profileValidation.timelineIssues.length) {
    throw new Error(`Candidate validation failed: ${JSON.stringify(profileValidation)}`);
  }

  const manualIds = new Set(["summary:0", "summary:1", "tianyuan_alert_triage"]);
  const manualRegistry = evidence.applyEvidenceControls(registry, [], manualIds);
  const manualPlan = evidence.validateResumePlan(profile, {
    target_title: "Data Engineer",
    positioning: ["Python", "SQL", "automation"],
    summary_fact_indexes: [0, 1, 2],
    experience: profile.experience.map((item) => ({ id: item.id, fact_ids: item.facts.map((fact) => fact.id) })),
    project_ids: profile.projects.map((item) => item.id),
    selected_skills: ["Python", "SQL", "Linux", "PostGIS"],
  }, requirementMap, manualRegistry);
  const manualSnapshot = evidence.buildResumeSnapshot(profile, manualPlan, false, manualRegistry);
  if (manualSnapshot.selected_evidence_ids.some((id) => !manualIds.has(id))) {
    throw new Error("Manual evidence selection was not enforced");
  }

  const coverTexPath = path.join(output, "cover-letter.tex");
  const coverDraft = {
    paragraphs: [
      {
        purpose: "motivation" as const,
        text: "I am applying for the Data Engineer role because it closely matches my background in data engineering, database operations, and applied data science.",
        evidence_ids: ["summary:0", "summary:1"],
        job_requirements: ["data engineering"],
      },
      {
        purpose: "evidence" as const,
        text: "My commercial experience includes building SQL-based reconciliation checks and working with BA and QA colleagues to validate edge cases, which is directly relevant to reliable pipeline delivery and data quality.",
        evidence_ids: ["chinasoft_reconciliation", "chinasoft_validation"],
        job_requirements: ["SQL", "data quality"],
      },
      {
        purpose: "evidence" as const,
        text: "I have also automated database alert triage with Python and SQL, turning repetitive incident work into a faster and more consistent operational process.",
        evidence_ids: ["tianyuan_alert_triage"],
        job_requirements: ["Python", "automation"],
      },
      {
        purpose: "closing" as const,
        text: "I would welcome the opportunity to discuss how this combination of practical engineering experience and applied data study could contribute to the team.",
        evidence_ids: ["summary:0", "summary:1"],
        job_requirements: [] as string[],
      },
    ],
  };
  const frozenEvidence = new Set(snapshot.selected_evidence_ids);
  const unmappedCoverEvidence = coverDraft.paragraphs.flatMap((paragraph) => paragraph.evidence_ids)
    .filter((evidenceId) => !frozenEvidence.has(evidenceId));
  if (unmappedCoverEvidence.length) {
    throw new Error(`Cover letter used evidence absent from the final resume: ${unmappedCoverEvidence.join(", ")}`);
  }
  const copiedPhrases = documents.deterministicCopiedPhrases(snapshot, coverDraft);
  if (copiedPhrases.length) throw new Error(`Cover letter copied resume phrases: ${copiedPhrases.join("; ")}`);
  await writeFile(coverTexPath, documents.renderCoverLetterTex(profile, "Example New Zealand Company", "Data Engineer", coverDraft), "utf8");
  await execFileAsync("xelatex", ["-interaction=nonstopmode", "-halt-on-error", "cover-letter.tex"], {
    cwd: output,
    env: process.env,
    timeout: 60000,
  });
  const coverLayout = await documents.inspectPdf(path.join(output, "cover-letter.pdf"));
  if (coverLayout.status !== "pass" || coverLayout.page_count !== 1) {
    throw new Error(`Cover letter layout failed: ${JSON.stringify(coverLayout)}`);
  }

  await writeFile(path.join(output, "result.json"), JSON.stringify({ plan, compact, layout, coverLayout, snapshot }, null, 2), "utf8");
  console.log(JSON.stringify({ project_ids: plan.project_ids, skills: plan.selected_skills, compact, layout, coverLayout }, null, 2));
}

void main();
