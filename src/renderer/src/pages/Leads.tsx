import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";

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
  | "profile_scraped"
  | "connection_requested"
  | "connection_accepted"
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
}

interface ScrapedResult {
  type: "person" | "company";
  name: string;
  headline: string;
  location: string;
  about: string;
  website?: string;
  industry?: string;
  employeeCount?: string;
  linkedinUrl: string;
}

interface ImportedLead {
  name: string;
  title: string;
  company: string;
  location: string;
  profileUrl: string;
  source: "people_search" | "company_search" | "sales_nav";
}

const statusLabels: Record<
  LeadStatus,
  { label: string; badge: string; icon: string }
> = {
  new: { label: "New", badge: "badge-neutral", icon: "🆕" },
  profile_scraped: { label: "Scraped", badge: "badge-info", icon: "📋" },
  connection_requested: {
    label: "Requested",
    badge: "badge-warning",
    icon: "⏳",
  },
  connection_accepted: {
    label: "Connected",
    badge: "badge-success",
    icon: "✅",
  },
  email_sent: { label: "Email Sent", badge: "badge-info", icon: "📧" },
  replied: { label: "Replied", badge: "badge-success", icon: "💬" },
  meeting_booked: { label: "Meeting", badge: "badge-success", icon: "📅" },
  converted: { label: "Converted", badge: "badge-success", icon: "🎯" },
  rejected: { label: "Rejected", badge: "badge-danger", icon: "❌" },
};

// Detect what kind of URL the user pasted
function detectUrlMode(url: string): "single" | "search" | "keyword" | "unknown" {
  if (!url.trim()) return "unknown";
  const trimmed = url.trim();
  if (
    trimmed.startsWith("http") &&
    (trimmed.includes("/in/") ||
      trimmed.includes("/company/") ||
      trimmed.includes("/school/") ||
      trimmed.includes("/showcase/"))
  )
    return "single";
  if (
    trimmed.startsWith("http") &&
    (trimmed.includes("/search/results/") ||
      trimmed.includes("/sales/search/") ||
      trimmed.includes("keywords=") ||
      trimmed.includes("searchType="))
  )
    return "search";

  // If it's not a URL but has content, treat as keyword
  if (!trimmed.startsWith("http") && trimmed.length > 0 && trimmed.length < 100) {
    return "keyword";
  }

  return "unknown";
}

