const navigationItems = [
  "Dashboard",
  "Projects",
  "Deployments",
  "Activity",
  "Alerts",
  "Approvals",
  "Integrations",
  "Automation",
  "Team",
  "Security",
  "Settings",
];

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">LR</span>
          <span>LayerRunner</span>
        </div>
        <nav className="nav-list">
          {navigationItems.map((item) => (
            <a className={item === "Dashboard" ? "active" : undefined} href="#" key={item}>
              {item}
            </a>
          ))}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <label className="command-label" htmlFor="global-command">Command</label>
          <input
            id="global-command"
            placeholder="Ask: Why did the last deployment fail?"
            type="search"
          />
          <div className="user-pill">Alex</div>
        </header>
        {children}
      </main>
    </div>
  );
}
