import { useState, useEffect, useRef } from "react";
import { Terminal, Copy, X, Activity } from "lucide-react";

interface ActivityLog {
  id: number;
  action: string;
  module: string;
  details_json: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface ActivityLogTerminalProps {
  moduleFilter: string;
  title?: string;
  onClose?: () => void;
  height?: number | string;
  className?: string;
}

export default function ActivityLogTerminal({ 
  moduleFilter, 
  title = "Live Terminal", 
  onClose,
  height = 300,
  className = ""
}: ActivityLogTerminalProps) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isCopied, setIsCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    try {
      const data = await (window as any).api.activity.list({ limit: 100, module: moduleFilter });
      // Database returns descending (newest first). Let's reverse to show oldest at top, newest at bottom.
      setLogs((data || []).reverse());
    } catch (err) {
      console.error("Failed to fetch activity logs", err);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [moduleFilter]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If we scroll up by more than 20px, turn off autoScroll
    if (scrollHeight - scrollTop - clientHeight > 20) {
      setAutoScroll(false);
    } else {
      setAutoScroll(true);
    }
  };

  const handleCopyLogs = () => {
    const text = logs.map(l => {
      const time = new Date(l.created_at).toLocaleTimeString("en-IN", { hour12: false });
      let statusIcon = "ℹ";
      if (l.status === "success" || l.status === "completed") statusIcon = "✓";
      else if (l.status === "error" || l.status === "failed") statusIcon = "❌";
      else if (l.status === "pending" || l.status === "queued") statusIcon = "⏳";
      return `[${time}] ${statusIcon} [${l.module}] ${l.action} ${l.error_message ? ` - ERROR: ${l.error_message}` : ""}`;
    }).join("\n");
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div 
      className={`activity-terminal ${className}`}
      style={{
        display: "flex", flexDirection: "column",
        background: "rgba(30, 36, 51, 0.75)",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
        height
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(0,0,0,0.2)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%", background: "var(--accent-success)",
            animation: "pulse 2s infinite"
          }} />
          <Terminal size={14} style={{ color: "var(--text-muted)" }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "0.5px" }}>
            {title}
          </span>
          {!autoScroll && (
            <button 
              onClick={() => { setAutoScroll(true); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }}
              style={{ background: "transparent", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontSize: 11, padding: "2px 8px", borderRadius: 4, cursor: "pointer", marginLeft: 8 }}
            >
              Resume Scroll
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={handleCopyLogs}
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
              fontSize: 12, transition: "color 0.2s"
            }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--text-primary)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
          >
            {isCopied ? <Activity size={12} style={{color: "var(--accent-success)"}} /> : <Copy size={12} />}
            {isCopied ? <span style={{color: "var(--accent-success)"}}>Copied!</span> : "Copy"}
          </button>
          {onClose && (
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", padding: 2 }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Logs Area */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1, overflowY: "auto", padding: "12px 16px",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 12, color: "var(--text-muted)",
          display: "flex", flexDirection: "column", gap: 6,
          lineHeight: 1.5
        }}
      >
        {logs.length === 0 ? (
          <div style={{ opacity: 0.5, fontStyle: "italic", textAlign: "center", marginTop: 20 }}>
            Waiting for activity...
          </div>
        ) : logs.map(log => {
          const isError = log.status === "error" || log.status === "failed";
          const isSuccess = log.status === "success" || log.status === "completed";
          const isPending = log.status === "pending" || log.status === "queued" || log.action.includes("started");
          
          let color = "var(--text-muted)";
          if (isError) color = "var(--accent-danger)";
          else if (isSuccess) color = "#34d399";
          else if (isPending) color = "var(--accent-warning)";
          else if (log.action.includes("scraped") || log.module === "ai") color = "var(--accent-primary)";

          let displayMessage = log.action;
          try {
            const details = JSON.parse(log.details_json || "{}");
            if (details.message) {
               // If it's a backend log, the action is just a tag, so just show the raw message
               if (log.action.endsWith("_log")) displayMessage = details.message;
               else displayMessage = `${log.action} — ${details.message}`;
            }
          } catch (e) {}

          return (
            <div key={log.id} style={{ display: "flex", gap: 10, wordBreak: "break-all" }}>
              <span style={{ opacity: 0.4, flexShrink: 0 }}>
                {new Date(log.created_at).toLocaleTimeString("en-IN", { hour12: false })}
              </span>
              <div style={{ color }}>
                <span style={{ opacity: 0.7 }}>[{log.module}]</span>{" "}
                {displayMessage}
                {log.error_message && (
                  <div style={{ color: "#fca5a5", marginTop: 2, paddingLeft: 8, borderLeft: "2px solid var(--accent-danger)" }}>
                    {log.error_message}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.95); }
        }
        .activity-terminal::-webkit-scrollbar {
          width: 8px;
        }
        .activity-terminal::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.1);
        }
        .activity-terminal::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
        }
        .activity-terminal::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.2);
        }
      `}</style>
    </div>
  );
}
