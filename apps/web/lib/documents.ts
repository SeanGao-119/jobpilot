import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";

import { aiProviderName, generateJson } from "./ai";
import { sql } from "./db";

const execFileAsync = promisify(execFile);

function repoRoot() {
  return path.resolve(process.cwd(), "../..");
}

function latexEscape(value: string) {
  return value
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("&", "\\&")
    .replaceAll("%", "\\%")
    .replaceAll("$", "\\$")
    .replaceAll("#", "\\#")
    .replaceAll("_", "\\_")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("~", "\\textasciitilde{}")
    .replaceAll("^", "\\textasciicircum{}");
}

function month(value: string) {
  const [year, monthValue] = value.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const index = Number(monthValue) - 1;
  return `${names[index] ?? monthValue} ${year}`;
}

type Profile = {
  candidate: { name: string; work_rights?: { statement?: string } };
  summary_facts: string[];
  experience: Array<{
    id: string;
    company: string;
    title: string;
    location: string;
    start: string;
    end: string;
    facts: Array<{ id: string; claim: string; metrics?: string[] }>;
  }>;
  projects: Array<{
    id: string;
    name: string;
    category: string;
    technologies: string[];
    summary?: string;
    facts: string[];
  }>;
  skills: Record<string, { verified?: string[]; familiar?: string[]; basic?: string[] }>;
};

type ResumePlan = {
  summary_fact_indexes: number[];
  experience: Array<{ id: string; fact_ids: string[] }>;
  project_ids: string[];
  skill_categories: string[];
};

type CoverLetterResult = { body: string };

async function loadProfile(): Promise<Profile> {
  const source = await readFile(path.join(repoRoot(), "resume/facts/profile.yaml"), "utf8");
  return YAML.parse(source) as Profile;
}

async function loadJob(jobId: string) {
  const rows = await sql<{
    id: string;
    title: string;
    company: string;
    location: string | null;
    jd_clean: string | null;
    requirements: unknown;
  }[]>`
    select id::text, title, company, location, jd_clean, requirements
    from jobs where id = ${jobId}::uuid limit 1
  `;
  if (!rows[0]) throw new Error("Job not found");
  return rows[0];
}

function validatePlan(profile: Profile, plan: ResumePlan): ResumePlan {
  const exp = new Map(profile.experience.map((item) => [item.id, item]));
  const projects = new Set(profile.projects.map((item) => item.id));
  const categories = new Set(Object.keys(profile.skills));

  const summary = [...new Set(plan.summary_fact_indexes)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < profile.summary_facts.length)
    .slice(0, 3);
  if (!summary.length) summary.push(0, 1);

  const experience = plan.experience
    .filter((item) => exp.has(item.id))
    .map((item) => {
      const allowed = new Set(exp.get(item.id)!.facts.map((fact) => fact.id));
      return { id: item.id, fact_ids: [...new Set(item.fact_ids)].filter((id) => allowed.has(id)).slice(0, 4) };
    })
    .filter((item) => item.fact_ids.length > 0);

  for (const item of profile.experience) {
    if (!experience.some((selected) => selected.id === item.id)) {
      experience.push({ id: item.id, fact_ids: item.facts.slice(0, 2).map((fact) => fact.id) });
    }
  }

  const project_ids = [...new Set(plan.project_ids)].filter((id) => projects.has(id)).slice(0, 3);
  if (!project_ids.length) project_ids.push(...profile.projects.slice(0, 2).map((p) => p.id));

  const skill_categories = [...new Set(plan.skill_categories)].filter((key) => categories.has(key));
  for (const key of Object.keys(profile.skills)) if (!skill_categories.includes(key)) skill_categories.push(key);

  return { summary_fact_indexes: summary, experience, project_ids, skill_categories };
}

async function buildResumePlan(profile: Profile, job: Awaited<ReturnType<typeof loadJob>>): Promise<ResumePlan> {
  const compactFacts = {
    summary_facts: profile.summary_facts.map((fact, index) => ({ index, fact })),
    experience: profile.experience.map((item) => ({
      id: item.id,
      company: item.company,
      title: item.title,
      facts: item.facts.map((fact) => ({ id: fact.id, claim: fact.claim, metrics: fact.metrics ?? [] })),
    })),
    projects: profile.projects.map((p) => ({ id: p.id, name: p.name, category: p.category, technologies: p.technologies, facts: p.facts })),
    skill_categories: Object.keys(profile.skills),
  };

  const plan = await generateJson<ResumePlan>({
    system: "You are a resume evidence selector. Never invent or rewrite candidate facts. Return JSON only. Choose which verified facts best match the job. Keep every experience entry but choose 2-4 fact IDs per role. Choose up to 3 projects. Choose 2-3 summary fact indexes. Order skill categories by relevance.",
    user: `JOB\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location ?? "New Zealand"}\nRequirements: ${JSON.stringify(job.requirements)}\nJD: ${(job.jd_clean ?? "").slice(0, 12000)}\n\nVERIFIED FACT REGISTRY\n${JSON.stringify(compactFacts)}\n\nReturn exactly: {"summary_fact_indexes":[0],"experience":[{"id":"...","fact_ids":["..."]}],"project_ids":["..."],"skill_categories":["..."]}`,
  });
  return validatePlan(profile, plan);
}

