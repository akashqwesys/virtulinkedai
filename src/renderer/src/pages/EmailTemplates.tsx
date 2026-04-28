import { useState, useEffect } from "react";
import { 
  Hand, PartyPopper, Send, Calendar, Pencil, Plus, Mail, 
  Sparkles, Save, RefreshCw, Trash2 
} from "lucide-react";

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables_json: string;
  type: string;
  created_at: string;
  updated_at: string;
}

export default function EmailTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] =
    useState<EmailTemplate | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    id: "",
    name: "",
    subject: "",
    body: "",
    type: "intro",
    variables: "",
  });

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const data = await (window as any).api.emailTemplates.list();
      setTemplates(data || []);
      if (data?.length > 0 && !selectedTemplate) {
        setSelectedTemplate(data[0]);
      }
    } catch {
      /* ignore */
    }
  }

  function startEdit(template?: EmailTemplate) {
    if (template) {
      const variables = JSON.parse(template.variables_json || "[]");
      setDraft({
        id: template.id,
        name: template.name,
        subject: template.subject,
        body: template.body,
        type: template.type,
        variables: variables.join(", "),
      });
    } else {
      setDraft({
        id: `tpl_${Date.now()}`,
        name: "",
        subject: "",
        body: "",
        type: "intro",
        variables: "",
      });
    }
    setEditing(true);
  }

  async function handleSave() {
    if (!draft.name || !draft.subject || !draft.body) return;
    setSaving(true);
    try {
      await (window as any).api.emailTemplates.save({
        id: draft.id,
        name: draft.name,
        subject: draft.subject,
        body: draft.body,
        variables: draft.variables
          .split(",")
          .map((v: string) => v.trim())
          .filter(Boolean),
        type: draft.type,
      });
      setEditing(false);
      loadTemplates();
    } catch {
      /* ignore */
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try {
      await (window as any).api.emailTemplates.delete(id);
      if (selectedTemplate?.id === id) setSelectedTemplate(null);
      loadTemplates();
    } catch {
      /* ignore */
    }
  }

  function renderPreview(template: EmailTemplate): string {
    let preview = template.body;
    const variables = JSON.parse(template.variables_json || "[]") as string[];
    for (const v of variables) {
      preview = preview.replace(
        new RegExp(`\\{${v}\\}`, "g"),
        `<span class="var-highlight">{${v}}</span>`,
      );
    }
    return preview.replace(/\n/g, "<br>");
  }

  const typeLabels: Record<
    string,
    { label: string; icon: React.ReactNode; color: string }
  > = {
    intro: { label: "Introduction", icon: <Hand size={16}/>, color: "#6366f1" },
    welcome: { label: "Welcome", icon: <PartyPopper size={16}/>, color: "#10b981" },
    follow_up: { label: "Follow-Up", icon: <Send size={16}/>, color: "#f59e0b" },
    meeting_confirm: { label: "Meeting", icon: <Calendar size={16}/>, color: "#3b82f6" },
    custom: { label: "Custom", icon: <Pencil size={16}/>, color: "#8b5cf6" },
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Email Templates</h1>
          <p className="page-subtitle">
            Design personalized outreach sequences
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => startEdit()}>
          <Plus size={16} className="mr-1"/> New Template
        </button>
      </div>

      <div className="page-body">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px 1fr",
            gap: "24px",
            height: "calc(100vh - 200px)",
          }}
        >
          {/* Template List */}
          <div className="card" style={{ overflowY: "auto", padding: 0 }}>
            <div
              style={{
                padding: "16px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <h3 className="card-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <Mail size={18}/> Templates
              </h3>
            </div>
            {templates.length === 0 ? (
              <div
                style={{
                  padding: "40px 16px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                }}
              >
                No templates yet
              </div>
            ) : (
              templates.map((tpl) => {
                const typeInfo = typeLabels[tpl.type] || typeLabels.custom;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => {
                      setSelectedTemplate(tpl);
                      setEditing(false);
                    }}
                    style={{
                      padding: "14px 16px",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border-subtle)",
                      background:
                        selectedTemplate?.id === tpl.id
                          ? "rgba(99, 102, 241, 0.1)"
                          : "transparent",
                      transition: "background 0.15s",
                    }}
                  >
                    <div
                      className="flex items-center gap-2"
                      style={{ marginBottom: "4px" }}
                    >
                      <span style={{display: "inline-flex", width:"16px", height:"16px", alignItems: "center", justifyContent: "center", color: typeInfo.color}}>{typeInfo.icon}</span>
                      <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                        {tpl.name}
                      </span>
                    </div>
                    <div
                      className="text-sm text-muted"
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {tpl.subject}
                    </div>
                    <div
                      className="flex items-center gap-2"
                      style={{ marginTop: "6px" }}
                    >
                      <span
                        className="badge badge-neutral"
                        style={{
                          fontSize: "0.6875rem",
                          borderLeft: `3px solid ${typeInfo.color}`,
                        }}
                      >
                        {typeInfo.label}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Template Detail / Editor */}
          <div className="card" style={{ overflowY: "auto" }}>
            {editing ? (
              <>
                <h2
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    marginBottom: "24px",
                    display: "flex", alignItems: "center", gap: "8px"
                  }}
                >
                  {draft.id.startsWith("tpl_") &&
                  !templates.find((t) => t.id === draft.id)
                    ? <><Sparkles size={20}/> New Template</>
                    : <><Pencil size={20}/> Edit Template</>}
                </h2>

                <div className="flex gap-4">
                  <div className="input-group" style={{ flex: 2 }}>
                    <label className="input-label">Template Name</label>
                    <input
                      className="input"
                      placeholder="e.g. Introduction Email"
                      value={draft.name}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, name: e.target.value }))
                      }
                    />
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label className="input-label">Type</label>
                    <select
                      className="input"
                      value={draft.type}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, type: e.target.value }))
                      }
                    >
                      <option value="intro">Introduction</option>
                      <option value="welcome">Welcome</option>
                      <option value="follow_up">Follow-Up</option>
                      <option value="meeting_confirm">Meeting Confirm</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                </div>

                <div className="input-group">
                  <label className="input-label">Subject Line</label>
                  <input
                    className="input"
                    placeholder="Connecting on an idea for {company}"
                    value={draft.subject}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, subject: e.target.value }))
                    }
                  />
                </div>

                <div className="input-group">
                  <label className="input-label">Email Body</label>
                  <textarea
                    className="input textarea"
                    rows={12}
                    placeholder="Hi {firstName},...&#10;&#10;Use {variableName} for dynamic content."
                    value={draft.body}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, body: e.target.value }))
                    }
                    style={{
                      resize: "vertical",
                      fontFamily: "inherit",
                      lineHeight: 1.7,
                    }}
                  />
                </div>

                <div className="input-group">
                  <label className="input-label">
                    Variables (comma-separated)
                  </label>
                  <input
                    className="input"
                    placeholder="firstName, company, role, yourName"
                    value={draft.variables}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        variables: e.target.value,
                      }))
                    }
                  />
                  <p
                    className="text-sm text-muted"
                    style={{ marginTop: "4px" }}
                  >
                    Use these in subject/body as {"{"}
                    <code>variableName</code>
                    {"}"} — they get filled from lead profiles and your
                    settings.
                  </p>
                </div>

                <div
                  className="flex gap-3"
                  style={{ justifyContent: "flex-end" }}
                >
                  <button
                    className="btn btn-secondary"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSave}
                    disabled={
                      saving || !draft.name || !draft.subject || !draft.body
                    }
                  >
                    {saving ? <><RefreshCw size={14} className="animate-spin"/> Saving...</> : <><Save size={14}/> Save Template</>}
                  </button>
                </div>
              </>
            ) : selectedTemplate ? (
              <>
                <div
                  className="flex items-center gap-3"
                  style={{ marginBottom: "8px" }}
                >
                  <span style={{ fontSize: "1.5rem", display: "inline-flex", color: (typeLabels[selectedTemplate.type] || typeLabels.custom).color }}>
                    {
                      (typeLabels[selectedTemplate.type] || typeLabels.custom)
                        .icon
                    }
                  </span>
                  <h2 style={{ fontSize: "1.25rem", fontWeight: 700, flex: 1 }}>
                    {selectedTemplate.name}
                  </h2>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => startEdit(selectedTemplate)}
                  >
                    <Pencil size={14} className="mr-1"/> Edit
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleDelete(selectedTemplate.id)}
                    style={{ color: "var(--accent-danger)" }}
                  >
                    <Trash2 size={14} className="mr-1"/> Delete
                  </button>
                </div>

                <span
                  className="badge badge-neutral"
                  style={{
                    fontSize: "0.75rem",
                    marginBottom: "20px",
                    display: "inline-block",
                    borderLeft: `3px solid ${(typeLabels[selectedTemplate.type] || typeLabels.custom).color}`,
                  }}
                >
                  {
                    (typeLabels[selectedTemplate.type] || typeLabels.custom)
                      .label
                  }
                </span>

                <div style={{ marginBottom: "20px" }}>
                  <label
                    className="input-label"
                    style={{ marginBottom: "6px", display: "block" }}
                  >
                    Subject
                  </label>
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "var(--bg-tertiary)",
                      borderRadius: "8px",
                      fontSize: "0.9375rem",
                      fontWeight: 500,
                    }}
                  >
                    {selectedTemplate.subject}
                  </div>
                </div>

                <div style={{ marginBottom: "20px" }}>
                  <label
                    className="input-label"
                    style={{ marginBottom: "6px", display: "block" }}
                  >
                    Body Preview
                  </label>
                  <div
                    style={{
                      padding: "20px",
                      background: "var(--bg-tertiary)",
                      borderRadius: "8px",
                      fontSize: "0.9375rem",
                      lineHeight: 1.8,
                    }}
                    dangerouslySetInnerHTML={{
                      __html: renderPreview(selectedTemplate),
                    }}
                  />
                </div>

                <div>
                  <label
                    className="input-label"
                    style={{ marginBottom: "6px", display: "block" }}
                  >
                    Variables
                  </label>
                  <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                    {(
                      JSON.parse(
                        selectedTemplate.variables_json || "[]",
                      ) as string[]
                    ).map((v) => (
                      <span
                        key={v}
                        className="badge badge-info"
                        style={{ fontSize: "0.75rem" }}
                      >
                        {"{"}
                        {v}
                        {"}"}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "var(--text-muted)",
                }}
              >
                Select a template to preview
              </div>
            )}
          </div>
        </div>

        <style>{`
          .var-highlight {
            background: rgba(99, 102, 241, 0.1);
            color: var(--accent-primary);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.8125rem;
          }
        `}</style>
      </div>
    </>
  );
}
