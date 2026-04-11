import { useState, useEffect } from "react";

interface ActivityEntry {
  id: string;
  action: string;
  module: string;
  status: string;
  details: string;
  created_at: string;
}

export default function Analytics() {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadActivities();
  }, [filter]);

  async function loadActivities() {
    setLoading(true);
    try {
      const params: any = { limit: 200 };
      if (filter !== "all") params.module = filter;
      const data = await (window as any).api.activity.list(params);
      setActivities(data || []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }

  // Calculate stats from activity data
  const stats = {
    totalActions: activities.length,
    successRate:
      activities.length > 0
        ? Math.round(
            (activities.filter((a) => a.status === "success").length /
              activities.length) *
              100,
          )
        : 0,
    errors: activities.filter((a) => a.status === "error").length,
    byModule: activities.reduce(
      (acc, a) => {
        acc[a.module] = (acc[a.module] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    byAction: activities.reduce(
      (acc, a) => {
        acc[a.action] = (acc[a.action] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  };

  // Get hourly activity distribution
  const hourlyDistribution = Array(24).fill(0);
  activities.forEach((a) => {
    const hour = new Date(a.created_at).getHours();
    hourlyDistribution[hour]++;
  });
  const maxHourly = Math.max(...hourlyDistribution, 1);

  const modules = [
    "all",
    "browser",
    "linkedin",
    "ai",
    "microsoft",
    "campaign",
    "content",
    "engagement",
    "settings",
    "system",
  ];

  const moduleIcons: Record<string, string> = {
    browser: "🌐",
    linkedin: "💼",
    ai: "🤖",
    microsoft: "📧",
    campaign: "🚀",
    content: "📅",
    engagement: "⚡",
    settings: "⚙️",
    system: "🖥️",
  };

  function formatAction(action: string): string {
    return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleString();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">
            Activity insights and performance metrics
          </p>
        </div>
        <button className="btn btn-secondary" onClick={loadActivities}>
          🔄 Refresh
        </button>
      </div>

      <div className="page-body">
        {/* Stats Overview */}
        <div className="stats-grid" style={{ marginBottom: "32px" }}>
          <div className="card stat-card">
            <div
              className="stat-icon"
              style={{
                background: "rgba(99, 102, 241, 0.15)",
                color: "#6366f1",
              }}
            >
              📊
            </div>
            <div className="stat-label">Total Actions</div>
            <div
              className="stat-value"
              style={{
                fontSize: "1.5rem",
                background: "none",
                WebkitTextFillColor: "var(--text-primary)",
              }}
            >
              {stats.totalActions}
            </div>
          </div>
          <div className="card stat-card">
            <div
              className="stat-icon"
              style={{
                background: "rgba(16, 185, 129, 0.15)",
                color: "#10b981",
              }}
            >
              ✅
            </div>
            <div className="stat-label">Success Rate</div>
            <div
              className="stat-value"
              style={{
                fontSize: "1.5rem",
                background: "none",
                WebkitTextFillColor:
                  stats.successRate > 90
                    ? "var(--accent-success)"
                    : stats.successRate > 70
                      ? "var(--accent-warning)"
                      : "var(--accent-danger)",
              }}
            >
              {stats.successRate}%
            </div>
          </div>
          <div className="card stat-card">
            <div
              className="stat-icon"
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
              }}
            >
              ⚠️
            </div>
            <div className="stat-label">Errors</div>
            <div
              className="stat-value"
              style={{
                fontSize: "1.5rem",
                background: "none",
                WebkitTextFillColor: stats.errors > 0 ? "var(--accent-danger)" : "var(--accent-success)",
              }}
            >
              {stats.errors}
            </div>
          </div>
          <div className="card stat-card">
            <div
              className="stat-icon"
              style={{
                background: "rgba(59, 130, 246, 0.15)",
                color: "#3b82f6",
              }}
            >
              ⏱️
            </div>
            <div className="stat-label">Active Modules</div>
            <div
              className="stat-value"
              style={{
                fontSize: "1.5rem",
                background: "none",
                WebkitTextFillColor: "var(--text-primary)",
              }}
            >
              {Object.keys(stats.byModule).length}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            gap: "24px",
          }}
        >
          <div>
            {/* Activity Heatmap */}
            <div className="card" style={{ marginBottom: "24px" }}>
              <h3 className="card-title" style={{ marginBottom: "16px" }}>
                📈 Activity by Hour
              </h3>
              <div className="flex items-end gap-1" style={{ height: "100px" }}>
                {hourlyDistribution.map((count, hour) => (
                  <div
                    key={hour}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: `${Math.max((count / maxHourly) * 80, 2)}px`,
                        background:
                          count > 0
                            ? `rgba(99, 102, 241, ${0.3 + (count / maxHourly) * 0.7})`
                            : "var(--bg-tertiary)",
                        borderRadius: "3px 3px 0 0",
                        transition: "height 0.3s",
                      }}
                      title={`${hour}:00 — ${count} actions`}
                    />
                    {hour % 4 === 0 && (
                      <span
                        className="text-sm text-muted"
                        style={{ fontSize: "0.625rem" }}
                      >
                        {hour}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Module Filter */}
            <div
              className="flex gap-2"
              style={{ marginBottom: "16px", flexWrap: "wrap" }}
            >
              {modules.map((m) => (
                <button
                  key={m}
                  className={`btn btn-sm ${filter === m ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setFilter(m)}
                >
                  {m === "all" ? "📋 All" : `${moduleIcons[m] || "📌"} ${m}`}
                </button>
              ))}
            </div>

            {/* Activity Feed */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">📋 Activity Log</h3>
                <span className="text-sm text-muted">
                  {activities.length} events
                </span>
              </div>
              <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                {loading ? (
                  <div style={{ padding: "40px", textAlign: "center" }}>
                    <div
                      className="skeleton"
                      style={{ width: 200, height: 20, margin: "0 auto" }}
                    />
                  </div>
                ) : activities.length === 0 ? (
                  <div
                    style={{
                      padding: "40px",
                      textAlign: "center",
                      color: "var(--text-muted)",
                    }}
                  >
                    No activity found
                  </div>
                ) : (
                  activities.map((act, i) => (
                    <div
                      key={act.id || i}
                      className="flex items-center gap-3"
                      style={{
                        padding: "10px 0",
                        borderBottom:
                          i < activities.length - 1
                            ? "1px solid var(--border-subtle)"
                            : "none",
                      }}
                    >
                      <span style={{ fontSize: "18px" }}>
                        {moduleIcons[act.module] || "📌"}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div className="text-sm" style={{ fontWeight: 500 }}>
                          {formatAction(act.action)}
                        </div>
                        <div className="text-sm text-muted">
                          {act.module} · {formatTime(act.created_at)}
                        </div>
                      </div>
                      <span
                        className={`badge ${act.status === "success" ? "badge-success" : "badge-danger"}`}
                        style={{ fontSize: "0.6875rem" }}
                      >
                        {act.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Sidebar — Top Actions & Module Breakdown */}
          <div>
            <div className="card" style={{ marginBottom: "24px" }}>
              <h3 className="card-title" style={{ marginBottom: "16px" }}>
                🏆 Module Activity
              </h3>
              {Object.entries(stats.byModule)
                .sort((a, b) => b[1] - a[1])
                .map(([module, count]) => (
                  <div
                    key={module}
                    className="flex items-center gap-3"
                    style={{ marginBottom: "12px" }}
                  >
                    <span style={{ fontSize: "16px" }}>
                      {moduleIcons[module] || "📌"}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontWeight: 500,
                        fontSize: "0.875rem",
                        textTransform: "capitalize",
                      }}
                    >
                      {module}
                    </span>
                    <span className="badge badge-neutral">{count}</span>
                  </div>
                ))}
            </div>

            <div className="card">
              <h3 className="card-title" style={{ marginBottom: "16px" }}>
                📌 Top Actions
              </h3>
              {Object.entries(stats.byAction)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([action, count]) => (
                  <div
                    key={action}
                    className="flex items-center gap-3"
                    style={{ marginBottom: "10px" }}
                  >
                    <span style={{ flex: 1, fontSize: "0.8125rem" }}>
                      {formatAction(action)}
                    </span>
                    <span
                      className="badge badge-neutral"
                      style={{ fontSize: "0.6875rem" }}
                    >
                      {count}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
