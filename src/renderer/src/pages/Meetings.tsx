import { useState, useEffect } from "react";
import {
  CalendarDays,
  Video,
  Clock,
  User,
  ExternalLink,
  MessageCircle,
  Inbox
} from "lucide-react";

type LeadStatus =
  | "meeting_booked"
  | string;

interface LeadItem {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  role: string;
  status: LeadStatus;
  profileImageUrl: string;
  linkedinUrl: string;
  campaignId?: string;
  campaignName?: string;
  email?: string;
  phone?: string;
  rawData?: any;
}

export default function Meetings() {
  const [leads, setLeads] = useState<LeadItem[]>([]);

  useEffect(() => {
    async function fetchLeads() {
      try {
        const all = await (window as any).api.leads.list();
        // Filter for leads that have a meeting booked
        const meetingLeads = all.filter((l: any) => l.status === "meeting_booked");
        setLeads(meetingLeads);
      } catch (e) {
        console.error("Failed to fetch leads:", e);
      }
    }
    fetchLeads();
    const id = setInterval(fetchLeads, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Scheduled Meetings</h1>
          <p className="page-subtitle">
            {leads.length} upcoming or past meetings booked via AI
          </p>
        </div>
      </div>

      <div className="page-body">
        {leads.length === 0 ? (
          <div
            className="card animate-fadeIn"
            style={{ textAlign: "center", padding: "60px 40px" }}
          >
            <div style={{ marginBottom: "16px", color: "var(--text-muted)", display: "flex", justifyContent: "center" }}>
              <CalendarDays size={48} strokeWidth={1} />
            </div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "12px" }}>
              No Meetings Scheduled
            </h2>
            <p className="text-muted" style={{ maxWidth: "400px", margin: "0 auto" }}>
              When the AI successfully books a meeting with a lead, it will appear here.
            </p>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "20px" }}>
            {leads.map((lead) => {
              // Parse raw data to extract meeting details
              let meetingUrl = "";
              let meetingTime = "";
              try {
                if (lead.rawData) {
                  const data = typeof lead.rawData === "string" ? JSON.parse(lead.rawData) : lead.rawData;
                  meetingUrl = data.meetingUrl || "";
                  meetingTime = data.meetingTime || "";
                }
              } catch (e) {
                // ignore parsing error
              }

              return (
                <div key={lead.id} className="card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div className="flex items-center gap-3">
                      <div
                        style={{
                          width: 42, height: 42, borderRadius: "50%",
                          background: "var(--gradient-brand)",
                          display: "flex", alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700, fontSize: "1rem",
                          flexShrink: 0,
                          color: "white"
                        }}
                      >
                        {(lead.firstName?.[0] || "?")}{(lead.lastName?.[0] || "")}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>
                          {lead.firstName} {lead.lastName}
                        </div>
                        <div className="text-sm text-muted">{lead.role || lead.company || "Lead"}</div>
                      </div>
                    </div>
                    <span className="badge badge-success">
                      Scheduled
                    </span>
                  </div>

                  <div style={{ padding: "12px", background: "var(--bg-elevated)", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {meetingTime && (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock size={14} className="text-muted" />
                        <span style={{ fontWeight: 500 }}>{meetingTime}</span>
                      </div>
                    )}
                    {meetingUrl && (
                      <div className="flex items-center gap-2 text-sm">
                        <Video size={14} className="text-muted" />
                        <a href={meetingUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent-primary)", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px" }}>
                          Join Meeting <ExternalLink size={12} />
                        </a>
                      </div>
                    )}
                    {!meetingTime && !meetingUrl && (
                      <div className="text-sm text-muted italic">
                        Meeting details not available. Check your connected calendar.
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "8px", marginTop: "auto", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
                     <button
                        className="btn btn-secondary btn-sm"
                        style={{ flex: 1, display: "flex", justifyContent: "center" }}
                        onClick={() => window.open(lead.linkedinUrl, "_blank")}
                      >
                        <User size={14} /> Profile
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ flex: 1, display: "flex", justifyContent: "center" }}
                        onClick={() => window.open(`https://www.linkedin.com/messaging/`, "_blank")}
                      >
                        <MessageCircle size={14} /> Message
                      </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
