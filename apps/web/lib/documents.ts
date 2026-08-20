import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";

import { aiProviderName, generateJson } from "./ai";
import { sql } from "./db";

const execFileAsync = promisify(execFile);

const root = () => path.resolve(process.cwd(), "../..");

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

type Profile = {
  candidate: { name: string; work_rights?: { statement?: string } };
  summary_facts: string[];
  experience: Array<{ id: string; company: string; title: string; location: string; start: string; end: string; facts: Array<{ id: string; claim: string; metrics?: string[] }> }>;
  projects: Array<{ id: string; name: string; category: string; technologies: string[]; summary?: string; facts: string[] }>;
  skills: Record<string, { verified?: string[]; familiar?: string[]; basic?: string[] }>;
};

type ResumePlan = {
  summary_fact_indexes: number[];
  experience: Array<{ id: string; fact_ids: string[] }>;
  project_ids: string[];
  skill_categories: string[];
};

type CoverLetterResult = { body: string };

async function profile(): Promise<Profile> {
  return YAML.parse(await readFile(path.join(root(), "resume/facts/profile.yaml"), "utf8")) as Profile;
}

async function job(jobId: string) {
  const rows = await sql<{ id: string; title: string; company: string; location: string | null; jd_clean: string | null; requirements: unknown }[]>`
    select id::text, title, company, location, jd_clean, requirements from jobs where id = ${jobId}::uuid limit 1
  `;
  if (!rows[0]) throw new Error("Job not found");
  return rows[0];
}

function validatePlan(p: Profile, raw: ResumePlan): ResumePlan {
  const exps = new Map(p.experience.map((x) => [x.id, x]));
  const projectIds = new Set(p.projects.map((x) => x.id));
  const skillKeys = new Set(Object.keys(p.skills));

  const summary = [...new Set(raw.summary_fact_indexes ?? [])].filter((i) => Number.isInteger(i) && i >= 0 && i < p.summary_facts.length).slice(0, 3);
  if (!summary.length) summary.push(0, 1);

  const experience = (raw.experience ?? []).filter((x) => exps.has(x.id)).map((x) => {
    const allowed = new Set(exps.get(x.id)!.facts.map((f) => f.id));
    return { id: x.id, fact_ids: [...new Set(x.fact_ids ?? [])].filter((id) => allowed.has(id)).slice(0, 4) };
  }).filter((x) => x.fact_ids.length);
  for (const x of p.experience) {
    if (!experience.some((selected) => selected.id === x.id)) experience.push({ id: x.id, fact_ids: x.facts.slice(0, 2).map((f) => f.id) });
  }

  const projects = [...new Set(raw.project_ids ?? [])].filter((id) => projectIds.has(id)).slice(0, 3);
  if (!projects.length) projects.push(...p.projects.slice(0, 2).map((x) => x.id));

  const skills = [...new Set(raw.skill_categories ?? [])].filter((key) => skillKeys.has(key));
  for (const key of Object.keys(p.skills)) if (!skills.includes(key)) skills.push(key);

  return { summary_fact_indexes: summary, experience, project_ids: projects, skill_categories: skills };
}

async function planResume(p: Profile, j: Awaited<ReturnType<typeof job>>) {
  const registry = {
    summary_facts: p.summary_facts.map((fact, index) => ({ index, fact })),
    experience: p.experience.map((x) => ({ id: x.id, company: x.company, title: x.title, facts: x.facts })),
    projects: p.projects.map((x) => ({ id: x.id, name: x.name, category: x.category, technologies: x.technologies, facts: x.facts })),
    skill_categories: Object.keys(p.skills),
  };
  const raw = await generateJson<ResumePlan>({
    system: "You are a resume evidence selector. Never invent or rewrite facts. Return JSON only. Keep every work experience entry and choose 2-4 verified fact IDs for each. Choose up to 3 relevant projects, 2-3 summary fact indexes, and order skill categories by relevance.",
    user: `JOB: ${j.title} at ${j.company}\nLOCATION: ${j.location ?? "New Zealand"}\nREQUIREMENTS: ${JSON.stringify(j.requirements)}\nJD: ${(j.jd_clean ?? "").slice(0, 12000)}\n\nVERIFIED REGISTRY: ${JSON.stringify(registry)}\n\nReturn {"summary_fact_indexes":[],"experience":[{"id":"","fact_ids":[]}],"project_ids":[],"skill_categories":[]}`,
  });
  return validatePlan(p, raw);
}

