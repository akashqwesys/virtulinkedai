import { useState, useEffect } from "react";

interface Message {
  id: string;
  leadName: string;
  leadCompany: string;
  direction: "inbound" | "outbound";
  content: string;
  platform: "linkedin" | "email";
  isAutomated: boolean;
  sentAt: string;
}

export default function Inbox() {
  const [messages] = useState<Message[]>([]);
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  // Group messages by lead
  const groupedMessages = messages.reduce(
    (acc, msg) => {
      const key = msg.leadName;
      if (!acc[key]) acc[key] = [];
      acc[key].push(msg);
      return acc;
    },
    {} as Record<string, Message[]>,
  );

  const leads = Object.keys(groupedMessages);

  function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-subtitle">
            Unified LinkedIn & email conversations
          </p>
        </div>
      </div>

      <div className="page-body">
        {messages.length === 0 ? (
          <div
            className="card animate-fadeIn"
            style={{ textAlign: "center", padding: "80px 40px" }}
          >
            <div style={{ fontSize: "56px", marginBottom: "20px" }}>💬</div>
            <h2
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                marginBottom: "12px",
              }}
            >
              No Conversations Yet
            </h2>
            <p
              className="text-muted"
              style={{ maxWidth: "500px", margin: "0 auto", lineHeight: 1.7 }}
            >
              Once you connect with leads and the chatbot starts engaging, all
              conversations will appear here. You can take over any conversation
              manually at any time.
            </p>

            <div
              style={{
                marginTop: "40px",
                maxWidth: "550px",
                margin: "40px auto 0",
              }}
            >
              <div
                className="card"
                style={{
                  background: "rgba(139, 92, 246, 0.06)",
                  border: "1px solid rgba(139, 92, 246, 0.15)",
                  textAlign: "left",
                }}
              >
                <h3
                  style={{
                    fontWeight: 600,
                    marginBottom: "12px",
                    fontSize: "0.9375rem",
                  }}
                >
                  🤖 Chatbot Flow
                </h3>
                <div style={{ display: "grid", gap: "12px" }}>
                  {[
                    {
                      step: "1",
                      label: "Connection accepted",
                      desc: "Send welcome DM",
                    },
                    {
                      step: "2",
                      label: "Lead replies",
                      desc: "AI analyzes intent",
                    },
                    {
                      step: "3",
                      label: "Build rapport",
                      desc: "2-3 contextual exchanges",
                    },
                    {
                      step: "4",
                      label: "Share value",
                      desc: "Present your services naturally",
                    },
                    {
                      step: "5",
                      label: "Suggest meeting",
                      desc: "Send calendar booking link",
                    },
                  ].map((item) => (
                    <div key={item.step} className="flex items-center gap-3">
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          background: "var(--gradient-brand)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          fontSize: "0.75rem",
                          flexShrink: 0,
                        }}
                      >
                        {item.step}
                      </div>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                          {item.label}
                        </span>
                        <span className="text-muted text-sm">
                          {" "}
                          — {item.desc}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "320px 1fr",
              gap: "0",
              height: "calc(100vh - 200px)",
            }}
          >
            {/* Conversations list */}
            <div
              className="card"
              style={{ borderRadius: "12px 0 0 12px", overflowY: "auto" }}
            >
              {leads.map((leadName) => {
                const msgs = groupedMessages[leadName];
                const lastMsg = msgs[msgs.length - 1];
                const unread = msgs.filter(
                  (m) => m.direction === "inbound" && !m.isAutomated,
                ).length;

                return (
                  <div
                    key={leadName}
                    onClick={() => setSelectedLead(leadName)}
                    style={{
                      padding: "14px 16px",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border-subtle)",
                      background:
                        selectedLead === leadName
                          ? "rgba(99, 102, 241, 0.1)"
                          : "transparent",
                      transition: "background 0.2s",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: "50%",
                          background: "var(--gradient-brand)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          fontSize: "0.8125rem",
                          flexShrink: 0,
                        }}
                      >
                        {leadName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex items-center gap-2">
                          <span
                            style={{ fontWeight: 600, fontSize: "0.875rem" }}
                          >
                            {leadName}
                          </span>
                          {unread > 0 && (
                            <span
                              className="badge badge-danger"
                              style={{ fontSize: "0.6875rem" }}
                            >
                              {unread}
                            </span>
                          )}
                        </div>
                        <div
                          className="text-sm text-muted"
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {lastMsg.content.slice(0, 60)}
                        </div>
                      </div>
                      <span
                        className="text-sm text-muted"
                        style={{ flexShrink: 0 }}
                      >
                        {formatTime(lastMsg.sentAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Chat area */}
            <div
              className="card"
              style={{
                borderRadius: "0 12px 12px 0",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {selectedLead ? (
                <>
                  <div
                    style={{
                      padding: "16px",
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    <h3 style={{ fontWeight: 700 }}>{selectedLead}</h3>
                    <span className="text-sm text-muted">
                      {groupedMessages[selectedLead][0]?.leadCompany}
                    </span>
                  </div>

                  <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
                    {groupedMessages[selectedLead].map((msg) => (
                      <div
                        key={msg.id}
                        style={{
                          display: "flex",
                          justifyContent:
                            msg.direction === "outbound"
                              ? "flex-end"
                              : "flex-start",
                          marginBottom: "12px",
                        }}
                      >
                        <div
                          style={{
                            maxWidth: "70%",
                            padding: "10px 14px",
                            borderRadius:
                              msg.direction === "outbound"
                                ? "14px 14px 4px 14px"
                                : "14px 14px 14px 4px",
                            background:
                              msg.direction === "outbound"
                                ? "var(--accent-primary)"
                                : "var(--bg-tertiary)",
                            fontSize: "0.9375rem",
                            lineHeight: 1.5,
                          }}
                        >
                          {msg.content}
                          <div
                            className="text-sm text-muted"
                            style={{
                              marginTop: "4px",
                              fontSize: "0.75rem",
                              opacity: 0.7,
                            }}
                          >
                            {msg.isAutomated ? "🤖 " : ""}
                            {msg.platform === "email" ? "📧 " : "💬 "}
                            {formatTime(msg.sentAt)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      padding: "12px 16px",
                      borderTop: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div className="flex gap-3">
                      <input
                        className="input"
                        placeholder="Type a message (sends as manual, stops chatbot)..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn btn-primary"
                        disabled={!replyText.trim()}
                      >
                        Send
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: 1,
                    color: "var(--text-muted)",
                  }}
                >
                  <p>Select a conversation</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
