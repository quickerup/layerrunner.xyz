import { AppShell } from "@/lib/components/app-shell";

const statusCards = [
  { label: "GitHub", status: "Operational" },
  { label: "Supabase", status: "Operational" },
  { label: "Cloudflare", status: "Operational" },
  { label: "Production", status: "Healthy" },
];

const activity = [
  "10:42 AM — Staging deployment verified",
  "10:31 AM — PR #184 merged",
  "10:17 AM — Database migration completed",
  "09:54 AM — Cloudflare Worker deployed",
];

export default function Home() {
  return (
    <AppShell>
      <section className="hero">
        <p className="eyebrow">AI Software Operations Platform</p>
        <h1>Describe the outcome. LayerRunner handles the machinery.</h1>
        <p>
          A calm operational command center for planning, approving, executing,
          verifying, and auditing work across GitHub, Supabase, and Cloudflare.
        </p>
      </section>

      <section className="dashboard-grid" aria-label="Dashboard overview">
        <article className="panel span-2">
          <div className="panel-heading">
            <h2>System status</h2>
            <span className="badge success">All clear</span>
          </div>
          <div className="status-grid">
            {statusCards.map((card) => (
              <div className="status-card" key={card.label}>
                <span className="status-dot" aria-hidden="true" />
                <div>
                  <strong>{card.label}</strong>
                  <p>{card.status}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel approval-panel">
          <h2>Pending approvals</h2>
          <p className="metric">2</p>
          <p>Production deployment and database migration need review.</p>
          <button>Review approvals</button>
        </article>

        <article className="panel">
          <h2>Plan pipeline</h2>
          <ol className="pipeline">
            <li>Intent</li>
            <li>Plan</li>
            <li>Approval</li>
            <li>Execution</li>
            <li>Verification</li>
            <li>Audit</li>
          </ol>
        </article>

        <article className="panel span-2">
          <h2>Recent activity</h2>
          <ul className="activity-list">
            {activity.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </AppShell>
  );
}
