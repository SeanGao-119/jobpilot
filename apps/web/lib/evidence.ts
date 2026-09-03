export type EvidenceStatus = "verified" | "needs_review";

export type ProfileFact = {
  id: string;
  claim: string;
  metrics?: string[];
  metrics_status?: EvidenceStatus;
  evidence_tags?: string[];
};

export type ProjectFact = {
  id: string;
  claim: string;
  status?: EvidenceStatus;
};

export type Profile = {
  schema_version: number;
  candidate: {
    name: string;
    legal_name?: string;
    email: string;
    phone: string;
    github: string;
    linkedin: string;
    location?: string;
    location_country: string;
    work_rights?: { statement?: string };
  };
  summary_facts: string[];
  experience: Array<{
    id: string;
    company: string;
    title: string;
    location: string;
    start: string;
    end: string;
    facts: ProfileFact[];
  }>;
  projects: Array<{
    id: string;
    name: string;
    category: string;
    technologies: string[];
    summary?: string;
    source_experience_ids?: string[];
    facts: ProjectFact[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    location: string;
    start: string;
    end: string;
    concentrations?: string[];
    coursework?: string[];
    awards?: string[];
  }>;
  skills: Record<string, { verified?: string[]; familiar?: string[]; basic?: string[] }>;
  languages: Array<{ language: string; proficiency: string }>;
};

export type EvidenceItem = {
  id: string;
  kind: "summary" | "experience" | "project" | "education";
  label: string;
  text: string;
  tags: string[];
  status: EvidenceStatus;
};

export type RequirementMatch = {
  requirement: string;
  priority: "critical" | "high" | "medium";
  status: "matched" | "partial" | "gap";
  evidence_ids: string[];
};

export type ResumePlan = {
  target_title: string;
  positioning: string[];
  summary_fact_indexes: number[];
  experience: Array<{ id: string; fact_ids: string[] }>;
  project_ids: string[];
  selected_skills: string[];
};

export type ResumeSnapshot = {
  target_title: string;
  summary: string;
  experience: Array<{
    id: string;
    company: string;
    title: string;
    location: string;
    dates: string;
    bullets: Array<{ evidence_id: string; text: string }>;
  }>;
  projects: Array<{
    id: string;
    name: string;
    category: string;
    technologies: string[];
    summary?: string;
    bullets: Array<{ evidence_id: string; text: string }>;
  }>;
  skills: Array<{ category: string; items: string[] }>;
  education: Profile["education"];
  selected_evidence_ids: string[];
  excluded_review_metrics: string[];
};

const CATEGORY_LABELS: Record<string, string> = {
  languages_and_databases: "Data Engineering",
  data_ml: "Data & Analytics",
  geospatial: "Geospatial",
  web_backend: "Backend",
  platforms_tools: "Platforms & Tools",
  containers_cloud: "Cloud & DevOps",
};

const ALIASES: Record<string, string[]> = {
  sql: ["sql", "postgresql", "mysql", "as400", "database", "query"],
  python: ["python", "pandas", "geopandas", "numpy"],
  etl: ["etl", "data pipeline", "data pipelines", "data integration", "data cleaning"],
  spark: ["spark", "pyspark"],
  linux: ["linux", "cron", "operations"],
  git: ["git", "version control"],
  "data quality": ["data quality", "reconciliation", "validation", "quality checks"],
  automation: ["automation", "automated", "batch", "scheduled"],
  reporting: ["reporting", "dashboard", "excel", "tableau"],
  geospatial: ["geospatial", "postgis", "spatial", "crs", "qgis"],
  api: ["api", "apis", "rest api", "backend"],
  stakeholder: ["stakeholder", "ba", "qa", "handover"],
};

function norm(value: string) {
  return value.toLowerCase().replace(/[_/-]+/g, " ").replace(/[^a-z0-9+#. ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokensFor(value: string) {
  const normalized = norm(value);
  const result = new Set([normalized]);
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    const normalizedAliases = aliases.map(norm);
    if (normalized === canonical || normalizedAliases.includes(normalized)) {
      result.add(canonical);
      normalizedAliases.forEach((alias) => result.add(alias));
    }
  }
  return [...result].filter(Boolean);
}

function includesTerm(haystack: string, term: string) {
  if (!term) return false;
  if (term.length <= 2) {
    return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(haystack);
  }
  return haystack.includes(term);
}

function evidenceSearchText(item: EvidenceItem) {
  return norm([item.text, item.label, ...item.tags].join(" "));
}

export function evidenceRegistry(profile: Profile): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  profile.summary_facts.forEach((text, index) => {
    items.push({ id: `summary:${index}`, kind: "summary", label: "Professional summary", text, tags: [], status: "verified" });
  });
  for (const experience of profile.experience) {
    for (const fact of experience.facts) {
      const verifiedMetrics = fact.metrics_status === "verified" ? fact.metrics ?? [] : [];
      items.push({
        id: fact.id,
        kind: "experience",
        label: `${experience.company} - ${experience.title}`,
        text: [fact.claim, ...verifiedMetrics].join("; "),
        tags: fact.evidence_tags ?? [],
        status: "verified",
      });
    }
  }
  for (const project of profile.projects) {
    for (const fact of project.facts) {
      items.push({
        id: fact.id,
        kind: "project",
        label: project.name,
        text: fact.claim,
        tags: [project.category, ...project.technologies],
        status: fact.status ?? "verified",
      });
    }
  }
  profile.education.forEach((education, index) => {
    items.push({
      id: `education:${index}`,
      kind: "education",
      label: education.institution,
      text: `${education.degree}; ${(education.concentrations ?? []).join(", ")}; ${(education.coursework ?? []).join(", ")}`,
      tags: education.concentrations ?? [],
      status: "verified",
    });
  });
  return items;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter((item) => item.length > 0 && item.length <= 80);
}

export function requirementTerms(requirements: unknown, jd: string): Array<{ requirement: string; priority: RequirementMatch["priority"] }> {
  const object = requirements && typeof requirements === "object" ? requirements as Record<string, unknown> : {};
  const required = stringArray(object.required_skills ?? object.must_have ?? object.critical);
  const preferred = stringArray(object.preferred_skills ?? object.nice_to_have ?? object.preferred);
  const found: Array<{ requirement: string; priority: RequirementMatch["priority"] }> = [
    ...required.map((requirement) => ({ requirement, priority: "critical" as const })),
    ...preferred.map((requirement) => ({ requirement, priority: "medium" as const })),
  ];

  if (!found.length) {
    const known = [
      "Python", "SQL", "ETL", "Spark", "Databricks", "Azure", "Microsoft Fabric", "dbt", "Airflow",
      "Docker", "AWS", "PostgreSQL", "MySQL", "Power BI", "Tableau", "Git", "Linux", "REST APIs",
      "data quality", "automation", "stakeholder management", "reporting", "geospatial",
    ];
    const searchable = norm(jd);
    for (const requirement of known) {
      if (tokensFor(requirement).some((token) => includesTerm(searchable, token))) {
        found.push({ requirement, priority: "high" });
      }
    }
  }

  const seen = new Set<string>();
  return found.filter((item) => {
    const key = norm(item.requirement);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 18);
}

export function mapRequirements(
  requirements: Array<{ requirement: string; priority: RequirementMatch["priority"] }>,
  registry: EvidenceItem[],
): RequirementMatch[] {
  const usable = registry.filter((item) => item.status === "verified");
  return requirements.map(({ requirement, priority }) => {
    const exactToken = norm(requirement);
    const aliases = tokensFor(requirement);
    const exact: string[] = [];
    const partial: string[] = [];
    for (const item of usable) {
      const searchable = evidenceSearchText(item);
      if (includesTerm(searchable, exactToken)) exact.push(item.id);
      else if (aliases.some((token) => includesTerm(searchable, token))) partial.push(item.id);
    }
    const evidenceIds = [...new Set(exact.length ? exact : partial)].slice(0, 5);
    return {
      requirement,
      priority,
      status: exact.length ? "matched" : partial.length ? "partial" : "gap",
      evidence_ids: evidenceIds,
    };
  });
}

export function coverageScore(matches: RequirementMatch[]) {
  if (!matches.length) return 0;
  const weight = { critical: 3, high: 2, medium: 1 };
  const points = { matched: 1, partial: 0.55, gap: 0 };
  const total = matches.reduce((sum, item) => sum + weight[item.priority], 0);
  const achieved = matches.reduce((sum, item) => sum + weight[item.priority] * points[item.status], 0);
  return Math.round((achieved / total) * 100);
}

function supportedSkills(profile: Profile, registry: EvidenceItem[]) {
  const usable = registry.filter((item) => item.status === "verified" && item.kind !== "summary");
  const result = new Map<string, { category: string; display: string; evidenceIds: string[] }>();
  for (const [category, group] of Object.entries(profile.skills)) {
    for (const [level, values] of Object.entries(group)) {
      for (const skill of values ?? []) {
        const exactSkill = norm(skill);
        const evidenceIds = usable
          .filter((item) => includesTerm(evidenceSearchText(item), exactSkill))
          .map((item) => item.id);
        if (!evidenceIds.length) continue;
        const suffix = level === "verified" ? "" : ` (${level})`;
        result.set(norm(skill), { category, display: `${skill}${suffix}`, evidenceIds: [...new Set(evidenceIds)] });
      }
    }
  }
  return result;
}

export function skillEvidenceCatalog(profile: Profile, registry: EvidenceItem[]) {
  return [...supportedSkills(profile, registry).values()].map((item) => ({
    skill: item.display,
    category: item.category,
    evidence_ids: item.evidenceIds,
  }));
}

function relevanceScore(text: string, requirementMap: RequirementMatch[]) {
  const searchable = norm(text);
  return requirementMap.reduce((score, match) => {
    if (match.status === "gap") return score;
    const hit = tokensFor(match.requirement).some((token) => includesTerm(searchable, token));
    return score + (hit ? (match.priority === "critical" ? 4 : match.priority === "high" ? 3 : 1) : 0);
  }, 0);
}

export function validateResumePlan(
  profile: Profile,
  raw: Partial<ResumePlan>,
  requirementMap: RequirementMatch[],
  registry: EvidenceItem[],
): ResumePlan {
  const experienceById = new Map(profile.experience.map((item) => [item.id, item]));
  const requestedExperience = new Map((raw.experience ?? []).map((item) => [item.id, item.fact_ids ?? []]));
  const experience = profile.experience.map((item) => {
    const factIds = new Set(item.facts.map((fact) => fact.id));
    const requested = [...new Set(requestedExperience.get(item.id) ?? [])].filter((id) => factIds.has(id)).slice(0, 3);
    const fallback = [...item.facts]
      .sort((a, b) => relevanceScore(`${b.claim} ${(b.evidence_tags ?? []).join(" ")}`, requirementMap)
        - relevanceScore(`${a.claim} ${(a.evidence_tags ?? []).join(" ")}`, requirementMap))
      .map((fact) => fact.id);
    const selected = [...requested, ...fallback.filter((id) => !requested.includes(id))].slice(0, 3);
    return { id: item.id, fact_ids: selected };
  }).filter((item) => experienceById.has(item.id));

  const selectedExperienceIds = new Set(experience.map((item) => item.id));
  const eligibleProjects = profile.projects.filter((project) =>
    !(project.source_experience_ids ?? []).some((id) => selectedExperienceIds.has(id))
    && project.facts.some((fact) => (fact.status ?? "verified") === "verified"),
  );
  const requestedProjects = [...new Set(raw.project_ids ?? [])]
    .map((id) => eligibleProjects.find((project) => project.id === id))
    .filter((project): project is Profile["projects"][number] => Boolean(project));
  const fallbackProjects = [...eligibleProjects].sort((a, b) =>
    relevanceScore(`${b.name} ${b.category} ${b.technologies.join(" ")} ${b.summary ?? ""}`, requirementMap)
    - relevanceScore(`${a.name} ${a.category} ${a.technologies.join(" ")} ${a.summary ?? ""}`, requirementMap),
  );
  const projectIds = [...requestedProjects, ...fallbackProjects.filter((item) => !requestedProjects.some((x) => x.id === item.id))]
    .slice(0, 2)
    .map((item) => item.id);

  const backed = supportedSkills(profile, registry);
  const requestedSkills = [...new Set(raw.selected_skills ?? [])]
    .map((skill) => backed.get(norm(skill)))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
  const rankedSkills = [...backed.values()].sort((a, b) =>
    relevanceScore(`${b.display} ${b.category}`, requirementMap) - relevanceScore(`${a.display} ${a.category}`, requirementMap),
  );
  const selectedSkills = [...requestedSkills, ...rankedSkills.filter((item) => !requestedSkills.includes(item))]
    .slice(0, 16)
    .map((item) => item.display);

  const summary = [...new Set(raw.summary_fact_indexes ?? [])]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < profile.summary_facts.length)
    .slice(0, 3);
  if (!summary.length) summary.push(...profile.summary_facts.slice(0, 2).map((_, index) => index));

  return {
    target_title: String(raw.target_title ?? "Data Engineer").trim() || "Data Engineer",
    positioning: [...new Set(raw.positioning ?? [])].map(String).filter(Boolean).slice(0, 6),
    summary_fact_indexes: summary,
    experience,
    project_ids: projectIds,
    selected_skills: selectedSkills,
  };
}

function month(value: string) {
  const [year, m] = value.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] ?? m} ${year}`;
}

export function buildResumeSnapshot(profile: Profile, plan: ResumePlan, compact = false): ResumeSnapshot {
  const registry = evidenceRegistry(profile);
  const evidenceById = new Map(registry.map((item) => [item.id, item]));
  const experienceById = new Map(profile.experience.map((item) => [item.id, item]));
  const projectById = new Map(profile.projects.map((item) => [item.id, item]));
  const excludedReviewMetrics: string[] = [];

  const experience = plan.experience.map((selected) => {
    const item = experienceById.get(selected.id)!;
    const factById = new Map(item.facts.map((fact) => [fact.id, fact]));
    const ids = selected.fact_ids.slice(0, compact ? 2 : 3);
    const bullets = ids.map((id) => {
      const fact = factById.get(id)!;
      if (fact.metrics?.length && fact.metrics_status !== "verified") {
        excludedReviewMetrics.push(`${item.company}: ${fact.metrics.join("; ")}`);
      }
      return { evidence_id: id, text: evidenceById.get(id)?.text ?? fact.claim };
    });
    return {
      id: item.id,
      company: item.company,
      title: item.title,
      location: item.location,
      dates: `${month(item.start)} - ${month(item.end)}`,
      bullets,
    };
  });

  const projects = plan.project_ids.slice(0, compact ? 1 : 2).map((id) => {
    const project = projectById.get(id)!;
    const facts = project.facts.filter((fact) => (fact.status ?? "verified") === "verified").slice(0, compact ? 2 : 3);
    return {
      id: project.id,
      name: project.name,
      category: project.category,
      technologies: project.technologies,
      summary: project.summary,
      bullets: facts.map((fact) => ({ evidence_id: fact.id, text: fact.claim })),
    };
  });

  const selectedByNorm = new Map(plan.selected_skills.map((skill) => [norm(skill.replace(/ \((familiar|basic)\)$/i, "")), skill]));
  const skills: ResumeSnapshot["skills"] = [];
  for (const [category, group] of Object.entries(profile.skills)) {
    const all = [...(group.verified ?? []), ...(group.familiar ?? []), ...(group.basic ?? [])];
    const items = all.map((skill) => selectedByNorm.get(norm(skill))).filter((item): item is string => Boolean(item));
    if (items.length) skills.push({ category: CATEGORY_LABELS[category] ?? category, items });
  }

  const summaryFacts = plan.summary_fact_indexes.map((index) => profile.summary_facts[index]).filter(Boolean);
  const summary = `${summaryFacts.join(". ").replace(/\.+$/, "")}.`;
  const selectedEvidenceIds = [
    ...plan.summary_fact_indexes.map((index) => `summary:${index}`),
    ...experience.flatMap((item) => item.bullets.map((bullet) => bullet.evidence_id)),
    ...projects.flatMap((item) => item.bullets.map((bullet) => bullet.evidence_id)),
  ];

  return {
    target_title: plan.target_title,
    summary,
    experience,
    projects,
    skills,
    education: profile.education,
    selected_evidence_ids: [...new Set(selectedEvidenceIds)],
    excluded_review_metrics: [...new Set(excludedReviewMetrics)],
  };
}
