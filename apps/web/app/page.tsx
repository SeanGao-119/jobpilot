import { addJobUrl } from "./actions";
import { getDashboardData } from "../lib/dashboard";

export const dynamic = "force-dynamic";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function sourceLabel(category: string) {
  if (category === "manual_url") return "Manual URL";
  if (category === "job_alert") return "Job alert";
  if (category === "recommendation") return "Recommendation";
  if (category === "recruiter") return "Recruiter";
  if (category === "network") return "Network";
  return "Other";
}

type PageProps = {
  searchParams: Promise<{ imported?: string; import_error?: string }>;
};

export default async function HomePage({ searchParams }: PageProps) {
  const { imported, import_error: importError } = await searchParams;
  const { stats, jobs } = await getDashboardData();

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">JOBPILOT V0.6</p>
          <h1>Job search command centre</h1>
          <p className="subtitle">One opportunity pool across SEEK, LinkedIn, ZEIL and Trade Me.</p>
        </div>
        <div className="topActions">
          <a className="button" href="/evidence">Evidence Bank</a>
          <div className="live"><span />Live database</div>
        </div>
      </header>

      <section className="importPanel">
        <div>
          <p className="eyebrow">ADD OPPORTUNITY</p>
          <h2>Add an opportunity URL</h2>
          <p className="muted">Jobs from SEEK, LinkedIn, ZEIL and Trade Me. LinkedIn recruiter and network leads are supported too.</p>
        </div>
        <form action={addJobUrl} className="urlImportForm opportunityForm">
          <div className="urlRow">
            <input name="url" type="url" required placeholder="Paste a SEEK, LinkedIn, ZEIL or Trade Me URL" aria-label="Opportunity URL" />
            <select name="opportunity_kind" aria-label="Opportunity type" defaultValue="job">
              <option value="job">Job</option>
              <option value="recruiter">LinkedIn recruiter</option>
              <option value="network">LinkedIn connection</option>
            </select>
            <button className="primaryButton" type="submit">Add to pool</button>
          </div>
          <details className="importFallback">
            <summary>Page blocked? Add details manually</summary>
            <div>
              <input name="title" placeholder="Role or contact title" />
              <input name="company" placeholder="Company" />
              <textarea name="description" placeholder="Optional job description or context" rows={4} />
            </div>
          </details>
        </form>
        {imported && <p className="importMessage success">{imported}</p>}
        {importError && <p className="importMessage error">{importError}</p>}
      </section>

      <section className="metrics">
        <article><span>Active jobs</span><strong>{stats.jobs}</strong><small>{stats.newToday} new today</small></article>
        <article><span>Average match</span><strong>{stats.averageMatch.toFixed(0)}%</strong><small>scored opportunities</small></article>
        <article><span>Apply</span><strong>{stats.apply}</strong><small>80+ match</small></article>
        <article><span>Consider</span><strong>{stats.consider}</strong><small>65–79 match</small></article>
      </section>

      <section className="panel">
        <div className="panelHead">
          <div>
            <p className="eyebrow">OPPORTUNITIES</p>
            <h2>Active ranked jobs</h2>
          </div>
          <div className="legend">
            <span>Low {stats.low}</span>
            <span>Skip {stats.skip}</span>
            <span>Archived {stats.archived}</span>
          </div>
        </div>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Match</th>
                <th>Role</th>
                <th>Company</th>
                <th>Location</th>
                <th>Source</th>
                <th>Recommendation</th>
                <th>Status</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td><div className="score">{job.overall_score === null ? "—" : Math.round(Number(job.overall_score))}</div></td>
                  <td className="role">
                    {job.overall_score === null
                      ? <span>{job.title}</span>
                      : <a href={`/jobs/${job.id}`}>{job.title}</a>}
                  </td>
                  <td>{job.company}</td>
                  <td className="muted">{job.location ?? "—"}</td>
                  <td>
                    <div className="sourceTags">
                      <span className={`sourceTag ${job.ingestion_mode}`}>{job.ingestion_mode}</span>
                      <span className={`sourceTag platform ${job.platform}`}>{job.platform}</span>
                      <span className="sourceTag">{sourceLabel(job.source_category)}</span>
                      {job.opportunity_kind !== "job" && <span className="sourceTag">{job.opportunity_kind}</span>}
                    </div>
                  </td>
                  <td>
                    {job.recommendation
                      ? <span className={`pill ${job.recommendation}`}>{job.recommendation}</span>
                      : <span className="pill">pending analysis</span>}
                  </td>
                  <td><span className="status">{job.status.replaceAll("_", " ")}</span></td>
                  <td className="muted">{formatDateTime(job.discovered_at)}</td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr><td colSpan={8} className="empty">No opportunities yet. Add a URL above or run JobPilot daily to sync SEEK and LinkedIn alerts.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