function summaryTex(p: Profile, plan: ResumePlan) {
  const facts = plan.summary_fact_indexes.map((i) => p.summary_facts[i]).filter(Boolean);
  const rights = p.candidate.work_rights?.statement;
  if (rights && !facts.includes(rights)) facts.push(rights);
  return `\\textbf{${latex(facts.join(". ").replace(/\.+$/, "") + ".")}}`;
}

function experienceTex(p: Profile, plan: ResumePlan) {
  const byId = new Map(p.experience.map((x) => [x.id, x]));
  return plan.experience.map((selected) => {
    const x = byId.get(selected.id)!;
    const facts = new Map(x.facts.map((f) => [f.id, f]));
    const bullets = selected.fact_ids.map((id) => facts.get(id)).filter(Boolean).map((f) => {
      const metric = f!.metrics?.length ? `; ${f!.metrics!.join("; ")}` : "";
      return `    \\item ${latex(f!.claim + metric)}`;
    }).join("\n");
    return `\\resumeHeading{${latex(x.company)}}{${latex(x.title)}}{${latex(x.location)}}{${month(x.start)} -- ${month(x.end)}}\n\\begin{bullets}\n${bullets}\n\\end{bullets}\n\\sectionsep`;
  }).join("\n\n");
}

function projectsTex(p: Profile, plan: ResumePlan) {
  const byId = new Map(p.projects.map((x) => [x.id, x]));
  return plan.project_ids.map((id) => {
    const x = byId.get(id)!;
    const bullets = x.facts.slice(0, 3).map((fact) => `    \\item ${latex(fact)}`).join("\n");
    const summary = x.summary ? `\\textbf{${latex(x.summary)}}\n` : "";
    return `\\projectHeadingNoLink{${latex(x.name)}}{${latex(x.category)}}{${latex(x.technologies.join(", "))}}\n${summary}\\begin{bullets}\n${bullets}\n\\end{bullets}\n\\sectionsep`;
  }).join("\n\n");
}

const labels: Record<string, string> = {
  languages_and_databases: "Languages \\& DB:", data_ml: "Data/ML:", geospatial: "Geospatial:",
  web_backend: "Web/Backend:", platforms_tools: "Platforms/Tools:", containers_cloud: "Containers/Cloud:",
};

function skillsTex(p: Profile, plan: ResumePlan) {
  const rows = plan.skill_categories.map((key) => {
    const g = p.skills[key] ?? {};
    const values = [...(g.verified ?? []), ...(g.familiar ?? []).map((v) => `${v} (familiar)`), ...(g.basic ?? []).map((v) => `${v} (basic)`)].join(", ");
    return `    \\singleItem{${labels[key] ?? latex(key + ":")}}{${latex(values)}} \\\\`;
  });
  return `\\begin{skillList}\n${rows.join("\n")}\n\\end{skillList}`;
}

async function compile(texPath: string, masterDir?: string) {
  const env = { ...process.env, ...(masterDir ? { TEXINPUTS: `${masterDir}:${process.env.TEXINPUTS ?? ""}` } : {}) };
  try {
    await execFileAsync("xelatex", ["-interaction=nonstopmode", "-halt-on-error", path.basename(texPath)], { cwd: path.dirname(texPath), env, timeout: 60000 });
  } catch (error) {
    throw new Error(`XeLaTeX compilation failed. Install a TeX distribution and the lato-font/raleway-font packages. ${String(error)}`);
  }
  return texPath.replace(/\.tex$/, ".pdf");
}

async function application(jobId: string) {
  const rows = await sql<{ id: string }[]>`
    insert into applications (job_id, status) values (${jobId}::uuid, 'discovered'::application_status)
    on conflict (job_id) do update set updated_at = now() returning id::text
  `;
  return rows[0].id;
}

async function record(appId: string, type: "resume" | "cover_letter", format: "tex" | "pdf", url: string) {
  await sql`
    insert into generated_documents (application_id, document_type, format, storage_path, generator_version, source_profile_version, approved)
    values (${appId}::uuid, ${type}, ${format}, ${url}, 'v0.2-deepseek-fact-guard', 'profile.yaml', false)
  `;
}

