import { useState, useEffect } from "react";
import Dashboard from "./pages/Dashboard";
import Campaigns from "./pages/Campaigns";
import Leads from "./pages/Leads";
import Settings from "./pages/Settings";
import ContentCalendar from "./pages/ContentCalendar";
import Inbox from "./pages/Inbox";
import Analytics from "./pages/Analytics";
import InMail from "./pages/InMail";
import Meetings from "./pages/Meetings";
import {
  LayoutDashboard,
  Rocket,
  Users,
  MessageSquare,
  Calendar,
  LineChart,
  Mail,
  Settings as SettingsIcon,
  Moon,
  Sun
} from "lucide-react";

type PageKey =
  | "dashboard"
  | "campaigns"
  | "leads"
  | "content"
  | "inbox"
  | "inmail"
  | "meetings"
  | "analytics"
  | "settings";

interface NavItem {
  key: PageKey;
  label: string;
  icon: React.ReactNode;
  section?: string;
}

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} />, section: "Overview" },
  { key: "campaigns", label: "Campaigns", icon: <Rocket size={18} />, section: "Automation" },
  { key: "leads", label: "Lead Pipeline", icon: <Users size={18} /> },
  { key: "inbox", label: "Inbox", icon: <MessageSquare size={18} /> },
  { key: "inmail", label: "Direct InMail", icon: <Mail size={18} /> },
  { key: "meetings", label: "Meetings", icon: <Calendar size={18} /> },
  { key: "content", label: "Content Calendar", icon: <Calendar size={18} />, section: "Content" },
  { key: "analytics", label: "Analytics", icon: <LineChart size={18} /> },
  { key: "settings", label: "Settings", icon: <SettingsIcon size={18} />, section: "System" },
];

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageKey>("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("app-theme") as "light" | "dark") || "light";
  });

  // Global Status States
  const [browserStatus, setBrowserStatus] = useState<"idle" | "running" | "error">("idle");
  const [linkedinStatus, setLinkedinStatus] = useState(false);
  const [aiStatus, setAiStatus] = useState(false);
  const [emailStatus, setEmailStatus] = useState(false);

  // Global Status Polling
  useEffect(() => {
    async function fetchStatuses() {
      try {
        const [browser, linkedin, ai, email] = await Promise.all([
          window.api.browser.getStatus().catch(() => ({ status: "error" })),
          window.api.linkedin.getLoginStatus().catch(() => ({ isLoggedIn: false })),
          window.api.ai.getStatus().catch(() => ({ online: false })),
          window.api.email.getStatus().catch(() => ({ connected: false })),
        ]);
        
        setBrowserStatus(browser.status as any);
        setLinkedinStatus(linkedin.isLoggedIn);
        setAiStatus(ai.online);
        setEmailStatus(email.connected);
      } catch {
        // Ignore errors during silent polling
      }
    }

    fetchStatuses();
    const interval = setInterval(fetchStatuses, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

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
      case "inmail":
        return <InMail />;
      case "meetings":
        return <Meetings />;
      case "analytics":
        return <Analytics />;
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
            <div style={{ fontSize: "49px" }}>🚧</div>
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
            <span style={{ display: "flex", alignItems: "center" }}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</span>
            <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
          </button>
        </div>

        {/* Status footer */}
        <div className="sidebar-status">
          <div
            className="flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            <span className={`status-dot ${browserStatus === "running" ? "online" : browserStatus === "error" ? "error" : "offline"}`} />
            <span className="text-sm text-muted">Browser: {browserStatus === "running" ? "Running" : browserStatus === "error" ? "Error" : "Idle"}</span>
          </div>
          <div
            className="flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            <span className={`status-dot ${linkedinStatus ? "online" : "offline"}`} />
            <span className="text-sm text-muted">LinkedIn: {linkedinStatus ? "Connected" : "Not connected"}</span>
          </div>
          <div
            className="flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            <span className={`status-dot ${aiStatus ? "online" : "offline"}`} />
            <span className="text-sm text-muted">AI Engine: {aiStatus ? "Online" : "Offline"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`status-dot ${emailStatus ? "online" : "offline"}`} />
            <span className="text-sm text-muted">O365 Email: {emailStatus ? "Connected" : "Not connected"}</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">{renderPage()}</main>
    </div>
  );
}
