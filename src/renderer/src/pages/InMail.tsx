import { useState, useEffect, useRef } from "react";
import {
  Mail, Send, AlertTriangle, CheckCircle2, Loader2,
  ExternalLink, ChevronRight, X, Clock, MessageSquare,
  User, Building2, Inbox, RefreshCw, Zap, Copy
} from "lucide-react";

interface InMailRecord {
  id: string;
  profile_url: string;
  first_name: string;
  last_name: string;
  headline: string;
  company: string;
  profile_image_url: string;
  subject: string;
  body: string;
  type: "inmail" | "dm";
  objective: string;
  sent_at: string;
}

interface ProfileGroup {
  profileUrl: string;
  firstName: string;
  lastName: string;
  headline: string;
  company: string;
  profileImageUrl: string;
  count: number;
  lastSentAt: string;
  lastType: "inmail" | "dm";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function Avatar({ name, url, size = 40 }: { name: string; url?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url} alt={name} onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  const initials = name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg, var(--accent-primary), var(--accent-primary))",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.35, fontWeight: 700, color: "#fff"
    }}>{initials || <User size={size * 0.45} />}</div>
  );
}

export default function InMail() {
  const [profileUrl, setProfileUrl] = useState("");
  const [objective, setObjective] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [resultType, setResultType] = useState<"dm" | "inmail" | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // History state
  const [history, setHistory] = useState<InMailRecord[]>([]);
  const [profileGroups, setProfileGroups] = useState<ProfileGroup[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<ProfileGroup | null>(null);
  const [profileInMails, setProfileInMails] = useState<InMailRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedInMail, setExpandedInMail] = useState<string | null>(null);

  // Subscribe to real-time logs from main process
  useEffect(() => {
    const unsub = (window as any).api.inmail.onLog((msg: string) => {
      setLogs(prev => [...prev, msg]);
    });
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await (window as any).api.inmail.list(200);
      if (res.success && res.data) {
        setHistory(res.data);
        // Group by profile
        const map = new Map<string, ProfileGroup>();
        for (const r of res.data as InMailRecord[]) {
          const key = r.profile_url.split("?")[0].replace(/\/$/, "");
          if (!map.has(key)) {
            map.set(key, {
              profileUrl: r.profile_url,
              firstName: r.first_name,
              lastName: r.last_name,
              headline: r.headline,
              company: r.company,
              profileImageUrl: r.profile_image_url,
              count: 0,
              lastSentAt: r.sent_at,
              lastType: r.type,
            });
          }
          const g = map.get(key)!;
          g.count++;
          if (new Date(r.sent_at) > new Date(g.lastSentAt)) {
            g.lastSentAt = r.sent_at;
            g.lastType = r.type;
          }
        }
        setProfileGroups(Array.from(map.values()).sort(
          (a, b) => new Date(b.lastSentAt).getTime() - new Date(a.lastSentAt).getTime()
        ));
      }
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => { loadHistory(); }, []);

  const openProfileDetail = async (group: ProfileGroup) => {
    setSelectedProfile(group);
    const res = await (window as any).api.inmail.getForProfile(group.profileUrl);
    if (res.success) setProfileInMails(res.data);
  };

  const handleSend = async () => {
    if (!profileUrl.includes("linkedin.com/in/")) {
      setErrorMessage("Please enter a valid LinkedIn profile URL (e.g. https://www.linkedin.com/in/username)");
      setStatus("error");
      return;
    }
    setIsProcessing(true);
    setStatus("processing");
    setErrorMessage("");
    setLogs([]);
    setResultType(null);

    try {
      const res = await (window as any).api.inmail.processDirect({
        profileUrl,
        objective: objective.trim() || undefined,
      });
      if (res.success) {
        setStatus("success");
        setResultType(res.type);
        await loadHistory();
      } else {
        setStatus("error");
        setErrorMessage(res.error || "Failed to process InMail");
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "An unexpected error occurred.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyLogs = () => {
    const text = logs.join("\n");
    navigator.clipboard.writeText(text);
    // Visual feedback handled by alert for now or just a quick state
    const originalText = "Live Terminal";
    const header = document.getElementById("terminal-header");
    if (header) {
      header.innerText = "Logs Copied! ✓";
      setTimeout(() => { if (header) header.innerText = originalText; }, 2000);
    }
  };

  const bg = "var(--bg-primary)";
  const bgSecondary = "var(--bg-secondary)";
  const bgCard = "var(--bg-card, #1e2433)";
  const border = "var(--border-subtle)";
  const textMuted = "var(--text-muted, #8b9ab0)";

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── LEFT PANEL: Compose + Terminal ─────────────────────── */}
      <div style={{
        width: 480, flexShrink: 0, display: "flex", flexDirection: "column",
        borderRight: `1px solid ${border}`, overflow: "auto", padding: "28px 24px"
      }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Zap size={20} style={{ color: "var(--accent-primary)" }} /> Direct InMail
          </h1>
          <p style={{ color: textMuted, fontSize: 13 }}>
            AI-personalized InMail or DM — automatically detects the right channel.
          </p>
        </div>

        {/* Compose Card */}
        <div style={{
          background: bgSecondary, border: `1px solid ${border}`,
          borderRadius: "var(--radius-lg)", padding: 20, marginBottom: 16
        }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-muted)" }}>
              LinkedIn Profile URL *
            </label>
            <input
              className="input"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 13,
                background: bg, border: `1px solid ${border}`, color: "var(--text-primary)", boxSizing: "border-box" }}
              value={profileUrl}
              onChange={e => setProfileUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/username"
              disabled={isProcessing}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-muted)" }}>
              Objective <span style={{ color: textMuted, fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              className="input"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 13,
                background: bg, border: `1px solid ${border}`, color: "var(--text-primary)",
                resize: "vertical", minHeight: 72, boxSizing: "border-box" }}
              value={objective}
              onChange={e => setObjective(e.target.value)}
              placeholder="e.g. Invite to our AI workshop on May 20th..."
              disabled={isProcessing}
              rows={3}
            />
            <p style={{ fontSize: 11, color: textMuted, marginTop: 4 }}>
              If blank, defaults to networking & knowledge sharing.
            </p>
          </div>

          {status === "error" && (() => {
            const isAuthError = errorMessage.toLowerCase().includes("inbox browser") ||
              errorMessage.toLowerCase().includes("inbox tab") ||
              errorMessage.toLowerCase().includes("not logged in") ||
              errorMessage.toLowerCase().includes("authwall");
            return (
              <div style={{
                marginBottom: 16, padding: "12px 14px",
                background: isAuthError ? "rgba(251,191,36,0.08)" : "rgba(255, 59, 48, 0.1)",
                border: `1px solid ${isAuthError ? "rgba(251,191,36,0.3)" : "rgba(255, 59, 48, 0.1)"}`,
                borderRadius: 8, display: "flex", gap: 10, alignItems: "flex-start"
              }}>
                <AlertTriangle size={15} style={{ color: isAuthError ? "var(--accent-warning)" : "var(--accent-danger)", flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12 }}>
                  <p style={{ color: isAuthError ? "#fde68a" : "#fca5a5", marginBottom: isAuthError ? 4 : 0 }}>
                    {errorMessage}
                  </p>
                  {isAuthError && (
                    <p style={{ color: "var(--accent-warning)", opacity: 0.8 }}>
                      → Open the <strong>Inbox</strong> tab and wait for the browser to load, then try again.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {status === "success" && (
            <div style={{
              marginBottom: 16, padding: "12px 14px", background: "rgba(52, 199, 89, 0.1)",
              border: "1px solid rgba(52, 199, 89, 0.1)", borderRadius: 8,
              display: "flex", gap: 10, alignItems: "flex-start"
            }}>
              <CheckCircle2 size={15} style={{ color: "var(--accent-success)", flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: "var(--accent-success)" }}>
                <p style={{ fontWeight: 600, marginBottom: 2 }}>Sent successfully!</p>
                <p>Sent as {resultType === "inmail" ? "LinkedIn InMail (with subject)" : "Standard DM (open profile)"}</p>
              </div>
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={isProcessing || !profileUrl.trim()}
            style={{
              width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
              background: (isProcessing || !profileUrl.trim())
                ? "rgba(0, 122, 255, 0.1)"
                : "linear-gradient(135deg, var(--accent-primary), var(--accent-primary-hover))",
              color: "#fff", fontWeight: 600, fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              cursor: (isProcessing || !profileUrl.trim()) ? "not-allowed" : "pointer",
              boxShadow: (isProcessing || !profileUrl.trim()) ? "none" : "0 4px 14px rgba(0, 122, 255, 0.1)",
              transition: "all 0.2s"
            }}
          >
            {isProcessing ? (
              <><Loader2 size={16} className="animate-spin" /> Processing...</>
            ) : (
              <><Send size={16} /> Process & Send</>
            )}
          </button>
        </div>

        {/* Live Terminal */}
        {(isProcessing || logs.length > 0) && (
          <div style={{
            background: bgCard, border: `1px solid ${border}`,
            borderRadius: "var(--radius-lg)", padding: 16, flexShrink: 0
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", background: "var(--accent-primary)",
                  animation: isProcessing ? "pulse 1.5s infinite" : "none"
                }} />
                <span id="terminal-header" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                  Live Terminal
                </span>
              </div>
              <button
                onClick={handleCopyLogs}
                style={{
                  background: "none", border: "none", color: textMuted,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                  padding: "2px 6px", borderRadius: 4, fontSize: 10, transition: "all 0.2s"
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = "none")}
                title="Copy terminal logs to clipboard"
              >
                <Copy size={10} /> Copy Logs
              </button>
            </div>
            <div style={{
              fontFamily: "monospace", fontSize: 11, color: textMuted,
              display: "flex", flexDirection: "column", gap: 4,
              maxHeight: 200, overflowY: "auto",
              userSelect: "text", cursor: "text"
            }}>
              {logs.length === 0 && (
                <span style={{ opacity: 0.5 }}>Initializing...</span>
              )}
              {logs.map((log, i) => (
                <div key={i} style={{
                  userSelect: "text",
                  color: log.startsWith("✅") ? "var(--accent-success)"
                    : log.startsWith("❌") ? "var(--accent-danger)"
                    : log.startsWith("✓") ? "var(--accent-primary)"
                    : log.startsWith("⚠") ? "var(--accent-warning)"
                    : textMuted
                }}>
                  <span style={{ opacity: 0.5, marginRight: 6, userSelect: "none" }}>›</span>{log}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL: Profile History ────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px", borderBottom: `1px solid ${border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
              InMail Pipeline
            </h2>
            <p style={{ fontSize: 12, color: textMuted }}>
              {profileGroups.length} profile{profileGroups.length !== 1 ? "s" : ""} contacted ·{" "}
              {history.length} total message{history.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={loadHistory}
            disabled={loadingHistory}
            style={{
              padding: "7px 12px", borderRadius: 8, border: `1px solid ${border}`,
              background: "transparent", color: textMuted, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6, fontSize: 12
            }}
          >
            <RefreshCw size={13} style={{ animation: loadingHistory ? "spin 1s linear infinite" : "none" }} />
            Refresh
          </button>
        </div>

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Profile List */}
          <div style={{
            width: selectedProfile ? 320 : "100%",
            flexShrink: 0, overflowY: "auto", transition: "width 0.25s ease",
            borderRight: selectedProfile ? `1px solid ${border}` : "none"
          }}>
            {profileGroups.length === 0 ? (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", height: "100%", gap: 12, color: textMuted, padding: 40
              }}>
                <Inbox size={40} style={{ opacity: 0.3 }} />
                <p style={{ fontSize: 14, textAlign: "center" }}>
                  No InMails sent yet.
                  <br />Use the compose panel to send your first InMail.
                </p>
              </div>
            ) : (
              <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                {profileGroups.map(group => {
                  const isSelected = selectedProfile?.profileUrl === group.profileUrl;
                  const fullName = `${group.firstName} ${group.lastName}`.trim();
                  return (
                    <div
                      key={group.profileUrl}
                      onClick={() => openProfileDetail(group)}
                      style={{
                        padding: "12px 14px", borderRadius: "var(--radius-lg)", cursor: "pointer",
                        background: isSelected ? "rgba(0, 122, 255, 0.1)" : bgSecondary,
                        border: `1px solid ${isSelected ? "rgba(0, 122, 255, 0.1)" : border}`,
                        display: "flex", alignItems: "center", gap: 12,
                        transition: "all 0.15s"
                      }}
                    >
                      <Avatar name={fullName} url={group.profileImageUrl} size={40} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
                            {fullName || "Unknown"}
                          </span>
                          <span style={{
                            fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                            background: group.lastType === "inmail" ? "var(--accent-primary-glow)" : "rgba(52, 199, 89, 0.1)",
                            color: group.lastType === "inmail" ? "var(--text-accent)" : "var(--accent-success)"
                          }}>
                            {group.lastType === "inmail" ? "InMail" : "DM"}
                          </span>
                        </div>
                        <p style={{ fontSize: 11, color: textMuted, marginBottom: 3, overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {group.headline || group.company || "—"}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 10, color: textMuted, display: "flex", alignItems: "center", gap: 3 }}>
                            <MessageSquare size={10} /> {group.count} sent
                          </span>
                          <span style={{ fontSize: 10, color: textMuted, display: "flex", alignItems: "center", gap: 3 }}>
                            <Clock size={10} /> {timeAgo(group.lastSentAt)}
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={14} style={{ color: textMuted, flexShrink: 0 }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Profile Detail Drawer */}
          {selectedProfile && (
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
              {/* Drawer header */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
                <Avatar
                  name={`${selectedProfile.firstName} ${selectedProfile.lastName}`}
                  url={selectedProfile.profileImageUrl}
                  size={52}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700 }}>
                      {selectedProfile.firstName} {selectedProfile.lastName}
                    </h3>
                    <a
                      href={selectedProfile.profileUrl}
                      target="_blank" rel="noreferrer"
                      style={{ color: "var(--accent-primary)", display: "flex" }}
                      title="Open LinkedIn profile"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                  {selectedProfile.headline && (
                    <p style={{ fontSize: 12, color: textMuted, marginBottom: 2 }}>
                      {selectedProfile.headline}
                    </p>
                  )}
                  {selectedProfile.company && (
                    <p style={{ fontSize: 12, color: textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                      <Building2 size={11} /> {selectedProfile.company}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { setSelectedProfile(null); setProfileInMails([]); setExpandedInMail(null); }}
                  style={{
                    padding: 6, borderRadius: 6, border: `1px solid ${border}`,
                    background: "transparent", cursor: "pointer", color: textMuted, flexShrink: 0,
                    display: "flex", alignItems: "center"
                  }}
                >
                  <X size={14} />
                </button>
              </div>

              <div style={{
                padding: "8px 12px", background: "rgba(0, 122, 255, 0.1)",
                border: "1px solid rgba(0, 122, 255, 0.1)", borderRadius: 8,
                fontSize: 12, color: "var(--text-accent)", marginBottom: 20
              }}>
                {profileInMails.length} InMail{profileInMails.length !== 1 ? "s" : ""} sent to this profile
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {profileInMails.map(im => {
                  const isExpanded = expandedInMail === im.id;
                  return (
                    <div
                      key={im.id}
                      style={{
                        background: bgSecondary, border: `1px solid ${border}`,
                        borderRadius: "var(--radius-lg)", overflow: "hidden", transition: "all 0.2s"
                      }}
                    >
                      {/* InMail card header */}
                      <div
                        style={{
                          padding: "12px 14px", cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 10
                        }}
                        onClick={() => setExpandedInMail(isExpanded ? null : im.id)}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                          background: im.type === "inmail"
                            ? "linear-gradient(135deg, var(--accent-primary), var(--accent-primary-hover))"
                            : "linear-gradient(135deg, var(--accent-success), var(--accent-success))",
                          display: "flex", alignItems: "center", justifyContent: "center"
                        }}>
                          {im.type === "inmail"
                            ? <Mail size={14} color="#fff" />
                            : <MessageSquare size={14} color="#fff" />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                              {im.type === "inmail" && im.subject
                                ? im.subject
                                : im.type === "inmail" ? "InMail (no subject)" : "Standard DM"}
                            </span>
                            <span style={{
                              fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 700,
                              background: im.type === "inmail" ? "var(--accent-primary-glow)" : "rgba(52, 199, 89, 0.1)",
                              color: im.type === "inmail" ? "var(--text-accent)" : "#34d399", textTransform: "uppercase"
                            }}>
                              {im.type}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: textMuted }}>
                            <Clock size={9} />
                            {new Date(im.sent_at).toLocaleString("en-IN", {
                              day: "numeric", month: "short", year: "numeric",
                              hour: "2-digit", minute: "2-digit"
                            })}
                            {im.objective && (
                              <span style={{ opacity: 0.7 }}>· {im.objective.substring(0, 40)}{im.objective.length > 40 ? "..." : ""}</span>
                            )}
                          </div>
                        </div>
                        <ChevronRight
                          size={14}
                          style={{
                            color: textMuted, flexShrink: 0,
                            transform: isExpanded ? "rotate(90deg)" : "none",
                            transition: "transform 0.2s"
                          }}
                        />
                      </div>

                      {/* Expanded body */}
                      {isExpanded && (
                        <div style={{
                          padding: "0 14px 14px",
                          borderTop: `1px solid ${border}`,
                          paddingTop: 12
                        }}>
                          {im.type === "inmail" && im.subject && (
                            <div style={{
                              marginBottom: 10, padding: "8px 12px",
                              background: "var(--accent-primary-glow)",
                              border: "1px solid var(--accent-primary-glow)",
                              borderRadius: 6
                            }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-accent)", display: "block", marginBottom: 2 }}>
                                SUBJECT
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                                {im.subject}
                              </span>
                            </div>
                          )}
                          <div style={{
                            padding: "10px 12px", background: bgCard,
                            borderRadius: 6, fontSize: 13, lineHeight: 1.65,
                            color: "var(--text-secondary, #cbd5e1)",
                            whiteSpace: "pre-wrap", wordBreak: "break-word"
                          }}>
                            {im.body}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}
