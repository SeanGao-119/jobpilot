import { addSeekJobUrl } from "./actions";
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
          <p className="eyebrow">JOBPILOT V0.5</p>
          <h1>Job search command centre</h1>
          <p className="subtitle">SEEK ingestion, evidence matching, unified application packets and outcome tracking.</p>
        </div>
        <div className="live"><span />Live database</div>
      </header>

      <section className="importPanel">
        <div>
          <p className="eyebrow">ADD OPPORTUNITY</p>
          <h2>Paste a SEEK job URL</h2>
          <p className="muted">Manual imports are tagged separately from Job Alerts and Recommendations.</p>
        </div>
        <form action={addSeekJobUrl} className="urlImportForm">
          <input name="url" type="url" required placeholder="https://www.seek.co.nz/job/12345678" aria-label="SEEK job URL" />
          <button className="primaryButton" type="submit">Add job</button>
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
                      <span className="sourceTag">{sourceLabel(job.source_category)}</span>
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
                <tr><td colSpan={8} className="empty">No jobs yet. Paste a SEEK URL above or run jobpilot daily to sync Gmail.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
