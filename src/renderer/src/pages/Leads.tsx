import { useState, useEffect } from "react";

const modalStyles = `
  @keyframes modalFadeIn {
    from { opacity: 0; transform: translateY(20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .modal-box {
    animation: modalFadeIn 0.2s ease-out;
  }
`;

type LeadStatus =
  | "new"
  | "queued"
  | "profile_scraped"
  | "connection_requested"
  | "connection_accepted"
  | "welcome_sent"
  | "in_conversation"
  | "handed_off"
  | "follow_up_sent"
  | "email_sent"
  | "replied"
  | "meeting_booked"
  | "converted"
  | "rejected";

interface LeadItem {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  role: string;
  status: LeadStatus;
  profileImageUrl: string;
  linkedinUrl: string;
  score: number;
  location?: string;
  about?: string;
  experience?: any[];
  connectionDegree?: string;
}

const statusLabels: Record<
  LeadStatus,
  { label: string; badge: string; icon: string }
> = {
  new:                  { label: "New",           badge: "badge-neutral",  icon: "🆕" },
  queued:               { label: "Queued",         badge: "badge-neutral",  icon: "⏳" },
  profile_scraped:      { label: "Scraped",        badge: "badge-info",     icon: "📋" },
  connection_requested: { label: "Requested",      badge: "badge-warning",  icon: "📤" },
  connection_accepted:  { label: "Connected",      badge: "badge-success",  icon: "✅" },
  welcome_sent:         { label: "Welcome Sent",   badge: "badge-info",     icon: "👋" },
  in_conversation:      { label: "Chatting",       badge: "badge-info",     icon: "💬" },
  handed_off:           { label: "Handed Off",     badge: "badge-warning",  icon: "🤝" },
  follow_up_sent:       { label: "Follow-Up Sent", badge: "badge-info",     icon: "📨" },
  email_sent:           { label: "Email Sent",     badge: "badge-info",     icon: "📧" },
  replied:              { label: "Replied",        badge: "badge-success",  icon: "💬" },
  meeting_booked:       { label: "Meeting",        badge: "badge-success",  icon: "📅" },
  converted:            { label: "Converted",      badge: "badge-success",  icon: "🎯" },
  rejected:             { label: "Rejected",       badge: "badge-danger",   icon: "❌" },
};

const FILTER_TABS: Array<LeadStatus | "all"> = [
  "all",
  "queued",
  "connection_requested",
  "connection_accepted",
  "welcome_sent",
  "in_conversation",
  "meeting_booked",
  "rejected",
];