function renderExperience(profile: Profile, plan: ResumePlan) {
  const byId = new Map(profile.experience.map((item) => [item.id, item]));
  return plan.experience.map((selected) => {
    const item = byId.get(selected.id)!;
    const facts = new Map(item.facts.map((fact) => [fact.id, fact]));
    const bullets = selected.fact_ids.map((id) => facts.get(id)!).filter(Boolean).map((fact) => {
      const metric = fact.metrics?.length ? `; ${fact.metrics.join("; ")}` : "";
      return `    \\item ${latexEscape(fact.claim + metric)}`;
    }).join("\n");
    return `\\resumeHeading{${latexEscape(item.company)}}{${latexEscape(item.title)}}{${latexEscape(item.location)}}{${month(item.start)} -- ${month(item.end)}}\n\\begin{bullets}\n${bullets}\n\\end{bullets}\n\\sectionsep`;
  }).join("\n\n");
}

function renderProjects(profile: Profile, plan: ResumePlan) {
  const byId = new Map(profile.projects.map((item) => [item.id, item]));
  return plan.project_ids.map((id) => {
    const p = byId.get(id)!;
    const bullets = p.facts.slice(0, 3).map((fact) => `    \\item ${latexEscape(fact)}`).join("\n");
    const summary = p.summary ? `\\textbf{${latexEscape(p.summary)}}\n` : "";
    return `\\projectHeadingNoLink{${latexEscape(p.name)}}{${latexEscape(p.category)}}{${latexEscape(p.technologies.join(", "))}}\n${summary}\\begin{bullets}\n${bullets}\n\\end{bullets}\n\\sectionsep`;
  }).join("\n\n");
}

const SKILL_LABELS: Record<string, string> = {
  languages_and_databases: "Languages \\& DB:",
  data_ml: "Data/ML:",
  geospatial: "Geospatial:",
  web_backend: "Web/Backend:",
  platforms_tools: "Platforms/Tools:",
  containers_cloud: "Containers/Cloud:",
};

function renderSkills(profile: Profile, plan: ResumePlan) {
  const lines = plan.skill_categories.map((key) => {
    const group = profile.skills[key] ?? {};
    const values = [
      ...(group.verified ?? []),
      ...(group.familiar ?? []).map((v) => `${v} (familiar)`),
      ...(group.basic ?? []).map((v) => `${v} (basic)`),
    ];
    return `    \\singleItem{${SKILL_LABELS[key] ?? latexEscape(key + ":")}}{${latexEscape(values.join(", "))}}`;
  });
  return `\\begin{skillList}\n${lines.join("\n    \\\\\n")}\n\\end{skillList}`;
}

function renderSummary(profile: Profile, plan: ResumePlan) {
  const facts = plan.summary_fact_indexes.map((i) => profile.summary_facts[i]).filter(Boolean);
  if (profile.candidate.work_rights?.statement && !facts.includes(profile.candidate.work_rights.statement)) {
    facts.push(profile.candidate.work_rights.statement);
  }
  return `\\textbf{${latexEscape(facts.join(". ").replace(/\.+$/g, "") + ".")}}`;
}

async function compileTex(texPath: string, masterDir?: string) {
  const cwd = path.dirname(texPath);
  const env = { ...process.env };
  if (masterDir) env.TEXINPUTS = `${masterDir}:${env.TEXINPUTS ?? ""}`;
  try {
    await execFileAsync("xelatex", ["-interaction=nonstopmode", "-halt-on-error", path.basename(texPath)], { cwd, env, timeout: 60000 });
  } catch (error) {
    throw new Error(`XeLaTeX compilation failed. Ensure a TeX distribution plus lato-font/raleway-font packages are installed. ${String(error)}`);
  }
  return texPath.replace(/\.tex$/, ".pdf");
}

async function recordDocument(applicationId: string, type: "resume" | "cover_letter", format: "tex" | "pdf", storagePath: string) {
  await sql`
    insert into generated_documents (application_id, document_type, format, storage_path, generator_version, source_profile_version, approved)
    values (${applicationId}::uuid, ${type}, ${format}, ${storagePath}, 'v0.2-deepseek-fact-guard', 'profile.yaml', false)
  `;
}

