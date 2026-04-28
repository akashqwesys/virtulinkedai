import { useState, useEffect } from "react";
import { 
  FileText, Clock, CheckCircle2, XCircle, Ban, Flame, 
  RefreshCw, Plus, Calendar, Zap, ThumbsUp, MessageSquare, 
  PenTool, Send 
} from "lucide-react";

interface ScheduledPostItem {
  id: string;
  content: string;
  type: string;
  scheduledAt: string;
  status: "draft" | "scheduled" | "published" | "failed" | "cancelled";
  hashtags: string[];
}

interface OptimalTime {
  day: string;
  times: string[];
  engagement: "high" | "medium";
}

export default function ContentCalendar() {
  const [posts, setPosts] = useState<ScheduledPostItem[]>([]);
  const [optimalTimes, setOptimalTimes] = useState<OptimalTime[]>([]);
  const [showComposer, setShowComposer] = useState(false);
  const [draft, setDraft] = useState({
    content: "",
    type: "text",
    scheduledAt: "",
    hashtags: "",
  });
  const [scheduling, setScheduling] = useState(false);
  const [engagementRunning, setEngagementRunning] = useState(false);
  const [engagementResults, setEngagementResults] = useState<{
    postsViewed: number;
    likes: number;
    comments: number;
  } | null>(null);

  useEffect(() => {
    loadPosts();
    loadOptimalTimes();
  }, []);

  async function loadPosts() {
    try {
      const data = await (window as any).api.content.list();
      setPosts(data || []);
    } catch {
      /* ignore */
    }
  }

  async function loadOptimalTimes() {
    try {
      const data = await (window as any).api.content.suggestTimes();
      setOptimalTimes(data || []);
    } catch {
      /* ignore */
    }
  }

  async function handleSchedulePost() {
    if (!draft.content.trim() || !draft.scheduledAt) return;
    setScheduling(true);
    try {
      await (window as any).api.content.schedule({
        content: draft.content,
        type: draft.type,
        scheduledAt: draft.scheduledAt,
        hashtags: draft.hashtags
          .split(",")
          .map((h: string) => h.trim())
          .filter(Boolean),
      });
      setDraft({ content: "", type: "text", scheduledAt: "", hashtags: "" });
      setShowComposer(false);
      loadPosts();
    } catch {
      /* ignore */
    }
    setScheduling(false);
  }

  async function handlePublishNow() {
    if (!draft.content.trim()) return;
    setScheduling(true);
    try {
      await (window as any).api.content.publish({ content: draft.content });
      setDraft({ content: "", type: "text", scheduledAt: "", hashtags: "" });
      setShowComposer(false);
    } catch {
      /* ignore */
    }
    setScheduling(false);
  }

  async function handleCancelPost(id: string) {
    try {
      await (window as any).api.content.cancel(id);
      loadPosts();
    } catch {
      /* ignore */
    }
  }

  async function runEngagement() {
    setEngagementRunning(true);
    setEngagementResults(null);
    try {
      const results = await (window as any).api.engagement.runSession({
        maxActions: 15,
        likeRatio: 0.4,
        commentRatio: 0.15,
      });
      setEngagementResults(results);
    } catch {
      /* ignore */
    }
    setEngagementRunning(false);
  }

  async function replyToComments() {
    setEngagementRunning(true);
    try {
      const count = await (window as any).api.engagement.replyComments({
        maxReplies: 5,
      });
      setEngagementResults({ postsViewed: 0, likes: 0, comments: count || 0 });
    } catch {
      /* ignore */
    }
    setEngagementRunning(false);
  }

  const statusBadge: Record<string, string> = {
    draft: "badge-neutral",
    scheduled: "badge-warning",
    published: "badge-success",
    failed: "badge-danger",
    cancelled: "badge-neutral",
  };

  const statusIcons: Record<string, React.ReactNode> = {
    draft: <FileText size={14}/>,
    scheduled: <Clock size={14}/>,
    published: <CheckCircle2 size={14}/>,
    failed: <XCircle size={14}/>,
    cancelled: <Ban size={14}/>,
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Content & Engagement</h1>
          <p className="page-subtitle">Schedule posts and boost your reach</p>
        </div>
        <div className="flex gap-3">
          <button
            className="btn btn-secondary"
            onClick={runEngagement}
            disabled={engagementRunning}
          >
            {engagementRunning ? <><RefreshCw size={14} className="animate-spin mr-1"/> Running...</> : <><Flame size={14} className="mr-1"/> Run Engagement Session</>}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowComposer(true)}
          >
            <Plus size={14} className="mr-1"/> New Post
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Engagement Results */}
        {engagementResults && (
          <div
            className="card animate-fadeIn"
            style={{
              marginBottom: "24px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-accent)",
            }}
          >
            <div className="card-header">
              <h3 className="card-title" style={{display: "flex", alignItems: "center", gap: "8px"}}><Flame size={18}/> Engagement Session Results</h3>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setEngagementResults(null)}
              >
                ✕
              </button>
            </div>
            <div className="flex gap-6">
              <div>
                <span style={{ fontWeight: 700, fontSize: "1.5rem" }}>
                  {engagementResults.postsViewed}
                </span>{" "}
                <span className="text-muted text-sm">Posts Viewed</span>
              </div>
              <div>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: "1.5rem",
                    color: "var(--accent-primary)",
                  }}
                >
                  {engagementResults.likes}
                </span>{" "}
                <span className="text-muted text-sm">Likes</span>
              </div>
              <div>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: "1.5rem",
                    color: "var(--accent-success)",
                  }}
                >
                  {engagementResults.comments}
                </span>{" "}
                <span className="text-muted text-sm">Comments</span>
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            gap: "24px",
          }}
        >
          {/* Scheduled Posts */}
          <div>
            <div className="card" style={{ marginBottom: "24px" }}>
              <div className="card-header">
                <h3 className="card-title" style={{display: "flex", alignItems: "center", gap: "8px"}}><Calendar size={18}/> Scheduled Posts</h3>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={loadPosts}
                >
                  <RefreshCw size={14} className="mr-1"/> Refresh
                </button>
              </div>

              {posts.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "48px 24px",
                    color: "var(--text-muted)",
                  }}
                >
                  <div style={{ marginBottom: "16px", color: "var(--accent-primary)", opacity: 0.8, display: "flex", justifyContent: "center" }}>
                    <FileText size={40}/>
                  </div>
                  <p>No posts scheduled. Create your first post above!</p>
                </div>
              ) : (
                posts.map((post) => (
                  <div
                    key={post.id}
                    style={{
                      padding: "16px 0",
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div
                      className="flex items-center gap-3"
                      style={{ marginBottom: "8px" }}
                    >
                      <span className={`badge ${statusBadge[post.status]}`} style={{display: "flex", alignItems: "center", gap: "4px"}}>
                        {statusIcons[post.status]} {post.status}
                      </span>
                      <span className="text-sm text-muted">
                        {new Date(post.scheduledAt).toLocaleString()}
                      </span>
                      <span className="text-sm text-muted">•</span>
                      <span className="text-sm text-muted">{post.type}</span>
                    </div>
                    <p
                      style={{
                        fontSize: "0.9375rem",
                        lineHeight: 1.6,
                        marginBottom: "8px",
                      }}
                    >
                      {post.content.length > 180
                        ? post.content.slice(0, 180) + "..."
                        : post.content}
                    </p>
                    {post.hashtags.length > 0 && (
                      <div
                        className="flex gap-2"
                        style={{ flexWrap: "wrap", marginBottom: "8px" }}
                      >
                        {post.hashtags.map((tag) => (
                          <span
                            key={tag}
                            className="badge badge-info"
                            style={{ fontSize: "0.75rem" }}
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {post.status === "scheduled" && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleCancelPost(post.id)}
                      >
                        <Ban size={14} className="mr-1"/> Cancel
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Engagement Tools */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title" style={{display: "flex", alignItems: "center", gap: "8px"}}><Zap size={18}/> Engagement Automation</h3>
              </div>
              <div className="flex gap-3" style={{ flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary"
                  onClick={runEngagement}
                  disabled={engagementRunning}
                >
                  <ThumbsUp size={14} className="mr-1"/> Auto-Like & Comment Feed
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={replyToComments}
                  disabled={engagementRunning}
                >
                  <MessageSquare size={14} className="mr-1"/> Reply to My Post Comments
                </button>
              </div>
              <p className="text-sm text-muted" style={{ marginTop: "12px" }}>
                AI generates unique, contextual comments. Actions are spread
                naturally across the session.
              </p>
            </div>
          </div>

          {/* Sidebar — Optimal Times */}
          <div>
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Clock size={18}/> Best Posting Times
              </h3>
              {optimalTimes.map((slot) => (
                <div key={slot.day} style={{ marginBottom: "16px" }}>
                  <div
                    className="flex items-center gap-2"
                    style={{ marginBottom: "6px" }}
                  >
                    <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                      {slot.day}
                    </span>
                    <span
                      className={`badge ${slot.engagement === "high" ? "badge-success" : "badge-warning"}`}
                      style={{ fontSize: "0.6875rem" }}
                    >
                      {slot.engagement}
                    </span>
                  </div>
                  <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                    {slot.times.map((t) => (
                      <span
                        key={t}
                        className="badge badge-neutral"
                        style={{ fontSize: "0.75rem" }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Post Composer Modal */}
        {showComposer && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              backdropFilter: "blur(4px)",
            }}
          >
            <div
              className="card animate-fadeIn"
              style={{ width: "600px", maxWidth: "90vw" }}
            >
              <h2
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  marginBottom: "24px",
                  display: "flex", alignItems: "center", gap: "8px"
                }}
              >
                <PenTool size={20}/> Create Post
              </h2>

              <div className="input-group">
                <label className="input-label">Content</label>
                <textarea
                  className="input textarea"
                  rows={6}
                  placeholder="Write your LinkedIn post here..."
                  value={draft.content}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, content: e.target.value }))
                  }
                  style={{ resize: "vertical" }}
                />
                <div
                  className="text-sm text-muted"
                  style={{ marginTop: "4px" }}
                >
                  {draft.content.length} characters
                </div>
              </div>

              <div className="flex gap-4">
                <div className="input-group" style={{ flex: 1 }}>
                  <label className="input-label">Post Type</label>
                  <select
                    className="input"
                    value={draft.type}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, type: e.target.value }))
                    }
                  >
                    <option value="text">Text</option>
                    <option value="image">Image</option>
                    <option value="poll">Poll</option>
                    <option value="article">Article</option>
                  </select>
                </div>
                <div className="input-group" style={{ flex: 2 }}>
                  <label className="input-label">Schedule For</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={draft.scheduledAt}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        scheduledAt: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">
                  Hashtags (comma-separated)
                </label>
                <input
                  className="input"
                  placeholder="linkedin, automation, ai"
                  value={draft.hashtags}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, hashtags: e.target.value }))
                  }
                />
              </div>

              <div
                className="flex gap-3"
                style={{ justifyContent: "flex-end" }}
              >
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowComposer(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handlePublishNow}
                  disabled={scheduling || !draft.content.trim()}
                >
                  {scheduling ? <><RefreshCw size={14} className="animate-spin mr-1"/>...</> : <><Send size={14} className="mr-1"/> Publish Now</>}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSchedulePost}
                  disabled={
                    scheduling || !draft.content.trim() || !draft.scheduledAt
                  }
                >
                  {scheduling ? <><RefreshCw size={14} className="animate-spin mr-1"/> Scheduling...</> : <><Calendar size={14} className="mr-1"/> Schedule</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
