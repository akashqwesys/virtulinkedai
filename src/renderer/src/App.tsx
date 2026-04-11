import { useState, useEffect } from "react";
import Dashboard from "./pages/Dashboard";
import Campaigns from "./pages/Campaigns";
import Leads from "./pages/Leads";
import Settings from "./pages/Settings";
import ContentCalendar from "./pages/ContentCalendar";
import Inbox from "./pages/Inbox";
import Analytics from "./pages/Analytics";
import EmailTemplates from "./pages/EmailTemplates";

type PageKey =
  | "dashboard"
  | "campaigns"
  | "leads"
  | "content"
  | "inbox"
  | "analytics"
  | "templates"
  | "settings";

interface NavItem {
  key: PageKey;
  label: string;
  icon: string;
  section?: string;
}

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "📊", section: "Overview" },
  { key: "campaigns", label: "Campaigns", icon: "🚀", section: "Automation" },
  { key: "leads", label: "Lead Pipeline", icon: "👥" },
  { key: "inbox", label: "Inbox", icon: "💬" },
  { key: "content", label: "Content Calendar", icon: "📅", section: "Content" },
  { key: "analytics", label: "Analytics", icon: "📈" },
  { key: "templates", label: "Email Templates", icon: "📧", section: "Tools" },
  { key: "settings", label: "Settings", icon: "⚙️", section: "System" },
];

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageKey>("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("app-theme") as "light" | "dark") || "light";
  });

  // Apply theme to body
  useEffect(() => {
    document.body.classList.remove("light-theme", "dark-theme");
    document.body.classList.add(`${theme}-theme`);
    localStorage.setItem("app-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const renderPage = () => {
    switch (currentPage) {
      case "dashboard":
        return <Dashboard onNavigate={setCurrentPage} />;
      case "campaigns":
        return <Campaigns />;
      case "leads":
        return <Leads />;
      case "content":
        return <ContentCalendar />;
      case "inbox":
        return <Inbox />;
      case "analytics":
        return <Analytics />;
      case "templates":
        return <EmailTemplates />;
      case "settings":
        return <Settings />;
      default:
        return (
          <div
            className="page-body"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={{ fontSize: "48px" }}>🚧</div>
            <h2>Coming Soon</h2>
            <p className="text-muted">This module is under development</p>
          </div>
        );
    }
  };

  let lastSection = "";

  return (
    <div className="app-layout">
      <div className="titlebar-drag" />

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">V</div>
          <span className="sidebar-logo-text">VirtuLinked AI</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const showSection = item.section && item.section !== lastSection;
            if (item.section) lastSection = item.section;

            return (
              <div key={item.key}>
                {showSection && (
                  <div className="sidebar-section-label">{item.section}</div>
                )}
                <div
                  className={`sidebar-item ${currentPage === item.key ? "active" : ""}`}
                  onClick={() => setCurrentPage(item.key)}
                >
                  <span className="sidebar-item-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
              </div>
            );
          })}
        </nav>

        {/* Theme Toggle */}
        <div style={{ padding: "0 24px", marginBottom: "8px" }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{
              width: "100%",
              justifyContent: "flex-start",
              border: "none",
              background: "var(--bg-elevated)",
            }}
            onClick={toggleTheme}
          >
            <span>{theme === "light" ? "🌙" : "☀️"}</span>
            <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
          </button>
        </div>

        {/* Status footer */}
        <div className="sidebar-status">
          <div
            className="flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            <span className="status-dot offline" id="browser-status-dot" />
            <span className="text-sm text-muted">Browser: Idle</span>
          </div>
          <div
            className="flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            <span className="status-dot offline" id="linkedin-status-dot" />
            <span className="text-sm text-muted">LinkedIn: Not connected</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="status-dot offline" id="ai-status-dot" />
            <span className="text-sm text-muted">AI: Checking...</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">{renderPage()}</main>
    </div>
  );
}