const outDir = (jobId: string) => path.join(root(), "apps/web/public/generated", jobId);

export async function generateResume(jobId: string) {
  const [p, j] = await Promise.all([profile(), job(jobId)]);
  const plan = await planResume(p, j);
  const masterDir = path.join(root(), "resume/master");
  let tex = await readFile(path.join(masterDir, "resume-template.tex"), "utf8");
  tex = tex.replace("%%SUMMARY%%", summaryTex(p, plan)).replace("%%EXPERIENCE%%", experienceTex(p, plan)).replace("%%PROJECTS%%", projectsTex(p, plan)).replace("%%SKILLS%%", skillsTex(p, plan));

  const out = outDir(jobId);
  await mkdir(out, { recursive: true });
  const texPath = path.join(out, "resume.tex");
  await writeFile(texPath, tex, "utf8");
  await compile(texPath, masterDir);

  const appId = await application(jobId);
  const texUrl = `/generated/${jobId}/resume.tex`;
  const pdfUrl = `/generated/${jobId}/resume.pdf`;
  await record(appId, "resume", "tex", texUrl);
  await record(appId, "resume", "pdf", pdfUrl);
  await sql`update applications set generated_at = now(), resume_path = ${pdfUrl}, updated_at = now() where id = ${appId}::uuid`;
  return { tex: texUrl, pdf: pdfUrl, provider: aiProviderName() };
}

function coverTex(name: string, company: string, title: string, body: string) {
  const paragraphs = body.split(/\n\s*\n/).map((x) => latex(x.trim())).filter(Boolean).join("\n\n");
  const date = new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" });
  return `\\documentclass[11pt,a4paper]{article}\n\\usepackage[a4paper,margin=0.78in]{geometry}\n\\usepackage[hidelinks]{hyperref}\n\\usepackage{lato-font}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0pt}\n\\setlength{\\parskip}{9pt}\n\\begin{document}\n{\\Large\\bfseries ${latex(name)}}\\\\\n+64 (022) 091 1240 $\\mid$ \\href{mailto:therinkao@gmail.com}{therinkao@gmail.com}\\\\\nNew Zealand\n\n\\vspace{12pt}\n${date}\n\nHiring Manager\\\\\n${latex(company)}\\\\\nNew Zealand\n\n\\textbf{Re: ${latex(title)}}\n\nDear Hiring Manager,\n\n${paragraphs}\n\nThank you for your consideration.\n\nKind regards,\\\\[14pt]\n${latex(name)}\n\\end{document}\n`;
}

export async function generateCoverLetter(jobId: string) {
  const [p, j] = await Promise.all([profile(), job(jobId)]);
  const result = await generateJson<CoverLetterResult>({
    system: "Write a concise New Zealand cover letter using only facts explicitly present in the verified profile. Never invent tools, industries, metrics, responsibilities, years, certifications or domain experience. Return JSON only with key body. Body must be 4-5 short paragraphs, with no address block, greeting, sign-off or markdown.",
    user: `JOB: ${j.title} at ${j.company}\nLOCATION: ${j.location ?? "New Zealand"}\nREQUIREMENTS: ${JSON.stringify(j.requirements)}\nJD: ${(j.jd_clean ?? "").slice(0, 12000)}\n\nVERIFIED PROFILE: ${JSON.stringify(p)}`,
    temperature: 0.2,
  });
  if (!result.body?.trim()) throw new Error("AI provider returned an empty cover letter");

  const out = outDir(jobId);
  await mkdir(out, { recursive: true });
  const texPath = path.join(out, "cover-letter.tex");
  await writeFile(texPath, coverTex(p.candidate.name, j.company, j.title, result.body), "utf8");
  await compile(texPath);

  const appId = await application(jobId);
  const texUrl = `/generated/${jobId}/cover-letter.tex`;
  const pdfUrl = `/generated/${jobId}/cover-letter.pdf`;
  await record(appId, "cover_letter", "tex", texUrl);
  await record(appId, "cover_letter", "pdf", pdfUrl);
  await sql`update applications set generated_at = now(), cover_letter_path = ${pdfUrl}, updated_at = now() where id = ${appId}::uuid`;
  return { tex: texUrl, pdf: pdfUrl, provider: aiProviderName() };
}
