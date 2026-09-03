import { notFound } from "next/navigation";

import { getJobDetail } from "../../../lib/jobs";
import { generateApplication, markApplied, refreshSalaryIntelligence } from "./actions";

export const dynamic = "force-dynamic";

function values(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") return JSON.stringify(item);
    return String(item);
  });
}

function salaryEvidence(input: unknown): Array<{ title: string; company: string; location: string; salary: string; source_url: string }> {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is { title: string; company: string; location: string; salary: string; source_url: string } => {
    return Boolean(item && typeof item === "object" && "title" in item && "company" in item);
  });
}

type PacketCheck = { id: string; label: string; status: "pass" | "warning" | "fail"; detail: string };
type PacketQa = {
  ready: boolean;
  evidence_coverage: number;
  resume_cover_alignment: number;
  checks: PacketCheck[];
};
type PacketRequirement = {
  requirement: string;
  priority: "critical" | "high" | "medium";
  status: "matched" | "partial" | "gap";
  evidence_ids: string[];
};
type ParagraphMapping = {
  paragraph: number;
  purpose: string;
  evidence_ids: string[];
  job_requirements: string[];
};

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? input as Record<string, unknown> : {};
}

function packetQa(input: unknown): PacketQa | null {
  const item = record(input);
  if (!Array.isArray(item.checks)) return null;
  return {
    ready: Boolean(item.ready),
    evidence_coverage: Number(item.evidence_coverage ?? 0),
    resume_cover_alignment: Number(item.resume_cover_alignment ?? 0),
    checks: item.checks.filter((check): check is PacketCheck => Boolean(check && typeof check === "object" && "label" in check)),
  };
}

function packetRequirements(input: unknown): PacketRequirement[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is PacketRequirement => Boolean(item && typeof item === "object" && "requirement" in item && "status" in item));
}

function paragraphMappings(input: unknown): ParagraphMapping[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is ParagraphMapping => Boolean(item && typeof item === "object" && "paragraph" in item));
}

function score(value: number | null) {
  return value == null ? "—" : Math.round(value).toString();
}