export default function Leads() {
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [filter, setFilter] = useState<"all" | LeadStatus>("all");

  // --- Tab state ---
  const [importMode, setImportMode] = useState<"single" | "bulk">("single");

  // --- Single URL mode ---
  const [singleUrl, setSingleUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [singleResult, setSingleResult] = useState<ScrapedResult | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [savingLead, setSavingLead] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // --- Bulk search mode ---
  const [searchUrl, setSearchUrl] = useState("");
  const [maxLeads, setMaxLeads] = useState(50);
  const [importing, setImporting] = useState(false);
  const [importedLeads, setImportedLeads] = useState<ImportedLead[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<string>("");
  const [savingAll, setSavingAll] = useState(false);
  const [bulkSaveSuccess, setBulkSaveSuccess] = useState<string | null>(null);

  // --- Auto Pilot Mode ---
  const [isAutoPilot, setIsAutoPilot] = useState(false);
  const [autoPilotLogs, setAutoPilotLogs] = useState<string[]>([]);

  // --- Lead Summary Modal ---
  const [selectedLead, setSelectedLead] = useState<LeadItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // --- Actions Modal ---
  const [actionModal, setActionModal] = useState<"connect" | "message" | null>(null);
  const [activeLeadAction, setActiveLeadAction] = useState<LeadItem | null>(null);
  const [connectionNote, setConnectionNote] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [isGeneratingNote, setIsGeneratingNote] = useState(false);
  const [isSendingAction, setIsSendingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    const styleTag = document.createElement("style");
    styleTag.innerHTML = modalStyles;
    document.head.appendChild(styleTag);
    return () => {
      document.head.removeChild(styleTag);
    };
  }, []);

  const handleViewProfile = (url: string) => {
    if (url) window.open(url, "_blank");
  };

  const openConnectModal = async (lead: LeadItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveLeadAction(lead);
    setActionModal("connect");
    setActionError(null);
    setActionSuccess(null);
    setConnectionNote("");
    setIsGeneratingNote(true);

    try {
      const settings = await (window as any).api.settings.get();
      const note = await (window as any).api.ai.generate({
        type: "connection_note",
        profile: {
          firstName: lead.firstName,
          lastName: lead.lastName,
          headline: lead.role,
          company: lead.company,
        },
        context: {
          yourName: settings.personalization.yourName,
          yourCompany: settings.personalization.yourCompany,
          yourServices: settings.personalization.yourServices,
        },
      });
      setConnectionNote(note || "");
    } catch (err) {
      console.error("AI Generation failed:", err);
    } finally {
      setIsGeneratingNote(false);
    }
  };

  const openMessageModal = (lead: LeadItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveLeadAction(lead);
    setActionModal("message");
    setActionError(null);
    setActionSuccess(null);
    setMessageBody("");
  };

  const handleSendConnection = async () => {
    if (!activeLeadAction || isSendingAction) return;
    setIsSendingAction(true);
    setActionError(null);
    try {
      const settings = await (window as any).api.settings.get();
      const res = await (window as any).api.linkedin.sendConnection({
        profile: {
          firstName: activeLeadAction.firstName,
          lastName: activeLeadAction.lastName,
          linkedinUrl: activeLeadAction.linkedinUrl,
          company: activeLeadAction.company,
        },
        context: {
          yourName: settings.personalization.yourName,
          yourCompany: settings.personalization.yourCompany,
          yourServices: settings.personalization.yourServices,
          customNote: connectionNote,
        },
      });

      if (res.success) {
        setActionSuccess("✅ Connection request sent successfully!");
        setTimeout(() => setActionModal(null), 2000);
      } else {
        setActionError(res.error || "Failed to send connection request.");
      }
    } catch (err: any) {
      setActionError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSendingAction(false);
    }
  };

  const handleSendMessage = async () => {
    if (!activeLeadAction || isSendingAction || !messageBody.trim()) return;
    setIsSendingAction(true);
    setActionError(null);
    try {
      const res = await (window as any).api.linkedin.sendMessage({
        profileUrl: activeLeadAction.linkedinUrl,
        message: messageBody,
      });

      if (res.success) {
        setActionSuccess("✅ Message sent successfully!");
        setTimeout(() => setActionModal(null), 2000);
      } else {
        setActionError(res.error || "Failed to send message.");
      }
    } catch (err: any) {
      setActionError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSendingAction(false);
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    if (!confirm("Are you sure you want to remove this lead?")) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await (window as any).api.leads.delete(leadId);
      if (res.success) {
        setLeads(leads.filter(l => l.id !== leadId));
        setSelectedLead(null);
      } else {
        setDeleteError(res.error || "Failed to remove lead.");
      }
    } catch (e: any) {
      setDeleteError(e.message || "Failed to remove lead.");
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    async function fetchAllLeads() {
      try {
        const allLeads = await (window as any).api.leads.list();
        setLeads(allLeads);
      } catch (err) {
        console.error("Failed to fetch leads", err);
      }
    }

    fetchAllLeads();
    const interval = setInterval(fetchAllLeads, 10000);
    return () => clearInterval(interval);
  }, []);

  const filteredLeads =
    filter === "all" ? leads : leads.filter((l) => l.status === filter);

  // ---- Single URL handler ----
  async function handleScrapeProfile() {
    if (!singleUrl.trim()) return;
    setScraping(true);
    setSingleResult(null);
    setSingleError(null);
    setSaveSuccess(null);
    try {
      const response = await (window as any).api.linkedin.scrapeCompany(singleUrl.trim());
      
      // Handle new structured response {success, data, error}
      const result = response?.data ?? response; // backward-compat if not wrapped
      const isError = response?.success === false;
      
      if (isError) {
        setSingleError(response.error || "Could not extract data.");
      } else if (result) {
        // Validate that we got meaningful data
        const hasData = result.name?.trim() || result.headline?.trim();
        if (!hasData) {
          setSingleError(
            "Profile page loaded but no data extracted. Check:\n" +
            "• You are logged into LinkedIn in the browser\n" +
            "• The profile is publicly visible\n" +
            "• LinkedIn is not showing a login wall",
          );
        } else {
          setSingleResult(result);
        }
      } else {
        setSingleError(
          "Could not extract data. Make sure the browser is active and you are logged into LinkedIn.",
        );
      }
    } catch (e: any) {
      setSingleError(e?.message || "An unexpected error occurred.");
      console.error("Scrape failed:", e);
    }
    setScraping(false);
  }

  // ---- Bulk Search URL handler ----
  async function handleImportSearch() {
    if (!searchUrl.trim()) return;
    setImporting(true);
    setImportedLeads([]);
    setImportError(null);
    setImportProgress("📡 Connecting to LinkedIn...");
    try {
      let finalUrl = searchUrl.trim();
      const mode = detectUrlMode(finalUrl);

      if (mode === "keyword") {
        setImportProgress(`🔍 Will perform human-centric search for "${finalUrl}"...`);
        // Do NOT overwrite finalUrl with a direct URL. Let backend handle the physical search bar typing.
      }

      setImportProgress("🔍 Navigating to search results page...");
      const results = await (window as any).api.linkedin.importSearch({
        searchUrl: finalUrl,
        maxLeads,
      });
      if (results && results.length > 0) {
        setImportedLeads(results);
        setImportProgress(`✅ Extracted ${results.length} lead(s) successfully!`);
      } else {
        setImportError(
          "No leads found on the page. Make sure the browser is open, you are logged into LinkedIn, and the search URL returns visible results.",
        );
        setImportProgress("");
      }
    } catch (e: any) {
      setImportError(e?.message || "An unexpected error occurred.");
      setImportProgress("");
      console.error("Import failed:", e);
    }
    setImporting(false);
  }

  // ---- Auto Pilot Event Listener ----
  useEffect(() => {
    const unsub = (window as any).api.on.autoPilotLog((msg: string) => {
      setAutoPilotLogs((prev) => {
        const newLogs = [...prev, msg];
        if (newLogs.length > 200) return newLogs.slice(newLogs.length - 200);
        return newLogs;
      });
    });
    return () => unsub();
  }, []);

  // ---- Auto Pilot Handler ----
  async function handleStartAutoPilot() {
    if (!searchUrl.trim()) return;
    setIsAutoPilot(true);
    setAutoPilotLogs([]);
    setImportedLeads([]);
    let finalUrl = searchUrl.trim();

    try {
      const mode = detectUrlMode(finalUrl);
      // Removed: Do not hardcode URL if it's a keyword. Let the backend handle physical typing.
      // if (mode === "keyword") {
      //  finalUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(finalUrl)}`;
      // }

      // Tell backend to take over physical interactions
      await (window as any).api.linkedin.startAutoPilot({
        searchUrl: finalUrl,
        maxLeads,
      });

      setIsAutoPilot(false);
    } catch (err: any) {
      console.error(err);
      setAutoPilotLogs(prev => [...prev, `❌ Error: ${err.message}`]);
      setIsAutoPilot(false);
    }
  }

  function handleStopAutoPilot() {
    (window as any).api.linkedin.stopAutoPilot();
    setIsAutoPilot(false);
    setAutoPilotLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🛑 Auto-Pilot stopped by user.`]);
  }

  const detectedMode = detectUrlMode(
    importMode === "single" ? singleUrl : searchUrl,
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Lead Pipeline</h1>
          <p className="page-subtitle">{leads.length} leads in pipeline</p>
        </div>
      </div>

      <div className="page-body">
        {/* Import Section */}
        <div className="card" style={{ marginBottom: "24px" }}>
          <div className="card-header">
            <h3 className="card-title">📥 Import Leads</h3>
          </div>

          {/* Mode Toggle */}
          <div
            className="flex gap-2"
            style={{
              marginBottom: "20px",
              background: "var(--bg-elevated)",
              borderRadius: "10px",
              padding: "4px",
              width: "fit-content",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <button
              id="import-mode-single"
              className={`btn btn-sm ${importMode === "single" ? "btn-primary" : ""}`}
              style={{
                background: importMode === "single" ? "var(--accent-primary)" : "transparent",
                color: importMode === "single" ? "var(--text-primary)" : "var(--text-muted)",
                border: "none",
                borderRadius: "8px",
                padding: "8px 18px",
                fontWeight: 600,
                transition: "background 0.2s, color 0.2s",
              }}
              onClick={() => {
                setImportMode("single");
                setSingleResult(null);
                setSingleError(null);
              }}
            >
              👤 Single Profile / Company
            </button>
            <button
              id="import-mode-bulk"
              className={`btn btn-sm ${importMode === "bulk" ? "btn-primary" : ""}`}
              style={{
                background: importMode === "bulk" ? "var(--accent-primary)" : "transparent",
                color: importMode === "bulk" ? "var(--text-primary)" : "var(--text-muted)",
                border: "none",
                borderRadius: "8px",
                padding: "8px 18px",
                fontWeight: 600,
                transition: "background 0.2s, color 0.2s",
              }}
              onClick={() => {
                setImportMode("bulk");
                setImportedLeads([]);
                setImportError(null);
                setImportProgress("");
              }}
            >
              🔍 Bulk Search Import
            </button>
          </div>

          {/* ---- MODE 1: Single Profile or Company ---- */}
          {importMode === "single" && (
            <div>
              <p
                className="text-xs text-muted"
                style={{ marginBottom: "12px" }}
              >
                Paste a URL for an individual person profile (<code>/in/username</code>) or a
                company page (<code>/company/name</code>). The system will visit the page
                and extract details.
              </p>
              <div className="flex gap-3" style={{ marginBottom: "12px" }}>
                <input
                  id="single-url-input"
                  className="input"
                  placeholder="Enter LinkedIn profile or company URL"
                  value={singleUrl}
                  onChange={(e) => {
                    setSingleUrl(e.target.value);
                    setSingleResult(null);
                    setSingleError(null);
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  id="single-scrape-btn"
                  className="btn btn-primary"
                  onClick={handleScrapeProfile}
                  disabled={scraping || !singleUrl.trim()}
                >
                  {scraping ? "⏳ Loading..." : "🔍 Fetch Profile"}
                </button>
              </div>

              {/* URL type hint */}
              {singleUrl && (
                <p
                  className="text-xs"
                  style={{
                    marginBottom: "12px",
                    color:
                      detectedMode === "single"
                        ? "var(--accent-success)"
                        : detectedMode === "search"
                          ? "var(--accent-warning)"
                          : "var(--text-muted)",
                  }}
                >
                  {detectedMode === "single" &&
                    "✅ Valid profile/company URL — ready to fetch."}
                  {detectedMode === "search" &&
                    "⚠️ This looks like a search page URL. Switch to 'Bulk Search Import' tab instead."}
                  {detectedMode === "unknown" &&
                    "❓ Unrecognized LinkedIn URL. Check the format."}
                </p>
              )}

              {/* Error */}
              {singleError && (
                <div
                  className="text-md"
                  style={{
                    background: "rgba(220, 38, 38, 0.08)",
                    border: "1px solid rgba(220, 38, 38, 0.25)",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    color: "var(--accent-danger)",
                    marginTop: "8px",
                  }}
                >
                  ❌ {singleError}
                </div>
              )}

              {/* Result Card */}
              {singleResult && (
                <div
                  style={{
                    marginTop: "16px",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-accent)",
                    borderRadius: "12px",
                    padding: "20px",
                  }}
                >
                  <div className="flex items-center gap-3" style={{ marginBottom: "12px" }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: singleResult.type === "company" ? "10px" : "50%",
                        background: "var(--gradient-brand, linear-gradient(135deg, #6366f1, #8b5cf6))",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1.5rem",
                        flexShrink: 0,
                      }}
                    >
                      {singleResult.type === "company" ? "🏢" : "👤"}
                    </div>
                    <div>
                      <div className="text-lg font-bold">
                        {singleResult.name}
                      </div>
                      {singleResult.headline && (
                        <div className="text-md" style={{ color: "var(--accent-info)" }}>
                          {singleResult.headline}
                        </div>
                      )}
                    </div>
                    <span
                      className="text-xs font-bold"
                      style={{
                        marginLeft: "auto",
                        background: singleResult.type === "company" ? "rgba(59, 130, 246, 0.1)" : "rgba(5, 150, 105, 0.1)",
                        color: singleResult.type === "company" ? "var(--accent-primary)" : "var(--accent-success)",
                        padding: "4px 10px",
                        borderRadius: "20px",
                        textTransform: "uppercase",
                      }}
                    >
                      {singleResult.type === "company" ? "Company" : "Person"}
                    </span>
                  </div>

                  <div
                    className="text-base"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "8px",
                    }}
                  >
                    {singleResult.location && (
                      <div>
                        📍 <strong>Location:</strong> {singleResult.location}
                      </div>
                    )}
                    {singleResult.industry && (
                      <div>
                        🏭 <strong>Industry:</strong> {singleResult.industry}
                      </div>
                    )}
                    {singleResult.employeeCount && (
                      <div>
                        👥 <strong>Employees:</strong> {singleResult.employeeCount}
                      </div>
                    )}
                    {singleResult.website && (
                      <div>
                        🌐 <strong>Website:</strong>{" "}
                        <a
                          href={singleResult.website}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--accent-info)" }}
                        >
                          {singleResult.website}
                        </a>
                      </div>
                    )}
                  </div>

                  {singleResult.about && (
                    <div
                      className="text-xs"
                      style={{
                        marginTop: "12px",
                        padding: "10px",
                        background: "var(--bg-card)",
                        borderRadius: "8px",
                        color: "var(--text-primary)",
                        lineHeight: 1.6,
                        maxHeight: "80px",
                        overflow: "hidden",
                      }}
                    >
                      {singleResult.about.slice(0, 300)}
                      {singleResult.about.length > 300 && "…"}
                    </div>
                  )}

                  <div style={{ marginTop: "14px", textAlign: "right" }}>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ marginRight: "8px" }}
                      onClick={() => {
                        const url = singleResult.linkedinUrl;
                        if (url) window.open(url, "_blank");
                      }}
                    >
                      🔗 Open on LinkedIn
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={savingLead}
                      onClick={async () => {
                        setSavingLead(true);
                        setSaveSuccess(null);
                        try {
                          // Split name for person profiles
                          const nameParts = (singleResult.name || "").split(" ");
                          const firstName = nameParts[0] || "";
                          const lastName = nameParts.slice(1).join(" ") || "";

                          const res = await (window as any).api.leads.save({
                            linkedinUrl: singleResult.linkedinUrl,
                            firstName,
                            lastName,
                            headline: singleResult.headline || "",
                            company: singleResult.type === "company" ? singleResult.name : "",
                            location: singleResult.location || "",
                            about: singleResult.about || "",
                          });
                          if (res.success) {
                            setSaveSuccess(res.duplicate
                              ? "✅ Lead already exists in pipeline."
                              : "✅ Lead saved to pipeline successfully!");
                            
                            // Refresh leads list immediately
                            const allLeads = await (window as any).api.leads.list();
                            setLeads(allLeads);
                          }
                        } catch (e) {
                          console.error("Save lead failed:", e);
                          setSaveSuccess("❌ Failed to save lead.");
                        }
                        setSavingLead(false);
                      }}
                    >
                      {savingLead ? "⏳ Saving..." : "➕ Add to Pipeline"}
                    </button>
                  </div>
                  {saveSuccess && (
                    <div
                      className="text-xs"
                      style={{
                        marginTop: "10px",
                        padding: "10px 14px",
                        background: saveSuccess.startsWith("✅") ? "rgba(5, 150, 105, 0.08)" : "rgba(220, 38, 38, 0.08)",
                        border: saveSuccess.startsWith("✅") ? "1px solid rgba(5, 150, 105, 0.2)" : "1px solid rgba(220, 38, 38, 0.2)",
                        borderRadius: "8px",
                        color: saveSuccess.startsWith("✅") ? "var(--accent-success)" : "var(--accent-danger)",
                        textAlign: "center",
                      }}
                    >
                      {saveSuccess}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---- MODE 2: Bulk Search Import ---- */}
          {importMode === "bulk" && (
            <div>
              <p
                className="text-xs text-muted"
                style={{ marginBottom: "12px" }}
              >
                Paste a LinkedIn search results URL with your filters already applied (People
                search, Company search, or Sales Navigator). The system will navigate to the
                page and extract all visible profiles automatically.
              </p>

              <div className="flex gap-3" style={{ marginBottom: "12px" }}>
                <input
                  id="search-url-input"
                  className="input"
                  placeholder="Enter LinkedIn search results URL"
                  value={searchUrl}
                  onChange={(e) => {
                    setSearchUrl(e.target.value);
                    setImportedLeads([]);
                    setImportError(null);
                    setImportProgress("");
                  }}
                  style={{ flex: 1 }}
                />
                <input
                  id="max-leads-input"
                  type="number"
                  className="input"
                  min={5}
                  max={200}
                  value={maxLeads}
                  onChange={(e) => setMaxLeads(Number(e.target.value))}
                  style={{ width: "90px" }}
                  title="Max leads to extract"
                />
                <button
                  id="bulk-import-btn"
                  className="btn btn-primary"
                  onClick={handleImportSearch}
                  disabled={importing || isAutoPilot || !searchUrl.trim()}
                >
                  {importing ? "⏳ Scanning..." : "📥 Scan Search Results"}
                </button>
                <button
                  className="btn btn-primary"
                  style={{ background: "var(--gradient-brand, linear-gradient(135deg, #6366f1, #8b5cf6))", border: "none" }}
                  onClick={isAutoPilot ? () => setIsAutoPilot(false) : handleStartAutoPilot}
                  disabled={importing || (!isAutoPilot && !searchUrl.trim())}
                >
                  {isAutoPilot ? "🛑 Stop Auto-Pilot" : "🚀 Start Auto-Pilot"}
                </button>
              </div>

              {/* URL type hint */}
              {searchUrl && !isAutoPilot && (
                <p
                  className="text-xs"
                  style={{
                    marginBottom: "12px",
                    color:
                      detectedMode === "search"
                        ? "var(--accent-success)"
                        : detectedMode === "single"
                          ? "var(--accent-warning)"
                          : "var(--text-muted)",
                  }}
                >
                  {detectedMode === "search" &&
                    "✅ Valid search URL detected — ready to process."}
                  {detectedMode === "single" &&
                    "⚠️ This looks like an individual profile URL. Use 'Single Profile / Company' tab instead."}
                  {detectedMode === "keyword" &&
                    "✅ Valid keyword detected — AI will construct search automatically."}
                  {detectedMode === "unknown" &&
                    "❓ Unrecognized URL format. Paste a full LinkedIn search URL or a Keyword."}
                </p>
              )}

              {/* Auto Pilot Terminal */}
              {(isAutoPilot || autoPilotLogs.length > 0) && (
                <div style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "8px",
                  padding: "16px",
                  marginBottom: "16px",
                  fontFamily: "monospace",
                  fontSize: "var(--font-size-base)",
                  color: "var(--text-primary)",
                  maxHeight: "300px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px"
                }}>
                  <div style={{ fontWeight: "bold", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px", marginBottom: "8px" }}>
                    🚀 Auto-Pilot Terminal
                  </div>
                  {autoPilotLogs.map((log, i) => (
                    <div key={i} style={{ 
                      color: log.includes("❌") ? "var(--accent-danger)" : 
                             log.includes("✅") ? "var(--accent-success)" : 
                             log.includes("⚠️") ? "var(--accent-warning)" : "inherit"
                    }}>
                      {log}
                    </div>
                  ))}
                  {isAutoPilot && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", color: "var(--accent-primary)" }}>
                       <div className="spinner" style={{ width: "16px", height: "16px", border: "2px solid rgba(99,102,241,0.2)", borderTopColor: "var(--accent-primary)", borderRadius: "50%", animation: "spin 1s linear infinite" }}></div>
                       <i>Auto-Pilot is running... Please do not close this window.</i>
                    </div>
                  )}
                </div>
              )}

              {/* Progress */}
              {importProgress && (
                <div
                  className="text-md"
                  style={{
                    background: "rgba(5, 150, 105, 0.08)",
                    border: "1px solid rgba(5, 150, 105, 0.2)",
                    borderRadius: "8px",
                    padding: "10px 16px",
                    color: "var(--accent-success)",
                    marginBottom: "12px",
                  }}
                >
                  {importProgress}
                </div>
              )}

              {/* Error */}
              {importError && (
                <div
                  className="text-md"
                  style={{
                    background: "rgba(220, 38, 38, 0.08)",
                    border: "1px solid rgba(220, 38, 38, 0.2)",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    color: "var(--accent-danger)",
                    marginBottom: "12px",
                  }}
                >
                  ❌ {importError}
                </div>
              )}

              {/* Imported results table */}
              {importedLeads.length > 0 && (
                <div style={{ marginTop: "12px" }}>
                  <div
                    className="flex justify-between items-center"
                    style={{ marginBottom: "10px" }}
                  >
                    <strong className="text-md">
                      🎯 {importedLeads.length} Leads Extracted
                    </strong>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={savingAll}
                      onClick={async () => {
                        setSavingAll(true);
                        setBulkSaveSuccess(null);
                        let addedCount = 0;
                        try {
                          for (const lead of importedLeads) {
                             const nameParts = (lead.name || "").split(" ");
                             const firstName = nameParts[0] || "";
                             const lastName = nameParts.slice(1).join(" ") || "";
                             
                             await (window as any).api.leads.save({
                               linkedinUrl: lead.profileUrl,
                               firstName,
                               lastName,
                               headline: lead.title || lead.source || "",
                               company: lead.company || "",
                               location: lead.location || "",
                               about: ""
                             });
                             addedCount++;
                          }
                          if (addedCount > 0) {
                            setBulkSaveSuccess(`✅ Successfully saved ${addedCount} leads to pipeline!`);
                            // Refresh leads list immediately
                            const allLeads = await (window as any).api.leads.list();
                            setLeads(allLeads);
                          }
                        } catch (e) {
                          console.error("Bulk save failed:", e);
                          setBulkSaveSuccess("❌ Failed to save some leads.");
                        } finally {
                          setSavingAll(false);
                        }
                      }}
                    >
                      {savingAll ? "⏳ Saving..." : "➕ Save All to Pipeline"}
                    </button>
                  </div>
                  {bulkSaveSuccess && (
                     <div
                      style={{
                        marginBottom: "10px",
                        padding: "10px 14px",
                        background: bulkSaveSuccess.startsWith("✅") ? "rgba(5, 150, 105, 0.08)" : "rgba(220, 38, 38, 0.08)",
                        border: bulkSaveSuccess.startsWith("✅") ? "1px solid rgba(5, 150, 105, 0.2)" : "1px solid rgba(220, 38, 38, 0.2)",
                        borderRadius: "8px",
                        color: bulkSaveSuccess.startsWith("✅") ? "var(--accent-success)" : "var(--accent-danger)",
                        fontSize: "0.8125rem",
                        textAlign: "center",
                      }}
                    >
                      {bulkSaveSuccess}
                    </div>
                  )}
                  <div
                    style={{
                      maxHeight: "320px",
                      overflowY: "auto",
                      borderRadius: "10px",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr
                          style={{
                            background: "var(--bg-secondary)",
                            borderBottom: "1px solid var(--border-primary)",
                          }}
                        >
                          {["Name", "Title / Type", "Location", "URL"].map(
                            (h) => (
                              <th
                                key={h}
                                className="text-xs"
                                style={{
                                  padding: "10px 14px",
                                  textAlign: "left",
                                  fontWeight: 700,
                                  color: "var(--text-secondary)",
                                  textTransform: "uppercase",
                                }}
                              >
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {importedLeads.map((lead, i) => (
                          <tr
                            key={i}
                            style={{
                              borderBottom: "1px solid var(--border-subtle)",
                            }}
                          >
                            <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                              {lead.name || "—"}
                            </td>
                            <td
                              className="text-sm text-muted"
                              style={{ padding: "10px 14px" }}
                            >
                              {lead.title || lead.source || "—"}
                            </td>
                            <td
                              className="text-sm text-muted"
                              style={{ padding: "10px 14px" }}
                            >
                              {lead.location || "—"}
                            </td>
                            <td style={{ padding: "10px 14px" }}>
                              <a
                                href={lead.profileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs"
                                style={{
                                  color: "var(--accent-info)",
                                  fontFamily: "monospace",
                                  wordBreak: "break-all",
                                }}
                              >
                                {lead.profileUrl
                                  .replace("https://www.linkedin.com", "")
                                  .slice(0, 40)}
                                …
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2" style={{ marginBottom: "24px", flexWrap: "wrap" }}>
          {(
            [
              "all",
              "new",
              "connection_requested",
              "connection_accepted",
              "email_sent",
              "replied",
              "meeting_booked",
            ] as const
          ).map((f) => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "📋 All"
                : `${statusLabels[f].icon} ${statusLabels[f].label}`}
            </button>
          ))}
        </div>

        {/* Leads Table */}
        {leads.length === 0 ? (
          <div
            className="card animate-fadeIn"
            style={{ textAlign: "center", padding: "60px 40px" }}
          >
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>👥</div>
            <h2
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                marginBottom: "12px",
              }}
            >
              No Leads Yet
            </h2>
            <p
              className="text-muted"
              style={{ maxWidth: "400px", margin: "0 auto" }}
            >
              Use the import panel above to add your first lead — either by
              pasting a single LinkedIn URL or a search results page.
            </p>
          </div>
        ) : (
          <div className="card">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-primary)" }}>
                  {["Lead", "Company", "Status", "Score", "Actions"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className="text-base"
                        style={{
                          textAlign: i >= 3 ? (i === 3 ? "center" : "right") : "left",
                          padding: "12px 16px",
                          color: "var(--text-secondary)",
                          fontWeight: 600,
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    style={{ borderBottom: "1px solid var(--border-subtle)", cursor: "pointer" }}
                    onClick={() => setSelectedLead(lead)}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <div className="flex items-center gap-3">
                        <div
                          className="text-md font-bold"
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            background: "var(--gradient-brand)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {lead.firstName[0]}
                          {lead.lastName[0]}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {lead.firstName} {lead.lastName}
                          </div>
                          <div className="text-sm text-muted">{lead.role}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }} className="text-sm">
                      {lead.company}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        className={`badge ${statusLabels[lead.status as LeadStatus]?.badge || "badge-neutral"}`}
                      >
                        {statusLabels[lead.status as LeadStatus]?.icon || "ℹ️"}{" "}
                        {statusLabels[lead.status as LeadStatus]?.label ||
                          lead.status}
                      </span>
                    </td>
                    <td
                      style={{ padding: "12px 16px", textAlign: "center" }}
                    >
                      <span style={{ fontWeight: 700 }}>{lead.score}</span>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div
                        className="flex gap-2"
                        style={{ justifyContent: "flex-end" }}
                      >
                        <button 
                          className="btn btn-secondary btn-sm"
                          title="View Profile"
                          onClick={(e) => { e.stopPropagation(); handleViewProfile(lead.linkedinUrl); }}
                        >
                          👁️
                        </button>
                        <button 
                          className="btn btn-secondary btn-sm"
                          title="Connect"
                          onClick={(e) => openConnectModal(lead, e)}
                        >
                          🤝
                        </button>
                        <button 
                          className="btn btn-secondary btn-sm"
                          title="Message"
                          onClick={(e) => openMessageModal(lead, e)}
                        >
                          ✉️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lead Summary Modal */}
      {selectedLead && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
            backdropFilter: "blur(2px)",
          }}
          onClick={() => { if (!isDeleting) setSelectedLead(null); }}
        >
          <div
            style={{
              background: "var(--bg-card)",
              width: "100%",
              maxWidth: "460px",
              borderRadius: "16px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              overflow: "hidden",
              border: "1px solid var(--border-subtle)",
              animation: "modalFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: "20px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 className="text-lg font-bold" style={{ color: "var(--text-main)", display: "flex", alignItems: "center", gap: "10px" }}>
                👤 Lead Summary
              </h2>
              <button 
                onClick={() => setSelectedLead(null)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1.25rem" }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: "24px" }}>
               <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px" }}>
                  <div style={{ 
                    width: "64px", height: "64px", borderRadius: "50%", background: "var(--gradient-brand)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", fontWeight: 700
                   }}>
                    {selectedLead.firstName[0]}{selectedLead.lastName[0] || ""}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="flex justify-between items-start">
                       <h3 className="text-xl font-bold" style={{ color: "var(--text-main)", marginBottom: "4px" }}>
                          {selectedLead.firstName} {selectedLead.lastName}
                       </h3>
                       <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full whitespace-nowrap mt-1">
                          {selectedLead.connectionDegree || "3rd"}
                       </span>
                    </div>
                    <div className="text-md font-semibold" style={{ color: "var(--accent-info)" }}>
                       {selectedLead.role}
                    </div>
                  </div>
               </div>

               <div style={{ display: "grid", gap: "16px" }}>
                  <div>
                    <label className="text-xs text-muted font-bold uppercase" style={{ display: "block", marginBottom: "4px" }}>
                       Company
                    </label>
                    <div className="text-md" style={{ color: "var(--text-main)" }}>🏢 {selectedLead.company}</div>
                  </div>

                  {selectedLead.location && (
                    <div>
                      <label className="text-xs text-muted font-bold uppercase" style={{ display: "block", marginBottom: "4px" }}>
                         Location
                      </label>
                      <div className="text-md" style={{ color: "var(--text-main)" }}>📍 {selectedLead.location}</div>
                    </div>
                  )}

                  {selectedLead.about && (
                    <div>
                      <label className="text-xs text-muted font-bold uppercase" style={{ display: "block", marginBottom: "4px" }}>
                         About
                      </label>
                      <div className="text-xs" style={{ color: "var(--text-main)", background: "var(--bg-secondary)", padding: "12px", borderRadius: "8px", maxHeight: "150px", overflowY: "auto", whiteSpace: "pre-wrap" }}>
                        {selectedLead.about}
                      </div>
                    </div>
                  )}

                  {selectedLead.experience && selectedLead.experience.length > 0 && (
                     <div>
                       <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>
                         Selected Experience
                       </label>
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

                  <div>
                    <label className="text-xs text-muted font-bold uppercase" style={{ display: "block", marginBottom: "4px" }}>
                       LinkedIn Profile
                    </label>
                    <a href={selectedLead.linkedinUrl} target="_blank" className="text-md" style={{ color: "var(--accent-primary)", wordBreak: "break-all", textDecoration: "underline" }}>
                      {selectedLead.linkedinUrl}
                    </a>
                  </div>

                  <div>
                     <label className="text-xs text-muted font-bold uppercase" style={{ display: "block", marginBottom: "4px" }}>
                       Current Pipeline Status
                    </label>
                    <span className={`badge ${statusLabels[selectedLead.status as LeadStatus]?.badge || "badge-neutral"}`} style={{ padding: "6px 12px" }}>
                       {statusLabels[selectedLead.status as LeadStatus]?.icon} {statusLabels[selectedLead.status as LeadStatus]?.label}
                    </span>
                  </div>
               </div>

               {deleteError && (
                 <div style={{ marginTop: "20px", color: "var(--accent-danger)", fontSize: "0.875rem", padding: "10px", background: "rgba(220,38,38,0.1)", borderRadius: "8px", border: "1px solid rgba(220,38,38,0.2)" }}>
                    ⚠️ {deleteError}
                 </div>
               )}
            </div>

            {/* Footer */}
            <div style={{ padding: "16px 20px", background: "var(--bg-secondary)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button 
                className="btn btn-danger btn-sm"
                onClick={() => handleDeleteLead(selectedLead.id)}
                disabled={isDeleting}
                style={{ 
                   background: "rgba(220, 38, 38, 0.1)", color: "var(--accent-danger)", border: "1px solid rgba(220, 38, 38, 0.2)",
                   display: "flex", alignItems: "center", gap: "6px"
                }}
              >
                {isDeleting ? "⏳ Removing..." : "🗑️ Delete Lead"}
              </button>
              <button 
                className="btn btn-primary"
                onClick={() => setSelectedLead(null)}
                style={{ minWidth: "100px" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Connect Modal */}
      {actionModal === "connect" && activeLeadAction && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1001, padding: "20px", backdropFilter: "blur(2px)",
          }}
          onClick={() => { if (!isSendingAction) setActionModal(null); }}
        >
          <div
            style={{
              background: "var(--bg-card)", width: "100%", maxWidth: "480px",
              borderRadius: "16px", border: "1px solid var(--border-subtle)",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              animation: "modalFadeIn 0.25s ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "20px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "1.125rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "10px" }}>
                🤝 Send Connection Request
              </h2>
              <button onClick={() => setActionModal(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1.25rem" }}>✕</button>
            </div>
            
            <div style={{ padding: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "var(--gradient-brand)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {activeLeadAction.firstName[0]}
                </div>
                <div>
                  <div className="font-semibold text-sm">{activeLeadAction.firstName} {activeLeadAction.lastName}</div>
                  <div className="text-xs" style={{ color: "var(--accent-info)" }}>{activeLeadAction.role}</div>
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: "8px" }}>
                  Connection Note (Personalized by AI)
                </label>
                <textarea
                  className="input text-md"
                  rows={6}
                  style={{ width: "100%", background: "var(--bg-secondary)" }}
                  value={isGeneratingNote ? "⏳ Orchestrating AI recommendation..." : connectionNote}
                  onChange={(e) => setConnectionNote(e.target.value)}
                  disabled={isGeneratingNote || isSendingAction}
                  placeholder="Type your connection request note here..."
                />
              </div>

              {actionError && (
                <div style={{ marginBottom: "16px", color: "var(--accent-danger)", fontSize: "0.875rem", padding: "10px", background: "rgba(220,38,38,0.1)", borderRadius: "8px", border: "1px solid rgba(220,38,38,0.2)" }}>
                   ⚠️ {actionError}
                </div>
              )}

              {actionSuccess && (
                <div style={{ marginBottom: "16px", color: "var(--accent-success)", fontSize: "0.875rem", padding: "10px", background: "rgba(5,150,105,0.1)", borderRadius: "8px", border: "1px solid rgba(5,150,105,0.2)" }}>
                   {actionSuccess}
                </div>
              )}
            </div>

            <div style={{ padding: "16px 20px", background: "var(--bg-secondary)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => setActionModal(null)}
                disabled={isSendingAction}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleSendConnection}
                disabled={isSendingAction || isGeneratingNote}
                style={{ minWidth: "160px" }}
              >
                {isSendingAction ? "⏳ Sending..." : "🤝 Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message Modal */}
      {actionModal === "message" && activeLeadAction && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1001, padding: "20px", backdropFilter: "blur(2px)",
          }}
          onClick={() => { if (!isSendingAction) setActionModal(null); }}
        >
          <div
            style={{
              background: "var(--bg-card)", width: "100%", maxWidth: "480px",
              borderRadius: "16px", border: "1px solid var(--border-subtle)",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              animation: "modalFadeIn 0.25s ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "20px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "1.125rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "10px" }}>
                ✉️ Send Message
              </h2>
              <button onClick={() => setActionModal(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1.25rem" }}>✕</button>
            </div>
            
            <div style={{ padding: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "var(--gradient-brand)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {activeLeadAction.firstName[0]}
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{activeLeadAction.firstName} {activeLeadAction.lastName}</div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--accent-info)" }}>Connected</div>
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: "8px" }}>
                  Message Content
                </label>
                <textarea
                  className="input text-md"
                  rows={5}
                  style={{ width: "100%", background: "var(--bg-secondary)" }}
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  disabled={isSendingAction}
                  placeholder="Hey, I noticed your profile and..."
                  autoFocus
                />
              </div>

              {actionError && (
                <div style={{ marginBottom: "16px", color: "var(--accent-danger)", fontSize: "0.875rem", padding: "10px", background: "rgba(220,38,38,0.1)", borderRadius: "8px", border: "1px solid rgba(220,38,38,0.2)" }}>
                   ⚠️ {actionError}
                </div>
              )}

              {actionSuccess && (
                <div style={{ marginBottom: "16px", color: "var(--accent-success)", fontSize: "0.875rem", padding: "10px", background: "rgba(5,150,105,0.1)", borderRadius: "8px", border: "1px solid rgba(5,150,105,0.2)" }}>
                   {actionSuccess}
                </div>
              )}
            </div>

            <div style={{ padding: "16px 20px", background: "var(--bg-secondary)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => setActionModal(null)}
                disabled={isSendingAction}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleSendMessage}
                disabled={isSendingAction || !messageBody.trim()}
                style={{ minWidth: "160px" }}
              >
                {isSendingAction ? "⏳ Sending..." : "✉️ Send Message"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
