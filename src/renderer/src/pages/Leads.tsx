import { useState, useEffect } from "react";
import {
  Sparkles,
  Hourglass,
  ClipboardList,
  Send,
  CheckCircle2,
  Hand,
  MessageCircle,
  Handshake,
  Forward,
  Mail,
  CalendarDays,
  Target,
  XCircle,
  Inbox,
  Search,
  Trash2,
  Users
} from "lucide-react";

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
  campaignId?: string;
  campaignName?: string;
  email?: string;
  phone?: string;
  rawData?: any;
}

const statusLabels: Record<
  LeadStatus,
  { label: string; badge: string; icon: React.ReactNode }
> = {
  new:                  { label: "New",           badge: "badge-neutral",  icon: <Sparkles size={14} /> },
  queued:               { label: "Queued",         badge: "badge-neutral",  icon: <Hourglass size={14} /> },
  profile_scraped:      { label: "Scraped",        badge: "badge-info",     icon: <ClipboardList size={14} /> },
  connection_requested: { label: "Requested",      badge: "badge-warning",  icon: <Send size={14} /> },
  connection_accepted:  { label: "Connected",      badge: "badge-success",  icon: <CheckCircle2 size={14} /> },
  welcome_sent:         { label: "Welcome Sent",   badge: "badge-info",     icon: <Hand size={14} /> },
  in_conversation:      { label: "Chatting",       badge: "badge-info",     icon: <MessageCircle size={14} /> },
  handed_off:           { label: "Handed Off",     badge: "badge-warning",  icon: <Handshake size={14} /> },
  follow_up_sent:       { label: "Follow-Up Sent", badge: "badge-info",     icon: <Forward size={14} /> },
  email_sent:           { label: "Email Sent",     badge: "badge-info",     icon: <Mail size={14} /> },
  replied:              { label: "Replied",        badge: "badge-success",  icon: <MessageCircle size={14} /> },
  meeting_booked:       { label: "Meeting",        badge: "badge-success",  icon: <CalendarDays size={14} /> },
  converted:            { label: "Converted",      badge: "badge-success",  icon: <Target size={14} /> },
  rejected:             { label: "Rejected",       badge: "badge-danger",   icon: <XCircle size={14} /> },
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

  const handleDeleteLead = async (leadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this lead?")) {
      try {
        const res = await (window as any).api.leads.delete(leadId);
        if (res.success) {
          setLeads((prev) => prev.filter((l) => l.id !== leadId));
        } else {
          alert("Failed to delete lead: " + res.error);
        }
      } catch (e) {
        console.error("Failed to delete lead", e);
      }
    }
  };

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
            {leads.length} total leads · pipeline statuses across all campaigns
          </p>
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
                ? <><ClipboardList size={14} style={{display: "inline", marginBottom: "-2px"}}/> All ({leads.length})</>
                : <span style={{display: "flex", gap: "6px", alignItems: "center"}}>{statusLabels[f as LeadStatus].icon} {statusLabels[f as LeadStatus].label}{countByStatus[f] ? ` (${countByStatus[f]})` : ""}</span>}
            </button>
          ))}
        </div>

        {/* Leads Table */}
        {leads.length === 0 ? (
          <div
            className="card animate-fadeIn"
            style={{ textAlign: "center", padding: "60px 40px" }}
          >
            <div style={{ marginBottom: "16px", color: "var(--text-muted)", display: "flex", justifyContent: "center" }}><Inbox size={48} strokeWidth={1} /></div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "12px" }}>
              No Leads in Pipeline
            </h2>
            <p className="text-muted" style={{ maxWidth: "400px", margin: "0 auto" }}>
              Go to <strong>Campaigns</strong> → select a campaign → <strong>Import Profiles</strong> to add leads.
            </p>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "40px" }}>
            <div style={{ marginBottom: "12px", color: "var(--text-muted)", display: "flex", justifyContent: "center" }}><Search size={36} strokeWidth={1} /></div>
            <p className="text-muted">No leads with this status yet.</p>
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-primary)", background: "var(--bg-secondary)" }}>
                  {["Lead", "Contact", "Campaign", "Position / Status", "Delete"].map((h, i) => (
                    <th
                      key={h + i}
                      className="text-xs"
                      style={{
                        textAlign: i === 4 ? "right" : "left",
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
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
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
                          <div className="text-xs text-muted">{lead.role || lead.company}</div>
                        </div>
                      </div>
                    </td>

                    {/* Contact Info */}
                    <td style={{ padding: "12px 16px" }} className="text-sm">
                      {lead.email || lead.phone ? (
                        <div className="flex flex-col gap-1">
                          {lead.email && <div className="text-muted"><Mail size={12} className="inline mr-1"/>{lead.email}</div>}
                          {lead.phone && <div className="text-muted">☎ {lead.phone}</div>}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>

                    {/* Campaign */}
                    <td style={{ padding: "12px 16px" }} className="text-sm">
                      {lead.campaignName || "—"}
                    </td>

                    {/* Status / Position */}
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        className={`badge ${statusLabels[lead.status as LeadStatus]?.badge || "badge-neutral"}`}
                      >
                        {statusLabels[lead.status as LeadStatus]?.icon || <Users size={14}/>}{" "}
                        {statusLabels[lead.status as LeadStatus]?.label || lead.status}
                      </span>
                    </td>

                    {/* Delete Action */}
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <button 
                        className="btn btn-secondary btn-sm"
                        style={{ background: "rgba(220, 38, 38, 0.1)", color: "var(--accent-danger)", border: "1px solid rgba(220, 38, 38, 0.2)" }}
                        onClick={(e) => handleDeleteLead(lead.id, e)}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </>
  );
}