function money(value: number | null, currency = "NZD") {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJobDetail(id);
  if (!job) notFound();

  const matched = values(job.matched_evidence);
  const partial = values(job.partial_evidence);
  const gaps = values(job.gaps);
  const comparables = salaryEvidence(job.salary_evidence);
  const hasSalaryEstimate = job.salary_estimate_min != null || job.salary_estimate_max != null;
  const qa = packetQa(job.packet_qa_report);
  const requirements = packetRequirements(job.packet_requirement_map);
  const mappings = paragraphMappings(job.packet_cover_letter_mapping);
  const targetProfile = record(job.packet_target_profile);

  return (
    <main className="shell detailShell">
      <a href="/" className="backLink">← Dashboard</a>
      <header className="detailHeader">
        <div>
          <p className="eyebrow">JOB WORKSPACE</p>
          <h1>{job.title}</h1>
          <p className="subtitle">{job.company} · {job.location ?? "Location not listed"}</p>
        </div>
        <div className="detailScore">
          <strong>{Math.round(job.overall_score)}</strong>
          <span>match</span>
        </div>
      </header>

      <section className="actionBar">
        <form action={generateApplication.bind(null, id)}>
          <button className="primaryButton" type="submit">{job.resume_path ? "Regenerate Application" : "Generate Application"}</button>
        </form>
        {job.resume_path && <a className="button" href={job.resume_path} target="_blank" rel="noreferrer">Resume PDF ↗</a>}
        {job.cover_letter_path && <a className="button" href={job.cover_letter_path} target="_blank" rel="noreferrer">Cover Letter PDF ↗</a>}
        {job.status !== "applied" ? (
          <form action={markApplied.bind(null, id)}>
            <button className="button" type="submit">Mark as Applied</button>
          </form>
        ) : <span className="appliedBadge">Applied ✓</span>}
        {job.source_url && <a className="button" href={job.source_url} target="_blank" rel="noreferrer">Open SEEK ↗</a>}
      </section>

      <section className={`packetCard ${qa?.ready ? "ready" : qa ? "review" : ""}`}>
        <div className="packetHead">
          <div>
            <p className="eyebrow">APPLICATION PACKET</p>
            <h2>{qa ? (qa.ready ? "Ready to apply" : "Needs review") : "Not generated"}</h2>
            <p className="muted">
              {qa
                ? `${String(targetProfile.target_title ?? job.title)} · Resume frozen before cover letter generation`
                : "Generate one evidence-linked resume and cover letter package."}
            </p>
          </div>
          {qa && (
            <div className="packetMetrics">
              <span>Evidence<strong>{qa.evidence_coverage}%</strong></span>
              <span>Resume ↔ CL<strong>{qa.resume_cover_alignment}%</strong></span>
            </div>
          )}
        </div>

        {qa && (
          <div className="qualityGrid">
            {qa.checks.map((check) => (
              <div className={`qualityCheck ${check.status}`} key={check.id}>
                <span>{check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "×"}</span>
                <div><strong>{check.label}</strong><small>{check.detail}</small></div>
              </div>
            ))}
          </div>
        )}

        {requirements.length > 0 && (
          <div className="packetSubgrid">
            <div>
              <h3>Requirement evidence</h3>
              <div className="requirementList">
                {requirements.map((item) => (
                  <span className={`requirement ${item.status}`} key={`${item.priority}-${item.requirement}`}>
                    {item.status === "matched" ? "✓" : item.status === "partial" ? "△" : "×"} {item.requirement}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3>Cover letter evidence map</h3>
              {mappings.length ? (
                <ul className="mappingList">
                  {mappings.map((item) => (
                    <li key={item.paragraph}>
                      <strong>Paragraph {item.paragraph}</strong>
                      <span>{item.evidence_ids.length ? item.evidence_ids.join(", ") : item.purpose}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No mapping recorded.</p>}
            </div>
          </div>
        )}
      </section>

      <section className="detailGrid">
        <article className="detailCard">
          <p className="eyebrow">MATCH BREAKDOWN</p>
          <div className="scoreGrid">
            <span>Technical<strong>{score(job.technical_score)}</strong></span>
            <span>Experience<strong>{score(job.experience_score)}</strong></span>
            <span>Education<strong>{score(job.education_score)}</strong></span>
            <span>Domain<strong>{score(job.domain_score)}</strong></span>
            <span>Seniority<strong>{score(job.seniority_score)}</strong></span>
            <span>Location<strong>{score(job.location_score)}</strong></span>
            <span>Work rights<strong>{score(job.work_rights_score)}</strong></span>
          </div>
          {job.explanation && <p className="detailText">{job.explanation}</p>}
          {job.generated_at && <p className="muted">Documents last generated: {new Date(job.generated_at).toLocaleString("en-NZ")}</p>}
        </article>

        <article className="detailCard salaryCard">
          <p className="eyebrow">SALARY INTELLIGENCE</p>
          {hasSalaryEstimate ? (
            <>
              <div className="salaryRange">
                {money(job.salary_estimate_min, job.salary_currency ?? "NZD")}–{money(job.salary_estimate_max, job.salary_currency ?? "NZD")}
              </div>
              <p>Recommended ask: <strong>{money(job.salary_recommended_ask, job.salary_currency ?? "NZD")}</strong></p>
              <p className="muted">{job.salary_confidence} confidence · {job.salary_comparable_count ?? 0} comparable roles</p>
              {job.salary_rationale && <p className="detailText">{job.salary_rationale}</p>}
              {comparables.length > 0 && (
                <ul>
                  {comparables.map((item, i) => (
                    <li key={i}>
                      {item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
                      {` · ${item.company} · ${item.location} · ${item.salary}`}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="salaryRange">Not calculated</div>
              <p className="muted">Search current NZ comparable roles and estimate a defensible market range.</p>
            </>
          )}
          {job.salary_text && <p className="detailText">Advertised: {job.salary_text}</p>}
          <form action={refreshSalaryIntelligence.bind(null, id)}>
            <button className="button" type="submit">{hasSalaryEstimate ? "Refresh salary estimate" : "Calculate salary estimate"}</button>
          </form>
        </article>
      </section>

      <section className="evidenceGrid">
        <article className="detailCard">
          <h2>Matched evidence</h2>
          <ul>{matched.length ? matched.map((item, i) => <li key={i}>{item}</li>) : <li>None recorded.</li>}</ul>
        </article>
        <article className="detailCard">
          <h2>Partial evidence</h2>
          <ul>{partial.length ? partial.map((item, i) => <li key={i}>{item}</li>) : <li>None recorded.</li>}</ul>
        </article>
        <article className="detailCard gapCard">
          <h2>Gaps</h2>
          <ul>{gaps.length ? gaps.map((item, i) => <li key={i}>{item}</li>) : <li>No material gaps recorded.</li>}</ul>
        </article>
      </section>

      <section className="detailCard jdCard">
        <p className="eyebrow">JOB DESCRIPTION</p>
        <pre>{job.jd_clean ?? "No job description stored."}</pre>
      </section>
    </main>
  );
}
