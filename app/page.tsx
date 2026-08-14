import Image from "next/image";
import logo from "../assets/logo.png";

const problemItems = [
  "GitHub",
  "Cloudflare",
  "Supabase",
  "CI/CD",
  "Logs",
  "DNS",
  "Monitoring",
  "Payments",
];

const workflowSteps = [
  "You ask",
  "Layer Runners understands",
  "Creates a plan",
  "You approve sensitive actions",
  "Layer Runners executes",
  "Layer Runners verifies",
  "You get the result",
];

const exampleRequests = [
  "Why did my last deployment fail?",
  "Deploy the latest version to staging.",
  "Show me production status.",
  "Add a subscription field to users.",
  "Investigate this incident.",
];

const securityPrinciples = [
  "Human approval for sensitive operations",
  "Project-scoped access",
  "Least privilege permissions",
  "Secret protection",
  "Audit logs",
  "Verification after important actions",
];

export default function Home() {
  return (
    <main className="site-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Layer Runners home">
          <Image
            src={logo}
            alt="Layer Runners logo"
            width={56}
            height={56}
            priority
            className="brand-logo"
          />
          <span>Layer Runners</span>
        </a>
        <div className="nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#integrations">Integrations</a>
          <a href="#security">Security</a>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Layer Runners</p>
          <h1>Your AI operating layer for modern software.</h1>
          <p className="hero-lede">
            Tell Layer Runners what you want done. It plans the work,
            operates your stack, verifies the result, and tells you what happened.
          </p>
          <div className="cta-row" aria-label="Primary actions">
            <a className="button primary" href="#telegram">Open Layer Runners on Telegram</a>
            <a className="button secondary" href="#how-it-works">See how it works</a>
          </div>
        </div>
        <div className="hero-card" aria-label="Example production deployment plan">
          <div className="card-heading">
            <span>Production Deployment</span>
            <span className="risk">Risk: Medium</span>
          </div>
          <ol>
            <li>Verify repository state</li>
            <li>Verify CI status</li>
            <li>Deploy Worker</li>
            <li>Run health checks</li>
            <li>Verify production version</li>
            <li>Monitor errors</li>
          </ol>
          <div className="approval-actions">
            <span>Approve</span>
            <span>Cancel</span>
          </div>
        </div>
      </section>

      <section className="section two-column" aria-labelledby="problem-heading">
        <div>
          <p className="eyebrow">The problem</p>
          <h2 id="problem-heading">Modern stacks are fragmented.</h2>
          <p>
            Developers move between different dashboards, credentials, and workflows
            just to understand what changed or perform routine operations. Layer Runners
            connects those surfaces into one operational layer.
          </p>
        </div>
        <div className="fragment-grid">
          {problemItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section className="section" id="how-it-works" aria-labelledby="workflow-heading">
        <p className="eyebrow">How it works</p>
        <h2 id="workflow-heading">From intent to verified result.</h2>
        <div className="workflow">
          {workflowSteps.map((step, index) => (
            <div className="workflow-step" key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="section two-column" aria-labelledby="requests-heading">
        <div>
          <p className="eyebrow">Example requests</p>
          <h2 id="requests-heading">Operational, not just conversational.</h2>
          <p>
            Layer Runners uses persistent Project Blueprint context to plan, execute,
            verify, and explain stack operations through controlled runners.
          </p>
        </div>
        <div className="request-list">
          {exampleRequests.map((request) => (
            <blockquote key={request}>“{request}”</blockquote>
          ))}
        </div>
      </section>

      <section className="section integrations" id="integrations" aria-labelledby="integrations-heading">
        <p className="eyebrow">Integrations</p>
        <h2 id="integrations-heading">Built first around your core stack.</h2>
        <div className="integration-row">
          <article>
            <h3>GitHub</h3>
            <p>Repository context, pull requests, CI status, issues, and deployment source.</p>
          </article>
          <article>
            <h3>Supabase</h3>
            <p>Database context, schema awareness, migrations, and project health.</p>
          </article>
          <article>
            <h3>Cloudflare</h3>
            <p>Workers, deployment targets, DNS, edge status, and Cloudflare AI.</p>
          </article>
        </div>
        <p className="planned-note">Future integrations will be labeled as planned until they are implemented.</p>
      </section>

      <section className="section two-column telegram" id="telegram" aria-labelledby="telegram-heading">
        <div>
          <p className="eyebrow">Telegram</p>
          <h2 id="telegram-heading">Your stack, in your pocket.</h2>
          <p>
            Ask questions, investigate incidents, request operations, approve changes,
            and receive alerts directly through Telegram.
          </p>
          <a className="button primary" href="https://t.me/layerrunnersbot">Open Layer Runners on Telegram</a>
        </div>
        <div className="phone-card">
          <p>Production deployment requested.</p>
          <div className="mini-plan">
            <span>✓ Plan created</span>
            <span>• Approval required</span>
            <span>• Verification queued</span>
          </div>
        </div>
      </section>

      <section className="section" id="security" aria-labelledby="security-heading">
        <p className="eyebrow">Security</p>
        <h2 id="security-heading">Humans stay in control.</h2>
        <div className="security-grid">
          {securityPrinciples.map((principle) => (
            <article key={principle}>{principle}</article>
          ))}
        </div>
      </section>
    </main>
  );
}
