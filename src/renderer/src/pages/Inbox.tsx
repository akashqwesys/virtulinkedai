import { useState, useEffect, useRef } from "react";
import {
  MessageSquare, RefreshCw, Send, Bot,
  Wifi, WifiOff, ChevronRight, CheckCheck,
  Zap, Search, Calendar, Sparkles
} from "lucide-react";
import Modal from "../components/Modal";

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

/** Fix dates with wrong year (LinkedIn returns "Apr 14" which JS parses as year 2001) */
function fixDate(dateStr: string): Date {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date();
  // If year is before 2020, LinkedIn probably omitted the year — assume current year
  if (d.getFullYear() < 2020) {
    d.setFullYear(new Date().getFullYear());
    // If the corrected date is in the future, use last year
    if (d.getTime() > Date.now()) d.setFullYear(d.getFullYear() - 1);
  }
  return d;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const d = fixDate(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 0) return "just now";
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatMessageTime(dateStr: string): string {
  if (!dateStr) return "";
  const d = fixDate(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const timeStr = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  // Today → just time
  if (diff < 86400000 && d.getDate() === now.getDate()) return timeStr;
  // Yesterday
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth()) return `Yesterday ${timeStr}`;
  // This year
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + ", " + timeStr;
  }
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) + ", " + timeStr;
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
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
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
    // Scroll only the messages container, not the whole page
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const selectLead = async (lead: InboxLead) => {
    setSelectedLead(lead);
    setMessages([]);
    setIsSyncing(true);

    // First try to load cached messages from DB (instant)
    try {
      const cachedMsgs = await api().inbox.getMessages(lead.id);
      if (cachedMsgs && cachedMsgs.length > 0) {
        setMessages(cachedMsgs);
      }
    } catch {}

    // Then auto-sync from LinkedIn unconditionally
    try {
      const result = await api().inbox.syncThread(lead.id);
      if (result?.success && result.messages?.length > 0) {
        setMessages(result.messages);
        setBrowserOpen(true);
      }
    } catch (err) {
      console.error("Auto-sync failed on selectLead", err);
    }
    setIsSyncing(false);
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
        
        // Auto-sync to fetch the delivered message
        try {
          const syncRes = await api().inbox.syncThread(selectedLead.id);
          if (syncRes?.success && syncRes.messages) {
            setMessages(syncRes.messages);
          }
        } catch (e) {
          console.error("Failed to sync after sending message", e);
        }
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

  const generateAiReply = async () => {
    if (!selectedLead || isGeneratingAi) return;
    setIsGeneratingAi(true);
    try {
      const result = await api().inbox.generateAiReply({ leadId: selectedLead.id });
      if (result?.success && result.reply) {
        setReplyText(result.reply);
        showToast("AI draft ready — review and send when you're happy ✨");
      } else {
        showToast(result?.error || "AI generation failed — check Ollama connection", "err");
      }
    } catch (e: any) {
      showToast(e?.message || "AI generation failed", "err");
    } finally {
      setIsGeneratingAi(false);
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
      <Modal
        isOpen={showMeetingModal}
        onClose={() => setShowMeetingModal(false)}
        title={`Schedule Meeting with ${selectedLead?.firstName}`}
        icon={<Calendar size={18} style={{ color: "var(--accent-primary)" }} />}
        width="420px"
      >
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
      </Modal>

      <div className="page-header">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-subtitle">LinkedIn conversations — manual & automated</p>
        </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, padding: "4px 10px",
              borderRadius: 12, fontSize: "0.7rem", fontWeight: 500,
              background: browserOpen ? "rgba(34,197,94,0.05)" : "var(--bg-tertiary)",
              border: `1px solid ${browserOpen ? "rgba(34,197,94,0.15)" : "var(--border-subtle)"}`,
              color: browserOpen ? "var(--accent-success)" : "var(--text-muted)",
            }}>
              {browserOpen ? <Wifi size={13} /> : <WifiOff size={13} />}
              {browserOpen ? "Inbox Browser Open" : "Inbox Browser Idle"}
            </div>
            <button onClick={scrapeAll} disabled={isScraping}
              style={{ cursor: "pointer", fontSize: "0.75rem", padding: "4px 12px", display: "flex", alignItems: "center", gap: 6, background: "var(--accent-primary-glow)", border: "1px solid var(--border-primary)", color: "var(--text-primary)", borderRadius: "6px", outline: "none" }}
              title="Open LinkedIn messaging in a separate browser window and sync ALL conversations to inbox">
              <RefreshCw size={12} style={{ animation: isScraping ? "spin 1s linear infinite" : "none" }} />
              {isScraping ? "Syncing…" : "Sync All"}
            </button>
            <button style={{ cursor: "pointer", fontSize: "0.75rem", padding: "4px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)", borderRadius: "6px", color: "var(--text-primary)", outline: "none", display: "flex", alignItems: "center", gap: 6 }} onClick={loadLeads}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
      </div>

      <div className="page-body" style={{ padding: 0, height: "calc(100vh - 130px)", display: "flex", gap: 0, overflow: "hidden" }}>
        {/* LEFT: Lead list */}
        <div style={{
          width: 280, flexShrink: 0,
          borderRight: "1px solid var(--border-subtle)",
          display: "flex", flexDirection: "column",
          background: "var(--bg-glass)",
          backdropFilter: "blur(20px)",
        }}>
          {/* Search */}
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input placeholder="Search leads..."
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 32, fontSize: "0.8125rem", height: 32, width: "100%", boxSizing: "border-box", background: "var(--bg-input)", border: "1px solid var(--border-subtle)", borderRadius: "6px", color: "var(--text-primary)", outline: "none" }} />
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
                  padding: "14px 16px", cursor: "pointer",
                  borderBottom: "1px solid var(--border-subtle)",
                  background: selectedLead?.id === lead.id ? "var(--bg-elevated)" : "transparent",
                  borderLeft: selectedLead?.id === lead.id ? "3px solid var(--accent-primary)" : "3px solid transparent",
                  transition: "all 0.2s ease",
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
              padding: "16px 24px", borderBottom: "1px solid var(--border-subtle)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: "var(--bg-glass)", backdropFilter: "blur(20px)", flexShrink: 0,
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
                <button onClick={syncThread} disabled={isSyncing}
                  style={{ cursor: "pointer", fontSize: "0.75rem", padding: "4px 12px", gap: 6, display: "flex", alignItems: "center", background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)", borderRadius: "6px", color: "var(--text-primary)", outline: "none" }}
                  title={browserOpen ? "Re-sync from LinkedIn" : "Opens inbox browser & syncs thread"}>
                  <RefreshCw size={12} style={{ animation: isSyncing ? "spin 1s linear infinite" : "none" }} />
                  {isSyncing ? "Syncing…" : "Sync"}
                </button>

                {isSyncing && (
                  <span style={{ fontSize: "0.75rem", color: "var(--accent-primary)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> Loading messages…
                  </span>
                )}


              </div>
            </div>

            {/* Messages */}
            <div ref={messagesContainerRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12, background: "var(--bg-primary)" }}>
              {isSyncing && messages.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", paddingTop: 60 }}>
                  <RefreshCw size={36} style={{ opacity: 0.4, marginBottom: 12, animation: "spin 1s linear infinite" }} />
                  <p style={{ fontWeight: 600 }}>Loading messages from LinkedIn…</p>
                  <p style={{ fontSize: "0.8125rem", marginTop: 6, opacity: 0.7 }}>
                    Syncing the conversation thread. This may take a few seconds.
                  </p>
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", paddingTop: 60 }}>
                  <MessageSquare size={36} style={{ opacity: 0.2, marginBottom: 12 }} />
                  <p style={{ fontWeight: 600 }}>No messages yet</p>
                  <p style={{ fontSize: "0.8125rem", marginTop: 6, opacity: 0.7 }}>
                    Click <strong>Sync</strong> to load the LinkedIn thread, or send a message below.
                  </p>
                </div>
              ) : [...messages].sort((a, b) => fixDate(a.sentAt).getTime() - fixDate(b.sentAt).getTime()).map(msg => (
                <div key={msg.id} style={{
                  display: "flex",
                  justifyContent: msg.direction === "outbound" ? "flex-end" : "flex-start",
                  paddingLeft: msg.direction === "inbound" ? 0 : 36,
                  paddingRight: msg.direction === "outbound" ? 0 : 36,
                }}>
                  {/* Lead avatar for inbound */}
                  {msg.direction === "inbound" && (
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginRight: 6, marginTop: 1,
                      background: "var(--gradient-brand)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "0.55rem", fontWeight: 700,
                      overflow: "hidden",
                    }}>
                      {selectedLead?.profileImageUrl
                        ? <img src={selectedLead.profileImageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : selectedLead ? initials(selectedLead) : "?"
                      }
                    </div>
                  )}
                  <div style={{
                    maxWidth: "65%",
                    padding: "8px 12px",
                    borderRadius: msg.direction === "outbound" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: "var(--bg-card)",
                    fontSize: "0.75rem", lineHeight: 1.45,
                    border: "1px solid var(--border-subtle)",
                    boxShadow: "var(--shadow-sm)",
                  }}>
                    <div style={{ wordBreak: "break-word" }}>{msg.content}</div>
                    <div style={{
                      marginTop: 2, fontSize: "0.6rem", opacity: 0.45,
                      display: "flex", alignItems: "center", gap: 3,
                      justifyContent: msg.direction === "outbound" ? "flex-end" : "flex-start",
                    }}>
                      {msg.isAutomated && <Bot size={8} />}
                      {formatMessageTime(msg.sentAt)}
                      {msg.direction === "outbound" && <CheckCheck size={8} style={{ color: "#93c5fd" }} />}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Compose box */}
            <div style={{
              padding: "16px 24px", borderTop: "1px solid var(--border-subtle)",
              background: "var(--bg-glass)", backdropFilter: "blur(20px)", flexShrink: 0,
            }}>
              {!browserOpen && (
                <div style={{
                  marginBottom: 10, padding: "6px 12px", borderRadius: 8,
                  background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)",
                  fontSize: "0.7rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8,
                }}>
                  <Zap size={10} style={{ opacity: 0.6 }} />
                  Sending will open a dedicated inbox browser window (one-time, stays open).
                </div>
              )}

              {/* Textarea row with AI button embedded */}
              <div style={{ position: "relative", display: "flex", gap: 8, alignItems: "flex-end" }}>
                {/* Textarea wrapper — has the AI button inside the right edge */}
                <div style={{ flex: 1, position: "relative" }}>
                  <textarea
                    placeholder="Type a message… (sends via LinkedIn, stops AI chatbot)"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    rows={2}
                    style={{
                      width: "100%", resize: "none", lineHeight: 1.5,
                      padding: "10px 110px 10px 14px",  /* right padding reserves space for AI button */
                      background: "var(--bg-input)", border: "1px solid var(--border-subtle)",
                      borderRadius: "10px", minHeight: "52px",
                      color: "var(--text-primary)", outline: "none", boxSizing: "border-box",
                      transition: "border-color 0.2s ease",
                      fontSize: "0.8125rem",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
                    onBlur={e => (e.currentTarget.style.borderColor = "var(--border-subtle)")}
                  />

                  {/* ✨ Write with AI — floated inside right side of textarea */}
                  <button
                    id="inbox-ai-reply-btn"
                    onClick={generateAiReply}
                    disabled={isGeneratingAi}
                    title="Generate an AI-crafted reply using full conversation context + Veda AI Lab LLC knowledge"
                    style={{
                      position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 10px", borderRadius: 20,
                      background: isGeneratingAi
                        ? "rgba(139,92,246,0.08)"
                        : "linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(99,102,241,0.18) 100%)",
                      border: "1px solid rgba(139,92,246,0.35)",
                      color: isGeneratingAi ? "rgba(167,139,250,0.6)" : "#a78bfa",
                      fontSize: "0.7rem", fontWeight: 600, cursor: isGeneratingAi ? "not-allowed" : "pointer",
                      outline: "none", whiteSpace: "nowrap",
                      transition: "all 0.2s ease",
                      backdropFilter: "blur(8px)",
                      boxShadow: isGeneratingAi ? "none" : "0 2px 12px rgba(139,92,246,0.2)",
                    }}
                    onMouseEnter={e => { if (!isGeneratingAi) (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, rgba(139,92,246,0.28) 0%, rgba(99,102,241,0.28) 100%)"; }}
                    onMouseLeave={e => { if (!isGeneratingAi) (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(99,102,241,0.18) 100%)"; }}
                  >
                    <Sparkles
                      size={12}
                      style={{
                        animation: isGeneratingAi ? "spin 1.2s linear infinite" : "none",
                        flexShrink: 0,
                      }}
                    />
                    {isGeneratingAi ? "Generating…" : "Write with AI"}
                  </button>
                </div>

                {/* Send button */}
                <button
                  onClick={sendMessage}
                  disabled={!replyText.trim() || isSending}
                  style={{
                    cursor: "pointer", padding: "0 18px", gap: 6,
                    display: "flex", alignItems: "center", height: "52px",
                    background: replyText.trim() && !isSending
                      ? "var(--accent-primary-glow)"
                      : "var(--bg-tertiary)",
                    border: "1px solid var(--border-primary)",
                    color: "var(--text-primary)", borderRadius: "10px",
                    fontSize: "0.8rem", fontWeight: 600, outline: "none",
                    transition: "all 0.2s ease",
                    flexShrink: 0,
                  }}
                >
                  <Send size={14} />
                  {isSending ? "Sending…" : "Send"}
                </button>
              </div>

              <div style={{ marginTop: 6, fontSize: "0.7rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 14 }}>
                <span><ChevronRight size={9} style={{ display: "inline" }} /> Enter to send · Shift+Enter for new line</span>
                <span style={{ color: "rgba(167,139,250,0.5)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Sparkles size={9} /> AI uses full chat history + Veda AI Lab LLC context
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
