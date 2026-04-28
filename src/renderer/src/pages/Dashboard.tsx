import { useState, useEffect } from "react";
import {
  Briefcase,
  Bot,
  Mail,
  Globe,
  Lock,
  Settings as SettingsIcon,
  Search,
  User,
  UserPlus,
  Send,
  Calendar,
  AlertTriangle,
  Trash2,
  RefreshCw,
  LogOut,
  Link as LinkIcon,
  CheckCircle2,
  Rocket,
  Activity
} from "lucide-react";

declare global {
  interface Window {
    api: {
      browser: {
        launch: () => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{ status: string; isLoggedIn: boolean }>;
        close: () => Promise<{ success: boolean }>;
      };
      linkedin: {
        login: () => Promise<{
          success: boolean;
          isLoggedIn?: boolean;
          accountType?: string;
          profileName?: string;
          error?: string;
        }>;
        logout: () => Promise<{ success: boolean; error?: string }>;
        getLoginStatus: () => Promise<{
          isLoggedIn: boolean;
          accountType: string | null;
          profileName: string | null;
        }>;
        scrapeProfile: (url: string) => Promise<any>;
        sendConnection: (data: any) => Promise<any>;
        checkConnections: (urls: string[]) => Promise<any>;
        sendMessage: (data: any) => Promise<any>;
      };
      ai: {
        generate: (data: any) => Promise<any>;
        getStatus: () => Promise<{
          online: boolean;
          models: string[];
          error?: string;
        }>;
      };
      email: {
        authenticate: () => Promise<{
          success: boolean;
          userEmail?: string;
          error?: string;
        }>;
        send: (data: any) => Promise<any>;
      };
      campaigns: {
        create: (data: any) => Promise<any>;
        start: (id: string) => Promise<any>;
        pause: (id: string) => Promise<any>;
        getStatus: (id: string) => Promise<any>;
        list: () => Promise<any>;
      };
      settings: {
        get: () => Promise<any>;
        update: (updates: any) => Promise<any>;
      };
      activity: {
        list: (params?: any) => Promise<any[]>;
      };
      system: {
        wipeData: () => Promise<{ success: boolean; error?: string }>;
      };
    };
  }
}

interface DashboardProps {
  onNavigate?: (page: string) => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [browserStatus, setBrowserStatus] = useState<
    "idle" | "running" | "error"
  >("idle");
  const [linkedinStatus, setLinkedinStatus] = useState<{
    isLoggedIn: boolean;
    profileName: string | null;
  }>({ isLoggedIn: false, profileName: null });
  const [aiStatus, setAiStatus] = useState<{
    online: boolean;
    models: string[];
  }>({ online: false, models: [] });
  const [emailStatus, setEmailStatus] = useState<{
    authenticated: boolean;
    email: string | null;
  }>({ authenticated: false, email: null });
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  // Check ALL statuses on mount (restores real state after navigation)
  useEffect(() => {
    checkBrowserStatus();
    checkLinkedInStatus();
    checkAIStatus();
    checkEmailStatus();
    loadActivities();
  }, []);

  async function checkEmailStatus() {
    try {
      const status = await window.api.email.getStatus();
      setEmailStatus({
        authenticated: !!status?.connected,
        email: status?.userEmail || null,
      });
    } catch {
      // Not available
    }
  }

  async function checkBrowserStatus() {
    try {
      const status = await window.api.browser.getStatus();
      if (status.status === "running") {
        setBrowserStatus("running");
      } else if (status.status === "error") {
        setBrowserStatus("error");
      } else {
        setBrowserStatus("idle");
      }
    } catch {
      // Engine not available
    }
  }

  async function checkLinkedInStatus() {
    try {
      const status = await window.api.linkedin.getLoginStatus();
      if (status.isLoggedIn) {
        setLinkedinStatus({
          isLoggedIn: true,
          profileName: status.profileName || null,
        });
        // If LinkedIn is logged in, the browser must be running too
        setBrowserStatus("running");
      }
    } catch {
      // Not available yet
    }
  }

  async function checkAIStatus() {
    try {
      const status = await window.api.ai.getStatus();
      setAiStatus(status);
    } catch (e) {
      setAiStatus({ online: false, models: [] });
    }
  }

