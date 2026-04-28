import { useState, useEffect, useRef } from "react";
import {
  MessageSquare, RefreshCw, Send, Bot, Calendar,
  Wifi, WifiOff, ChevronRight, Clock, CheckCheck,
  Mail, Zap, Search, User
} from "lucide-react";

declare const window: any;
const api = () => (window as any).api;

interface InboxLead {
  id: string;
  inboxContactId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  headline: string;
  company: string;
  linkedinUrl: string;
  threadUrl: string;
  status: string;
  chatbotState: string;
  profileImageUrl: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  isLinkedInContact: boolean;
}

interface ConversationMsg {
  id: string;
  leadId: string;
  direction: "inbound" | "outbound";
  content: string;
  platform: string;
  isAutomated: boolean;
  sentAt: string;
}

interface CalendarSlot { start: string; end: string; }

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(dateStr).toLocaleDateString();
}

function initials(lead: InboxLead): string {
  if (lead.fullName) {
    const parts = lead.fullName.trim().split(' ');
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  }
  return ((lead.firstName?.[0] || '') + (lead.lastName?.[0] || '')).toUpperCase() || '?';
}

export default function Inbox() {
  const [leads, setLeads] = useState<InboxLead[]>([]);
  const [selectedLead, setSelectedLead] = useState<InboxLead | null>(null);
  const [messages, setMessages] = useState<ConversationMsg[]>([]);
  const [replyText, setReplyText] = useState("");
  const [search, setSearch] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSendingWelcome, setIsSendingWelcome] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadLeads = async () => {
    try {
      const data = await api().inbox.getLeads();
      setLeads(data || []);
    } catch {}
  };

  const checkBrowserStatus = async () => {
    try {
      const s = await api().inbox.getBrowserStatus();
      setBrowserOpen(s?.isOpen || false);
    } catch {}
  };

  useEffect(() => {
    loadLeads();
    checkBrowserStatus();
    // Poll leads refresh every 30s
    const t = setInterval(() => { loadLeads(); checkBrowserStatus(); }, 30000);
    // Listen for new messages pushed from main
    const unsub = api().on.inboxNewMessage(() => loadLeads());
    return () => { clearInterval(t); unsub?.(); };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectLead = async (lead: InboxLead) => {
    setSelectedLead(lead);
    setMessages([]);
    try {
      const msgs = await api().inbox.getMessages(lead.id);
      setMessages(msgs || []);
    } catch {}
  };

  // Scrape ALL conversations from LinkedIn sidebar
  const scrapeAll = async () => {
    setIsScraping(true);
    try {
      const result = await api().inbox.scrapeAll();
      if (result?.success) {
        showToast(`Synced ${result.count} conversations from LinkedIn ✓`);
        setBrowserOpen(true);
        await loadLeads();
      } else {
        showToast(result?.error || 'Sync failed — make sure inbox browser is logged in', 'err');
      }
    } catch (e: any) {
      showToast(e?.message || 'Sync failed', 'err');
    } finally {
      setIsScraping(false);
    }
  };

  const syncThread = async () => {
    if (!selectedLead) return;
    setIsSyncing(true);
    try {
      const result = await api().inbox.syncThread(selectedLead.id);
      if (result?.success) {
        setMessages(result.messages || []);
        setBrowserOpen(true);
        showToast("Thread synced from LinkedIn");
        loadLeads();
      } else {
        showToast(result?.error || "Sync failed", "err");
      }
    } catch (e: any) {
      showToast(e?.message || "Sync failed", "err");
    } finally {
      setIsSyncing(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedLead || !replyText.trim()) return;
    const text = replyText.trim();
    setReplyText("");
    setIsSending(true);
    // Optimistic update
    const optimistic: ConversationMsg = {
      id: `opt-${Date.now()}`, leadId: selectedLead.id,
      direction: "outbound", content: text, platform: "linkedin",
      isAutomated: false, sentAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    try {
      const threadId = selectedLead.threadUrl || selectedLead.linkedinUrl;
      const result = await api().inbox.sendManual({ leadId: selectedLead.id, threadId, message: text });
      if (result?.success) {
        showToast("Message sent on LinkedIn ✓");
        setBrowserOpen(true);
        loadLeads();
      } else {
        showToast(result?.error || "Send failed", "err");
        setMessages(prev => prev.filter(m => m.id !== optimistic.id));
        setReplyText(text);
      }
    } catch (e: any) {
      showToast(e?.message || "Send failed", "err");
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setReplyText(text);
    } finally {
      setIsSending(false);
    }
  };

  const sendWelcome = async () => {
    if (!selectedLead) return;
    setIsSendingWelcome(true);
    try {
      const result = await api().inbox.sendWelcome(selectedLead.id);
      if (result?.success) {
        showToast("Welcome DM sent via LinkedIn ✓");
        loadLeads();
      } else {
        showToast(result?.message || "Welcome DM failed", "err");
      }
    } catch (e: any) {
      showToast(e?.message || "Failed", "err");
    } finally {
      setIsSendingWelcome(false);
    }
  };

  const openMeetingModal = async () => {
    setShowMeetingModal(true);
    setSlots([]);
    try {
      const now = new Date();
      const end = new Date(now.getTime() + 7 * 86400000);
      const data = await api().calendar.getAvailableSlots({ startDate: now.toISOString(), endDate: end.toISOString(), durationMinutes: 30 });
      setSlots((data || []).slice(0, 6));
    } catch {}
  };

  const scheduleMeeting = async (slot: CalendarSlot) => {
    if (!selectedLead) return;
    setIsScheduling(true);
    try {
      const result = await api().inbox.scheduleMeeting({ leadId: selectedLead.id, slotStart: slot.start, durationMinutes: 30 });
      if (result?.success) {
        showToast("Meeting scheduled ✓");
        setShowMeetingModal(false);
        loadLeads();
      } else {
        showToast(result?.error || "Scheduling failed", "err");
      }
    } catch (e: any) {
      showToast(e?.message || "Failed", "err");
    } finally {
      setIsScheduling(false);
    }
  };

  const filteredLeads = leads.filter(l => {
    const name = `${l.firstName} ${l.lastName}`.toLowerCase();
    return name.includes(search.toLowerCase()) || l.company?.toLowerCase().includes(search.toLowerCase());
  });

  const statusColor: Record<string, string> = {
    in_conversation: "#22c55e", handed_off: "#f59e0b", meeting_booked: "#8b5cf6",
    welcome_sent: "#3b82f6", connected: "#6b7280",
  };

  return (
    <>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 24, zIndex: 9999,
          padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: "0.875rem",
          background: toast.type === "ok" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          border: `1px solid ${toast.type === "ok" ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
          color: toast.type === "ok" ? "#86efac" : "#fca5a5",
          backdropFilter: "blur(12px)", boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          animation: "fadeIn 0.2s ease",
        }}>{toast.msg}</div>
      )}

      {/* Meeting modal */}
      {showMeetingModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)",
        }}>
          <div className="card" style={{ width: 420, padding: "28px 32px" }}>
            <h3 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
              <Calendar size={18} style={{ color: "var(--accent-primary)" }} />
              Schedule Meeting with {selectedLead?.firstName}
            </h3>
            {slots.length === 0 ? (
              <p className="text-muted" style={{ textAlign: "center", padding: "20px 0" }}>Loading available slots...</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {slots.map((slot, i) => (
                  <button key={i} className="btn" onClick={() => scheduleMeeting(slot)} disabled={isScheduling}
                    style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 10, padding: "12px 16px", textAlign: "left", cursor: "pointer", color: "var(--text-primary)" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                      {new Date(slot.start).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" })}
                    </div>
                    <div className="text-muted text-sm">
                      {new Date(slot.start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} IST · 30 min
                    </div>
                  </button>
                ))}
              </div>
            )}
            <button className="btn" onClick={() => setShowMeetingModal(false)}
              style={{ marginTop: 16, width: "100%", opacity: 0.6 }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-subtitle">LinkedIn conversations — manual & automated</p>
        </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
              borderRadius: 20, fontSize: "0.8rem", fontWeight: 600,
              background: browserOpen ? "rgba(34,197,94,0.1)" : "rgba(107,114,128,0.1)",
              border: `1px solid ${browserOpen ? "rgba(34,197,94,0.3)" : "rgba(107,114,128,0.2)"}`,
              color: browserOpen ? "#86efac" : "var(--text-muted)",
            }}>
              {browserOpen ? <Wifi size={13} /> : <WifiOff size={13} />}
              {browserOpen ? "Inbox Browser Open" : "Inbox Browser Idle"}
            </div>
            <button className="btn btn-primary" onClick={scrapeAll} disabled={isScraping}
              style={{ fontSize: "0.8rem", padding: "6px 16px", display: "flex", alignItems: "center", gap: 6 }}
              title="Open LinkedIn messaging in a separate browser window and sync ALL conversations to inbox">
              <RefreshCw size={13} style={{ animation: isScraping ? "spin 1s linear infinite" : "none" }} />
              {isScraping ? "Syncing LinkedIn…" : "Sync All from LinkedIn"}
            </button>
            <button className="btn" style={{ fontSize: "0.8rem", padding: "6px 14px" }} onClick={loadLeads}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
      </div>

      <div className="page-body" style={{ padding: 0, height: "calc(100vh - 130px)", display: "flex", gap: 0 }}>
        {/* LEFT: Lead list */}
        <div style={{
          width: 300, flexShrink: 0,
          borderRight: "1px solid var(--border-subtle)",
          display: "flex", flexDirection: "column",
          background: "var(--bg-secondary)",
        }}>
          {/* Search */}
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input className="input" placeholder="Search leads..."
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 32, fontSize: "0.8125rem", height: 36 }} />
            </div>
          </div>

          {/* Lead list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredLeads.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>
                <MessageSquare size={32} style={{ opacity: 0.3, marginBottom: 10 }} />
                <p style={{ fontSize: "0.8125rem" }}>No conversations yet</p>
                <p style={{ fontSize: "0.75rem", marginTop: 6, opacity: 0.7 }}>Click <strong>Sync All from LinkedIn</strong> to mirror your full LinkedIn inbox here</p>
              </div>
            ) : filteredLeads.map(lead => (
              <div key={lead.id} onClick={() => selectLead(lead)}
                style={{
                  padding: "12px 14px", cursor: "pointer",
                  borderBottom: "1px solid var(--border-subtle)",
                  background: selectedLead?.id === lead.id ? "rgba(99,102,241,0.1)" : "transparent",
                  borderLeft: selectedLead?.id === lead.id ? "3px solid var(--accent-primary)" : "3px solid transparent",
                  transition: "all 0.15s",
                }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  {/* Avatar */}
                  <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, overflow: "hidden",
                    background: "var(--gradient-brand)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: "0.8125rem", position: "relative",
                  }}>
                    {lead.profileImageUrl
                      ? <img src={lead.profileImageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
                      : initials(lead)
                    }
                    <span style={{
                      position: "absolute", bottom: 0, right: 0,
                      width: 10, height: 10, borderRadius: "50%",
                      background: statusColor[lead.status] || "#6b7280",
                      border: "2px solid var(--bg-secondary)",
                    }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.8125rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>
                        {lead.fullName || `${lead.firstName} ${lead.lastName}`.trim() || 'Unknown'}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {lead.unreadCount > 0 && (
                          <span style={{
                            background: "var(--accent-primary)", color: "#fff",
                            borderRadius: 10, padding: "0 6px", fontSize: "0.65rem", fontWeight: 700,
                          }}>{lead.unreadCount}</span>
                        )}
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                          {timeAgo(lead.lastMessageAt)}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {lead.company || lead.headline || ""}
                    </div>
                    {lead.lastMessage && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.8 }}>
                        {lead.lastMessage.slice(0, 55)}{lead.lastMessage.length > 55 ? "…" : ""}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: Chat area */}
        {!selectedLead ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, color: "var(--text-muted)" }}>
            <MessageSquare size={48} style={{ opacity: 0.2 }} />
            <p style={{ fontWeight: 600 }}>Select a lead to view conversation</p>
            <p style={{ fontSize: "0.8125rem", opacity: 0.7 }}>Click any lead on the left to load their messages</p>
            {!browserOpen && (
              <div style={{
                marginTop: 8, padding: "12px 20px", borderRadius: 12,
                background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)",
                fontSize: "0.8125rem", color: "#fcd34d", maxWidth: 380, textAlign: "center",
              }}>
                <Zap size={14} style={{ display: "inline", marginRight: 6 }} />
                Clicking a lead will open a <strong>dedicated inbox browser window</strong> for messaging — your campaign browser stays untouched.
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Chat header */}
            <div style={{
              padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: "var(--bg-secondary)", flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: "50%", overflow: "hidden",
                  background: "var(--gradient-brand)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
                }}>
                  {selectedLead.profileImageUrl
                    ? <img src={selectedLead.profileImageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : initials(selectedLead)
                  }
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.9375rem" }}>
                    {selectedLead.fullName || `${selectedLead.firstName} ${selectedLead.lastName}`.trim()}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {selectedLead.company || selectedLead.headline || ""}
                    {selectedLead.chatbotState === "handed_off" && (
                      <span style={{ marginLeft: 8, padding: "1px 8px", background: "rgba(245,158,11,0.15)", borderRadius: 10, color: "#fcd34d", fontSize: "0.7rem" }}>
                        Manual mode
                      </span>
                    )}
                    {selectedLead.chatbotState === "waiting_reply" && (
                      <span style={{ marginLeft: 8, padding: "1px 8px", background: "rgba(99,102,241,0.15)", borderRadius: 10, color: "#a5b4fc", fontSize: "0.7rem" }}>
                        <Bot size={10} style={{ display: "inline", marginRight: 3 }} />AI active
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={syncThread} disabled={isSyncing}
                  style={{ fontSize: "0.8rem", padding: "6px 14px", gap: 6, display: "flex", alignItems: "center" }}
                  title={browserOpen ? "Re-sync from LinkedIn" : "Opens inbox browser & syncs thread"}>
                  <RefreshCw size={13} style={{ animation: isSyncing ? "spin 1s linear infinite" : "none" }} />
                  {isSyncing ? "Syncing…" : "Sync"}
                </button>

                <button className="btn" onClick={sendWelcome} disabled={isSendingWelcome}
                  style={{ fontSize: "0.8rem", padding: "6px 14px", gap: 6, display: "flex", alignItems: "center", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
                  title="Send AI-generated welcome DM via campaign browser">
                  <Zap size={13} />
                  {isSendingWelcome ? "Sending…" : "Welcome DM"}
                </button>

                <button className="btn" onClick={openMeetingModal}
                  style={{ fontSize: "0.8rem", padding: "6px 14px", gap: 6, display: "flex", alignItems: "center", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)" }}>
                  <Calendar size={13} /> Schedule
                </button>

                <a href={selectedLead.linkedinUrl} target="_blank" rel="noreferrer"
                  style={{ textDecoration: "none" }}>
                  <button className="btn" style={{ fontSize: "0.8rem", padding: "6px 14px" }}>
                    <User size={13} /> Profile
                  </button>
                </a>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", paddingTop: 60 }}>
                  <MessageSquare size={36} style={{ opacity: 0.2, marginBottom: 12 }} />
                  <p style={{ fontWeight: 600 }}>No messages yet</p>
                  <p style={{ fontSize: "0.8125rem", marginTop: 6, opacity: 0.7 }}>
                    Click <strong>Sync</strong> to load the LinkedIn thread, or send a message below.
                  </p>
                </div>
              ) : messages.map(msg => (
                <div key={msg.id} style={{
                  display: "flex",
                  justifyContent: msg.direction === "outbound" ? "flex-end" : "flex-start",
                }}>
                  <div style={{
                    maxWidth: "68%",
                    padding: "10px 14px",
                    borderRadius: msg.direction === "outbound" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                    background: msg.direction === "outbound"
                      ? (msg.isAutomated ? "rgba(99,102,241,0.7)" : "var(--accent-primary)")
                      : "var(--bg-tertiary)",
                    fontSize: "0.9rem", lineHeight: 1.55,
                    border: msg.direction === "inbound" ? "1px solid var(--border-subtle)" : "none",
                  }}>
                    <div>{msg.content}</div>
                    <div style={{
                      marginTop: 4, fontSize: "0.7rem", opacity: 0.65,
                      display: "flex", alignItems: "center", gap: 4,
                      justifyContent: msg.direction === "outbound" ? "flex-end" : "flex-start",
                    }}>
                      {msg.isAutomated && <Bot size={10} />}
                      {msg.platform === "email" ? <Mail size={10} /> : null}
                      <Clock size={10} />
                      {timeAgo(msg.sentAt)}
                      {msg.direction === "outbound" && <CheckCheck size={10} />}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Compose box */}
            <div style={{
              padding: "14px 20px", borderTop: "1px solid var(--border-subtle)",
              background: "var(--bg-secondary)", flexShrink: 0,
            }}>
              {!browserOpen && (
                <div style={{
                  marginBottom: 10, padding: "8px 14px", borderRadius: 8,
                  background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)",
                  fontSize: "0.8rem", color: "#fcd34d", display: "flex", alignItems: "center", gap: 8,
                }}>
                  <Zap size={12} />
                  Sending will open a dedicated inbox browser window (one-time, stays open).
                </div>
              )}
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <textarea
                  className="input"
                  placeholder="Type a message… (sends via LinkedIn, stops AI chatbot)"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  rows={2}
                  style={{ flex: 1, resize: "none", lineHeight: 1.5, padding: "10px 14px" }}
                />
                <button className="btn btn-primary" onClick={sendMessage}
                  disabled={!replyText.trim() || isSending}
                  style={{ padding: "10px 20px", gap: 6, display: "flex", alignItems: "center", height: "fit-content" }}>
                  <Send size={14} />
                  {isSending ? "Sending…" : "Send"}
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                <ChevronRight size={10} style={{ display: "inline" }} />
                {" "}Enter to send · Shift+Enter for new line · Sending manually pauses AI chatbot for this lead
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
