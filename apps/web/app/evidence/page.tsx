import { getEvidenceBank } from "../../lib/evidence-store";
import { updateEvidenceControl } from "./actions";

export const dynamic = "force-dynamic";

const kindLabels = {
  summary: "Summary",
  experience: "Work experience",
  project: "Project",
  education: "Education",
};

export default async function EvidencePage() {
  const items = await getEvidenceBank();
  const verified = items.filter((item) => item.status === "verified").length;
  const locked = items.filter((item) => item.locked).length;
  const review = items.filter((item) => item.status === "needs_review").length;

  return (
    <main className="shell evidenceShell">
      <a className="backLink" href="/">← Dashboard</a>
      <header className="evidenceHeader">
        <div>
          <p className="eyebrow">MASTER EVIDENCE BANK</p>
          <h1>Control what JobPilot can claim</h1>
          <p className="subtitle">Only verified evidence can enter a resume. Lock facts whose wording, dates or metrics must remain unchanged.</p>
        </div>
        <div className="evidenceStats">
          <span><strong>{verified}</strong> verified</span>
          <span><strong>{locked}</strong> locked</span>
          <span><strong>{review}</strong> needs review</span>
        </div>
      </header>

      <section className="evidenceBank">
        {items.map((item) => (
          <form action={updateEvidenceControl} className={`evidenceRow ${item.status}`} key={item.id}>
            <input name="evidence_id" type="hidden" value={item.id} />
            <div className="evidenceIdentity">
              <span className="evidenceKind">{kindLabels[item.kind]}</span>
              <strong>{item.label}</strong>
              <code>{item.id}</code>
            </div>
            <div className="evidenceClaim">
              <p>{item.text}</p>
              {item.tags.length > 0 && <small>{item.tags.slice(0, 8).join(" · ")}</small>}
            </div>
            <div className="evidenceControls">
              <label>
                Status
                <select name="status" defaultValue={item.status}>
                  <option value="verified">Verified</option>
                  <option value="draft">Draft</option>
                  <option value="needs_review">Needs review</option>
                </select>
              </label>
              <label className="lockControl">
                <input name="locked" type="checkbox" defaultChecked={item.locked} />
                Lock exact fact
              </label>
              <label>
                Review note
                <input name="notes" defaultValue={item.notes ?? ""} placeholder="Optional note" />
              </label>
              <button className="button" type="submit">Save</button>
            </div>
          </form>
        ))}
      </section>
    </main>
  );
}