  async function loadActivities() {
    try {
      const acts = await window.api.activity.list({ limit: 20 });
      setActivities(acts || []);
    } catch {
      /* ignore */
    }
  }

  async function handleLaunchBrowser() {
    setLoading((prev) => ({ ...prev, browser: true }));
    try {
      const result = await window.api.browser.launch();
      if (result.success) {
        setBrowserStatus("running");
      } else {
        setBrowserStatus("error");
        alert("Browser launch failed: " + result.error);
      }
    } catch (e: any) {
      setBrowserStatus("error");
      alert("IPC Error: " + (e.message || String(e)));
    }
    setLoading((prev) => ({ ...prev, browser: false }));
  }

  async function handleLinkedInLogin() {
    setLoading((prev) => ({ ...prev, linkedin: true }));
    try {
      const result = await window.api.linkedin.login();
      if (result.success && result.isLoggedIn) {
        setLinkedinStatus({
          isLoggedIn: true,
          profileName: result.profileName || null,
        });
        setBrowserStatus("running");
      } else if (!result.success && result.error) {
        console.error("LinkedIn login failed:", result.error);
        alert("LinkedIn login failed: " + result.error);
      }
    } catch (e: any) {
      console.error("IPC Error:", e);
      alert("IPC Error: " + (e.message || String(e)));
    }
    setLoading((prev) => ({ ...prev, linkedin: false }));
  }

  async function handleLinkedInLogout() {
    if (!confirm("Are you sure you want to log out from LinkedIn?")) return;
    setLoading((prev) => ({ ...prev, linkedin: true }));
    try {
      const result = await window.api.linkedin.logout();
      if (result.success) {
        setLinkedinStatus({ isLoggedIn: false, profileName: null });
        setBrowserStatus("idle");
      } else {
        alert("Logout failed: " + result.error);
      }
    } catch (e: any) {
      alert("IPC Error: " + (e.message || String(e)));
    }
    setLoading((prev) => ({ ...prev, linkedin: false }));
  }

  async function handleEmailAuth() {
    setLoading((prev) => ({ ...prev, email: true }));
    try {
      const result = await window.api.email.authenticate();
      if (result.success) {
        setEmailStatus({
          authenticated: true,
          email: result.userEmail || null,
        });
      }
    } catch {
      /* ignore */
    }
    setLoading((prev) => ({ ...prev, email: false }));
  }

  async function handleWipeData() {
    if (!confirm("⚠️ ARE YOU SURE? This will permanently delete ALL leads, campaigns, emails, and logs. This action cannot be undone.")) {
      return;
    }
    
    setLoading((prev) => ({ ...prev, wipe: true }));
    try {
      const result = await window.api.system.wipeData();
      if (result.success) {
        alert("✅ Database wiped successfully. Please restart the app for a completely fresh state.");
        window.location.reload();
      } else {
        alert("❌ Error wiping database: " + result.error);
      }
    } catch (e: any) {
      alert("❌ IPC Error: " + (e.message || String(e)));
    }
    setLoading((prev) => ({ ...prev, wipe: false }));
  }

