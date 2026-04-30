import { useState, useEffect } from "react";
import { 
  Settings as SettingsIcon, Shield, Bot, Mail, MessageSquare, 
  Search, Save, LogOut, CheckCircle2, XCircle, Link as LinkIcon, 
  Unlink, AlertTriangle, Building, Calendar, Info, RefreshCw, Database
} from "lucide-react";

export default function Settings() {
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "general" | "limits" | "ai" | "microsoft" | "chatbot" | "enrichment" | "database"
  >("general");

  // Microsoft 365 connection state
  const [msStatus, setMsStatus] = useState<{ connected: boolean; userEmail?: string } | null>(null);
  const [msConnecting, setMsConnecting] = useState(false);
  const [msDisconnecting, setMsDisconnecting] = useState(false);

  const [dbPath, setDbPath] = useState<string>("");


  useEffect(() => {
    loadSettings();
  }, []);

  // Check MS connection status whenever the microsoft tab is opened
  useEffect(() => {
    if (activeTab === "microsoft") {
      window.api.email.getStatus().then((s: any) => setMsStatus(s)).catch(() => setMsStatus({ connected: false }));
    }
    if (activeTab === "database" && !dbPath) {
      window.api.system.getDbPath().then((path: string) => setDbPath(path)).catch(console.error);
    }
  }, [activeTab]);

  async function loadSettings() {
    try {
      const s = await window.api.settings.get();
      setSettings(s);
    } catch {
      /* ignore */
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      await window.api.settings.update(settings);
    } catch {
      /* ignore */
    }
    setSaving(false);
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      const result = await window.api.linkedin.logout();
      if (result?.success) {
        console.log("Successfully logged out from LinkedIn.");
      } else {
        console.error("Logout failed:", result?.error);
      }
    } catch (e) {
      console.error("Logout error", e);
    }
    setLoggingOut(false);
  }

  async function handleConnectMicrosoft() {
    // Save settings first so Client ID / Tenant ID are persisted before auth
    await saveSettings();
    setMsConnecting(true);
    try {
      const result = await window.api.email.authenticate();
      if (result?.success) {
        setMsStatus({ connected: true, userEmail: result.userEmail });
        alert("Successfully connected to Microsoft 365!");
      } else {
        alert("Error while connecting, try again. " + (result?.error || "Unknown error"));
        setMsStatus({ connected: false });
      }
    } catch (e: any) {
      alert("Error while connecting, try again. " + e?.message);
      setMsStatus({ connected: false });
    }
    setMsConnecting(false);
  }

  async function handleDisconnectMicrosoft() {
    setMsDisconnecting(true);
    try {
      await window.api.email.disconnect();
      setMsStatus({ connected: false });
    } catch (e) {
      console.error("Disconnect error", e);
    }
    setMsDisconnecting(false);
  }


  function updateSettings(path: string, value: any) {
    setSettings((prev: any) => {
      const updated = { ...prev };
      const keys = path.split(".");
      let obj = updated;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return updated;
    });
  }

  function toggleWorkingDay(day: number) {
    const current = settings.workingHours.workDays || [];
    const updated = current.includes(day)
      ? current.filter((d: number) => d !== day)
      : [...current, day].sort();
    updateSettings("workingHours.workDays", updated);
  }

  if (!settings) {
    return (
      <div
        className="page-body"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div className="skeleton" style={{ width: 200, height: 24 }}></div>
      </div>
    );
  }

  const tabs = [
    { key: "general", label: <><SettingsIcon size={14} className="mr-1"/> General</> },
    { key: "limits", label: <><Shield size={14} className="mr-1"/> Safety Limits</> },
    { key: "ai", label: <><Bot size={14} className="mr-1"/> AI Engine</> },
    { key: "microsoft", label: <><Mail size={14} className="mr-1"/> Microsoft 365</> },
    { key: "chatbot", label: <><MessageSquare size={14} className="mr-1"/> Chatbot</> },
    { key: "enrichment", label: <><Search size={14} className="mr-1"/> Enrichment</> },
    { key: "database", label: <><Database size={14} className="mr-1"/> Database</> },
  ] as const;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure your automation preferences</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={saveSettings}
          disabled={saving}
        >
          {saving ? <><RefreshCw size={14} className="animate-spin"/> Saving...</> : <><Save size={14}/> Save Settings</>}
        </button>
      </div>

      <div className="page-body">
        {/* Tabs */}
        <div className="flex gap-2" style={{ marginBottom: "32px" }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`btn btn-sm ${activeTab === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* General Settings */}
        {activeTab === "general" && (
          <div className="card animate-fadeIn">
            <h3 className="card-title" style={{ marginBottom: "24px" }}>
              Account & Working Hours
            </h3>

            <div className="input-group">
              <label className="input-label">LinkedIn Account Type</label>
              <div className="flex gap-4 items-center">
                <select
                  className="input"
                  style={{ flex: 1 }}
                  value={settings.linkedinAccountType}
                  onChange={(e) =>
                    updateSettings("linkedinAccountType", e.target.value)
                  }
                >
                  <option value="normal">Normal Account</option>
                  <option value="sales_navigator">Sales Navigator</option>
                </select>
                <button 
                  className="btn btn-secondary" 
                  style={{ color: "var(--accent-danger)" }}
                  onClick={handleLogout}
                  disabled={loggingOut}
                >
                  {loggingOut ? <><RefreshCw size={14} className="animate-spin"/> Logging out...</> : <><LogOut size={14}/> Logout from LinkedIn</>}
                </button>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Start Hour (24h)</label>
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={23}
                  value={settings.workingHours.startHour}
                  onChange={(e) =>
                    updateSettings(
                      "workingHours.startHour",
                      parseInt(e.target.value),
                    )
                  }
                />
              </div>
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">End Hour (24h)</label>
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={23}
                  value={settings.workingHours.endHour}
                  onChange={(e) =>
                    updateSettings(
                      "workingHours.endHour",
                      parseInt(e.target.value),
                    )
                  }
                />
              </div>
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Timezone</label>
                <input
                  className="input"
                  value={settings.workingHours.timezone}
                  onChange={(e) =>
                    updateSettings("workingHours.timezone", e.target.value)
                  }
                />
              </div>
            </div>

            <div className="input-group" style={{ marginTop: "16px" }}>
              <label className="input-label">Working Days</label>
              <div className="flex gap-2" style={{ flexWrap: "wrap", marginBottom: "12px" }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                  <label
                    key={day}
                    className="flex items-center gap-2 text-md"
                    style={{
                      padding: "6px 12px",
                      background: settings.workingHours.workDays.includes(i)
                        ? "rgba(99, 102, 241, 0.15)"
                        : "var(--bg-secondary)",
                      border: `1px solid ${
                        settings.workingHours.workDays.includes(i)
                          ? "var(--accent-primary)"
                          : "var(--border-subtle)"
                      }`,
                      borderRadius: "6px",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={settings.workingHours.workDays.includes(i)}
                      onChange={() => toggleWorkingDay(i)}
                      style={{ display: "none" }}
                    />
                    <span
                      style={{
                        color: settings.workingHours.workDays.includes(i)
                          ? "var(--accent-primary)"
                          : "var(--text-muted)",
                        fontWeight: settings.workingHours.workDays.includes(i) ? 600 : 400,
                      }}
                    >
                      {day}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => updateSettings("workingHours.workDays", [1, 2, 3, 4, 5])}
                >
                  <Building size={14}/> Weekdays Only
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => updateSettings("workingHours.workDays", [0, 1, 2, 3, 4, 5, 6])}
                >
                  <Calendar size={14}/> All Week
                </button>
              </div>
            </div>

            <div
              className="flex items-center gap-3"
              style={{ marginTop: "8px" }}
            >
              <input
                type="checkbox"
                checked={settings.workingHours.randomizeStart}
                onChange={(e) =>
                  updateSettings(
                    "workingHours.randomizeStart",
                    e.target.checked,
                  )
                }
                style={{ accentColor: "var(--accent-primary)" }}
              />
              <label className="text-sm">
                Randomize start time (±30 min) for natural patterns
              </label>
            </div>

            <div
              className="flex items-center gap-3"
              style={{ marginTop: "16px" }}
            >
              <input
                type="checkbox"
                checked={settings.warmup.enabled}
                onChange={(e) =>
                  updateSettings("warmup.enabled", e.target.checked)
                }
                style={{ accentColor: "var(--accent-primary)" }}
              />
              <label className="text-sm">
                Enable account warm-up (ramp up over{" "}
                {settings.warmup.rampUpDays} days)
              </label>
            </div>
          </div>
        )}

        {/* Safety Limits */}
        {activeTab === "limits" && (
          <div className="card animate-fadeIn">
            <h3 className="card-title" style={{ marginBottom: "8px" }}>
              Daily Action Limits
            </h3>
            <p className="text-sm text-muted" style={{ marginBottom: "24px" }}>
              LinkedIn monitors daily activity. These limits keep you safe.
              Values are randomized by ±{settings.dailyLimits.randomizePercent}%
              daily.
            </p>

            <div className="flex gap-4" style={{ flexWrap: "wrap" }}>
              {[
                {
                  key: "connectionRequests",
                  label: "Connection Requests/Day",
                  max: 50,
                },
                { key: "profileViews", label: "Profile Views/Day", max: 150 },
                { key: "messages", label: "Messages/Day", max: 100 },
                {
                  key: "postEngagements",
                  label: "Post Engagements/Day",
                  max: 80,
                },
                { key: "contentPosts", label: "Content Posts/Day", max: 5 },
              ].map((item) => (
                <div
                  className="input-group"
                  key={item.key}
                  style={{ flex: "1 1 200px" }}
                >
                  <label className="input-label">{item.label}</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={item.max}
                    value={settings.dailyLimits[item.key]}
                    onChange={(e) =>
                      updateSettings(
                        `dailyLimits.${item.key}`,
                        parseInt(e.target.value),
                      )
                    }
                  />
                </div>
              ))}
            </div>

            <div
              className="input-group"
              style={{ marginTop: "16px", maxWidth: "300px" }}
            >
              <label className="input-label">Randomization % (±)</label>
              <input
                type="number"
                className="input"
                min={5}
                max={30}
                value={settings.dailyLimits.randomizePercent}
                onChange={(e) =>
                  updateSettings(
                    "dailyLimits.randomizePercent",
                    parseInt(e.target.value),
                  )
                }
              />
            </div>
          </div>
        )}

        {/* AI Engine */}
        {activeTab === "ai" && (
          <div className="card animate-fadeIn">
            <h3 className="card-title" style={{ marginBottom: "24px" }}>
              AI Engine Configuration
            </h3>

            <div className="input-group" style={{ marginBottom: "20px" }}>
              <label className="input-label">Provider</label>
              <select
                className="input"
                value={settings.ai.provider || "ollama"}
                onChange={(e) => updateSettings("ai.provider", e.target.value)}
              >
                <option value="nvidia">NVIDIA NIM (Recommended)</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>

            {settings.ai.provider === "nvidia" && (
              <>
                <div className="input-group" style={{ marginBottom: "20px" }}>
                  <label className="input-label">Primary Model API Key (NVIDIA)</label>
                  <input
                    type="password"
                    className="input"
                    value={settings.ai.nvidiaApiKey || ""}
                    onChange={(e) => updateSettings("ai.nvidiaApiKey", e.target.value)}
                    placeholder="nvapi-..."
                  />
                  <p className="text-sm text-muted" style={{ marginTop: "8px" }}>
                    Get your free API key at <a href="https://build.nvidia.com" target="_blank" rel="noreferrer" style={{color: "var(--accent-primary)", textDecoration: "none"}}>build.nvidia.com</a>.
                  </p>
                </div>
                
                <div className="input-group" style={{ marginBottom: "20px" }}>
                  <label className="input-label">Fallback Model API Key (Optional)</label>
                  <input
                    type="password"
                    className="input"
                    value={settings.ai.fallbackApiKey || ""}
                    onChange={(e) => updateSettings("ai.fallbackApiKey", e.target.value)}
                    placeholder="Leave blank to use primary key"
                  />
                </div>
              </>
            )}

            {settings.ai.provider === "ollama" && (
              <div className="flex gap-4" style={{ marginBottom: "20px" }}>
                <div className="input-group" style={{ flex: 2 }}>
                  <label className="input-label">Ollama Server URL</label>
                  <input
                    className="input"
                    value={settings.ai.ollamaBaseUrl}
                    onChange={(e) =>
                      updateSettings("ai.ollamaBaseUrl", e.target.value)
                    }
                    placeholder="http://35.175.238.52"
                  />
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label className="input-label">API Port</label>
                  <input
                    type="number"
                    className="input"
                    value={settings.ai.ollamaApiPort}
                    onChange={(e) =>
                      updateSettings("ai.ollamaApiPort", parseInt(e.target.value))
                    }
                  />
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label className="input-label">Generate Port</label>
                  <input
                    type="number"
                    className="input"
                    value={settings.ai.ollamaGeneratePort}
                    onChange={(e) =>
                      updateSettings(
                        "ai.ollamaGeneratePort",
                        parseInt(e.target.value),
                      )
                    }
                  />
                </div>
              </div>
            )}

            <div className="flex gap-4">
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Primary Model</label>
                <input
                  className="input"
                  value={settings.ai.primaryModel}
                  onChange={(e) =>
                    updateSettings("ai.primaryModel", e.target.value)
                  }
                />
              </div>
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Fallback Model</label>
                <input
                  className="input"
                  value={settings.ai.fallbackModel}
                  onChange={(e) =>
                    updateSettings("ai.fallbackModel", e.target.value)
                  }
                />
              </div>
            </div>

            <div className="flex gap-4">
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Temperature (0-1)</label>
                <input
                  type="number"
                  className="input"
                  step={0.1}
                  min={0}
                  max={1}
                  value={settings.ai.temperature}
                  onChange={(e) =>
                    updateSettings("ai.temperature", parseFloat(e.target.value))
                  }
                />
              </div>
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Max Tokens</label>
                <input
                  type="number"
                  className="input"
                  min={64}
                  max={2048}
                  value={settings.ai.maxTokens}
                  onChange={(e) =>
                    updateSettings("ai.maxTokens", parseInt(e.target.value))
                  }
                />
              </div>
            </div>
          </div>
        )}

        {/* Microsoft 365 */}
        {activeTab === "microsoft" && (
          <div className="card animate-fadeIn">
            <h3 className="card-title" style={{ marginBottom: "8px" }}>
              Microsoft 365 (Azure AD)
            </h3>
            <p className="text-sm text-muted" style={{ marginBottom: "24px" }}>
              Register an app in Azure Portal → App registrations to get these
              values.
            </p>

            <div className="input-group">
              <label className="input-label">Client ID (Application ID)</label>
              <input
                className="input"
                value={settings.microsoft.clientId}
                onChange={(e) =>
                  updateSettings("microsoft.clientId", e.target.value)
                }
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>

            <div className="input-group">
              <label className="input-label">Tenant ID</label>
              <input
                className="input"
                value={settings.microsoft.tenantId}
                onChange={(e) =>
                  updateSettings("microsoft.tenantId", e.target.value)
                }
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>

            <div className="input-group">
              <label className="input-label">Redirect URI</label>
              <input
                className="input"
                value={settings.microsoft.redirectUri}
                onChange={(e) =>
                  updateSettings("microsoft.redirectUri", e.target.value)
                }
              />
            </div>

            {/* Connection Status Panel */}
            <div
              style={{
                padding: "20px",
                background: msStatus?.connected
                  ? "rgba(34, 197, 94, 0.08)"
                  : "rgba(99, 102, 241, 0.08)",
                borderRadius: "12px",
                border: `1px solid ${msStatus?.connected ? "rgba(34, 197, 94, 0.3)" : "rgba(99, 102, 241, 0.25)"}`,
                marginTop: "8px",
              }}
            >
              {/* Status header row */}
              <div className="flex items-center gap-3" style={{ marginBottom: "16px" }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: msStatus === null
                      ? "var(--text-muted)"
                      : msStatus.connected
                      ? "#22c55e"
                      : "#ef4444",
                    flexShrink: 0,
                    boxShadow: msStatus?.connected ? "0 0 8px rgba(34,197,94,0.6)" : undefined,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                    {msStatus === null
                      ? "Checking status..."
                      : msStatus.connected
                      ? <><CheckCircle2 size={16} color="var(--accent-success)"/> Connected to Microsoft 365</>
                      : <><XCircle size={16} color="var(--accent-danger)"/> Not Connected</>}
                  </div>
                  {msStatus?.connected && msStatus.userEmail && (
                    <div className="text-sm text-muted" style={{ marginTop: "2px" }}>
                      Signed in as <strong>{msStatus.userEmail}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3">
                {!msStatus?.connected ? (
                  <button
                    className="btn btn-primary"
                    onClick={handleConnectMicrosoft}
                    disabled={msConnecting || !settings.microsoft.clientId || !settings.microsoft.tenantId}
                  >
                    {msConnecting ? <><RefreshCw size={14} className="animate-spin"/> Connecting...</> : <><LinkIcon size={14}/> Connect Microsoft 365</>}
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary"
                    style={{ color: "var(--accent-danger)" }}
                    onClick={handleDisconnectMicrosoft}
                    disabled={msDisconnecting}
                  >
                    {msDisconnecting ? <><RefreshCw size={14} className="animate-spin"/> Disconnecting...</> : <><Unlink size={14}/> Disconnect</>}
                  </button>
                )}
              </div>

              {!settings.microsoft.clientId || !settings.microsoft.tenantId ? (
                <div className="text-sm text-muted" style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <AlertTriangle size={14} color="var(--accent-warning)"/> Enter your <strong>Client ID</strong> and <strong>Tenant ID</strong> above,
                  then click Save Settings before connecting.
                </div>
              ) : null}
            </div>

            {/* Comprehensive Setup Guide */}
            <div
              className="card"
              style={{
                marginTop: "24px",
                padding: "24px",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "16px", fontSize: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Info size={18} color="var(--accent-primary)" /> Step-by-Step Guide: Connect Office 365
              </div>
              
              <div className="text-sm text-muted" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <strong style={{ color: "var(--text-main)", fontSize: "14px" }}>Step 1: Create Azure App</strong>
                  <ol style={{ margin: "6px 0 0 20px", padding: 0, lineHeight: "1.6" }}>
                    <li>Go to the <a href="https://entra.microsoft.com/" target="_blank" rel="noreferrer" style={{color: "var(--accent-primary)", textDecoration: "none"}}>Microsoft Entra admin center</a>.</li>
                    <li>Navigate to <strong>Applications → App registrations</strong> and click <strong>+ New registration</strong>.</li>
                    <li>Name your app (e.g., VirtuLinked AI).</li>
                    <li>For Supported account types, select <strong>Accounts in any organizational directory and personal Microsoft accounts</strong>.</li>
                    <li>Click <strong>Register</strong>.</li>
                  </ol>
                </div>

                <div>
                  <strong style={{ color: "var(--text-main)", fontSize: "14px" }}>Step 2: Configure the Platform</strong>
                  <ol style={{ margin: "6px 0 0 20px", padding: 0, lineHeight: "1.6" }}>
                    <li>Go to <strong>Authentication</strong> on the left menu.</li>
                    <li>Click <strong>+ Add a platform</strong> and select <strong>Mobile and desktop applications</strong>.</li>
                    <li>In the Custom redirect URIs box, paste exactly: <code style={{background:"rgba(100,100,100,0.15)", padding:"2px 6px", borderRadius:"4px"}}>http://localhost:3847/auth/callback</code></li>
                    <li>Also check the box for <code style={{background:"rgba(100,100,100,0.15)", padding:"2px 6px", borderRadius:"4px"}}>http://localhost</code> (or add it manually).</li>
                    <li>Click <strong>Configure</strong>.</li>
                    <li>Scroll down to <strong>Advanced settings</strong>, toggle <strong>Allow public client flows</strong> to <strong>Yes</strong>, and save.</li>
                  </ol>
                </div>

                <div>
                  <strong style={{ color: "var(--text-main)", fontSize: "14px" }}>Step 3: Add API Permissions</strong>
                  <ol style={{ margin: "6px 0 0 20px", padding: 0, lineHeight: "1.6" }}>
                    <li>Go to <strong>API permissions</strong> on the left menu.</li>
                    <li>Click <strong>+ Add a permission</strong> → <strong>Microsoft Graph</strong> → <strong>Delegated permissions</strong>.</li>
                    <li>Search for and check: <strong>Mail.Send</strong>, <strong>Mail.ReadWrite</strong>, <strong>Calendars.ReadWrite</strong>, <strong>User.Read</strong>, and <strong>offline_access</strong>.</li>
                    <li>Click <strong>Add permissions</strong>.</li>
                    <li>Click <strong>Grant admin consent</strong> (if your account has admin rights, this avoids extra prompts).</li>
                  </ol>
                </div>

                <div>
                  <strong style={{ color: "var(--text-main)", fontSize: "14px" }}>Step 4: Connect to Application</strong>
                  <ol style={{ margin: "6px 0 0 20px", padding: 0, lineHeight: "1.6" }}>
                    <li>Go back to <strong>Overview</strong> in the Azure portal.</li>
                    <li>Copy the <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong>.</li>
                    <li>Paste them into the fields above in this Settings page.</li>
                    <li>Click <strong>Save Settings</strong> at the top right of this page.</li>
                    <li>Click the blue <strong>Connect Microsoft 365</strong> button above and sign in!</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}



        {/* Chatbot */}
        {activeTab === "chatbot" && (
          <div className="card animate-fadeIn">
            <h3 className="card-title" style={{ marginBottom: "24px" }}>
              Auto-Reply Chatbot
            </h3>

            <div
              className="flex items-center gap-3"
              style={{ marginBottom: "20px" }}
            >
              <input
                type="checkbox"
                checked={settings.chatbot.enabled}
                onChange={(e) =>
                  updateSettings("chatbot.enabled", e.target.checked)
                }
                style={{ accentColor: "var(--accent-primary)" }}
              />
              <label style={{ fontWeight: 600 }}>
                Enable Auto-Reply Chatbot
              </label>
            </div>

            <div className="flex gap-4">
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">
                  Min Response Delay (minutes)
                </label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={60}
                  value={settings.chatbot.responseDelayMinMinutes}
                  onChange={(e) =>
                    updateSettings(
                      "chatbot.responseDelayMinMinutes",
                      parseInt(e.target.value),
                    )
                  }
                />
              </div>
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">
                  Max Response Delay (minutes)
                </label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={60}
                  value={settings.chatbot.responseDelayMaxMinutes}
                  onChange={(e) =>
                    updateSettings(
                      "chatbot.responseDelayMaxMinutes",
                      parseInt(e.target.value),
                    )
                  }
                />
              </div>
            </div>

            <div className="input-group" style={{ maxWidth: "300px" }}>
              <label className="input-label">
                Max Auto Messages Before Meeting Suggestion
              </label>
              <input
                type="number"
                className="input"
                min={2}
                max={10}
                value={settings.chatbot.maxAutoMessages}
                onChange={(e) =>
                  updateSettings(
                    "chatbot.maxAutoMessages",
                    parseInt(e.target.value),
                  )
                }
              />
            </div>

            <div
              className="flex items-center gap-3"
              style={{ marginTop: "8px" }}
            >
              <input
                type="checkbox"
                checked={settings.chatbot.handoffOnNegativeSentiment}
                onChange={(e) =>
                  updateSettings(
                    "chatbot.handoffOnNegativeSentiment",
                    e.target.checked,
                  )
                }
                style={{ accentColor: "var(--accent-primary)" }}
              />
              <label className="text-sm">
                Auto-handoff to human on negative sentiment detection
              </label>
            </div>
          </div>
        )}

        {/* Enrichment */}
        {activeTab === "enrichment" && (
          <div className="card animate-fadeIn">
            <h3 className="card-title" style={{ marginBottom: "8px" }}>
              Email Enrichment
            </h3>
            <p className="text-sm text-muted" style={{ marginBottom: "24px" }}>
              Automatically find business emails for leads who don't share
              contact info. Uses Hunter.io or Apollo.io APIs.
            </p>

            <div className="input-group">
              <label className="input-label">Enrichment Provider</label>
              <select
                className="input"
                value={settings.enrichment?.provider || "none"}
                onChange={(e) =>
                  updateSettings("enrichment.provider", e.target.value)
                }
              >
                <option value="none">None (disabled)</option>
                <option value="hunter">Hunter.io</option>
                <option value="apollo">Apollo.io</option>
              </select>
            </div>

            {settings.enrichment?.provider !== "none" && (
              <div className="input-group">
                <label className="input-label">
                  {settings.enrichment?.provider === "hunter"
                    ? "Hunter.io API Key"
                    : "Apollo.io API Key"}
                </label>
                <input
                  className="input"
                  type="password"
                  value={settings.enrichment?.apiKey || ""}
                  onChange={(e) =>
                    updateSettings("enrichment.apiKey", e.target.value)
                  }
                  placeholder="Paste your API key here"
                />
              </div>
            )}

            <div
              style={{
                padding: "16px",
                background: "rgba(99, 102, 241, 0.08)",
                borderRadius: "8px",
                border: "1px solid rgba(99, 102, 241, 0.25)",
                marginTop: "16px",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  marginBottom: "8px",
                  color: "var(--accent-primary)",
                }}
              >
                ℹ️ How it works
              </div>
              <div className="text-sm text-muted">
                When a connection request is pending for more than 3 days and
                we don't have an email, the system will call the configured
                provider to find a business email, then send a personalized
                follow-up via Microsoft 365.
              </div>
            </div>
          </div>
        )}

        {/* Database Settings */}
        {activeTab === "database" && (
          <div className="card animate-fadeIn">
            <h3 className="card-title" style={{ marginBottom: "8px" }}>
              Local Database Management
            </h3>
            <p className="text-sm text-muted" style={{ marginBottom: "24px" }}>
              VirtuLinked AI stores all your leads securely and entirely offline using SQLite. 
              Here is how you can view your data using standard database tools.
            </p>

            <div className="input-group">
              <label className="input-label">Local Database File Path</label>
              <div className="flex gap-2">
                <input
                  className="input"
                  readOnly
                  value={dbPath || "Loading path..."}
                  style={{ fontFamily: "monospace", flex: 1, backgroundColor: "var(--bg-secondary)", color: "var(--text-secondary)" }}
                />
                <button 
                  className="btn btn-secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(dbPath);
                    alert("Path copied to clipboard!");
                  }}
                >
                  Copy Path
                </button>
              </div>
            </div>

            <div style={{ marginTop: "32px", padding: "16px", borderRadius: "10px", backgroundColor: "var(--bg-secondary)" }}>
              <h4 style={{ fontWeight: 600, marginBottom: "12px", color: "var(--text-primary)" }}>How to view your Database on this PC:</h4>
              <ol style={{ paddingLeft: "24px", margin: 0, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: "8px" }}>
                <li>
                  <strong style={{ color: "var(--text-primary)" }}>Using VS Code:</strong>
                  <div>Open VS Code, go to Extensions and install "SQLite Viewer" by Florian Klampfer. Press <code>Ctrl+P</code> (or <code>Cmd+P</code>), paste the path above, and press Enter to instantly open your DB in the editor.</div>
                </li>
                <li>
                  <strong style={{ color: "var(--text-primary)" }}>Using DB Browser for SQLite:</strong>
                  <div>Download <a href="https://sqlitebrowser.org" target="_blank" rel="noreferrer" style={{ color: "var(--accent-primary)", textDecoration: "underline" }}>DB Browser for SQLite</a>. Open it, click "Open Database" and paste the path above to view or query your leads safely.</div>
                </li>
              </ol>
            </div>

            <div style={{ marginTop: "20px", padding: "16px", borderRadius: "10px", backgroundColor: "var(--bg-card)", border: "1px dashed var(--border-subtle)" }}>
              <h4 style={{ fontWeight: 600, marginBottom: "12px", color: "var(--text-primary)" }}>How to view on another device:</h4>
              <ul style={{ paddingLeft: "24px", margin: 0, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: "8px" }}>
                <li>
                  <strong>Windows:</strong> <code>%APPDATA%\virtulinked-ai\virtulinked.db</code>
                </li>
                <li>
                  <strong>macOS:</strong> <code>~/Library/Application Support/virtulinked-ai/virtulinked.db</code>
                </li>
                <li>
                  <strong>Linux:</strong> <code>~/.config/virtulinked-ai/virtulinked.db</code>
                </li>
              </ul>
            </div>
            
            <div style={{ marginTop: "16px", fontSize: "0.85rem", color: "var(--accent-warning)", display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertTriangle size={14}/>
              Note: Do not delete or manually lock the `.db` file while VirtuLinked AI is running.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
