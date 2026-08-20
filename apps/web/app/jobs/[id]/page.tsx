import { notFound } from "next/navigation";

import { getJobDetail } from "../../../lib/jobs";
import { markApplied, refreshSalaryIntelligence, requestDocument } from "./actions";

export const dynamic = "force-dynamic";

function values(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") return JSON.stringify(item);
    return String(item);
  });
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
  const hasSalaryEstimate = job.salary_estimate_min != null || job.salary_estimate_max != null;

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
        <form action={requestDocument.bind(null, id, "resume")}>
          <button className="primaryButton" type="submit">Generate Resume</button>
        </form>
        <form action={requestDocument.bind(null, id, "cover_letter")}>
          <button className="button" type="submit">Generate Cover Letter</button>
        </form>
        {job.status !== "applied" ? (
          <form action={markApplied.bind(null, id)}>
            <button className="button" type="submit">Mark as Applied</button>
          </form>
        ) : <span className="appliedBadge">Applied ✓</span>}
        {job.source_url && <a className="button" href={job.source_url} target="_blank" rel="noreferrer">Open SEEK ↗</a>}
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
