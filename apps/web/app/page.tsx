import { getDashboardData } from "../lib/dashboard";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export default async function HomePage() {
  const { stats, jobs } = await getDashboardData();

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">JOBPILOT</p>
          <h1>Job search command centre</h1>
          <p className="subtitle">Live SEEK recommendations ranked against your current profile.</p>
        </div>
        <div className="live"><span />Live database</div>
      </header>

      <section className="metrics">
        <article><span>Jobs</span><strong>{stats.jobs}</strong><small>ranked opportunities</small></article>
        <article><span>Average match</span><strong>{stats.averageMatch.toFixed(0)}%</strong><small>latest profile</small></article>
        <article><span>Apply</span><strong>{stats.apply}</strong><small>80+ match</small></article>
        <article><span>Consider</span><strong>{stats.consider}</strong><small>65–79 match</small></article>
      </section>

      <section className="panel">
        <div className="panelHead">
          <div>
            <p className="eyebrow">OPPORTUNITIES</p>
            <h2>Ranked jobs</h2>
          </div>
          <div className="legend">
            <span>Low {stats.low}</span>
            <span>Skip {stats.skip}</span>
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
                <th>Recommendation</th>
                <th>Status</th>
                <th>Found</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td><div className="score">{Math.round(Number(job.overall_score))}</div></td>
                  <td className="role">
                    {job.source_url ? <a href={job.source_url} target="_blank" rel="noreferrer">{job.title}</a> : job.title}
                  </td>
                  <td>{job.company}</td>
                  <td className="muted">{job.location ?? "—"}</td>
                  <td><span className={`pill ${job.recommendation}`}>{job.recommendation}</span></td>
                  <td><span className="status">{job.status.replaceAll("_", " ")}</span></td>
                  <td className="muted">{formatDate(job.discovered_at)}</td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr><td colSpan={7} className="empty">No ranked jobs yet. Run the SEEK ingestion pipeline first.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