  function formatTime(dateStr: string): string {
    let rawStr = dateStr || "";
    if (rawStr && !rawStr.endsWith('Z')) {
      rawStr = rawStr.replace(' ', 'T') + 'Z';
    }
    const date = new Date(rawStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    // In case the clock has skewed backwards (negative diff), we default to "Just now"
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  }

  const moduleIcons: Record<string, React.ReactNode> = {
    browser: <Globe size={18} />,
    linkedin: <Briefcase size={18} />,
    ai: <Bot size={18} />,
    microsoft: <Mail size={18} />,
    session: <Lock size={18} />,
    system: <SettingsIcon size={18} />,
    settings: <SettingsIcon size={18} />,
  };

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Welcome back — here's your automation overview
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className={`btn ${browserStatus === "running" ? "btn-success" : "btn-primary"}`}
            onClick={handleLaunchBrowser}
            disabled={loading.browser || browserStatus === "running"}
          >
            {loading.browser
              ? <><RefreshCw size={16} className="animate-spin" /> Launching...</>
              : browserStatus === "running"
                ? <><CheckCircle2 size={16} /> Browser Running</>
                : <><Rocket size={16} /> Launch Browser</>}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="page-body">
        {/* Connection Status Cards */}
        <div
          className="stats-grid stagger-children"
          style={{ marginBottom: "32px" }}
        >
          {/* LinkedIn Status */}
          <div className="card stat-card">
            <div
              className="stat-icon"
              style={{
                background: "rgba(10, 102, 194, 0.15)",
                color: "#0a66c2",
              }}
            >
              <Briefcase size={20} />
            </div>
            <div className="stat-label">LinkedIn</div>
            <div
              className="stat-value"
              style={{
                fontSize: "var(--font-size-lg)",
                background: "none",
                WebkitTextFillColor: linkedinStatus.isLoggedIn
                  ? "var(--accent-success)"
                  : "var(--text-muted)",
              }}
            >
              {linkedinStatus.isLoggedIn ? `Connected` : "Not Connected"}
            </div>
            {linkedinStatus.profileName && (
              <div
                className="stat-change positive"
                style={{ textTransform: "none", letterSpacing: "normal" }}
              >
                {linkedinStatus.profileName}
              </div>
            )}
            {!linkedinStatus.isLoggedIn && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: "12px", width: "100%" }}
                onClick={handleLinkedInLogin}
                disabled={loading.linkedin}
              >
                {loading.linkedin ? <><RefreshCw size={14} className="animate-spin" /> Logging in...</> : <><LinkIcon size={14} /> Connect LinkedIn</>}
              </button>
            )}
            {linkedinStatus.isLoggedIn && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: "12px", width: "100%", color: "var(--accent-danger)" }}
                onClick={handleLinkedInLogout}
                disabled={loading.linkedin}
              >
                {loading.linkedin ? <><RefreshCw size={14} className="animate-spin" /> Logging out...</> : <><LogOut size={14} /> Logout</>}
              </button>
            )}
          </div>

          {/* AI Status */}
          <div className="card stat-card">
            <div
              className="stat-icon"
              style={{
                background: "rgba(139, 92, 246, 0.15)",
                color: "#8b5cf6",
              }}
            >
              <Bot size={20} />
            </div>
            <div className="stat-label">AI Engine (Ollama)</div>
            <div
              className="stat-value"
              style={{
                fontSize: "1.125rem",
                background: "none",
                WebkitTextFillColor: aiStatus.online ? "var(--accent-success)" : "var(--accent-danger)",
              }}
            >
              {aiStatus.online ? "Online" : "Offline"}
            </div>
            {aiStatus.models.length > 0 && (
              <div
                className="stat-change positive"
                style={{ textTransform: "none", letterSpacing: "normal" }}
              >
                {aiStatus.models.length} model
                {aiStatus.models.length > 1 ? "s" : ""} available
              </div>
            )}
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: "12px", width: "100%" }}
              onClick={checkAIStatus}
            >
              <RefreshCw size={14} /> Refresh Status
            </button>
          </div>

          {/* Email Status */}
          <div className="card stat-card">
            <div
              className="stat-icon"
              style={{
                background: "rgba(0, 120, 212, 0.15)",
                color: "#0078d4",
              }}
            >
              <Mail size={20} />
            </div>
            <div className="stat-label">O365 Email</div>
            <div
              className="stat-value"
              style={{
                fontSize: "1.125rem",
                background: "none",
                WebkitTextFillColor: emailStatus.authenticated
                  ? "var(--accent-success)"
                  : "var(--text-muted)",
              }}
            >
              {emailStatus.authenticated ? "Connected" : "Not Connected"}
            </div>
            {emailStatus.email && (
              <div
                className="stat-change positive"
                style={{ textTransform: "none", letterSpacing: "normal" }}
              >
                {emailStatus.email}
              </div>
            )}
            {!emailStatus.authenticated && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: "12px", width: "100%" }}
                onClick={handleEmailAuth}
                disabled={loading.email}
              >
                {loading.email ? <><RefreshCw size={14} className="animate-spin" /> Authenticating...</> : <><Lock size={14} /> Connect O365</>}
              </button>
            )}
          </div>

          {/* Browser Status */}
          <div className="card stat-card">
            <div
              className="stat-icon"
              style={{
                background: "rgba(59, 130, 246, 0.15)",
                color: "#3b82f6",
              }}
            >
              <Globe size={20} />
            </div>
            <div className="stat-label">Browser Engine</div>
            <div
              className="stat-value"
              style={{
                fontSize: "1.125rem",
                background: "none",
                WebkitTextFillColor:
                  browserStatus === "running"
                    ? "var(--accent-success)"
                    : browserStatus === "error"
                      ? "var(--accent-danger)"
                      : "var(--text-muted)",
              }}
            >
              {browserStatus === "running"
                ? "Running"
                : browserStatus === "error"
                  ? "Error"
                  : "Idle"}
            </div>
            <div
              className="stat-change"
              style={{
                color: "var(--text-muted)",
                textTransform: "none",
                letterSpacing: "normal",
              }}
            >
              Puppeteer Stealth Mode
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card" style={{ marginBottom: "32px" }}>
          <div className="card-header">
            <h3 className="card-title"><Rocket size={18} style={{color: "var(--accent-primary)"}}/> Quick Actions</h3>
          </div>
          <div className="flex gap-3" style={{ flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              disabled={!linkedinStatus.isLoggedIn}
              onClick={() => onNavigate?.("leads")}
            >
              <Search size={16} /> Search Leads
            </button>
            <button
              className="btn btn-secondary"
              disabled={!linkedinStatus.isLoggedIn}
              onClick={() => onNavigate?.("leads")}
            >
              <User size={16} /> Scrape Profile
            </button>
            <button
              className="btn btn-secondary"
              disabled={!linkedinStatus.isLoggedIn}
              onClick={() => onNavigate?.("campaigns")}
            >
              <UserPlus size={16} /> Send Connections
            </button>
            <button
              className="btn btn-secondary"
              disabled={!emailStatus.authenticated}
              onClick={() => onNavigate?.("templates")}
            >
              <Send size={16} /> Send Email
            </button>
            <button
              className="btn btn-secondary"
              disabled={!aiStatus.online}
              onClick={() => onNavigate?.("content")}
            >
              <Bot size={16} /> Generate Content
            </button>
            <button
              className="btn btn-secondary"
              disabled={!emailStatus.authenticated}
              onClick={() => onNavigate?.("inbox")}
            >
              <Calendar size={16} /> Create Meeting
            </button>
          </div>
        </div>

        {/* Activity Log */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><Activity size={18} /> Recent Activity</h3>
            <button
              className="btn btn-secondary btn-sm"
              onClick={loadActivities}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div style={{ maxHeight: "400px", overflowY: "auto" }}>
            {activities.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px",
                  color: "var(--text-muted)",
                }}
              >
                <div style={{ fontSize: "32px", marginBottom: "12px" }}>📭</div>
                <p>
                  No activity yet. Launch the browser and connect to LinkedIn to
                  get started.
                </p>
              </div>
            ) : (
              activities.map((act, i) => (
                <div
                  key={act.id || i}
                  className="flex items-center gap-3"
                  style={{
                    padding: "12px 0",
                    borderBottom:
                      i < activities.length - 1
                        ? "1px solid var(--border-subtle)"
                        : "none",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px", background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)", color: "var(--text-secondary)" }}>
                    {moduleIcons[act.module] || <Activity size={16} />}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="text-sm font-semibold">
                      {act.action
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </div>
                    <div className="text-xs text-muted">
                      {act.module} · {formatTime(act.created_at)}
                    </div>
                  </div>
                  <span
                    className={`badge ${act.status === "success" ? "badge-success" : "badge-danger"}`}
                  >
                    {act.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Danger Zone */}
        <div className="card" style={{ marginTop: "40px", border: "1px solid var(--accent-danger-subtle)", background: "rgba(239, 68, 68, 0.02)" }}>
          <div className="card-header">
            <h3 className="card-title" style={{ color: "var(--accent-danger)" }}><AlertTriangle size={18} /> Danger Zone</h3>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm" style={{ fontWeight: 500, marginBottom: "4px" }}>Reset All Data</p>
              <p className="text-sm text-muted">Permanently delete all leads, campaigns, and activity history. Use this to start fresh.</p>
            </div>
            <button 
              className="btn btn-danger" 
              onClick={handleWipeData}
              disabled={loading.wipe}
            >
              {loading.wipe ? <><RefreshCw size={14} className="animate-spin" /> Wiping...</> : <><Trash2 size={14} /> Reset Everything</>}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
