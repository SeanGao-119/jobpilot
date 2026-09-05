import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { aiProviderName, generateJson } from "./ai";
import { sql } from "./db";
import { evidenceContentHash, generationEvidence } from "./evidence-store";
import {
  buildResumeSnapshot,
  coverageScore,
  type EvidenceItem,
  mapRequirements,
  type Profile,
  type RequirementMatch,
  requirementTerms,
  type ResumePlan,
  type ResumeSnapshot,
  skillEvidenceCatalog,
  validateResumePlan,
} from "./evidence";

const execFileAsync = promisify(execFile);
const GENERATOR_VERSION = "v0.6-application-packet";

const root = () => path.resolve(process.cwd(), "../..");
const outDir = (jobId: string) => path.join(root(), "apps/web/public/generated", jobId);

type JobRecord = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  jd_clean: string | null;
  requirements: unknown;
  posted_at: string | null;
  expires_at: string | null;
};

type CoverParagraph = {
  purpose: "motivation" | "evidence" | "closing";
  text: string;
  evidence_ids: string[];
  job_requirements: string[];
};

type CoverLetterDraft = { paragraphs: CoverParagraph[] };

type ConsistencyResult = {
  alignment_score: number;
  unsupported_claims: string[];
  contradictions: string[];
  copied_phrases: string[];
};

export type PdfLayout = {
  page_count: number;
  page_character_counts: number[];
  second_page_balance: number | null;
  page_fill_ratios: number[];
  budget: PageBudget | null;
  status: "pass" | "fail";
};

export type PageBudget = {
  target_pages: 1 | 2;
  estimated_total_lines: number;
  capacity_lines: number;
  section_line_counts: Record<"summary" | "skills" | "work" | "projects" | "education" | "languages", number>;
  status: "pass" | "fail";
};

export type QaCheck = {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail";
  detail: string;
};

export type ApplicationQaReport = {
  ready: boolean;
  evidence_coverage: number;
  resume_cover_alignment: number;
  unsupported_claims: string[];
  contradictions: string[];
  duplicate_evidence: string[];
  skills_without_evidence: string[];
  excluded_review_metrics: string[];
  copied_phrases: string[];
  contact_issues: string[];
  timeline_issues: string[];
  locked_evidence_issues: string[];
  resume_layout: PdfLayout;
  cover_letter_layout: PdfLayout;
  checks: QaCheck[];
};

function latex(value: string) {
  const map: Record<string, string> = {
    "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#",
    "_": "\\_", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}",
  };
  return [...value].map((char) => map[char] ?? char).join("");
}

