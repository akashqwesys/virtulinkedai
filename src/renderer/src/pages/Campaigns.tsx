import { useState, useEffect, useRef } from "react";
import { 
  Rocket, Plus, Trash2, Play, Pause, Zap, BarChart2, LineChart, 
  Search, Eye, UserPlus, MessageSquare, Mail, AlertTriangle, 
  Download, Bot, User, CheckCircle2, XCircle
} from "lucide-react";

interface CampaignStep {
  id: string;
  type: "extract" | "visit" | "connect" | "message" | "email";
  name: string;
  delayHours: number;
  content?: string;
}

interface Lead {
  id: string;
  name: string;
  title: string;
  company: string;
  status: string;
  linkedinUrl?: string;
}

interface Campaign {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  description: string;
  steps: CampaignStep[];
  leads: Lead[];
  createdAt: string;
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null,
  );
  const [prioritizedSection, setPrioritizedSection] = useState<string>("none");

  // Load Settings for prioritized section
  useEffect(() => {
    async function loadSettings() {
      try {
        const settings = await (window as any).api.settings.get();
        if (settings.pipeline?.prioritizedSection) {
          setPrioritizedSection(settings.pipeline.prioritizedSection);
        }
      } catch (e) {
        console.error("Failed to load settings", e);
      }
    }
    loadSettings();
  }, []);

  const handlePrioritize = async (sectionId: string) => {
    const newPriority = prioritizedSection === sectionId ? "none" : sectionId;
    setPrioritizedSection(newPriority);
    try {
      await (window as any).api.settings.update({
        pipeline: { prioritizedSection: newPriority }
      });
    } catch (e) {
      console.error("Failed to update priority setting", e);
    }
  };

  // Detail View State
  const [activeTab, setActiveTab] = useState<
    "workflow" | "pipeline" | "analytics"
  >("workflow");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  // Creation Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignDesc, setNewCampaignDesc] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  
  const [isSavingSteps, setIsSavingSteps] = useState(false);

  // Import Profiles Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<"profiles" | "page">("profiles");
  const [importUrls, setImportUrls] = useState("");
  const [importPageUrl, setImportPageUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // Lead Summary Modal
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isRemovingLead, setIsRemovingLead] = useState(false);

  const selectedCampaignIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedCampaignIdRef.current = selectedCampaignId;
  }, [selectedCampaignId]);

  // Load real data from SQLite backend
  useEffect(() => {
    async function fetchCampaigns() {
      try {
        const data = await window.api.campaigns.list();
        setCampaigns((prev) => {
          return data.map((c: any) => {
            const existing = prev.find((p) => p.id === c.id);
            // CRITICAL: Preserve local unsaved edits for the currently active campaign
            // Otherwise, the 10-second background poll will abruptly close the Action Settings screen
            if (existing && existing.id === selectedCampaignIdRef.current) {
              return { ...c, steps: existing.steps, leads: existing.leads };
            }
            return { ...c, leads: existing ? existing.leads : [] };
          });
        });
      } catch (err) {
        console.error("Failed to load campaigns", err);
      }
    }
    fetchCampaigns();
    
    // Poll campaigns list every 10 seconds
    const interval = setInterval(fetchCampaigns, 10000);
    return () => clearInterval(interval);
  }, []);

  // Load detailed lead statuses for the active campaign
  useEffect(() => {
    if (!selectedCampaignId) return;
    
    async function refreshActiveCampaign() {
      try {
        const details = await window.api.campaigns.getStatus(selectedCampaignId!);
        if (details) {
          setCampaigns(prev => prev.map(c => {
            if (c.id === selectedCampaignId) {
              // Parse lead profiles from the database rows (now unified in the backend)
              const parsedLeads = details.leads.map((l: any) => {
                return {
                  id: l.id,
                  name: l.firstName ? `${l.firstName} ${l.lastName}`.trim() : (l.linkedinUrl || "").split('/').pop() || "Unknown",
                  title: l.role || "Unknown Title",
                  company: l.company || "Unknown Company",
                  status: l.status,
                  linkedinUrl: l.linkedinUrl,
                  location: l.location || "",
                  about: l.about || "",
                  connectionDegree: l.connectionDegree || "3rd",
                  experience: l.experience || [],
                  education: l.education || [],
                  skills: l.skills || []
                };
              });
              // CRITICAL FIX: Only update the leads and DB-level campaign details (like status/name), 
              // but DO NOT overwrite the local `steps` array so the user's active UI session is not immediately closed!
              return { 
                ...c, 
                status: details.campaign.status,
                name: details.campaign.name, 
                description: details.campaign.description,
                leads: parsedLeads 
              };
            }
            return c;
          }));
        }
      } catch (err) {
        console.error("Failed to refresh active campaign", err);
      }
    }
    
    refreshActiveCampaign();
    // Fast polling for realtime pipeline movement (jobQueue runs every 5s)
    const interval = setInterval(refreshActiveCampaign, 3000);
    return () => clearInterval(interval);
  }, [selectedCampaignId]);

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);
  const selectedStep = selectedCampaign?.steps.find(
    (s) => s.id === selectedStepId,
  );

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setNewCampaignName("");
    setNewCampaignDesc("");
    setCreateError(null);
    setIsCreating(false);
  };

  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim() || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await window.api.campaigns.create({
        name: newCampaignName,
        description: newCampaignDesc,
        leadUrls: [] // Can be updated later or via import
      });
      if (res.success) {
        closeCreateModal();
        // Reload list
        const data = await window.api.campaigns.list();
        setCampaigns(data.map((c: any) => ({ ...c, leads: [] })));
        setSelectedCampaignId(res.campaignId);
        setActiveTab("workflow");
      } else {
        setCreateError("Failed to create campaign. Please try again.");
        setIsCreating(false);
      }
    } catch (e) {
      console.error("Failed to create campaign", e);
      setCreateError("An error occurred. Please try again.");
      setIsCreating(false);
    }
  };

  const handleImportProfiles = async () => {
    if (!importUrls.trim() || !selectedCampaignId || isImporting) return;
    setIsImporting(true);
    setImportResult(null);
    try {
      const urls = importUrls
        .split("\n")
        .map(u => u.trim())
        .filter(u => u.length > 0 && u.includes("linkedin.com"));
      if (urls.length === 0) {
        setImportResult("❌ No valid LinkedIn URLs found. Paste one URL per line.");
        setIsImporting(false);
        return;
      }
      const res = await (window as any).api.campaigns.addLeads({
        campaignId: selectedCampaignId,
        leadUrls: urls,
      });
      if (res.success) {
        setImportResult(`✅ Added ${res.added} lead(s).${res.duplicates > 0 ? ` ${res.duplicates} duplicate(s) skipped.` : ""}`);
        setImportUrls("");
        setShowImportModal(false);
        setImportResult(null);
      } else {
        setImportResult("❌ Failed to import leads.");
      }
    } catch (e) {
      console.error("Import failed", e);
      setImportResult("❌ An error occurred while importing.");
    }
    setIsImporting(false);
  };

  const handlePageImport = async () => {
    if (!importPageUrl.trim() || !selectedCampaignId || isImporting) return;
    
    let urlToImport = importPageUrl.trim();
    
    if (!urlToImport.startsWith("http")) {
      setImportResult(`🔍 Will perform human-centric search for "${urlToImport}"...`);
      // Do NOT convert to a direct URL here. Let the backend handle the physical search bar typing.
    } else if (!urlToImport.includes("linkedin.com")) {
      setImportResult("❌ Please enter a valid LinkedIn URL (search results, company page, or alumni page) or a search keyword.");
      return;
    }

    setIsImporting(true);
    setImportResult("🔍 Scanning page... This may take 30–60 seconds. You can close this modal.");

    // Close modal after a short delay so user knows it's running in background
    setTimeout(() => {
      setShowImportModal(false);
      setImportPageUrl("");
    }, 1500);

    // Run the actual import asynchronously without blocking
    try {
      const res = await (window as any).api.campaigns.importFromPage({
        campaignId: selectedCampaignId,
        pageUrl: urlToImport,
      });
      if (res.success) {
        setImportResult(`✅ AI imported ${res.added} lead(s) from the page.${res.matched > 0 ? ` ${res.matched} matched existing leads.` : ""}${res.duplicates > 0 ? ` ${res.duplicates} duplicate(s) skipped.` : ""}`);
      } else {
        setImportResult(`❌ ${res.error || "Failed to import from page. Make sure the browser is running and you are logged into LinkedIn."}`);
      }
    } catch (e) {
      console.error("Page import failed", e);
      setImportResult("❌ An error occurred. Make sure the browser is running and you are logged into LinkedIn.");
    }
    setIsImporting(false);
  };


  const handleDeleteCampaign = async (campaignId: string) => {
    if (!window.confirm("⚠️ ARE YOU SURE? This will permanently delete the campaign and ALL associated leads and history. This cannot be undone.")) return;
    try {
      const res = await (window as any).api.campaigns.delete(campaignId);
      if (res.success) {
        setCampaigns(campaigns.filter(c => c.id !== campaignId));
        setSelectedCampaignId(null);
      } else {
        alert("Error deleting campaign: " + res.error);
      }
    } catch (e) {
      console.error("Delete failed", e);
      alert("An unexpected error occurred.");
    }
  };

  const addStep = (type: CampaignStep["type"]) => {
    if (!selectedCampaign) return;
    const newStep: CampaignStep = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      name: `New ${type.charAt(0).toUpperCase() + type.slice(1)} Action`,
      delayHours: selectedCampaign.steps.length === 0 ? 0 : 24,
      content: ["connect", "message", "email"].includes(type) ? "" : undefined,
    };
    const updated = {
      ...selectedCampaign,
      steps: [...selectedCampaign.steps, newStep],
    };
    setCampaigns(campaigns.map((c) => (c.id === updated.id ? updated : c)));
    setSelectedStepId(newStep.id);
  };

  const updateStep = (updates: Partial<CampaignStep>) => {
    if (!selectedCampaign || !selectedStepId) return;
    const updatedSteps = selectedCampaign.steps.map((s) =>
      s.id === selectedStepId ? { ...s, ...updates } : s,
    );
    const updated = { ...selectedCampaign, steps: updatedSteps };
    setCampaigns(campaigns.map((c) => (c.id === updated.id ? updated : c)));
  };

  const removeStep = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedCampaign) return;
    const updatedSteps = selectedCampaign.steps.filter((s) => s.id !== id);
    const updated = { ...selectedCampaign, steps: updatedSteps };
    setCampaigns(campaigns.map((c) => (c.id === updated.id ? updated : c)));
    if (selectedStepId === id) setSelectedStepId(null);
  };

  const handleSaveSteps = async () => {
    if (!selectedCampaign || isSavingSteps) return;
    setIsSavingSteps(true);
    try {
      await (window as any).api.campaigns.update({
        campaignId: selectedCampaign.id,
        updates: {
          name: selectedCampaign.name,
          description: selectedCampaign.description,
          steps: selectedCampaign.steps
        }
      });
    } catch (e) {
      console.error("Failed to save campaign updates", e);
    }
    setTimeout(() => setIsSavingSteps(false), 500);
  };

  const stepIcons = {
    extract: <Search size={16} />,
    visit: <Eye size={16} />,
    connect: <UserPlus size={16} />,
    message: <MessageSquare size={16} />,
    email: <Mail size={16} />,
  };

  // --- RENDERING VIEWS ---

  if (!selectedCampaign) {
    return (
      <div style={{ padding: "32px", height: "100%", overflow: "auto" }}>
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-2">Campaigns</h1>
            <p className="text-muted">
              Manage your outreach workflows inspired by LinkedHelper
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => { setShowCreateModal(true); setCreateError(null); }}
          >
            <Plus size={16} /> New Campaign
          </button>
        </div>

        {campaigns.length === 0 ? (
          <div className="card text-center" style={{ padding: "80px 20px" }}>
            <div style={{ marginBottom: "16px", color: "var(--accent-primary)", display: "flex", justifyContent: "center" }}><Rocket size={48} /></div>
            <h3 className="text-xl font-bold mb-2">Ready to automate?</h3>
            <p className="text-muted mb-6">
              Create your first LinkedHelper-style workflow.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
            >
              Create Campaign
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className="card"
                style={{
                  cursor: "pointer",
                  transition: "transform 0.2s",
                }}
                onClick={() => {
                  setSelectedCampaignId(campaign.id);
                  setActiveTab("pipeline"); // Switch directly to pipeline to see the magic
                  setSelectedStepId(campaign.steps?.length ? campaign.steps[0].id : null);
                }}
              >
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold truncate pr-4">
                    {campaign.name}
                  </h3>
                  <span
                    className={`px-2 py-1 rounded text-xs font-bold uppercase ${campaign.status === "active" ? "badge-success" : "badge-neutral"}`}
                    style={{ border: "none" }}
                  >
                    {campaign.status}
                  </span>
                  <button 
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: "8px", background: "rgba(239, 68, 68, 0.1)", color: "var(--accent-danger)", border: "1px solid rgba(239, 68, 68, 0.2)" }}
                    onClick={(e) => { e.stopPropagation(); handleDeleteCampaign(campaign.id); }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-sm text-muted mb-4 line-clamp-2">
                  {campaign.description || "No description"}
                </p>
                <div className="flex justify-between text-sm py-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <div className="text-center">
                    <div className="font-bold text-lg">
                      {campaign.steps.length}
                    </div>
                    <div className="text-muted text-xs uppercase">Actions</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-lg">
                      {campaign.leads.length}
                    </div>
                    <div className="text-muted text-xs uppercase">Leads</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-lg text-emerald-600">
                      {
                        campaign.leads.filter(
                          (l) =>
                            l.status === "connected" ||
                            l.status === "meeting_booked",
                        ).length
                      }
                    </div>
                    <div className="text-muted text-xs uppercase">Success</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create Modal */}
        {showCreateModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
            onClick={(e) => { if (e.target === e.currentTarget && !isCreating) closeCreateModal(); }}
          >
            <div className="card" style={{ width: "450px" }}>
              <h2 className="text-xl font-bold mb-4">Create New Campaign</h2>
              <div className="mb-4">
                <label className="block text-sm font-semibold mb-2">
                  Campaign Name
                </label>
                <input
                  className="input"
                  style={{ width: "100%" }}
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  placeholder="e.g. CEO Outreach"
                  autoFocus
                  disabled={isCreating}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateCampaign(); }}
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-semibold mb-2">
                  Description
                </label>
                <textarea
                  className="input textarea"
                  style={{ width: "100%" }}
                  value={newCampaignDesc}
                  onChange={(e) => setNewCampaignDesc(e.target.value)}
                  placeholder="Campaign goals..."
                  rows={3}
                  disabled={isCreating}
                />
              </div>
              {createError && (
                <div style={{
                  marginBottom: "12px",
                  padding: "10px 14px",
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                  borderRadius: "8px",
                  color: "var(--accent-danger)",
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}>
                  <AlertTriangle size={14} /> {createError}
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  className="btn btn-secondary"
                  onClick={closeCreateModal}
                  disabled={isCreating}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateCampaign}
                  disabled={!newCampaignName.trim() || isCreating}
                  style={{ minWidth: "140px" }}
                >
                  {isCreating ? "Creating..." : "Continue to Workflow"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- DETAIL VIEW (Campaign Selected) ---
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--bg-primary)",
      }}
    >
      {/* Detail Header */}
      <div
        style={{
          padding: "24px 32px 0 32px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-secondary)",
        }}
      >
        <button
          className="btn btn-sm btn-secondary mb-4"
          onClick={() => setSelectedCampaignId(null)}
        >
          ← Back to Campaigns
        </button>
        <div className="flex justify-between items-end mb-6">
          <div>
            <h1 className="text-2xl font-bold">{selectedCampaign.name}</h1>
            <p className="text-muted">{selectedCampaign.description}</p>
          </div>
          <div className="flex gap-3">
            <button className="btn btn-secondary" onClick={() => { setShowImportModal(true); setImportResult(null); }}>Import Profiles</button>
            <button
              className={`btn ${selectedCampaign.status === "active" ? "btn-secondary" : "btn-primary"}`}
              onClick={async () => {
                if (selectedCampaign.status === "active") {
                  await window.api.campaigns.pause(selectedCampaign.id);
                } else {
                  await window.api.campaigns.start(selectedCampaign.id);
                }
                const data = await window.api.campaigns.list();
                setCampaigns(data.map((c: any) => ({ ...c, leads: c.id === selectedCampaign.id ? selectedCampaign.leads : [] })));
              }}
            >
              {selectedCampaign.status === "active"
                ? <><Pause size={14} /> Pause Campaign</>
                : <><Play size={14} /> Start Campaign</>}
            </button>
            <button
               className="btn btn-danger"
               onClick={() => handleDeleteCampaign(selectedCampaign.id)}
            >
               <Trash2 size={14} className="mr-1"/> Delete
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "-1px" }}>
          {([
            { key: "workflow", label: "Workflow", icon: <Zap size={14} /> },
            { key: "pipeline", label: "Pipeline", icon: <BarChart2 size={14} /> },
            { key: "analytics", label: "Analytics", icon: <LineChart size={14} /> },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "10px 20px",
                fontWeight: 600,
                fontSize: "0.875rem",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: activeTab === tab.key ? "var(--accent-primary)" : "var(--bg-elevated)",
                color: activeTab === tab.key ? "#fff" : "var(--text-secondary)",
                border: activeTab === tab.key ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                borderRadius: "8px 8px 0 0",
                borderBottom: activeTab === tab.key ? "none" : "1px solid var(--border-subtle)",
                cursor: "pointer",
                transition: "all 0.18s ease",
              }}
            >
              <span style={{ fontSize: "14px" }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {activeTab === "workflow" && (
          <div style={{ display: "flex", height: "100%" }}>
            {/* Left: Sequence List */}
            <div
              style={{
                width: "380px",
                borderRight: "1px solid var(--border-subtle)",
                background: "var(--bg-card)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: "16px",
                  background: "var(--bg-secondary)",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <h3 className="font-bold text-sm uppercase text-muted tracking-wider">
                  Automation Sequence
                </h3>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
                {selectedCampaign.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    style={{ display: "flex", marginBottom: "12px" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        marginRight: "16px",
                      }}
                    >
                      <div
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          background:
                            selectedStepId === step.id
                              ? "var(--accent-primary)"
                              : "var(--bg-card)",
                          border:
                            selectedStepId === step.id
                              ? "none"
                              : "2px solid var(--border-primary)",
                          color:
                            selectedStepId === step.id ? "white" : "inherit",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: "bold",
                          fontSize: "12px",
                          zIndex: 2,
                        }}
                      >
                        {idx + 1}
                      </div>
                      {idx !== selectedCampaign.steps.length - 1 && (
                        <div
                          style={{
                            width: "2px",
                            flex: 1,
                            background: "var(--border-subtle)",
                            margin: "4px 0",
                          }}
                        />
                      )}
                    </div>

                    <div
                      className="card flex-1"
                      style={{
                        padding: "16px",
                        cursor: "pointer",
                        border:
                          selectedStepId === step.id
                            ? "2px solid var(--accent-primary)"
                            : "1px solid var(--border-subtle)",
                        boxShadow:
                          selectedStepId === step.id
                            ? "0 4px 12px var(--accent-primary-glow)"
                            : "none",
                      }}
                      onClick={() => setSelectedStepId(step.id)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-semibold flex items-center gap-2">
                          <span>{stepIcons[step.type]}</span>
                          {step.name}
                        </div>
                        <button
                          style={{ color: "var(--text-muted)", transition: "color 0.2s" }}
                          onMouseOver={(e) => (e.currentTarget.style.color = "var(--accent-danger)")}
                          onMouseOut={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                          onClick={(e) => removeStep(step.id, e)}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="text-xs font-medium text-muted">
                        Delay: {step.delayHours} hours
                      </div>
                    </div>
                  </div>
                ))}

                <div
                  style={{
                    marginTop: "24px",
                    padding: "16px",
                    border: "2px dashed var(--border-subtle)",
                    borderRadius: "8px",
                    textAlign: "center",
                  }}
                >
                  <div className="text-sm font-bold text-muted mb-3">
                    ADD ACTION
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ fontSize: "12px", padding: "6px" }}
                      onClick={() => addStep("extract")}
                    >
                      <Search size={14} className="mr-1"/> Extract
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ fontSize: "12px", padding: "6px" }}
                      onClick={() => addStep("visit")}
                    >
                      <Eye size={14} className="mr-1"/> Visit
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ fontSize: "12px", padding: "6px" }}
                      onClick={() => addStep("connect")}
                    >
                      <UserPlus size={14} className="mr-1"/> Connect
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ fontSize: "12px", padding: "6px" }}
                      onClick={() => addStep("message")}
                    >
                      <MessageSquare size={14} className="mr-1"/> Message
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ fontSize: "12px", padding: "6px" }}
                      onClick={() => addStep("email")}
                    >
                      <Mail size={14} className="mr-1"/> Email
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Action Settings */}
            <div style={{ flex: 1, padding: "32px", overflowY: "auto" }}>
              {selectedStep ? (
                <div style={{ maxWidth: "600px" }}>
                  <div className="flex items-center gap-3 mb-6">
                    <span style={{ fontSize: "32px" }}>
                      {stepIcons[selectedStep.type]}
                    </span>
                    <h2 className="text-2xl font-bold">Action Settings</h2>
                  </div>

                  <div className="card mb-6">
                    <h3 className="font-bold mb-4 pb-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      General
                    </h3>
                    <div className="mb-4">
                      <label className="block text-sm font-semibold mb-2">
                        Action Name
                      </label>
                      <input
                        className="input w-full"
                        value={selectedStep.name}
                        onChange={(e) => updateStep({ name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">
                        Execution Delay (Hours)
                      </label>
                      <input
                        type="number"
                        className="input w-full"
                        value={selectedStep.delayHours}
                        onChange={(e) =>
                          updateStep({ delayHours: Number(e.target.value) })
                        }
                      />
                      <p className="text-xs text-muted mt-1">
                        Wait time after the previous action completes.
                      </p>
                    </div>
                  </div>

                  {selectedStep.content !== undefined && (
                    <div className="card">
                      <h3 className="font-bold mb-4 pb-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        Templates & Content
                      </h3>
                      <label className="block text-sm font-semibold mb-2">
                        Message Content
                      </label>
                      <textarea
                        className="input textarea w-full font-mono text-sm"
                        rows={6}
                        value={selectedStep.content}
                        onChange={(e) =>
                          updateStep({ content: e.target.value })
                        }
                        placeholder="Hi {first_name}, I saw you work at {company}..."
                      />
                      <div
                        className="flex gap-2 mt-4 text-xs font-semibold text-muted"
                      >
                        Variables:
                        {["{first_name}", "{last_name}", "{company}"].map((v) => (
                          <span
                            key={v}
                            style={{
                              background: "var(--bg-elevated)",
                              padding: "4px 8px",
                              borderRadius: "4px",
                              cursor: "pointer",
                              border: "1px solid var(--border-subtle)"
                            }}
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-8 flex justify-end">
                    <button 
                      className="btn btn-primary"
                      onClick={handleSaveSteps}
                      disabled={isSavingSteps}
                    >
                      {isSavingSteps ? "Saving..." : "Save Action Settings"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center height-full text-muted">
                  <div className="text-center">
                    <p className="text-xl mb-2">👈 Select an action</p>
                    <p className="text-sm">
                      Click an action in the sequence to configure it.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Kanban Board Pipeline Tab */}
        {activeTab === "pipeline" && (
          <div
            style={{
              padding: "32px",
              height: "100%",
              overflowX: "auto",
              display: "flex",
              gap: "24px",
            }}
          >
            {/* Real mapped Backend DB States */}
            {[
              { id: "queue", name: "Queue", statusFilter: ["queued", "profile_scraped"] },
              { id: "connecting", name: "Connecting", statusFilter: ["connection_requested", "connection_sent"] },
              { id: "connected", name: "Connected", statusFilter: ["connection_accepted"] },
              { id: "engaged", name: "Engaged", statusFilter: ["email_sent", "welcome_sent", "follow_up_sent", "replied", "in_conversation"] },
              { id: "meeting", name: "Meeting Booked", statusFilter: ["meeting_booked", "converted"] }
            ].map((col) => {
              const colLeads = selectedCampaign.leads.filter((l) =>
                col.statusFilter.includes(l.status),
              );
              
              const statusColors = {
                queue: "border-gray-500",
                connecting: "border-blue-500",
                connected: "border-purple-500",
                engaged: "border-orange-500",
                meeting: "border-emerald-500",
              };

              return (
                <div
                  key={col.id}
                  style={{
                    width: "240px",
                    minWidth: "240px",
                    display: "flex",
                    flexDirection: "column",
                    background: "rgba(255, 255, 255, 0.02)",
                    borderRadius: "12px",
                    padding: "12px",
                    border: "1px solid var(--border-subtle)",
                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.05)"
                  }}
                >
                  <div className="flex justify-between items-center mb-4 px-1 gap-2">
                    <div className="flex items-center gap-2">
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: col.id === 'queue' ? 'var(--text-muted)' : col.id === 'meeting' ? 'var(--accent-success)' : 'var(--accent-primary)' }}></div>
                      <h3 className="font-bold text-sm" style={{ color: "var(--text-main)", letterSpacing: "0.2px" }}>
                        {col.name}
                      </h3>
                      <span className="bg-white/10 px-1.5 text-[10px] font-bold rounded-full py-0 text-muted border border-white/5">
                        {colLeads.length}
                      </span>
                    </div>
                    {col.id !== "meeting" && (
                      <button
                        onClick={() => handlePrioritize(col.id)}
                        style={{
                          padding: "3px 8px",
                          fontSize: "10px",
                          fontWeight: "600",
                          borderRadius: "12px",
                          cursor: "pointer",
                          transition: "all 0.2s",
                          backgroundColor: prioritizedSection === col.id ? "rgba(99, 102, 241, 0.15)" : "transparent",
                          color: prioritizedSection === col.id ? "var(--accent-primary)" : "var(--text-muted)",
                          border: `1px solid ${prioritizedSection === col.id ? "var(--accent-primary)" : "transparent"}`,
                        }}
                        onMouseOver={(e) => { if (prioritizedSection !== col.id) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                        onMouseOut={(e) => { if (prioritizedSection !== col.id) e.currentTarget.style.background = "transparent"; }}
                        title={prioritizedSection === col.id ? "Disable Priority" : "Prioritize this section"}
                      >
                        {prioritizedSection === col.id ? "★ Prioritized" : "☆ Prioritize"}
                      </button>
                    )}
                  </div>

                  <div
                    style={{
                      flex: 1,
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      paddingRight: "4px"
                    }}
                  >
                    {colLeads.map((lead) => (
                      <div
                        key={lead.id}
                        className={`card hover-lift ${statusColors[col.id as keyof typeof statusColors]}`}
                        style={{ 
                          padding: "12px", 
                          cursor: "pointer", 
                          borderLeftWidth: "3px",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                          background: "var(--bg-card)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          transition: "transform 0.2s, box-shadow 0.2s"
                        }}
                        onMouseOver={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                        onMouseOut={(e) => e.currentTarget.style.transform = "none"}
                        onClick={() => setSelectedLead(lead)}
                      >
                        <div className="font-bold" style={{ color: "var(--text-main)", fontSize: "13px", lineHeight: "1.2", wordBreak: "break-word" }}>
                          {lead.name}
                        </div>
                        <div
                          className="text-muted"
                          style={{ fontSize: "11px", lineHeight: "1.3" }}
                        >
                          {lead.title}
                        </div>
                        <div
                          style={{ color: "var(--text-secondary)", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
                        >
                          <span style={{ opacity: 0.6, fontSize: "12px" }}>🏢</span> 
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lead.company}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "2px" }}>
                          <span 
                            style={{ 
                              fontSize: "9px",
                              fontWeight: "bold",
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                              padding: "3px 6px",
                              borderRadius: "6px",
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              color: "var(--text-muted)"
                            }}
                          >
                            {lead.status.replace(/_/g, " ")}
                          </span>
                        </div>
                      </div>
                    ))}
                    {colLeads.length === 0 && (
                      <div
                        className="text-center text-sm py-12 rounded-xl text-muted font-medium"
                        style={{ border: "1px dashed var(--border-subtle)", background: "rgba(0,0,0,0.15)" }}
                      >
                        No leads in {col.name}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === "analytics" && (() => {
          const leads = selectedCampaign ? selectedCampaign.leads : [];
          const total = leads.length;
          const connected = leads.filter(l => ["connection_accepted", "email_sent", "welcome_sent", "follow_up_sent", "replied", "in_conversation", "meeting_booked", "converted"].includes(l.status)).length;
          const replied = leads.filter(l => ["replied", "in_conversation", "meeting_booked", "converted"].includes(l.status)).length;
          const meetings = leads.filter(l => ["meeting_booked", "converted"].includes(l.status)).length;
          
          return (
          <div style={{ padding: "32px" }}>
            <div style={{ display: "flex", gap: "24px", marginBottom: "32px", width: "100%" }}>
              <div className="card" style={{ flex: 1, borderTop: "4px solid #3b82f6", padding: "24px", background: "var(--bg-tertiary)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", marginBottom: "8px" }}>
                  Processed
                </h4>
                <div className="text-4xl font-bold" style={{ color: "var(--text-main)" }}>{total}</div>
              </div>
              <div className="card" style={{ flex: 1, borderTop: "4px solid #a855f7", padding: "24px", background: "var(--bg-tertiary)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", marginBottom: "8px" }}>
                  Connection Rate
                </h4>
                <div className="text-4xl font-bold" style={{ color: "var(--text-main)" }}>{total > 0 ? ((connected / total) * 100).toFixed(1) : "0.0"}%</div>
              </div>
              <div className="card" style={{ flex: 1, borderTop: "4px solid #f97316", padding: "24px", background: "var(--bg-tertiary)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", marginBottom: "8px" }}>
                  Reply Rate
                </h4>
                <div className="text-4xl font-bold" style={{ color: "var(--text-main)" }}>{total > 0 ? ((replied / total) * 100).toFixed(1) : "0.0"}%</div>
              </div>
              <div className="card" style={{ flex: 1, borderTop: "4px solid #10b981", padding: "24px", background: "var(--bg-tertiary)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", marginBottom: "8px" }}>
                  Meetings
                </h4>
                <div className="text-4xl font-bold" style={{ color: "var(--text-main)" }}>{meetings}</div>
              </div>
            </div>

            <div
              className="card"
              style={{
                height: "400px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div className="text-center text-muted">
                <BarChart2 size={48} style={{ margin: "0 auto 16px auto", opacity: 0.5 }} />
                <p className="text-lg font-semibold">
                  Detailed charts will appear here once the campaign runs.
                </p>
              </div>
            </div>
          </div>
        )})()}
      </div>

      {/* Import Profiles Modal */}
      {showImportModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            backdropFilter: "blur(4px)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !isImporting) { setShowImportModal(false); setImportResult(null); } }}
        >
          <div
            style={{
              background: "var(--bg-card)",
              borderRadius: "16px",
              padding: "28px",
              width: "min(580px, 92vw)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}><Download size={20} /> Import Leads</h3>
              <button
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
                onClick={() => { setShowImportModal(false); setImportResult(null); }}
                disabled={isImporting}
              ><XCircle size={20}/></button>
            </div>

            {/* Mode Toggle */}
            <div style={{ display: "flex", gap: "6px", marginBottom: "20px", background: "var(--bg-elevated)", padding: "4px", borderRadius: "10px" }}>
              <button
                onClick={() => { setImportMode("profiles"); setImportResult(null); }}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: "7px", border: "none",
                  fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", transition: "all 0.18s",
                  background: importMode === "profiles" ? "var(--accent-primary)" : "transparent",
                  color: importMode === "profiles" ? "#fff" : "var(--text-muted)",
                }}
              ><span style={{display:"flex", alignItems:"center", gap:"6px", justifyContent: "center"}}><User size={14}/> Profile URLs</span></button>
              <button
                onClick={() => { setImportMode("page"); setImportResult(null); }}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: "7px", border: "none",
                  fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", transition: "all 0.18s",
                  background: importMode === "page" ? "var(--accent-primary)" : "transparent",
                  color: importMode === "page" ? "#fff" : "var(--text-muted)",
                }}
              ><span style={{display:"flex", alignItems:"center", gap:"6px", justifyContent: "center"}}><Bot size={14}/> AI Page Import</span></button>
            </div>

            {/* Profile URLs Mode */}
            {importMode === "profiles" && (
              <>
                <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "12px", lineHeight: 1.5 }}>
                  Paste individual LinkedIn profile URLs — one per line. Each will be scraped and added as a lead to this campaign.
                </p>
                <textarea
                  className="input"
                  rows={7}
                  placeholder={"https://www.linkedin.com/in/username1/\nhttps://www.linkedin.com/in/username2/"}
                  value={importUrls}
                  onChange={(e) => setImportUrls(e.target.value)}
                  disabled={isImporting}
                  style={{ width: "100%", resize: "vertical", marginBottom: "12px", fontFamily: "monospace", fontSize: "0.8125rem" }}
                />
              </>
            )}

            {/* AI Page Import Mode */}
            {importMode === "page" && (
              <>
                <div style={{
                  padding: "12px 14px", marginBottom: "14px", borderRadius: "10px",
                  background: "rgba(99, 102, 241, 0.07)", border: "1px solid rgba(99, 102, 241, 0.2)",
                  fontSize: "0.8125rem", lineHeight: 1.6, color: "var(--text-secondary)",
                }}>
                  <strong style={{ color: "var(--accent-primary)", display: "flex", alignItems: "center", gap: "6px" }}><Bot size={16}/> AI-Powered Bulk Import</strong><div style={{marginTop:"4px"}}/>
                  Paste a LinkedIn <strong>search results page</strong>, <strong>company "People" page</strong>, or <strong>alumni page</strong> URL.
                  The AI will automatically:
                  <ul style={{ marginTop: "8px", paddingLeft: "18px", color: "var(--text-muted)", marginBottom: 0 }}>
                    <li>Extract all visible profiles from the page</li>
                    <li>Match candidates against existing leads by role, company &amp; description</li>
                    <li>Add new qualified leads directly to this campaign</li>
                  </ul>
                </div>
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "8px" }}>
                  Supported: <code style={{ opacity: 0.8 }}>linkedin.com/search/results/people/...</code> · <code style={{ opacity: 0.8 }}>linkedin.com/company/.../people</code>
                </p>
                <input
                  className="input"
                  placeholder="https://www.linkedin.com/search/results/people/?keywords=CTO&..."
                  value={importPageUrl}
                  onChange={(e) => setImportPageUrl(e.target.value)}
                  disabled={isImporting}
                  style={{ width: "100%", marginBottom: "8px", fontFamily: "monospace", fontSize: "0.8125rem" }}
                />
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "12px" }}>
                  ⚠️ Browser must be running and logged into LinkedIn.
                </p>
              </>
            )}

            {/* Result Banner */}
            {importResult && (
              <div style={{
                padding: "10px 14px", marginBottom: "12px", borderRadius: "8px", fontSize: "0.8125rem", lineHeight: 1.5,
                background: importResult.startsWith("✅") ? "rgba(5, 150, 105, 0.08)" : "rgba(220, 38, 38, 0.08)",
                border: importResult.startsWith("✅") ? "1px solid rgba(5, 150, 105, 0.2)" : "1px solid rgba(220, 38, 38, 0.2)",
                color: importResult.startsWith("✅") ? "var(--accent-success)" : "var(--accent-danger)",
              }}>
                {importResult}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => { setShowImportModal(false); setImportResult(null); }} disabled={isImporting}>
                Cancel
              </button>
              {importMode === "profiles" ? (
                <button className="btn btn-primary" onClick={handleImportProfiles} disabled={!importUrls.trim() || isImporting} style={{ minWidth: "140px" }}>
                  {isImporting ? <><Zap size={14} className="animate-spin"/> Importing...</> : <><Download size={14}/> Import Profiles</>}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handlePageImport} disabled={!importPageUrl.trim() || isImporting} style={{ minWidth: "160px" }}>
                  {isImporting ? <><Bot size={14} className="animate-pulse"/> AI Scanning...</> : <><Bot size={14}/> Import from Page</>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lead Summary Modal */}
      {selectedLead && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            backdropFilter: "blur(4px)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !isRemovingLead) setSelectedLead(null); }}
        >
          <div
            style={{
              background: "var(--bg-card)",
              borderRadius: "16px",
              padding: "24px",
              width: "min(400px, 92vw)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}><User size={20}/> Lead Summary</h3>
              <button
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
                onClick={() => setSelectedLead(null)}
                disabled={isRemovingLead}
              ><XCircle size={20}/></button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
              <div>
                <span className="text-xs text-muted font-bold uppercase">Name</span>
                <div className="font-semibold flex items-center gap-2">
                   {selectedLead.name}
                   <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">{selectedLead.connectionDegree}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                   <span className="text-xs text-muted font-bold uppercase">Headline</span>
                   <div style={{ fontSize: "0.875rem", opacity: 0.9 }}>{selectedLead.title}</div>
                 </div>
                 <div>
                   <span className="text-xs text-muted font-bold uppercase">Company</span>
                   <div style={{ fontSize: "0.875rem", opacity: 0.9 }}>{selectedLead.company}</div>
                 </div>
              </div>
              
              {selectedLead.location && (
                 <div>
                   <span className="text-xs text-muted font-bold uppercase">Location</span>
                   <div style={{ fontSize: "0.875rem", opacity: 0.9 }}>📍 {selectedLead.location}</div>
                 </div>
              )}
              
              {selectedLead.about && (
                 <div>
                   <span className="text-xs text-muted font-bold uppercase">About</span>
                   <div 
                      style={{ fontSize: "0.8125rem", opacity: 0.8, background: "var(--bg-elevated)", padding: "10px", borderRadius: "8px", maxHeight: "150px", overflowY: "auto", whiteSpace: "pre-wrap" }}
                   >
                     {selectedLead.about}
                   </div>
                 </div>
              )}

              {selectedLead.experience && selectedLead.experience.length > 0 && (
                 <div>
                   <span className="text-xs text-muted font-bold uppercase">Selected Experience</span>
                   <div style={{ fontSize: "0.875rem", opacity: 0.9, display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                     {selectedLead.experience.slice(0, 2).map((exp: any, i: number) => (
                       <div key={i} className="pl-3 border-l-2 border-[var(--border-primary)]">
                         <div className="font-bold text-sm">{exp.title}</div>
                         <div className="text-xs opacity-75">{exp.company} • {exp.duration}</div>
                       </div>
                     ))}
                   </div>
                 </div>
              )}

              {selectedLead.linkedinUrl && (
                 <div>
                   <span className="text-xs text-muted font-bold uppercase">LinkedIn</span>
                   <div style={{ fontSize: "0.8125rem", opacity: 0.8, wordBreak: "break-all" }}>
                     <a href={selectedLead.linkedinUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent-primary)", textDecoration: "none" }}>{selectedLead.linkedinUrl}</a>
                   </div>
                 </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
              <button
                className="btn btn-secondary"
                style={{ color: "var(--accent-danger)", borderColor: "rgba(220,38,38,0.4)", background: "rgba(220,38,38,0.06)" }}
                onClick={async () => {
                  // Escalating warning message based on pipeline stage
                  const advancedStatuses = ["connection_accepted", "email_sent", "welcome_sent", "follow_up_sent", "replied", "in_conversation", "meeting_booked", "converted"];
                  const midStatuses = ["connection_requested", "connection_sent"];
                  let confirmMsg = `Remove "${selectedLead.name}" from the pipeline?`;

                  if (advancedStatuses.includes(selectedLead.status)) {
                    confirmMsg = `⚠️ WARNING: "${selectedLead.name}" is currently in an active stage (${selectedLead.status.replace(/_/g, " ")}).\n\nRemoving this lead will permanently delete all their data, conversation history, and cancel any pending automation jobs.\n\nThis CANNOT be undone. Continue?`;
                  } else if (midStatuses.includes(selectedLead.status)) {
                    confirmMsg = `Remove "${selectedLead.name}" from the pipeline?\n\nThis will cancel the pending connection request job and delete all associated data.`;
                  }

                  if (!window.confirm(confirmMsg)) return;

                  setIsRemovingLead(true);
                  try {
                    const res = await (window as any).api.leads.delete(selectedLead.id);
                    if (res.success) {
                      setCampaigns(prev => prev.map(c => {
                        if (c.id === selectedCampaignId) {
                          return { ...c, leads: c.leads.filter(l => l.id !== selectedLead.id) };
                        }
                        return c;
                      }));
                      setSelectedLead(null);
                    } else {
                      alert("Failed to remove lead: " + (res.error || "Unknown error"));
                    }
                  } catch (e) {
                    console.error("Failed to remove lead", e);
                    alert("Error removing lead.");
                  }
                  setIsRemovingLead(false);
                }}
                disabled={isRemovingLead}
              >
                {isRemovingLead ? <><Zap size={14} className="animate-spin"/> Removing...</> : <><Trash2 size={14}/> Remove from Pipeline</>}
              </button>
              <button className="btn btn-primary" onClick={() => setSelectedLead(null)} disabled={isRemovingLead}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