export default function Leads() {
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [filter, setFilter] = useState<"all" | LeadStatus>("all");
  const [selectedLead, setSelectedLead] = useState<LeadItem | null>(null);

  // Inject animation styles
  useEffect(() => {
    const tag = document.createElement("style");
    tag.innerHTML = modalStyles;
    document.head.appendChild(tag);
    return () => { document.head.removeChild(tag); };
  }, []);

  // Poll leads every 8 seconds (read-only)
  useEffect(() => {
    async function fetchLeads() {
      try {
        const all = await (window as any).api.leads.list();
        setLeads(all);
      } catch (e) {
        console.error("Failed to fetch leads:", e);
      }
    }
    fetchLeads();
    const id = setInterval(fetchLeads, 8000);
    return () => clearInterval(id);
  }, []);

  const filteredLeads =
    filter === "all" ? leads : leads.filter((l) => l.status === filter);

  // Status distribution for the summary bar
  const countByStatus = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Lead Pipeline</h1>
          <p className="page-subtitle">
            {leads.length} total leads · read-only status monitor
          </p>
        </div>
        <div
          style={{
            padding: "8px 14px",
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.25)",
            borderRadius: "8px",
            fontSize: "0.8125rem",
            color: "var(--accent-primary)",
            fontWeight: 600,
          }}
        >
          ℹ️ To add or import leads, open a Campaign → Import Profiles
        </div>
      </div>

      <div className="page-body">
        {/* Quick Stats */}
        {leads.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: "12px",
              marginBottom: "24px",
              flexWrap: "wrap",
            }}
          >
            {[
              { key: "connection_requested", color: "#f59e0b" },
              { key: "connection_accepted",  color: "#10b981" },
              { key: "welcome_sent",         color: "#6366f1" },
              { key: "in_conversation",      color: "#3b82f6" },
              { key: "meeting_booked",       color: "#8b5cf6" },
              { key: "rejected",             color: "#ef4444" },
            ].map(({ key, color }) => {
              const count = countByStatus[key] || 0;
              if (count === 0) return null;
              const meta = statusLabels[key as LeadStatus];
              return (
                <div
                  key={key}
                  onClick={() => setFilter(key as LeadStatus)}
                  style={{
                    padding: "10px 18px",
                    background: "var(--bg-card)",
                    border: `1px solid ${color}33`,
                    borderRadius: "10px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    transition: "transform 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                >
                  <span style={{ fontSize: "1.1rem" }}>{meta.icon}</span>
                  <span style={{ fontWeight: 700, color, fontSize: "1.25rem" }}>{count}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-2" style={{ marginBottom: "20px", flexWrap: "wrap" }}>
          {FILTER_TABS.map((f) => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? `📋 All (${leads.length})`
                : `${statusLabels[f as LeadStatus].icon} ${statusLabels[f as LeadStatus].label}${countByStatus[f] ? ` (${countByStatus[f]})` : ""}`}
            </button>
          ))}
        </div>

        {/* Leads Table */}
        {leads.length === 0 ? (
          <div
            className="card animate-fadeIn"
            style={{ textAlign: "center", padding: "60px 40px" }}
          >
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>📭</div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "12px" }}>
              No Leads in Pipeline
            </h2>
            <p className="text-muted" style={{ maxWidth: "400px", margin: "0 auto" }}>
              Go to <strong>Campaigns</strong> → select a campaign → <strong>Import Profiles</strong> to add leads.
            </p>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "40px" }}>
            <div style={{ fontSize: "36px", marginBottom: "12px" }}>🔍</div>
            <p className="text-muted">No leads with this status yet.</p>
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-primary)", background: "var(--bg-secondary)" }}>
                  {["Lead", "Company", "Status", "Score", ""].map((h, i) => (
                    <th
                      key={h + i}
                      className="text-xs"
                      style={{
                        textAlign: i >= 3 ? (i === 3 ? "center" : "right") : "left",
                        padding: "12px 16px",
                        color: "var(--text-secondary)",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      cursor: "pointer",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    onClick={() => setSelectedLead(lead)}
                  >
                    {/* Lead */}
                    <td style={{ padding: "12px 16px" }}>
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            width: 38, height: 38, borderRadius: "50%",
                            background: "var(--gradient-brand)",
                            display: "flex", alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700, fontSize: "0.875rem",
                            flexShrink: 0,
                          }}
                        >
                          {(lead.firstName?.[0] || "?")}{(lead.lastName?.[0] || "")}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {lead.firstName} {lead.lastName}
                          </div>
                          <div className="text-xs text-muted">{lead.role}</div>
                        </div>
                      </div>
                    </td>

                    {/* Company */}
                    <td style={{ padding: "12px 16px" }} className="text-sm">
                      {lead.company || "—"}
                    </td>

                    {/* Status */}
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        className={`badge ${statusLabels[lead.status as LeadStatus]?.badge || "badge-neutral"}`}
                      >
                        {statusLabels[lead.status as LeadStatus]?.icon || "ℹ️"}{" "}
                        {statusLabels[lead.status as LeadStatus]?.label || lead.status}
                      </span>
                    </td>

                    {/* Score */}
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <span style={{ fontWeight: 700 }}>{lead.score ?? 0}</span>
                    </td>

                    {/* View icon */}
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>👁 View</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lead Detail Modal — read-only */}
      {selectedLead && (
        <div
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: "20px", backdropFilter: "blur(2px)",
          }}
          onClick={() => setSelectedLead(null)}
        >
          <div
            className="modal-box"
            style={{
              background: "var(--bg-card)", width: "100%", maxWidth: "460px",
              borderRadius: "16px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              overflow: "hidden", border: "1px solid var(--border-subtle)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: "20px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 className="text-lg font-bold" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                👤 Lead Details
              </h2>
              <button
                onClick={() => setSelectedLead(null)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1.25rem" }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px" }}>
                <div
                  style={{
                    width: 64, height: 64, borderRadius: "50%",
                    background: "var(--gradient-brand)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "1.5rem", fontWeight: 700,
                  }}
                >
                  {selectedLead.firstName?.[0] || "?"}{selectedLead.lastName?.[0] || ""}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <h3 className="text-xl font-bold" style={{ marginBottom: "4px" }}>
                      {selectedLead.firstName} {selectedLead.lastName}
                    </h3>
                    <span style={{ fontSize: "0.7rem", background: "rgba(99,102,241,0.1)", color: "var(--accent-primary)", padding: "2px 8px", borderRadius: "12px", whiteSpace: "nowrap", marginTop: "2px" }}>
                      {selectedLead.connectionDegree || "3rd"}
                    </span>
                  </div>
                  <div style={{ color: "var(--accent-info)", fontWeight: 600, fontSize: "0.875rem" }}>
                    {selectedLead.role}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: "14px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>Company</label>
                  <div className="text-sm">🏢 {selectedLead.company || "—"}</div>
                </div>

                {selectedLead.location && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>Location</label>
                    <div className="text-sm">📍 {selectedLead.location}</div>
                  </div>
                )}

                {selectedLead.about && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>About</label>
                    <div style={{ fontSize: "0.8125rem", background: "var(--bg-secondary)", padding: "12px", borderRadius: "8px", maxHeight: "120px", overflowY: "auto", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {selectedLead.about}
                    </div>
                  </div>
                )}

                {selectedLead.experience && selectedLead.experience.length > 0 && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: "6px" }}>Experience</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {selectedLead.experience.slice(0, 2).map((exp: any, i: number) => (
                        <div key={i} style={{ padding: "0 0 0 12px", borderLeft: "2px solid var(--border-primary)" }}>
                          <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{exp.title}</div>
                          <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>{exp.company} · {exp.duration}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>LinkedIn</label>
                  <a
                    href={selectedLead.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent-primary)", fontSize: "0.8125rem", wordBreak: "break-all", textDecoration: "underline" }}
                  >
                    {selectedLead.linkedinUrl}
                  </a>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: "6px" }}>Pipeline Status</label>
                  <span className={`badge ${statusLabels[selectedLead.status as LeadStatus]?.badge || "badge-neutral"}`} style={{ padding: "6px 12px", fontSize: "0.875rem" }}>
                    {statusLabels[selectedLead.status as LeadStatus]?.icon}{" "}
                    {statusLabels[selectedLead.status as LeadStatus]?.label || selectedLead.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: "16px 20px", background: "var(--bg-secondary)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" style={{ minWidth: "100px" }} onClick={() => setSelectedLead(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