async function ensureApplication(jobId: string) {
  const rows = await sql<{ id: string }[]>`
    insert into applications (job_id, status)
    values (${jobId}::uuid, 'discovered'::application_status)
    on conflict (job_id) do update set updated_at = now()
    returning id::text
  `;
  return rows[0].id;
}

function outputDirectory(jobId: string) {
  return path.join(repoRoot(), "apps/web/public/generated", jobId);
}

export async function generateResume(jobId: string) {
  const [profile, job] = await Promise.all([loadProfile(), loadJob(jobId)]);
  const plan = await buildResumePlan(profile, job);
  const masterDir = path.join(repoRoot(), "resume/master");
  let template = await readFile(path.join(masterDir, "resume-template.tex"), "utf8");
  template = template
    .replace("%%SUMMARY%%", renderSummary(profile, plan))
    .replace("%%EXPERIENCE%%", renderExperience(profile, plan))
    .replace("%%PROJECTS%%", renderProjects(profile, plan))
    .replace("%%SKILLS%%", renderSkills(profile, plan));

  const out = outputDirectory(jobId);
  await mkdir(out, { recursive: true });
  const texPath = path.join(out, "resume.tex");
  await writeFile(texPath, template, "utf8");
  const pdfPath = await compileTex(texPath, masterDir);
  const appId = await ensureApplication(jobId);
  await recordDocument(appId, "resume", "tex", `/generated/${jobId}/resume.tex`);
  await recordDocument(appId, "resume", "pdf", `/generated/${jobId}/resume.pdf`);
  await sql`update applications set generated_at = now(), resume_path = ${`/generated/${jobId}/resume.pdf`}, updated_at = now() where id = ${appId}::uuid`;
  return { tex: `/generated/${jobId}/resume.tex`, pdf: `/generated/${jobId}/resume.pdf`, provider: aiProviderName() };
}

function coverLetterTex(name: string, company: string, title: string, body: string) {
  const paragraphs = body.split(/\n\s*\n/).map((p) => latexEscape(p.trim())).filter(Boolean).join("\n\n");
  return `\\documentclass[11pt,a4paper]{article}\n\\usepackage[a4paper,margin=0.78in]{geometry}\n\\usepackage[hidelinks]{hyperref}\n\\usepackage{lato-font}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0pt}\n\\setlength{\\parskip}{9pt}\n\\begin{document}\n{\\Large\\bfseries ${latexEscape(name)}}\\\\\n+64 (022) 091 1240 $\\mid$ \\href{mailto:therinkao@gmail.com}{therinkao@gmail.com}\\\\\nNew Zealand\n\n\\vspace{12pt}\n${new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })}\n\nHiring Manager\\\\\n${latexEscape(company)}\\\\\nNew Zealand\n\n\\textbf{Re: ${latexEscape(title)}}\n\nDear Hiring Manager,\n\n${paragraphs}\n\nThank you for your consideration.\n\nKind regards,\\\\[14pt]\n${latexEscape(name)}\n\\end{document}\n`;
}

export async function generateCoverLetter(jobId: string) {
  const [profile, job] = await Promise.all([loadProfile(), loadJob(jobId)]);
  const result = await generateJson<CoverLetterResult>({
    system: "Write a concise New Zealand job application cover letter. Use only facts explicitly present in the supplied verified profile. Do not invent tools, industries, metrics, responsibilities, years, certifications or domain experience. If the job asks for something unsupported, do not claim it. Return JSON only with a single key body. Use 4-5 short paragraphs and no address block, greeting, sign-off or markdown.",
    user: `JOB\n${job.title} at ${job.company}\nLocation: ${job.location ?? "New Zealand"}\nRequirements: ${JSON.stringify(job.requirements)}\nJD: ${(job.jd_clean ?? "").slice(0, 12000)}\n\nVERIFIED PROFILE\n${JSON.stringify(profile)}`,
    temperature: 0.2,
  });
  if (!result.body?.trim()) throw new Error("AI provider returned an empty cover letter");

  const out = outputDirectory(jobId);
  await mkdir(out, { recursive: true });
  const texPath = path.join(out, "cover-letter.tex");
  await writeFile(texPath, coverLetterTex(profile.candidate.name, job.company, job.title, result.body), "utf8");
  const pdfPath = await compileTex(texPath);
  const appId = await ensureApplication(jobId);
  await recordDocument(appId, "cover_letter", "tex", `/generated/${jobId}/cover-letter.tex`);
  await recordDocument(appId, "cover_letter", "pdf", `/generated/${jobId}/cover-letter.pdf`);
  await sql`update applications set generated_at = now(), cover_letter_path = ${`/generated/${jobId}/cover-letter.pdf`}, updated_at = now() where id = ${appId}::uuid`;
  return { tex: `/generated/${jobId}/cover-letter.tex`, pdf: `/generated/${jobId}/cover-letter.pdf`, provider: aiProviderName() };
}
