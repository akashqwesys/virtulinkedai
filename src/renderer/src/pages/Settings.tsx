import { useState, useEffect } from "react";

export default function Settings() {
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "general" | "limits" | "ai" | "microsoft" | "chatbot" | "enrichment"
  >("general");

  // Microsoft 365 connection state
  const [msStatus, setMsStatus] = useState<{ connected: boolean; userEmail?: string } | null>(null);
  const [msConnecting, setMsConnecting] = useState(false);
  const [msDisconnecting, setMsDisconnecting] = useState(false);


  useEffect(() => {
    loadSettings();
  }, []);

  // Check MS connection status whenever the microsoft tab is opened
  useEffect(() => {
    if (activeTab === "microsoft") {
      window.api.email.getStatus().then((s: any) => setMsStatus(s)).catch(() => setMsStatus({ connected: false }));
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
      } else {
        alert("Microsoft login failed: " + (result?.error || "Unknown error"));
        setMsStatus({ connected: false });
      }
    } catch (e: any) {
      alert("Microsoft login error: " + e?.message);
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
    { key: "general", label: "⚙️ General" },
    { key: "limits", label: "🛡️ Safety Limits" },
    { key: "ai", label: "🤖 AI Engine" },
    { key: "microsoft", label: "📧 Microsoft 365" },
    { key: "chatbot", label: "💬 Chatbot" },
    { key: "enrichment", label: "🔍 Enrichment" },
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
          {saving ? "⏳ Saving..." : "💾 Save Settings"}
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
                  {loggingOut ? "⏳ Logging out..." : "🚪 Logout from LinkedIn"}
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
                  🏢 Weekdays Only
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => updateSettings("workingHours.workDays", [0, 1, 2, 3, 4, 5, 6])}
                >
                  📅 All Week
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
              Ollama AI Configuration
            </h3>

            <div className="flex gap-4">
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
                  <div style={{ fontWeight: 600, fontSize: "14px" }}>
                    {msStatus === null
                      ? "Checking status..."
                      : msStatus.connected
                      ? "✅ Connected to Microsoft 365"
                      : "❌ Not Connected"}
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
                    {msConnecting ? "⏳ Connecting..." : "🔗 Connect Microsoft 365"}
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary"
                    style={{ color: "var(--accent-danger)" }}
                    onClick={handleDisconnectMicrosoft}
                    disabled={msDisconnecting}
                  >
                    {msDisconnecting ? "⏳ Disconnecting..." : "🔌 Disconnect"}
                  </button>
                )}
              </div>

              {!settings.microsoft.clientId || !settings.microsoft.tenantId ? (
                <div className="text-sm text-muted" style={{ marginTop: "12px" }}>
                  ⚠️ Enter your <strong>Client ID</strong> and <strong>Tenant ID</strong> above,
                  then click Save Settings before connecting.
                </div>
              ) : null}
            </div>

            {/* Required Permissions Info */}
            <div
              style={{
                padding: "14px",
                background: "rgba(99, 102, 241, 0.05)",
                borderRadius: "8px",
                border: "1px solid rgba(99, 102, 241, 0.15)",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "6px", color: "var(--accent-primary)", fontSize: "13px" }}>
                ℹ️ Required API Permissions (Azure Portal)
              </div>
              <div className="text-sm text-muted">
                Under <strong>API Permissions → Microsoft Graph → Delegated</strong>, add:{" "}
                <strong>Mail.Send</strong>, <strong>Mail.ReadWrite</strong>,{" "}
                <strong>Calendars.ReadWrite</strong>, <strong>User.Read</strong>,{" "}
                <strong>offline_access</strong>
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
      </div>
    </>
  );
}
