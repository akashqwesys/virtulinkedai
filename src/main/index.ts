/**
 * VirtuLinked AI — Electron Main Process
 *
 * Entry point for the desktop application.
 * Sets up the Electron window, IPC handlers, and initializes all modules.
 */

process.env.TZ = "Asia/Kolkata";

import { app, BrowserWindow, shell, ipcMain, globalShortcut } from "electron";
import { join } from "path";

// Prevent multiple instances AS EARLY AS POSSIBLE
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on("second-instance", () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      if (windows[0].isMinimized()) windows[0].restore();
      windows[0].focus();
    }
  });
}

// Handle graceful shutdown signals from dev environments
if (process.platform === "win32") {
  process.on("message", (msg) => {
    if (msg === "graceful-exit") {
      app.quit();
    }
  });
}

process.on("uncaughtException", (err) => {
  console.error("FATAL ERROR (uncaughtException):", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error(
    "FATAL ERROR (unhandledRejection):",
    promise,
    "reason:",
    reason,
  );
});

// Inline replacements for @electron-toolkit/utils (v4 crashes on load)
const is = {
  get dev() {
    return !app.isPackaged;
  },
};
const electronApp = {
  setAppUserModelId(id: string) {
    if (process.platform === "win32")
      app.setAppUserModelId(is.dev ? process.execPath : id);
  },
};
const optimizer = {
  watchWindowShortcuts(win: BrowserWindow) {
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown") {
        // F12 or Cmd+Option+I to toggle devtools in dev mode
        if (
          input.key === "F12" ||
          (input.meta && input.alt && input.key.toLowerCase() === "i")
        ) {
          if (is.dev) win.webContents.toggleDevTools();
        }
        // Cmd+R to reload in dev mode
        if ((input.meta || input.control) && input.key.toLowerCase() === "r") {
          if (is.dev) win.webContents.reload();
        }
      }
    });
  },
};
import { IPC_CHANNELS } from "../shared/types";
import type { AppSettings, Campaign } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/defaults";
import {
  getDatabase,
  logActivity,
  closeDatabase,
  getEmailTemplates,
  saveEmailTemplate,
  deleteEmailTemplate,
  wipeDatabase,
} from "./storage/database";
import {
  launchBrowser,
  closeBrowser,
  getBrowserStatus,
} from "./browser/engine";
import {
  checkLoginStatus,
  openLoginPage,
  waitForLogin,
  logout,
} from "./browser/session";
import { scrapeProfile, scrapeCompanyOrPersonProfile, importFromSearchUrl } from "./linkedin/scraper";
import {
  sendConnectionRequest,
  checkConnectionStatuses,
} from "./linkedin/connector";
import {
  sendMessage,
  readUnreadMessages,
  processChatbotMessage,
  sendWelcomeDM,
  scrapeAndSaveThread,
  sendReplyInThreadOnPage,
  scrapeAllLinkedInConversations,
} from "./linkedin/messenger";

import { checkAIStatus } from "./ai/personalizer";
import {
  authenticate,
  sendEmail,
  createMeeting,
  getAvailableSlots,
  getConnectionStatus,
  disconnectMicrosoft,
} from "./microsoft/email";
import { DailyLimitManager } from "./browser/humanizer";
import { startQueueWorker, stopQueueWorker, updateWorkerSettings } from "./queue/worker";
import { jobQueue } from "./queue/jobQueue";
import { JOB_TYPES } from "./queue/jobs";
import type { ScrapeProfilePayload } from "./queue/jobs";
import { startTrackingServer, stopTrackingServer } from "./analytics/tracker";
import {
  getInboxPage,
  getInboxBrowserStatus,
  closeInboxBrowser,
} from "./browser/inbox-engine";
import { v4 as uuidv4 } from "uuid";
import type Store from "electron-store";


// Persistent settings store (lazy-init via async import for ESM compatibility in CJS)
let _settingsStore: Store<{ settings: AppSettings }> | null = null;

async function initSettingsStore() {
  if (!_settingsStore) {
    const { default: ElectronStore } = await import("electron-store");
    _settingsStore = new ElectronStore<{ settings: AppSettings }>({
      defaults: { settings: DEFAULT_SETTINGS },
    });
  }
}

function getSettingsStore(): Store<{ settings: AppSettings }> {
  if (!_settingsStore) {
    throw new Error("Settings store not initialized yet");
  }
  return _settingsStore;
}

// Daily limit manager (initialized after settings load)
let limitManager: DailyLimitManager | null = null;

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: "VirtuLinked AI",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only open external URLs (not localhost/dev server) in the system browser
    try {
      const url = new URL(details.url);
      const isExternal =
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname !== "localhost" &&
        url.hostname !== "127.0.0.1" &&
        !url.hostname.startsWith("192.168.");
      if (isExternal) {
        shell.openExternal(details.url);
      }
    } catch {
      // ignore malformed URLs
    }
    return { action: "deny" };
  });

  // Load the UI
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

// ============================================================
// IPC Handlers
// ============================================================