function month(value: string) {
  const [year, m] = value.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] ?? m} ${year}`;
}

async function prompt(name: string) {
  return readFile(path.join(root(), "prompts", name), "utf8");
}

async function job(jobId: string): Promise<JobRecord> {
  const rows = await sql<JobRecord[]>`
    select id::text, title, company, location, jd_clean, requirements,
           posted_at::text, expires_at::text
    from jobs
    where id = ${jobId}::uuid
    limit 1
  `;
  if (!rows[0]) throw new Error("Job not found");
  return rows[0];
}

async function planResume(
  p: Profile,
  j: JobRecord,
  requirementMap: RequirementMatch[],
  registry: EvidenceItem[],
): Promise<ResumePlan> {
  const usableIds = new Set(registry.filter((item) => item.status === "verified").map((item) => item.id));
  const system = await prompt("application-packet.md");
  const selectionRegistry = {
    summary_facts: p.summary_facts.map((fact, index) => ({ index, fact })),
    experience: p.experience.map((item) => ({
      id: item.id,
      company: item.company,
      title: item.title,
      facts: item.facts.filter((fact) => usableIds.has(fact.id)).map((fact) => ({ id: fact.id, claim: fact.claim, tags: fact.evidence_tags ?? [] })),
    })),
    projects: p.projects.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      technologies: item.technologies,
      source_experience_ids: item.source_experience_ids ?? [],
      facts: item.facts.filter((fact) => usableIds.has(fact.id)),
    })),
    supported_skills: skillEvidenceCatalog(p, registry),
  };
  const raw = await generateJson<Partial<ResumePlan>>({
    system,
    user: JSON.stringify({
      job: {
        title: j.title,
        company: j.company,
        location: j.location ?? "New Zealand",
        description: (j.jd_clean ?? "").slice(0, 12000),
      },
      requirement_map: requirementMap,
      verified_registry: selectionRegistry,
    }),
    temperature: 0.05,
  });
  return validateResumePlan(p, raw, requirementMap, registry);
}

function summaryTex(p: Profile, snapshot: ResumeSnapshot) {
  const rights = p.candidate.work_rights?.statement;
  const summary = rights ? `${snapshot.summary} ${rights}.` : snapshot.summary;
  return latex(summary);
}

function experienceTex(snapshot: ResumeSnapshot) {
  return snapshot.experience.map((item) => {
    const bullets = item.bullets.map((bullet) => `    \\item ${latex(bullet.text)}`).join("\n");
    return `\\resumeHeading{${latex(item.company)}}{${latex(item.title)}}{${latex(item.location)}}{${latex(item.dates)}}\n\\begin{bullets}\n${bullets}\n\\end{bullets}\n\\sectionsep`;
  }).join("\n\n");
}

function projectsTex(snapshot: ResumeSnapshot) {
  if (!snapshot.projects.length) return "";
  return snapshot.projects.map((item) => {
    const bullets = item.bullets.map((bullet) => `    \\item ${latex(bullet.text)}`).join("\n");
    return `\\projectHeadingNoLink{${latex(item.name)}}{${latex(item.category)}}{${latex(item.technologies.join(", "))}}\n\\begin{bullets}\n${bullets}\n\\end{bullets}\n\\sectionsep`;
  }).join("\n\n");
}

function skillsTex(snapshot: ResumeSnapshot) {
  return snapshot.skills
    .map((row) => `\\textbf{${latex(row.category)}:} ${latex(row.items.join(", "))}\\\\`)
    .join("\n");
}

function educationTex(snapshot: ResumeSnapshot) {
  return snapshot.education.map((item, index) => {
    const lines = [
      `\\educationHeading{${latex(item.degree)}}{${latex(item.institution)}}{${latex(item.location)}}{${month(item.start)} -- ${month(item.end)}}{}`,
    ];
    if (index === 0 && item.concentrations?.length) {
      lines.push(`\\eduConcentration{${latex(item.concentrations.join(", "))}}`);
    }
    if (item.awards?.length) {
      lines.push(`\\scholarship{${latex(item.awards.join(", "))}}`);
    }
    lines.push("\\sectionsep");
    return lines.join("\\\\\n");
  }).join("\n");
}

function languagesTex(p: Profile) {
  return latex(p.languages.map((item) => `${item.language} (${item.proficiency})`).join(", "));
}

export async function renderResumeTex(p: Profile, snapshot: ResumeSnapshot) {
  const template = await readFile(path.join(root(), "resume/master/resume-template.tex"), "utf8");
  const replacements: Record<string, string> = {
    "%%NAME%%": latex(p.candidate.name),
    "%%EMAIL%%": latex(p.candidate.email),
    "%%PHONE%%": latex(p.candidate.phone),
    "%%LOCATION%%": latex(p.candidate.location ?? p.candidate.location_country),
    "%%GITHUB%%": latex(p.candidate.github),
    "%%LINKEDIN%%": latex(p.candidate.linkedin),
    "%%SUMMARY%%": summaryTex(p, snapshot),
    "%%SKILLS%%": skillsTex(snapshot),
    "%%EXPERIENCE%%": experienceTex(snapshot),
    "%%PROJECTS%%": projectsTex(snapshot),
    "%%EDUCATION%%": educationTex(snapshot),
    "%%LANGUAGES%%": languagesTex(p),
  };
  return Object.entries(replacements).reduce((value, [key, replacement]) => value.replace(key, replacement), template);
}

async function compile(texPath: string, masterDir?: string) {
  const env = { ...process.env, ...(masterDir ? { TEXINPUTS: `${masterDir}:${process.env.TEXINPUTS ?? ""}` } : {}) };
  try {
    await execFileAsync("xelatex", ["-interaction=nonstopmode", "-halt-on-error", path.basename(texPath)], {
      cwd: path.dirname(texPath), env, timeout: 60000,
    });
  } catch (error) {
    throw new Error(`XeLaTeX compilation failed. Verify the required TeX Live packages are installed. ${String(error)}`);
  }
  return texPath.replace(/\.tex$/, ".pdf");
}

function wrappedLines(value: string, width = 96) {
  return Math.max(1, Math.ceil(value.length / width));
}

export function estimateResumePageBudget(p: Profile, snapshot: ResumeSnapshot): PageBudget {
  const sectionLineCounts = {
    summary: 2 + wrappedLines(snapshot.summary, 105),
    skills: 1 + snapshot.skills.reduce((sum, row) => sum + wrappedLines(`${row.category}: ${row.items.join(", ")}`, 105), 0),
    work: 1 + snapshot.experience.reduce((sum, role) => sum + 2 + role.bullets.reduce((lines, bullet) => lines + wrappedLines(bullet.text, 94), 0), 0),
    projects: snapshot.projects.length
      ? 1 + snapshot.projects.reduce((sum, project) => sum + 2 + project.bullets.reduce((lines, bullet) => lines + wrappedLines(bullet.text, 94), 0), 0)
      : 0,
    education: 1 + snapshot.education.reduce((sum, item, index) => sum + 2 + (index === 0 && item.concentrations?.length ? 1 : 0) + (item.awards?.length ? 1 : 0), 0),
    languages: p.languages.length ? 2 : 0,
  };
  const total = Object.values(sectionLineCounts).reduce((sum, value) => sum + value, 0);
  const targetPages: 1 | 2 = total <= 58 ? 1 : 2;
  const sectionPass = sectionLineCounts.summary <= 5
    && sectionLineCounts.skills <= 8
    && sectionLineCounts.work <= 30
    && sectionLineCounts.projects <= 14
    && sectionLineCounts.education <= 10;
  return {
    target_pages: targetPages,
    estimated_total_lines: total,
    capacity_lines: targetPages * 58,
    section_line_counts: sectionLineCounts,
    status: sectionPass && total <= targetPages * 58 ? "pass" : "fail",
  };
}

export async function inspectPdf(pdfPath: string, budget: PageBudget | null = null): Promise<PdfLayout> {
  try {
    const { stdout: info } = await execFileAsync("pdfinfo", [pdfPath], { timeout: 15000 });
    const pageCount = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0);
    const counts: number[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
      const { stdout } = await execFileAsync("pdftotext", ["-f", String(page), "-l", String(page), pdfPath, "-"], { timeout: 15000 });
      counts.push(stdout.replace(/\s+/g, "").length);
    }
    const secondPageBalance = pageCount === 2 && counts[0] ? Number((counts[1] / counts[0]).toFixed(2)) : null;
    const fillRatios = counts.map((count) => Number(Math.min(1, count / 2200).toFixed(2)));
    const balanced = pageCount === 1 || (pageCount === 2 && (secondPageBalance ?? 0) >= 0.55);
    const matchesBudget = !budget || (budget.target_pages === 1 ? pageCount === 1 : pageCount <= 2);
    const pass = pageCount > 0 && pageCount <= 2 && balanced && matchesBudget && (budget?.status ?? "pass") === "pass";
    return {
      page_count: pageCount,
      page_character_counts: counts,
      second_page_balance: secondPageBalance,
      page_fill_ratios: fillRatios,
      budget,
      status: pass ? "pass" : "fail",
    };
  } catch {
    return { page_count: 0, page_character_counts: [], second_page_balance: null, page_fill_ratios: [], budget, status: "fail" };
  }
}

async function writeResume(p: Profile, plan: ResumePlan, registry: EvidenceItem[], jobId: string) {
  const masterDir = path.join(root(), "resume/master");
  const out = outDir(jobId);
  await mkdir(out, { recursive: true });
  const texPath = path.join(out, "resume.tex");

  let compact = false;
  let snapshot = buildResumeSnapshot(p, plan, compact, registry);
  await writeFile(texPath, await renderResumeTex(p, snapshot), "utf8");
  let pdfPath = await compile(texPath, masterDir);
  let layout = await inspectPdf(pdfPath, estimateResumePageBudget(p, snapshot));

  if (layout.status === "fail") {
    compact = true;
    snapshot = buildResumeSnapshot(p, plan, compact, registry);
    await writeFile(texPath, await renderResumeTex(p, snapshot), "utf8");
    pdfPath = await compile(texPath, masterDir);
    layout = await inspectPdf(pdfPath, estimateResumePageBudget(p, snapshot));
  }
  return { snapshot, layout, compact, texPath, pdfPath };
}

function normalizeParagraphPurpose(value: unknown): CoverParagraph["purpose"] {
  return value === "motivation" || value === "closing" ? value : "evidence";
}

function normalizeCoverDraft(raw: unknown, allowedEvidenceIds: Set<string>) {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rows = Array.isArray(value.paragraphs) ? value.paragraphs : [];
  const invalidEvidenceIds: string[] = [];
  const paragraphs = rows.flatMap((row): CoverParagraph[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const text = String(item.text ?? "").trim();
    if (!text) return [];
    const requestedIds = Array.isArray(item.evidence_ids) ? item.evidence_ids.map(String) : [];
    invalidEvidenceIds.push(...requestedIds.filter((id) => !allowedEvidenceIds.has(id)));
    return [{
      purpose: normalizeParagraphPurpose(item.purpose),
      text,
      evidence_ids: requestedIds.filter((id) => allowedEvidenceIds.has(id)),
      job_requirements: Array.isArray(item.job_requirements) ? item.job_requirements.map(String).filter(Boolean).slice(0, 4) : [],
    }];
  }).slice(0, 5);
  if (paragraphs.length < 3) throw new Error("AI provider returned an incomplete cover letter");
  for (const paragraph of paragraphs) {
    if (!paragraph.evidence_ids.length) {
      invalidEvidenceIds.push(`Unmapped evidence paragraph: ${paragraph.text.slice(0, 90)}`);
    }
  }
  return { draft: { paragraphs } satisfies CoverLetterDraft, invalidEvidenceIds: [...new Set(invalidEvidenceIds)] };
}

async function generateCoverDraft(
  j: JobRecord,
  snapshot: ResumeSnapshot,
  requirementMap: RequirementMatch[],
  feedback: string[] = [],
) {
  const allowedEvidenceIds = new Set(snapshot.selected_evidence_ids);
  const evidence = [
    ...snapshot.experience.flatMap((item) => item.bullets.map((bullet) => ({ ...bullet, source: `${item.company} - ${item.title}` }))),
    ...snapshot.projects.flatMap((item) => item.bullets.map((bullet) => ({ ...bullet, source: item.name }))),
    ...snapshot.selected_evidence_ids
      .filter((id) => id.startsWith("summary:"))
      .map((evidence_id) => ({ evidence_id, text: snapshot.summary, source: "Final resume summary" })),
  ].filter((item) => allowedEvidenceIds.has(item.evidence_id));
  const raw = await generateJson<unknown>({
    system: await prompt("cover-letter.md"),
    user: JSON.stringify({
      job: {
        title: j.title,
        company: j.company,
        location: j.location ?? "New Zealand",
        requirements: requirementMap,
        description: (j.jd_clean ?? "").slice(0, 12000),
      },
      final_resume: snapshot,
      allowed_evidence: evidence,
      correction_feedback: feedback,
    }),
    temperature: 0.15,
  });
  return normalizeCoverDraft(raw, allowedEvidenceIds);
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12) : [];
}

async function checkConsistency(j: JobRecord, snapshot: ResumeSnapshot, draft: CoverLetterDraft): Promise<ConsistencyResult> {
  const raw = await generateJson<Record<string, unknown>>({
    system: await prompt("consistency-check.md"),
    user: JSON.stringify({ job: { title: j.title, company: j.company }, final_resume: snapshot, cover_letter: draft }),
    temperature: 0,
  });
  const score = Number(raw.alignment_score);
  return {
    alignment_score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    unsupported_claims: stringList(raw.unsupported_claims),
    contradictions: stringList(raw.contradictions),
    copied_phrases: stringList(raw.copied_phrases),
  };
}

function words(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#. ]/g, " ").split(/\s+/).filter(Boolean);
}

export function deterministicCopiedPhrases(snapshot: ResumeSnapshot, draft: CoverLetterDraft) {
  const resumeTexts = [
    snapshot.summary,
    ...snapshot.experience.flatMap((item) => item.bullets.map((bullet) => bullet.text)),
    ...snapshot.projects.flatMap((item) => item.bullets.map((bullet) => bullet.text)),
  ];
  const copied = new Set<string>();
  for (const paragraph of draft.paragraphs) {
    const paragraphWords = words(paragraph.text);
    const paragraphText = paragraphWords.join(" ");
    for (const resumeText of resumeTexts) {
      const sourceWords = words(resumeText);
      for (let index = 0; index <= sourceWords.length - 10; index += 1) {
        const phrase = sourceWords.slice(index, index + 10).join(" ");
        if (paragraphText.includes(phrase)) copied.add(phrase);
      }
    }
  }
  return [...copied].slice(0, 12);
}

function validMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthNumber(value: string) {
  const [year, monthValue] = value.split("-").map(Number);
  return year * 12 + monthValue;
}

export function validateCandidateProfile(p: Profile) {
  const contactIssues: string[] = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.candidate.email)) contactIssues.push("Candidate email is invalid");
  if (!/^\+64\s\d(?:[\d ]{6,})$/.test(p.candidate.phone)) contactIssues.push("Candidate phone is not in +64 international format");
  if (!(p.candidate.location ?? "").trim()) contactIssues.push("Candidate location is missing");
  if (!(p.candidate.work_rights?.statement ?? "").trim()) contactIssues.push("Work-right statement is missing");

  const timelineIssues: string[] = [];
  const periods = [
    ...p.experience.map((item) => ({ label: item.company, start: item.start, end: item.end })),
    ...p.education.map((item) => ({ label: item.institution, start: item.start, end: item.end })),
  ];
  for (const period of periods) {
    if (!validMonth(period.start) || !validMonth(period.end)) {
      timelineIssues.push(`${period.label} has an invalid YYYY-MM date`);
    } else if (monthNumber(period.start) > monthNumber(period.end)) {
      timelineIssues.push(`${period.label} ends before it starts`);
    }
  }
  const validPeriods = periods
    .filter((period) => validMonth(period.start) && validMonth(period.end))
    .map((period) => ({ start: monthNumber(period.start), end: monthNumber(period.end) }))
    .sort((a, b) => a.start - b.start);
  let coveredUntil = validPeriods[0]?.end ?? 0;
  for (const period of validPeriods.slice(1)) {
    if (period.start - coveredUntil > 24) timelineIssues.push("Candidate timeline contains an unexplained gap longer than 24 months");
    coveredUntil = Math.max(coveredUntil, period.end);
  }
  return { contactIssues: [...new Set(contactIssues)], timelineIssues: [...new Set(timelineIssues)] };
}

function validateJobDates(j: JobRecord) {
  const issues: string[] = [];
  const posted = j.posted_at ? new Date(j.posted_at) : null;
  const expires = j.expires_at ? new Date(j.expires_at) : null;
  if (posted && Number.isNaN(posted.valueOf())) issues.push("Job posted date is invalid");
  if (expires && Number.isNaN(expires.valueOf())) issues.push("Job expiry date is invalid");
  if (posted && expires && !Number.isNaN(posted.valueOf()) && !Number.isNaN(expires.valueOf()) && posted > expires) {
    issues.push("Job expiry precedes its posted date");
  }
  return issues;
}

function lockedEvidenceIssues(registry: EvidenceItem[], snapshot: ResumeSnapshot) {
  const selected = new Set(snapshot.selected_evidence_ids);
  const rendered = new Map([
    ...snapshot.experience.flatMap((item) => item.bullets.map((bullet) => [bullet.evidence_id, bullet.text] as const)),
    ...snapshot.projects.flatMap((item) => item.bullets.map((bullet) => [bullet.evidence_id, bullet.text] as const)),
  ]);
  const issues: string[] = [];
  for (const item of registry.filter((candidate) => candidate.locked && selected.has(candidate.id))) {
    if (item.locked_content_hash && evidenceContentHash(item) !== item.locked_content_hash) {
      issues.push(`${item.id} changed after it was locked`);
    }
    if (item.kind === "summary") {
      if (!snapshot.summary.includes(item.text)) issues.push(`${item.id} was rewritten despite its lock`);
    } else if (rendered.get(item.id) !== item.text) {
      issues.push(`${item.id} was rewritten despite its lock`);
    }
  }
  return [...new Set(issues)];
}

export function renderCoverLetterTex(p: Profile, company: string, title: string, draft: CoverLetterDraft) {
  const paragraphs = draft.paragraphs.map((item) => latex(item.text)).join("\n\n");
  const date = new Date().toLocaleDateString("en-NZ", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Pacific/Auckland",
  });
  return `\\documentclass[11pt,a4paper]{article}\n\\usepackage[a4paper,margin=0.78in]{geometry}\n\\usepackage[hidelinks]{hyperref}\n\\usepackage{fontspec}\n\\setsansfont{Latin Modern Sans}\n\\renewcommand{\\familydefault}{\\sfdefault}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0pt}\n\\setlength{\\parskip}{9pt}\n\\begin{document}\n{\\Large\\bfseries ${latex(p.candidate.name)}}\\\\\n${latex(p.candidate.phone)} $\\mid$ \\href{mailto:${latex(p.candidate.email)}}{${latex(p.candidate.email)}} $\\mid$ ${latex(p.candidate.location ?? p.candidate.location_country)}\n\n\\vspace{12pt}\n${date}\n\nHiring Manager\\\\\n${latex(company)}\\\\\n${latex(p.candidate.location_country)}\n\n\\textbf{Re: ${latex(title)}}\n\nDear Hiring Manager,\n\n${paragraphs}\n\nThank you for your consideration.\n\nKind regards,\\\\[14pt]\n${latex(p.candidate.name)}\n\\end{document}\n`;
}

async function writeCoverLetter(p: Profile, j: JobRecord, draft: CoverLetterDraft, jobId: string) {
  const out = outDir(jobId);
  await mkdir(out, { recursive: true });
  const texPath = path.join(out, "cover-letter.tex");
  await writeFile(texPath, renderCoverLetterTex(p, j.company, j.title, draft), "utf8");
  const pdfPath = await compile(texPath);
  return { texPath, pdfPath, layout: await inspectPdf(pdfPath) };
}

async function application(jobId: string) {
  const rows = await sql<{ id: string }[]>`
    insert into applications (job_id, status)
    values (${jobId}::uuid, 'discovered'::application_status)
    on conflict (job_id) do update set updated_at = now()
    returning id::text
  `;
  return rows[0].id;
}

async function recordDocument(
  appId: string,
  packetId: string,
  type: "resume" | "cover_letter",
  format: "tex" | "pdf",
  url: string,
  profileVersion: string,
) {
  await sql`
    insert into generated_documents (
      application_id, packet_id, document_type, format, storage_path, generator_version, source_profile_version, approved
    ) values (
      ${appId}::uuid, ${packetId}::uuid, ${type}, ${format}, ${url}, ${GENERATOR_VERSION}, ${profileVersion}, false
    )
  `;
}

function duplicateEvidence(p: Profile, snapshot: ResumeSnapshot) {
  const selectedExperienceIds = new Set(snapshot.experience.map((item) => item.id));
  return snapshot.projects.flatMap((item) => {
    const project = p.projects.find((candidate) => candidate.id === item.id);
    const duplicates = (project?.source_experience_ids ?? []).filter((id) => selectedExperienceIds.has(id));
    return duplicates.length ? [`${item.name} duplicates evidence already shown in work experience`] : [];
  });
}

function buildQaReport(args: {
  coverage: number;
  consistency: ConsistencyResult;
  invalidEvidenceIds: string[];
  duplicates: string[];
  skillsWithoutEvidence: string[];
  snapshot: ResumeSnapshot;
  resumeLayout: PdfLayout;
  coverLayout: PdfLayout;
  copiedPhrases: string[];
  contactIssues: string[];
  timelineIssues: string[];
  lockedEvidenceIssues: string[];
}): ApplicationQaReport {
  const unsupported = [...new Set([...args.invalidEvidenceIds, ...args.consistency.unsupported_claims])];
  const alignmentPass = args.consistency.alignment_score >= 90 && !unsupported.length && !args.consistency.contradictions.length;
  const checks: QaCheck[] = [
    {
      id: "claims",
      label: "Evidence-grounded claims",
      status: unsupported.length ? "fail" : "pass",
      detail: unsupported.length ? `${unsupported.length} unsupported claim(s) require review` : "Every mapped professional claim uses frozen resume evidence",
    },
    {
      id: "duplicates",
      label: "No repeated work/projects",
      status: args.duplicates.length ? "fail" : "pass",
      detail: args.duplicates.length ? args.duplicates.join("; ") : "Projects derived from selected work experience were excluded",
    },
    {
      id: "skills",
      label: "Evidence-backed skills",
      status: args.skillsWithoutEvidence.length ? "fail" : "pass",
      detail: args.skillsWithoutEvidence.length ? args.skillsWithoutEvidence.join(", ") : "Every displayed skill has supporting resume evidence",
    },
    {
      id: "metrics",
      label: "Metric confidence",
      status: args.snapshot.excluded_review_metrics.length ? "warning" : "pass",
      detail: args.snapshot.excluded_review_metrics.length
        ? `${args.snapshot.excluded_review_metrics.length} unverified metric(s) were automatically omitted`
        : "All displayed metrics are verified",
    },
    {
      id: "resume_layout",
      label: "Resume page layout",
      status: args.resumeLayout.status === "pass" ? "pass" : "fail",
      detail: args.resumeLayout.page_count
        ? `${args.resumeLayout.page_count} page(s); ${args.resumeLayout.budget?.estimated_total_lines ?? "?"}/${args.resumeLayout.budget?.capacity_lines ?? "?"} estimated lines`
        : "PDF layout could not be verified",
    },
    {
      id: "cover_layout",
      label: "Cover letter page layout",
      status: args.coverLayout.status === "pass" && args.coverLayout.page_count === 1 ? "pass" : "fail",
      detail: `${args.coverLayout.page_count || "Unknown"} page(s)`,
    },
    {
      id: "alignment",
      label: "Resume-cover letter alignment",
      status: alignmentPass ? "pass" : "fail",
      detail: `${args.consistency.alignment_score}% alignment`,
    },
    {
      id: "copying",
      label: "Complementary cover letter",
      status: args.copiedPhrases.length ? "fail" : "pass",
      detail: args.copiedPhrases.length ? `${args.copiedPhrases.length} resume phrase(s) copied too closely` : "Cover letter adds context without copying resume sentences",
    },
    {
      id: "contact",
      label: "Contact and work rights",
      status: args.contactIssues.length ? "fail" : "pass",
      detail: args.contactIssues.length ? args.contactIssues.join("; ") : "Contact fields and work-right statement are valid",
    },
    {
      id: "timeline",
      label: "Dates and timeline",
      status: args.timelineIssues.length ? "fail" : "pass",
      detail: args.timelineIssues.length ? args.timelineIssues.join("; ") : "Candidate and job dates are internally consistent",
    },
    {
      id: "locks",
      label: "Locked evidence integrity",
      status: args.lockedEvidenceIssues.length ? "fail" : "pass",
      detail: args.lockedEvidenceIssues.length ? args.lockedEvidenceIssues.join("; ") : `${args.snapshot.locked_evidence_ids.length} selected locked fact(s) preserved exactly`,
    },
  ];
  return {
    ready: checks.every((check) => check.status !== "fail"),
    evidence_coverage: args.coverage,
    resume_cover_alignment: args.consistency.alignment_score,
    unsupported_claims: unsupported,
    contradictions: args.consistency.contradictions,
    duplicate_evidence: args.duplicates,
    skills_without_evidence: args.skillsWithoutEvidence,
    excluded_review_metrics: args.snapshot.excluded_review_metrics,
    copied_phrases: args.copiedPhrases,
    contact_issues: args.contactIssues,
    timeline_issues: args.timelineIssues,
    locked_evidence_issues: args.lockedEvidenceIssues,
    resume_layout: args.resumeLayout,
    cover_letter_layout: args.coverLayout,
    checks,
  };
}

export async function generateApplicationPacket(jobId: string) {
  const [{ profile: p, registry, selection }, j] = await Promise.all([generationEvidence(jobId), job(jobId)]);
  if (selection.mode === "manual" && !registry.some((item) => item.status === "verified")) {
    throw new Error("Manual evidence selection is empty. Select verified evidence or return to automatic selection.");
  }
  const terms = requirementTerms(j.requirements, j.jd_clean ?? "");
  const requirementMap = mapRequirements(terms, registry);
  const coverage = coverageScore(requirementMap);
  const plan = await planResume(p, j, requirementMap, registry);

  // Resume is rendered, inspected and frozen before the cover letter sees any candidate evidence.
  const resume = await writeResume(p, plan, registry, jobId);
  const resumeHash = createHash("sha256").update(JSON.stringify(resume.snapshot)).digest("hex");

  let cover = await generateCoverDraft(j, resume.snapshot, requirementMap);
  let consistency = await checkConsistency(j, resume.snapshot, cover.draft);
  let copiedPhrases = [...new Set([...consistency.copied_phrases, ...deterministicCopiedPhrases(resume.snapshot, cover.draft)])];
  if (cover.invalidEvidenceIds.length || consistency.unsupported_claims.length || consistency.contradictions.length || copiedPhrases.length || consistency.alignment_score < 90) {
    const feedback = [
      ...cover.invalidEvidenceIds,
      ...consistency.unsupported_claims,
      ...consistency.contradictions,
      ...copiedPhrases.map((phrase) => `Paraphrase instead of copying: ${phrase}`),
      ...(consistency.alignment_score < 90 ? [`Previous alignment score was ${consistency.alignment_score}; use fewer, more directly supported claims.`] : []),
    ];
    cover = await generateCoverDraft(j, resume.snapshot, requirementMap, feedback);
    consistency = await checkConsistency(j, resume.snapshot, cover.draft);
    copiedPhrases = [...new Set([...consistency.copied_phrases, ...deterministicCopiedPhrases(resume.snapshot, cover.draft)])];
  }
  const coverFiles = await writeCoverLetter(p, j, cover.draft, jobId);

  const supported = new Set(skillEvidenceCatalog(p, registry).map((item) => item.skill));
  const skillsWithoutEvidence = plan.selected_skills.filter((skill) => !supported.has(skill));
  const duplicates = duplicateEvidence(p, resume.snapshot);
  const profileValidation = validateCandidateProfile(p);
  const contactIssues = profileValidation.contactIssues;
  const timelineIssues = [...profileValidation.timelineIssues, ...validateJobDates(j)];
  const lockIssues = lockedEvidenceIssues(registry, resume.snapshot);
  const qa = buildQaReport({
    coverage,
    consistency,
    invalidEvidenceIds: cover.invalidEvidenceIds,
    duplicates,
    skillsWithoutEvidence,
    snapshot: resume.snapshot,
    resumeLayout: resume.layout,
    coverLayout: coverFiles.layout,
    copiedPhrases,
    contactIssues,
    timelineIssues,
    lockedEvidenceIssues: lockIssues,
  });

  const appId = await application(jobId);
  const profileVersion = `profile-v${p.schema_version}`;
  const resumeTexUrl = `/generated/${jobId}/resume.tex`;
  const resumePdfUrl = `/generated/${jobId}/resume.pdf`;
  const coverTexUrl = `/generated/${jobId}/cover-letter.tex`;
  const coverPdfUrl = `/generated/${jobId}/cover-letter.pdf`;
  const coverLetterMapping = cover.draft.paragraphs.map((paragraph, index) => ({
    paragraph: index + 1,
    purpose: paragraph.purpose,
    evidence_ids: paragraph.evidence_ids,
    job_requirements: paragraph.job_requirements,
  }));
  const targetProfile = {
    target_title: plan.target_title,
    positioning: plan.positioning,
    evidence_coverage: coverage,
    evidence_selection_mode: selection.mode,
    compact_layout: resume.compact,
  };
  const packetRows = await sql<Array<{ id: string }>>`
    insert into application_packets (
      application_id, packet_version, status, target_profile, requirement_map,
      resume_plan, final_resume, resume_hash, cover_letter_mapping, qa_report, provider
    ) values (
      ${appId}::uuid, ${GENERATOR_VERSION}, ${qa.ready ? "ready_to_apply" : "needs_review"}::packet_status,
      ${JSON.stringify(targetProfile)}::jsonb, ${JSON.stringify(requirementMap)}::jsonb,
      ${JSON.stringify(plan)}::jsonb, ${JSON.stringify(resume.snapshot)}::jsonb, ${resumeHash},
      ${JSON.stringify(coverLetterMapping)}::jsonb, ${JSON.stringify(qa)}::jsonb, ${aiProviderName()}
    )
    returning id::text
  `;
  const packetId = packetRows[0].id;
  await sql.begin(async (transaction) => {
    for (const evidenceId of resume.snapshot.selected_evidence_ids) {
      await transaction`
        insert into application_packet_evidence (packet_id, evidence_id, usage, paragraph_number)
        values (${packetId}::uuid, ${evidenceId}, 'resume', 0)
        on conflict do nothing
      `;
    }
    for (const mapping of coverLetterMapping) {
      for (const evidenceId of mapping.evidence_ids) {
        await transaction`
          insert into application_packet_evidence (packet_id, evidence_id, usage, paragraph_number)
          values (${packetId}::uuid, ${evidenceId}, 'cover_letter', ${mapping.paragraph})
          on conflict do nothing
        `;
      }
    }
  });
  await recordDocument(appId, packetId, "resume", "tex", resumeTexUrl, profileVersion);
  await recordDocument(appId, packetId, "resume", "pdf", resumePdfUrl, profileVersion);
  await recordDocument(appId, packetId, "cover_letter", "tex", coverTexUrl, profileVersion);
  await recordDocument(appId, packetId, "cover_letter", "pdf", coverPdfUrl, profileVersion);

  await sql`
    update applications
    set generated_at = now(),
        resume_path = ${resumePdfUrl},
        cover_letter_path = ${coverPdfUrl},
        status = case
          when status in (
            'applied'::application_status, 'screening'::application_status,
            'interview'::application_status, 'final_interview'::application_status,
            'offer'::application_status, 'rejected'::application_status,
            'withdrawn'::application_status, 'expired'::application_status,
            'skipped'::application_status
          ) then status
          else ${qa.ready ? "documents_ready" : "analyzed"}::application_status
        end,
        updated_at = now()
    where id = ${appId}::uuid
  `;

  const packet = {
    packet_version: GENERATOR_VERSION,
    status: qa.ready ? "ready_to_apply" : "needs_review",
    packet_id: packetId,
    target_profile: targetProfile,
    requirement_map: requirementMap,
    resume_plan: plan,
    final_resume: resume.snapshot,
    resume_hash: resumeHash,
    compact_layout: resume.compact,
    cover_letter_mapping: coverLetterMapping,
    qa_report: qa,
    provider: aiProviderName(),
    generated_at: new Date().toISOString(),
  };

  await sql`
    insert into application_events (application_id, event_type, source, details)
    values (${appId}::uuid, 'application_packet_generated', 'dashboard', ${JSON.stringify(packet)}::jsonb)
  `;

  return {
    resume: { tex: resumeTexUrl, pdf: resumePdfUrl },
    cover_letter: { tex: coverTexUrl, pdf: coverPdfUrl },
    qa,
    provider: aiProviderName(),
  };
}