function setupIpcHandlers(mainWindow: BrowserWindow): void {
  // ---- System ----
  ipcMain.removeHandler(IPC_CHANNELS.SYSTEM_WIPE_DATA);
  ipcMain.handle(IPC_CHANNELS.SYSTEM_WIPE_DATA, () => {
    try {
      wipeDatabase();
      return { success: true };
    } catch (e: any) {
      console.error("Failed to wipe database:", e);
      return { success: false, error: e.message };
    }
  });

  // ---- Browser Control ----
  ipcMain.removeHandler(IPC_CHANNELS.BROWSER_LAUNCH);
  ipcMain.handle(IPC_CHANNELS.BROWSER_LAUNCH, async () => {
    return await launchBrowser();
  });

  ipcMain.removeHandler(IPC_CHANNELS.BROWSER_STATUS);
  ipcMain.handle(IPC_CHANNELS.BROWSER_STATUS, () => {
    return getBrowserStatus();
  });

  ipcMain.removeHandler(IPC_CHANNELS.BROWSER_CLOSE);
  ipcMain.handle(IPC_CHANNELS.BROWSER_CLOSE, async () => {
    await closeBrowser();
    return { success: true };
  });

  // ---- LinkedIn ----
  ipcMain.removeHandler(IPC_CHANNELS.LINKEDIN_LOGIN);
  ipcMain.handle(IPC_CHANNELS.LINKEDIN_LOGIN, async () => {
    const launchResult = await launchBrowser();
    if (!launchResult.success)
      return { success: false, error: launchResult.error };

    // Check if already logged in
    const status = await checkLoginStatus();
    if (status.isLoggedIn) {
      return { success: true, ...status };
    }

    // Open login page for manual login
    await openLoginPage();

    // Wait for user to login
    const loggedIn = await waitForLogin(300000, (message) => {
      mainWindow.webContents.send(IPC_CHANNELS.LINKEDIN_LOGIN_STATUS, {
        message,
      });
    });

    if (loggedIn) {
      const finalStatus = await checkLoginStatus();
      return { success: true, ...finalStatus };
    }

    return { success: false, error: "Login timed out" };
  });

  ipcMain.removeHandler(IPC_CHANNELS.LINKEDIN_LOGIN_STATUS);
  ipcMain.handle(IPC_CHANNELS.LINKEDIN_LOGIN_STATUS, async () => {
    return await checkLoginStatus();
  });

  ipcMain.removeHandler(IPC_CHANNELS.LINKEDIN_LOGOUT);
  ipcMain.handle(IPC_CHANNELS.LINKEDIN_LOGOUT, async () => {
    const browserStatus = getBrowserStatus();
    if (browserStatus.status !== "running") {
      await launchBrowser();
    }
    return await logout();
  });

  ipcMain.removeHandler(IPC_CHANNELS.LINKEDIN_SCRAPE_PROFILE);
  ipcMain.handle(
    IPC_CHANNELS.LINKEDIN_SCRAPE_PROFILE,
    async (_event, profileUrl: string) => {
      const settings = getSettingsStore().get("settings");
      return await scrapeProfile(profileUrl, {}, settings.ai);
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.LINKEDIN_SCRAPE_COMPANY);
  ipcMain.handle(
    IPC_CHANNELS.LINKEDIN_SCRAPE_COMPANY,
    async (_event, url: string) => {
      try {
        const browserStatus = getBrowserStatus();
        if (browserStatus.status !== "running") {
          await launchBrowser();
        }
        const result = await scrapeCompanyOrPersonProfile(url);
        return { success: true, data: result };
      } catch (e: any) {
        const msg = e?.message || "Unknown error during scraping";
        console.error("[Main] LINKEDIN_SCRAPE_COMPANY failed:", msg);
        return { success: false, error: msg };
      }
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.LINKEDIN_IMPORT_SEARCH);
  ipcMain.handle(
    IPC_CHANNELS.LINKEDIN_IMPORT_SEARCH,
    async (_event, data: { searchUrl: string; maxLeads?: number }) => {
      try {
        const browserStatus = getBrowserStatus();
        if (browserStatus.status !== "running") {
          await launchBrowser();
        }
        return await importFromSearchUrl(data.searchUrl, data.maxLeads ?? 50);
      } catch (e: any) {
        console.error("[Main] LINKEDIN_IMPORT_SEARCH failed:", e.message);
        throw e;
      }
    },
  );

  ipcMain.removeHandler("LINKEDIN_START_AUTOPILOT");
  ipcMain.handle(
    "LINKEDIN_START_AUTOPILOT",
    async (_event, data: { searchUrl: string; maxLeads: number }) => {
      try {
        const browserStatus = getBrowserStatus();
        if (browserStatus.status !== "running") {
          await launchBrowser();
        }
        const settings = getSettingsStore().get("settings");
        if (!limitManager) {
          limitManager = new DailyLimitManager(
            {
              connectionRequests: settings.dailyLimits.connectionRequests,
              profileViews: settings.dailyLimits.profileViews,
              messages: settings.dailyLimits.messages,
              postEngagements: settings.dailyLimits.postEngagements,
            },
            settings.dailyLimits.randomizePercent,
          );
        }

        const { runPhysicalAutoPilot } = await import("./linkedin/autopilot");
        // Start it in the background by not awaiting it here, so the frontend UI doesn't hang!
        // Wait, if it runs in the background, the UI can keep showing the terminal.
        runPhysicalAutoPilot(data.searchUrl, data.maxLeads, settings, limitManager);
        return { success: true };
      } catch (e: any) {
        console.error("[Main] LINKEDIN_START_AUTOPILOT failed:", e.message);
        return { success: false, error: e.message };
      }
    },
  );

  ipcMain.removeHandler("LINKEDIN_STOP_AUTOPILOT");
  ipcMain.handle("LINKEDIN_STOP_AUTOPILOT", async () => {
    const { stopAutoPilot } = await import("./linkedin/autopilot");
    stopAutoPilot();
    return { success: true };
  });

  ipcMain.removeHandler(IPC_CHANNELS.LINKEDIN_SEND_CONNECTION);
  ipcMain.handle(
    IPC_CHANNELS.LINKEDIN_SEND_CONNECTION,
    async (
      _event,
      data: {
        profile: any;
        context: {
          yourName: string;
          yourCompany: string;
          yourServices: string;
        };
      },
    ) => {
      const settings = getSettingsStore().get("settings");
      if (!limitManager) {
        limitManager = new DailyLimitManager(
          {
            connectionRequests: settings.dailyLimits.connectionRequests,
            profileViews: settings.dailyLimits.profileViews,
            messages: settings.dailyLimits.messages,
            postEngagements: settings.dailyLimits.postEngagements,
          },
          settings.dailyLimits.randomizePercent,
        );
      }
      return await sendConnectionRequest(
        data.profile,
        data.context,
        settings,
        limitManager,
      );
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.LINKEDIN_CHECK_CONNECTIONS);
  ipcMain.handle(
    IPC_CHANNELS.LINKEDIN_CHECK_CONNECTIONS,
    async (_event, leadUrls: string[]) => {
      const statuses = await checkConnectionStatuses(leadUrls);
      return Object.fromEntries(statuses);
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.LINKEDIN_SEND_MESSAGE);
  ipcMain.handle(
    IPC_CHANNELS.LINKEDIN_SEND_MESSAGE,
    async (
      _event,
      data: {
        profileUrl: string;
        message: string;
      },
    ) => {
      return await sendMessage(data.profileUrl, data.message);
    },
  );

  // ---- AI ----
  ipcMain.removeHandler(IPC_CHANNELS.AI_STATUS);
  ipcMain.handle(IPC_CHANNELS.AI_STATUS, async () => {
    const settings = getSettingsStore().get("settings");
    return await checkAIStatus(settings.ai);
  });

  ipcMain.removeHandler(IPC_CHANNELS.AI_GENERATE);
  ipcMain.handle(
    IPC_CHANNELS.AI_GENERATE,
    async (
      _event,
      data: {
        type: "connection_note" | "email" | "comment" | "chatbot_reply";
        profile: any;
        context: any;
      },
    ) => {
      const settings = getSettingsStore().get("settings");
      const {
        generateConnectionNote,
        generatePersonalizedEmail,
        generatePostComment,
      } = await import("./ai/personalizer");

      switch (data.type) {
        case "connection_note":
          return await generateConnectionNote(
            data.profile,
            data.context,
            settings.ai,
          );
        case "email":
          return await generatePersonalizedEmail(
            data.profile,
            data.context,
            settings.ai,
          );
        case "comment":
          return await generatePostComment(
            data.context.postContent,
            data.context.authorName,
            data.context,
            settings.ai,
          );
        default:
          return null;
      }
    },
  );

  // ---- Email ----
  ipcMain.removeHandler(IPC_CHANNELS.EMAIL_AUTH);
  ipcMain.handle(IPC_CHANNELS.EMAIL_AUTH, async () => {
    const settings = getSettingsStore().get("settings");
    return await authenticate(settings.microsoft);
  });

  ipcMain.removeHandler(IPC_CHANNELS.EMAIL_SEND);
  ipcMain.handle(
    IPC_CHANNELS.EMAIL_SEND,
    async (
      _event,
      data: {
        to: string;
        subject: string;
        body: string;
        isHtml?: boolean;
      },
    ) => {
      return await sendEmail(data.to, data.subject, data.body, {
        isHtml: data.isHtml,
      });
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.EMAIL_STATUS);
  ipcMain.handle(IPC_CHANNELS.EMAIL_STATUS, async () => {
    const settings = getSettingsStore().get("settings");
    return await getConnectionStatus(settings.microsoft);
  });

  ipcMain.removeHandler("email:disconnect");
  ipcMain.handle("email:disconnect", async () => {
    return await disconnectMicrosoft();
  });

  // ---- Calendar ----
  ipcMain.removeHandler(IPC_CHANNELS.CALENDAR_CREATE_MEETING);
  ipcMain.handle(
    IPC_CHANNELS.CALENDAR_CREATE_MEETING,
    async (
      _event,
      data: {
        attendeeEmail: string;
        attendeeName: string;
        subject?: string;
        startTime: string;
        durationMinutes?: number;
      },
    ) => {
      return await createMeeting(data.attendeeEmail, data.attendeeName, {
        ...data,
        startTime: new Date(data.startTime),
      });
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.CALENDAR_AVAILABLE_SLOTS);
  ipcMain.handle(
    IPC_CHANNELS.CALENDAR_AVAILABLE_SLOTS,
    async (
      _event,
      data: {
        startDate: string;
        endDate: string;
        durationMinutes?: number;
      },
    ) => {
      return await getAvailableSlots(
        { start: new Date(data.startDate), end: new Date(data.endDate) },
        data.durationMinutes,
      );
    },
  );

  // ---- Settings ----
  ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_GET);
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return getSettingsStore().get("settings");
  });

  ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_UPDATE);
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_UPDATE,
    (_event, updates: Partial<AppSettings>) => {
      const current = getSettingsStore().get("settings");
      const merged = { ...current, ...updates };
      getSettingsStore().set("settings", merged);

      // Notify background processes about updated settings
      updateWorkerSettings(merged);
      import("./campaign/pipelineRunner").then(({ pipelineRunner }) => {
         pipelineRunner.updateSettings(merged);
      });

      logActivity("settings_updated", "settings", {
        updatedKeys: Object.keys(updates),
      });
      return merged;
    },
  );

  // ---- Activity Log ----
  ipcMain.removeHandler(IPC_CHANNELS.ACTIVITY_LIST);
  ipcMain.handle(
    IPC_CHANNELS.ACTIVITY_LIST,
    (_event, data?: { limit?: number; module?: string }) => {
      const db = getDatabase();
      let query = "SELECT * FROM activity_log";
      const params: unknown[] = [];

      if (data?.module) {
        query += " WHERE module = ?";
        params.push(data.module);
      }

      query += " ORDER BY created_at DESC LIMIT ?";
      params.push(data?.limit || 50);

      return db.prepare(query).all(...params);
    },
  );

  // ---- Campaigns ----
  ipcMain.removeHandler(IPC_CHANNELS.CAMPAIGN_CREATE);
  ipcMain.handle(
    IPC_CHANNELS.CAMPAIGN_CREATE,
    async (
      _event,
      data: {
        name: string;
        description: string;
        leadUrls: string[];
      },
    ) => {
      const { CampaignRunner } = await import("./campaign/orchestrator");
      const settings = getSettingsStore().get("settings");
      const runner = new CampaignRunner(settings);
      const campaign = {
        id: uuidv4(),
        name: data.name,
        description: data.description,
        status: "draft" as const,
        steps: [],
        leadIds: [],
        stats: {
          totalLeads: data.leadUrls.length,
          connectionsSent: 0,
          connectionsAccepted: 0,
          emailsSent: 0,
          emailsOpened: 0,
          repliesReceived: 0,
          meetingsBooked: 0,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const id = runner.registerCampaign(campaign, data.leadUrls);
      return { success: true, campaignId: id };
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.CAMPAIGN_UPDATE);
  ipcMain.handle(
    IPC_CHANNELS.CAMPAIGN_UPDATE,
    (_event, data: { campaignId: string; updates: Partial<Campaign> | any }) => {
      const db = getDatabase();
      const updatesObj = data.updates;
      if (Object.keys(updatesObj).length === 0) return { success: true };

      const setClauses: string[] = [];
      const params: any[] = [];

      if (updatesObj.name !== undefined) {
        setClauses.push("name = ?");
        params.push(updatesObj.name);
      }
      if (updatesObj.description !== undefined) {
        setClauses.push("description = ?");
        params.push(updatesObj.description);
      }
      if (updatesObj.steps !== undefined) {
        setClauses.push("steps_json = ?");
        params.push(JSON.stringify(updatesObj.steps));
      }

      if (setClauses.length > 0) {
        setClauses.push("updated_at = ?");
        params.push(new Date().toISOString());
        params.push(data.campaignId);

        const query = `UPDATE campaigns SET ${setClauses.join(", ")} WHERE id = ?`;
        db.prepare(query).run(...params);

        logActivity("campaign_updated", "campaign", {
          campaignId: data.campaignId,
        });
      }

      return { success: true };
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.CAMPAIGN_START);
  ipcMain.handle(IPC_CHANNELS.CAMPAIGN_START, async (_event, campaignId: string) => {
    const { CampaignRunner } = await import("./campaign/orchestrator");
    const settings = getSettingsStore().get("settings");
    const runner = new CampaignRunner(settings);
    await runner.startCampaign(campaignId);
    return { success: true };
  });

  ipcMain.removeHandler(IPC_CHANNELS.CAMPAIGN_PAUSE);
  ipcMain.handle(IPC_CHANNELS.CAMPAIGN_PAUSE, async (_event, campaignId: string) => {
    const { CampaignRunner } = await import("./campaign/orchestrator");
    const settings = getSettingsStore().get("settings");
    const runner = new CampaignRunner(settings);
    runner.pauseCampaign(campaignId);
    return { success: true };
  });

  // ---- Helpers ----
  const mapLeadToSharedType = (l: any) => ({
    id: l.id,
    firstName: l.first_name || (l.linkedin_url || "").split("/").pop() || "Unknown",
    lastName: l.last_name || "",
    company: l.company || "Unknown Company",
    role: l.headline || "Unknown Title",
    status: l.status,
    profileImageUrl: l.profile_image_url || "",
    linkedinUrl: l.linkedin_url,
    score: l.score || 0,
    tags: JSON.parse(l.tags_json || "[]"),
    scrapedAt: l.scraped_at,
    location: l.location || "",
    about: l.about || "",
    email: l.email || "",
    phone: l.phone_number || "",
    experience: JSON.parse(l.experience_json || "[]"),
    education: JSON.parse(l.education_json || "[]"),
    skills: JSON.parse(l.skills_json || "[]"),
    connectionDegree: l.connection_degree || "3rd",
    rawData: JSON.parse(l.raw_data_json || "{}")
  });

  ipcMain.removeHandler(IPC_CHANNELS.CAMPAIGN_LIST);
  ipcMain.handle(IPC_CHANNELS.CAMPAIGN_LIST, () => {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT * FROM campaigns ORDER BY created_at DESC")
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      description: r.description || "",
      steps: JSON.parse(r.steps_json || "[]"),
      createdAt: r.created_at,
    }));
  });

  ipcMain.removeHandler(IPC_CHANNELS.CAMPAIGN_STATUS);
  ipcMain.handle(IPC_CHANNELS.CAMPAIGN_STATUS, (_event, campaignId: string) => {
    const db = getDatabase();
    const campaign = db
      .prepare("SELECT * FROM campaigns WHERE id = ?")
      .get(campaignId) as any;
    if (!campaign) return null;
    const leads = db
      .prepare("SELECT * FROM leads WHERE campaign_id = ?")
      .all(campaignId);
    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        description: campaign.description || "",
        steps: JSON.parse(campaign.steps_json || "[]"),
      },
      leads: leads.map(mapLeadToSharedType),
      stats: {
        total: leads.length,
        byStatus: leads.reduce((acc: any, l: any) => {
          acc[l.status] = (acc[l.status] || 0) + 1;
          return acc;
        }, {}),
      },
    };
  });

  // ---- Leads ----
  ipcMain.removeHandler(IPC_CHANNELS.LEAD_SAVE);
  ipcMain.handle(
    IPC_CHANNELS.LEAD_SAVE,
    (_event, data: {
      linkedinUrl: string;
      firstName?: string;
      lastName?: string;
      headline?: string;
      company?: string;
      location?: string;
      about?: string;
      campaignId?: string;
    }) => {
      const db = getDatabase();
      const id = uuidv4();
      // Use INSERT OR IGNORE to handle duplicate linkedin_url gracefully
      const nowNode = new Date().toISOString();
      const result = db.prepare(`
        INSERT OR IGNORE INTO leads (id, linkedin_url, first_name, last_name, headline, company, location, about, status, campaign_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
      `).run(
        id,
        data.linkedinUrl,
        data.firstName || "",
        data.lastName || "",
        data.headline || "",
        data.company || "",
        data.location || "",
        data.about || "",
        data.campaignId || null,
        nowNode,
        nowNode
      );
      if (result.changes === 0) {
        // Already exists — return existing
        const existing = db.prepare("SELECT id FROM leads WHERE linkedin_url = ?").get(data.linkedinUrl) as any;
        return { success: true, leadId: existing?.id || id, duplicate: true };
      }
      logActivity("lead_saved", "pipeline", { leadId: id, url: data.linkedinUrl });
      return { success: true, leadId: id, duplicate: false };
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.CAMPAIGN_DELETE);
  ipcMain.handle(IPC_CHANNELS.CAMPAIGN_DELETE, async (_event, campaignId: string) => {
    try {
      const db = getDatabase();
      db.transaction(() => {
        // 1. Get all leads for this campaign
        const leads = db.prepare("SELECT id FROM leads WHERE campaign_id = ?").all(campaignId) as any[];
        const leadIds = leads.map(l => l.id);

        if (leadIds.length > 0) {
          const placeholders = leadIds.map(() => "?").join(",");
          
          db.prepare(`DELETE FROM connection_checks WHERE lead_id IN (${placeholders})`).run(...leadIds);
          db.prepare(`DELETE FROM conversations WHERE lead_id IN (${placeholders})`).run(...leadIds);
          db.prepare(`DELETE FROM emails WHERE lead_id IN (${placeholders})`).run(...leadIds);
          
          // Cancel jobs in queue by matching leadId in the JSON payload
          for (const leadId of leadIds) {
            db.prepare(
              `UPDATE job_queue SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
               WHERE status IN ('pending', 'running') AND json_extract(payload, '$.leadId') = ?`
            ).run(leadId);
          }
          
          db.prepare("DELETE FROM leads WHERE campaign_id = ?").run(campaignId);
        }

        db.prepare("DELETE FROM campaigns WHERE id = ?").run(campaignId);
      })();

      logActivity("campaign_deleted", "campaign", { campaignId });
      return { success: true };
    } catch (e) {
      console.error("Failed to delete campaign:", e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.removeHandler(IPC_CHANNELS.LEAD_DELETE);
  ipcMain.handle(
    IPC_CHANNELS.LEAD_DELETE,
    (_event, leadId: string) => {
      try {
        const db = getDatabase();
        let changes = 0;
        db.transaction(() => {
          // 1. Cancel ALL pending/running queue jobs for this lead
          db.prepare(
            `UPDATE job_queue SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE status IN ('pending', 'running') AND json_extract(payload, '$.leadId') = ?`
          ).run(leadId);
          
          // 2. Delete related records
          db.prepare("DELETE FROM connection_checks WHERE lead_id = ?").run(leadId);
          db.prepare("DELETE FROM conversations WHERE lead_id = ?").run(leadId);
          db.prepare("DELETE FROM emails WHERE lead_id = ?").run(leadId);
          
          const result = db.prepare("DELETE FROM leads WHERE id = ?").run(leadId);
          changes = result.changes;
        })();
        
        if (changes > 0) {
          logActivity("lead_deleted", "pipeline", { leadId });
          return { success: true };
        }
        return { success: false, error: "Lead not found" };
      } catch (e: any) {
        console.error("Failed to delete lead:", e);
        return { success: false, error: e.message || "Failed to remove lead" };
      }
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.LEAD_LIST);
  ipcMain.handle(
    IPC_CHANNELS.LEAD_LIST,
    (_event, data?: { status?: string; limit?: number }) => {
      const db = getDatabase();
      const status = data?.status || "all";
      const limit = data?.limit || 1000;

      let query = "SELECT leads.*, campaigns.name as campaign_name FROM leads LEFT JOIN campaigns ON leads.campaign_id = campaigns.id";
      const params: any[] = [];

      if (status !== "all") {
        query += " WHERE leads.status = ?";
        params.push(status);
      }

      query += " ORDER BY leads.updated_at DESC LIMIT ?";
      params.push(limit);

      const rows = db.prepare(query).all(...params) as any[];
      return rows.map((l: any) => ({
        ...mapLeadToSharedType(l),
        campaignId: l.campaign_id,
        campaignName: l.campaign_name
      }));
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.LEAD_GET);
  ipcMain.handle(IPC_CHANNELS.LEAD_GET, (_event, leadId: string) => {
    const db = getDatabase();
    return db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);
  });

  // ---- Campaign Add Leads ----
  ipcMain.removeHandler(IPC_CHANNELS.CAMPAIGN_ADD_LEADS);
  ipcMain.handle(
    IPC_CHANNELS.CAMPAIGN_ADD_LEADS,
    (_event, data: { campaignId: string; leadUrls: string[] }) => {
      const db = getDatabase();
      const insertLead = db.prepare(`
        INSERT OR IGNORE INTO leads (id, campaign_id, linkedin_url, status, created_at, updated_at)
        VALUES (?, ?, ?, 'queued', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      `);
      let added = 0;
      const addedLeads: { id: string, url: string }[] = [];
      
      const campaign = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(data.campaignId) as any;
      const isActive = campaign?.status === "active";

      db.transaction(() => {
        for (const url of data.leadUrls) {
          const trimmed = url.trim();
          if (!trimmed) continue;
          const id = uuidv4();
          const result = insertLead.run(id, data.campaignId, trimmed);
          if (result.changes > 0) {
            added++;
            if (isActive) addedLeads.push({ id, url: trimmed });
          }
        }
      })();

      if (isActive && addedLeads.length > 0) {
        let delay = 0;
        for (const lead of addedLeads) {
          jobQueue.enqueue<ScrapeProfilePayload>(
            JOB_TYPES.SCRAPE_PROFILE,
            { leadId: lead.id, linkedinUrl: lead.url, campaignId: data.campaignId },
            { delayMs: delay }
          );
          delay += 60000 + Math.random() * 120000;
        }
      }
      logActivity("campaign_leads_added", "campaign", {
        campaignId: data.campaignId,
        added,
        total: data.leadUrls.length,
      });
      return { success: true, added, duplicates: data.leadUrls.length - added };
    },
  );

  // ---- Campaign Import From Page (AI bulk scraper + human-mimicry outreach) ----
  ipcMain.removeHandler(IPC_CHANNELS.CAMPAIGN_IMPORT_FROM_PAGE);
  ipcMain.handle(
    IPC_CHANNELS.CAMPAIGN_IMPORT_FROM_PAGE,
    async (_event, data: { campaignId: string; pageUrl: string }) => {
      try {
        const db = getDatabase();

        // ── Hard guard: refuse to import if campaign is not active ──────────
        const campaignCheck = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(data.campaignId) as any;
        if (!campaignCheck) {
          return { success: false, error: "Campaign not found." };
        }
        if (campaignCheck.status !== "active") {
          return { success: false, error: "Campaign is paused. Resume the campaign before importing leads." };
        }

        const settings = getSettingsStore().get("settings");

        // Initialize limitManager for outreach (same pattern as autopilot handler)
        if (!limitManager) {
          limitManager = new DailyLimitManager(
            {
              connectionRequests: settings.dailyLimits.connectionRequests,
              profileViews: settings.dailyLimits.profileViews,
              messages: settings.dailyLimits.messages,
              postEngagements: settings.dailyLimits.postEngagements,
            },
            settings.dailyLimits.randomizePercent,
          );
        }

        // Ensure browser is running
        const browserStatus = getBrowserStatus();
        if (browserStatus.status !== "running") {
          await launchBrowser();
        }

        // Track what the AI actually visits (inserted one-by-one via callback)
        let added = 0;
        let duplicates = 0;

        // Pre-load existing URLs for deduplication
        const existingLeads = db.prepare("SELECT linkedin_url FROM leads WHERE campaign_id = ?").all(data.campaignId) as any[];
        const existingUrls = new Set(existingLeads.map((l: any) => (l.linkedin_url || "").toLowerCase().trim()));

        const insertLead = db.prepare(`
          INSERT OR IGNORE INTO leads (id, campaign_id, linkedin_url, first_name, last_name, headline, company, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        `);

        const campaign = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(data.campaignId) as any;
        const isActive = campaign?.status === "active";

        // ── Profile-by-profile callback ────────────────────────────────────────
        // This fires IMMEDIATELY after the AI clicks and scrapes each profile.
        // Only profiles the AI actually visits get added to the queue.
        const onProfileScraped = (profile: {
          name: string;
          title: string;
          company: string;
          location: string;
          profileUrl: string;
        }) => {
          const url = (profile.profileUrl || "").trim();
          if (!url || !url.includes("linkedin.com")) return;

          const urlKey = url.toLowerCase();
          if (existingUrls.has(urlKey)) {
            duplicates++;
            return;
          }

          const nameParts = (profile.name || "").trim().split(" ");
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";
          const id = uuidv4();

          const result = insertLead.run(
            id,
            data.campaignId,
            url,
            firstName,
            lastName,
            profile.title || "",
            profile.company || "",
          );

          if (result.changes > 0) {
            added++;
            existingUrls.add(urlKey);
            console.log(`[CampaignImport] ✅ Profile added to queue: "${profile.name}" → ${url} (total: ${added})`);

            // Enqueue a scrape job for active campaigns immediately
            if (isActive) {
              jobQueue.enqueue<ScrapeProfilePayload>(
                JOB_TYPES.SCRAPE_PROFILE,
                { leadId: id, linkedinUrl: url, campaignId: data.campaignId },
                { delayMs: 0 }
              );
            }

            logActivity("lead_queued_from_import", "campaign", {
              campaignId: data.campaignId,
              name: profile.name,
              url,
            });
          } else {
            duplicates++;
          }
        };

        // Run the AI import — profiles added one-by-one via onProfileScraped callback
        const scrapedProfiles = await importFromSearchUrl(data.pageUrl, 100, {
          settings,
          limitManager,
          campaignId: data.campaignId,
          onProfileScraped,
        });

        if (!scrapedProfiles || scrapedProfiles.length === 0) {
          return { success: false, error: "No profiles found on page. Make sure you are logged in and the URL is a valid LinkedIn listing page (search results, company people, or alumni page)." };
        }

        logActivity("campaign_page_import", "campaign", {
          campaignId: data.campaignId,
          pageUrl: data.pageUrl,
          scrapedTotal: scrapedProfiles.length,
          addedToQueue: added,
          duplicates,
        });

        return { success: true, added, duplicates, total: scrapedProfiles.length };
      } catch (err: any) {
        console.error("Campaign page import failed:", err);
        return { success: false, error: err?.message || "Import failed. Make sure browser is running and you are logged into LinkedIn." };
      }
    },
  );


  ipcMain.removeHandler(IPC_CHANNELS.CONTENT_SCHEDULE);
  ipcMain.handle(
    IPC_CHANNELS.CONTENT_SCHEDULE,
    async (
      _event,
      data: {
        content: string;
        type: string;
        scheduledAt: string;
        hashtags?: string[];
      },
    ) => {
      const { schedulePost } = await import("./content/scheduler");
      const settings = getSettingsStore().get("settings");
      if (!limitManager) {
        limitManager = new DailyLimitManager(
          {
            connectionRequests: settings.dailyLimits.connectionRequests,
            profileViews: settings.dailyLimits.profileViews,
            messages: settings.dailyLimits.messages,
            postEngagements: settings.dailyLimits.postEngagements,
          },
          settings.dailyLimits.randomizePercent,
        );
      }
      const post = {
        id: uuidv4(),
        content: data.content,
        type: data.type as any,
        scheduledAt: data.scheduledAt,
        hashtags: data.hashtags || [],
        mediaUrls: [],
        publishedAt: null,
        status: "scheduled" as const,
        engagement: null,
      };
      return schedulePost(post, limitManager);
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.CONTENT_CANCEL);
  ipcMain.handle(
    IPC_CHANNELS.CONTENT_CANCEL,
    async (_event, postId: string) => {
      const { cancelScheduledPost } = await import("./content/scheduler");
      return { success: cancelScheduledPost(postId) };
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.CONTENT_LIST);
  ipcMain.handle(IPC_CHANNELS.CONTENT_LIST, async () => {
    const { getScheduledPosts } = await import("./content/scheduler");
    return getScheduledPosts();
  });

  ipcMain.removeHandler(IPC_CHANNELS.CONTENT_SUGGEST_TIMES);
  ipcMain.handle(IPC_CHANNELS.CONTENT_SUGGEST_TIMES, async () => {
    const { suggestPostingTimes } = await import("./content/scheduler");
    return suggestPostingTimes();
  });

  ipcMain.removeHandler(IPC_CHANNELS.CONTENT_PUBLISH);
  ipcMain.handle(
    IPC_CHANNELS.CONTENT_PUBLISH,
    async (_event, data: { content: string }) => {
      const { createTextPost } = await import("./content/scheduler");
      const settings = getSettingsStore().get("settings");
      if (!limitManager) {
        limitManager = new DailyLimitManager(
          {
            connectionRequests: settings.dailyLimits.connectionRequests,
            profileViews: settings.dailyLimits.profileViews,
            messages: settings.dailyLimits.messages,
            postEngagements: settings.dailyLimits.postEngagements,
          },
          settings.dailyLimits.randomizePercent,
        );
      }
      return await createTextPost(data.content, limitManager);
    },
  );

  // ---- Engagement ----
  ipcMain.removeHandler(IPC_CHANNELS.ENGAGEMENT_RUN_SESSION);
  ipcMain.handle(
    IPC_CHANNELS.ENGAGEMENT_RUN_SESSION,
    async (
      _event,
      data?: {
        maxActions?: number;
        likeRatio?: number;
        commentRatio?: number;
      },
    ) => {
      const { runEngagementSession } = await import("./engagement/feed");
      const settings = getSettingsStore().get("settings");
      if (!limitManager) {
        limitManager = new DailyLimitManager(
          {
            connectionRequests: settings.dailyLimits.connectionRequests,
            profileViews: settings.dailyLimits.profileViews,
            messages: settings.dailyLimits.messages,
            postEngagements: settings.dailyLimits.postEngagements,
          },
          settings.dailyLimits.randomizePercent,
        );
      }
      return await runEngagementSession(settings, limitManager, data);
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.ENGAGEMENT_REPLY_COMMENTS);
  ipcMain.handle(
    IPC_CHANNELS.ENGAGEMENT_REPLY_COMMENTS,
    async (_event, data?: { maxReplies?: number }) => {
      const { replyToOwnPostComments } = await import("./engagement/feed");
      const settings = getSettingsStore().get("settings");
      if (!limitManager) {
        limitManager = new DailyLimitManager(
          {
            connectionRequests: settings.dailyLimits.connectionRequests,
            profileViews: settings.dailyLimits.profileViews,
            messages: settings.dailyLimits.messages,
            postEngagements: settings.dailyLimits.postEngagements,
          },
          settings.dailyLimits.randomizePercent,
        );
      }
      return await replyToOwnPostComments(
        settings,
        limitManager,
        data?.maxReplies,
      );
    },
  );

  // ---- Sales Navigator ----
  ipcMain.removeHandler(IPC_CHANNELS.SALES_NAV_DETECT);
  ipcMain.handle(IPC_CHANNELS.SALES_NAV_DETECT, async () => {
    const { detectSalesNavigator } = await import("./linkedin/salesNavigator");
    return await detectSalesNavigator();
  });

  ipcMain.removeHandler(IPC_CHANNELS.SALES_NAV_SEARCH);
  ipcMain.handle(
    IPC_CHANNELS.SALES_NAV_SEARCH,
    async (
      _event,
      data: {
        filters: any;
        maxResults?: number;
      },
    ) => {
      const { searchSalesNavLeads } = await import("./linkedin/salesNavigator");
      return await searchSalesNavLeads(data.filters, data.maxResults);
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.SALES_NAV_SCRAPE);
  ipcMain.handle(
    IPC_CHANNELS.SALES_NAV_SCRAPE,
    async (_event, salesNavUrl: string) => {
      const { scrapeSalesNavProfile } =
        await import("./linkedin/salesNavigator");
      return await scrapeSalesNavProfile(salesNavUrl);
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.SALES_NAV_INMAIL);
  ipcMain.handle(
    IPC_CHANNELS.SALES_NAV_INMAIL,
    async (
      _event,
      data: {
        salesNavUrl: string;
        subject: string;
        body: string;
      },
    ) => {
      const { sendInMail } = await import("./linkedin/salesNavigator");
      return await sendInMail(data.salesNavUrl, data.subject, data.body);
    },
  );

  // ---- Email Templates ----
  ipcMain.removeHandler(IPC_CHANNELS.EMAIL_TEMPLATES_LIST);
  ipcMain.handle(IPC_CHANNELS.EMAIL_TEMPLATES_LIST, () => {
    return getEmailTemplates();
  });

  ipcMain.removeHandler(IPC_CHANNELS.EMAIL_TEMPLATES_SAVE);
  ipcMain.handle(
    IPC_CHANNELS.EMAIL_TEMPLATES_SAVE,
    (
      _event,
      template: {
        id: string;
        name: string;
        subject: string;
        body: string;
        variables: string[];
        type: string;
      },
    ) => {
      saveEmailTemplate(template);
      logActivity("template_saved", "settings", { templateId: template.id });
      return { success: true };
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.EMAIL_TEMPLATES_DELETE);
  ipcMain.handle(IPC_CHANNELS.EMAIL_TEMPLATES_DELETE, (_event, id: string) => {
    deleteEmailTemplate(id);
    logActivity("template_deleted", "settings", { templateId: id });
    return { success: true };
  });

  // ---- Connection Checker ----
  ipcMain.removeHandler(IPC_CHANNELS.CONNECTION_CHECKER_START);
  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_CHECKER_START,
    async (_event, intervalMinutes?: number) => {
      const { startConnectionChecker } =
        await import("./linkedin/connectionChecker");
      const settings = getSettingsStore().get("settings");
      startConnectionChecker(settings, intervalMinutes || 60);
      return { success: true };
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.CONNECTION_CHECKER_STOP);
  ipcMain.handle(IPC_CHANNELS.CONNECTION_CHECKER_STOP, async () => {
    const { stopConnectionChecker } =
      await import("./linkedin/connectionChecker");
    stopConnectionChecker();
    return { success: true };
  });

  ipcMain.removeHandler(IPC_CHANNELS.CONNECTION_CHECKER_RUN);
  ipcMain.handle(IPC_CHANNELS.CONNECTION_CHECKER_RUN, async () => {
    const { checkAllPendingConnections } =
      await import("./linkedin/connectionChecker");
    const settings = getSettingsStore().get("settings");
    return await checkAllPendingConnections(settings);
  });

  ipcMain.removeHandler(IPC_CHANNELS.CONNECTION_CHECKER_HISTORY);
  ipcMain.handle(IPC_CHANNELS.CONNECTION_CHECKER_HISTORY, async () => {
    const { getRecentChecks } = await import("./linkedin/connectionChecker");
    return getRecentChecks(50);
  });

  // ---- System ----
  ipcMain.removeHandler(IPC_CHANNELS.SYSTEM_GET_DB_PATH);
  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_DB_PATH, async () => {
    const path = await import("path");
    return path.join(app.getPath("userData"), "virtulinked.db");
  });

  // ---- Inbox ----

  // Get inbox browser status (no launch triggered)
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_BROWSER_STATUS);
  ipcMain.handle(IPC_CHANNELS.INBOX_BROWSER_STATUS, () => {
    return getInboxBrowserStatus();
  });

  // Scrape ALL conversations from LinkedIn messaging sidebar → persist to inbox_contacts
  ipcMain.removeHandler('inbox:scrape-all');
  ipcMain.handle('inbox:scrape-all', async () => {
    try {
      const inboxPage = await getInboxPage();
      const conversations = await scrapeAllLinkedInConversations(inboxPage);
      if (conversations.length === 0) {
        return { success: false, error: 'No conversations found. Make sure you are logged into LinkedIn in the inbox browser.', count: 0 };
      }

      const db = getDatabase();
      const upsert = db.prepare(`
        INSERT INTO inbox_contacts (id, name, headline, avatar_url, thread_url, last_message, last_message_at, unread_count, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          headline = excluded.headline,
          avatar_url = excluded.avatar_url,
          last_message = excluded.last_message,
          last_message_at = excluded.last_message_at,
          unread_count = excluded.unread_count,
          synced_at = excluded.synced_at
      `);

      // Also try to match contacts to existing leads
      const matchLead = db.prepare(`SELECT id FROM leads WHERE first_name || ' ' || last_name LIKE ? LIMIT 1`);

      db.transaction(() => {
        for (const conv of conversations) {
          // Use thread URL as stable ID key (hash it)
          const id = Buffer.from(conv.threadUrl).toString('base64').slice(0, 40);
          const existingLead = matchLead.get(`%${conv.name}%`) as any;
          upsert.run(
            id, conv.name, conv.headline, conv.avatarUrl, conv.threadUrl,
            conv.lastMessage, conv.lastMessageAt, conv.unreadCount,
            new Date().toISOString()
          );
          // Link to lead if matched
          if (existingLead) {
            db.prepare('UPDATE inbox_contacts SET lead_id = ? WHERE id = ?').run(existingLead.id, id);
          }
        }
      })();

      logActivity('inbox_scrape_all_done', 'inbox', { count: conversations.length });
      return { success: true, count: conversations.length };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Scrape failed', count: 0 };
    }
  });

  // Get ALL inbox entries: inbox_contacts (full LinkedIn sidebar) merged with known leads
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_GET_LEADS);
  ipcMain.handle(IPC_CHANNELS.INBOX_GET_LEADS, () => {
    const db = getDatabase();

    // inbox_contacts rows (from scrape-all)
    const contacts = db.prepare(`
      SELECT
        ic.id, ic.name, ic.headline, ic.avatar_url, ic.thread_url,
        ic.last_message, ic.last_message_at, ic.unread_count, ic.lead_id,
        l.first_name, l.last_name, l.company, l.linkedin_url,
        l.status as lead_status, l.chatbot_state,
        l.profile_image_url
      FROM inbox_contacts ic
      LEFT JOIN leads l ON ic.lead_id = l.id
      ORDER BY ic.last_message_at DESC
    `).all() as any[];

    // Also grab leads that have conversations but no inbox_contact row yet
    const leadsWithConvos = db.prepare(`
      SELECT
        l.id, l.first_name, l.last_name, l.headline, l.company,
        l.linkedin_url, l.thread_url, l.status, l.chatbot_state,
        l.profile_image_url,
        (SELECT content FROM conversations WHERE lead_id = l.id ORDER BY sent_at DESC LIMIT 1) as last_message,
        (SELECT sent_at FROM conversations WHERE lead_id = l.id ORDER BY sent_at DESC LIMIT 1) as last_message_at,
        (
          SELECT COUNT(*) FROM conversations
          WHERE lead_id = l.id AND direction = 'inbound'
            AND sent_at > COALESCE((
              SELECT sent_at FROM conversations
              WHERE lead_id = l.id AND direction = 'outbound'
              ORDER BY sent_at DESC LIMIT 1
            ), '1970-01-01')
        ) as unread_count
      FROM leads l
      WHERE
        l.id NOT IN (SELECT lead_id FROM inbox_contacts WHERE lead_id IS NOT NULL)
        AND (
          l.status IN ('connected','welcome_sent','in_conversation','handed_off','meeting_booked')
          OR l.id IN (SELECT DISTINCT lead_id FROM conversations)
        )
      ORDER BY last_message_at DESC
    `).all() as any[];

    // Build unified list: inbox_contacts first (includes all LinkedIn conversations)
    const unified: any[] = [];
    const seenIds = new Set<string>();

    for (const c of contacts) {
      const id = c.lead_id || c.id;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      unified.push({
        id,
        inboxContactId: c.id,
        firstName: c.first_name || c.name?.split(' ')[0] || '',
        lastName: c.last_name || c.name?.split(' ').slice(1).join(' ') || '',
        fullName: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        headline: c.headline || '',
        company: c.company || '',
        linkedinUrl: c.linkedin_url || '',
        threadUrl: c.thread_url || '',
        status: c.lead_status || 'contact',
        chatbotState: c.chatbot_state || 'idle',
        profileImageUrl: c.profile_image_url || c.avatar_url || '',
        lastMessage: c.last_message || '',
        lastMessageAt: c.last_message_at || '',
        unreadCount: c.unread_count || 0,
        isLinkedInContact: true,
      });
    }

    for (const l of leadsWithConvos) {
      if (seenIds.has(l.id)) continue;
      seenIds.add(l.id);
      unified.push({
        id: l.id,
        inboxContactId: null,
        firstName: l.first_name || '',
        lastName: l.last_name || '',
        fullName: `${l.first_name || ''} ${l.last_name || ''}`.trim(),
        headline: l.headline || '',
        company: l.company || '',
        linkedinUrl: l.linkedin_url || '',
        threadUrl: l.thread_url || '',
        status: l.status || 'contact',
        chatbotState: l.chatbot_state || 'idle',
        profileImageUrl: l.profile_image_url || '',
        lastMessage: l.last_message || '',
        lastMessageAt: l.last_message_at || '',
        unreadCount: l.unread_count || 0,
        isLinkedInContact: false,
      });
    }

    return unified;
  });

  // Get all stored messages for a lead from DB (fast, no Puppeteer)
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_GET_MESSAGES);
  ipcMain.handle(IPC_CHANNELS.INBOX_GET_MESSAGES, (_event, leadId: string) => {
    const db = getDatabase();
    return db.prepare(
      'SELECT id, lead_id, direction, content, platform, is_automated, sent_at FROM conversations WHERE lead_id = ? ORDER BY sent_at ASC'
    ).all(leadId).map((r: any) => ({
      id: r.id,
      leadId: r.lead_id,
      direction: r.direction,
      content: r.content,
      platform: r.platform,
      isAutomated: !!r.is_automated,
      sentAt: r.sent_at,
    }));
  });

  // Sync a lead's thread from LinkedIn using the inbox browser
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_SYNC_THREAD);
  ipcMain.handle(IPC_CHANNELS.INBOX_SYNC_THREAD, async (_event, leadId: string) => {
    try {
      const db = getDatabase();
      const lead = db.prepare('SELECT first_name, last_name FROM leads WHERE id = ?').get(leadId) as any;
      if (!lead) return { success: false, error: 'Lead not found', messages: [] };

      const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';
      const inboxPage = await getInboxPage(); // singleton — launches once
      const messages = await scrapeAndSaveThread(leadId, fullName, inboxPage);
      return { success: true, messages };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Sync failed', messages: [] };
    }
  });

  // Send a manual message from inbox (uses inbox browser, marks chatbot handed_off)
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_SEND_MANUAL);
  ipcMain.handle(
    IPC_CHANNELS.INBOX_SEND_MANUAL,
    async (_event, data: { leadId: string; threadId: string; message: string }) => {
      try {
        const inboxPage = await getInboxPage(); // singleton
        const result = await sendReplyInThreadOnPage(
          inboxPage,
          data.threadId || data.leadId,
          data.message,
          { isAutomated: false, leadId: data.leadId }
        );
        return result;
      } catch (err: any) {
        return { success: false, error: err?.message || 'Send failed' };
      }
    }
  );

  // Send welcome DM via campaign browser (automation — doesn't use inbox browser)
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_SEND_WELCOME);
  ipcMain.handle(IPC_CHANNELS.INBOX_SEND_WELCOME, async (_event, leadId: string) => {
    try {
      const db = getDatabase();
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as any;
      if (!lead) return { success: false, message: 'Lead not found' };

      const settings = getSettingsStore().get('settings');
      const profile = {
        id: lead.id,
        linkedinUrl: lead.linkedin_url,
        firstName: lead.first_name || '',
        lastName: lead.last_name || '',
        headline: lead.headline || '',
        company: lead.company || '',
        role: lead.role || '',
        location: lead.location || '',
        about: lead.about || '',
        experience: JSON.parse(lead.experience_json || '[]'),
        education: JSON.parse(lead.education_json || '[]'),
        skills: JSON.parse(lead.skills_json || '[]'),
        recentPosts: JSON.parse(lead.recent_posts_json || '[]'),
        mutualConnections: JSON.parse(lead.mutual_connections_json || '[]'),
        profileImageUrl: lead.profile_image_url || '',
        connectionDegree: lead.connection_degree || '1st',
        isSalesNavigator: !!lead.is_sales_navigator,
        scrapedAt: lead.scraped_at || '',
        rawData: JSON.parse(lead.raw_data_json || '{}'),
      };

      return await sendWelcomeDM(
        profile,
        {
          yourName: settings.profile.name,
          yourCompany: settings.profile.company,
          yourServices: settings.profile.services,
        },
        settings
      );
    } catch (err: any) {
      return { success: false, message: err?.message || 'Welcome DM failed' };
    }
  });

  // Schedule a meeting with a lead
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_SCHEDULE_MEETING);
  ipcMain.handle(
    IPC_CHANNELS.INBOX_SCHEDULE_MEETING,
    async (_event, data: { leadId: string; slotStart: string; durationMinutes?: number }) => {
      try {
        const db = getDatabase();
        const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(data.leadId) as any;
        if (!lead) return { success: false, error: 'Lead not found' };

        const attendeeName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
        const result = await createMeeting(
          lead.email || '',
          attendeeName,
          {
            startTime: new Date(data.slotStart),
            durationMinutes: data.durationMinutes || 30,
            subject: `Meeting with ${attendeeName}`,
          }
        );

        if (result.success) {
          db.prepare(`UPDATE leads SET status = 'meeting_booked', updated_at = ? WHERE id = ?`)
            .run(new Date().toISOString(), data.leadId);
          logActivity('meeting_scheduled_from_inbox', 'inbox', { leadId: data.leadId, slotStart: data.slotStart });
        }

        return result;
      } catch (err: any) {
        return { success: false, error: err?.message || 'Meeting scheduling failed' };
      }
    }
  );

  // Poll LinkedIn for new unread messages (uses campaign browser)
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_POLL_UNREAD);
  ipcMain.handle(IPC_CHANNELS.INBOX_POLL_UNREAD, async () => {
    try {
      const unread = await readUnreadMessages();
      if (unread.length > 0) {
        const db = getDatabase();
        for (const thread of unread) {
          // Try to match to a known lead by senderUrl
          let lead: any = null;
          if (thread.senderUrl) {
            lead = db.prepare('SELECT id FROM leads WHERE linkedin_url LIKE ?').get(`%${thread.senderUrl.split('?')[0]}%`);
          }
          if (lead && thread.lastMessage) {
            const exists = db.prepare('SELECT id FROM conversations WHERE lead_id = ? AND content = ?').get(lead.id, thread.lastMessage);
            if (!exists) {
              db.prepare(`
                INSERT INTO conversations (id, lead_id, direction, content, platform, is_automated, sent_at)
                VALUES (?, ?, 'inbound', ?, 'linkedin', 0, ?)
              `).run(uuidv4(), lead.id, thread.lastMessage, new Date().toISOString());
            }
          }
        }
        // Push event to renderer
        BrowserWindow.getAllWindows()[0]?.webContents.send(IPC_CHANNELS.INBOX_NEW_MESSAGE, { threads: unread });
      }
      return { success: true, count: unread.length };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Poll failed', count: 0 };
    }
  });
}

// ============================================================
// App Lifecycle
// ============================================================

// Prevent duplicate execution if bundler accidentally requires entry twice
if (!(global as any).__VIRTULINKED_BOOTSTRAPPED) {
  (global as any).__VIRTULINKED_BOOTSTRAPPED = true;

  app.whenReady().then(async () => {
    // Initialize settings store first (needed by many modules)
    await initSettingsStore();

    // Set app user model id for Windows
    electronApp.setAppUserModelId("com.vedaailab.virtulinked");

    // Watch for devtools shortcuts in development
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

  // Initialize database
  getDatabase();

  // Start background job worker
  startQueueWorker(getSettingsStore().get("settings"));
  
  // Start pipeline runner
  const { pipelineRunner } = await import("./campaign/pipelineRunner");
  pipelineRunner.init(getSettingsStore().get("settings"));
  pipelineRunner.start();

  // Create the main window
  const mainWindow = createWindow();

  // Setup IPC handlers
  setupIpcHandlers(mainWindow);

  // Start analytics tracking server
  startTrackingServer(3333);

  // Log app start
  logActivity("app_started", "system", {
    version: app.getVersion(),
    platform: process.platform,
  });


  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
} // End of global bootstrap guard

app.on("window-all-closed", async () => {
  // Cleanup
  stopQueueWorker();
  stopTrackingServer();
  
  // Close both browsers
  try {
    await Promise.race([
      Promise.all([closeBrowser(), closeInboxBrowser()]),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
  } catch (e) {}
  
  closeDatabase();

  if (process.platform !== "darwin") {
    app.quit();
  }
});
