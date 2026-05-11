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
  wipeDatabase,
  wipeInboxData,
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
  inboxLogout,
} from "./browser/inbox-engine";
import { processDirectInMail, getInMailHistory, getInMailsForProfile } from "./linkedin/inmailManager";
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

// --- GLOBAL CONSOLE LOG INTERCEPTOR ---
// This ensures that deep backend logs like [Connector], [JobQueue], etc. 
// are mirrored to the activity_log database table so the frontend terminal can show them.
const originalConsoleLog = console.log;
console.log = function(...args) {
  originalConsoleLog.apply(console, args);
  try {
    if (args.length > 0 && typeof args[0] === 'string') {
      const msg = args[0];
      if (msg.startsWith('[Connector]') || 
          msg.startsWith('[JobQueue]') || 
          msg.startsWith('[Orchestrator]') || 
          msg.startsWith('[Scraper]') || 
          msg.startsWith('[InMail]')) {
        
        let mod = 'system';
        if (msg.startsWith('[Connector]')) mod = 'network';
        else if (msg.startsWith('[JobQueue]')) mod = 'queue';
        else if (msg.startsWith('[Orchestrator]')) mod = 'campaign';
        else if (msg.startsWith('[Scraper]')) mod = 'scraper';
        else if (msg.startsWith('[InMail]')) mod = 'inmail';
        
        // Strip the bracket prefix for the action name, e.g. "connector_log"
        const prefixMatch = msg.match(/^\[(.*?)\]/);
        const actionPrefix = prefixMatch ? prefixMatch[1].toLowerCase() + "_log" : "backend_log";
        
        // Send it directly to activity_log
        logActivity(actionPrefix, mod, { message: msg });
      }
    }
  } catch (err) {
    // Silently ignore to avoid infinite logging loops
  }
};

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
        const modules = data.module.split(",").map(m => m.trim());
        const placeholders = modules.map(() => "?").join(",");
        query += ` WHERE module IN (${placeholders})`;
        params.push(...modules);
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
      
      // Auto-start campaign upon creation per user request
      await runner.startCampaign(id);
      
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
  ipcMain.handle(IPC_CHANNELS.CAMPAIGN_IMPORT_FROM_PAGE,
    async (_event, data: { campaignId: string; pageUrl: string }) => {
      try {
        const db = getDatabase();

        // ── Hard guard: refuse to import if campaign is not active ──────────
        const campaignCheck = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(data.campaignId) as any;
        if (!campaignCheck) {
          return { success: false, error: "Campaign not found." };
        }
        
        // Native persistence approach:
        // Instead of manually blocking the main process and scraping right here,
        // we just save the URL natively to the campaign. The pipeline runner will see it
        // and spin up a persistent RUN_SEARCH_IMPORT job that survives app restarts.
        db.prepare(`UPDATE campaigns SET search_url = ? WHERE id = ?`).run(data.pageUrl, data.campaignId);

        console.log(`[CampaignImport] Native persistent Search URL saved for campaign ${data.campaignId}`);
        logActivity("campaign_search_url_assigned", "campaign", {
          campaignId: data.campaignId,
          pageUrl: data.pageUrl,
        });

        return {
          success: true,
          added: 0,
          duplicates: 0,
          totalScraped: 0,
          message: "Search campaign successfully registered. The AI will begin continuous scraping in the background."
        };

      } catch (err: any) {
        console.error("Failed to set campaign search URL:", err);
        return { success: false, error: err.message };
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

  // ---- InMail ----
  ipcMain.removeHandler(IPC_CHANNELS.INMAIL_PROCESS_DIRECT);
  ipcMain.handle(
    IPC_CHANNELS.INMAIL_PROCESS_DIRECT,
    async (_event, data: { profileUrl: string; objective?: string }) => {
      try {
        // InMail uses the inbox browser (createInboxTab) — do NOT launch the campaign browser here.
        const settings = getSettingsStore().get("settings");
        return await processDirectInMail(data.profileUrl, settings, data.objective);
      } catch (err: any) {
        console.error("[Main] INMAIL_PROCESS_DIRECT failed:", err.message);
        return { success: false, error: err.message };
      }
    }
  );

  ipcMain.removeHandler(IPC_CHANNELS.INMAIL_LIST);
  ipcMain.handle(IPC_CHANNELS.INMAIL_LIST, (_event, limit?: number) => {
    try {
      return { success: true, data: getInMailHistory(limit ?? 100) };
    } catch (err: any) {
      return { success: false, error: err.message, data: [] };
    }
  });

  ipcMain.removeHandler(IPC_CHANNELS.INMAIL_GET_FOR_PROFILE);
  ipcMain.handle(IPC_CHANNELS.INMAIL_GET_FOR_PROFILE, (_event, profileUrl: string) => {
    try {
      return { success: true, data: getInMailsForProfile(profileUrl) };
    } catch (err: any) {
      return { success: false, error: err.message, data: [] };
    }
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

  // Launch inbox browser without any other task
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_BROWSER_LAUNCH);
  ipcMain.handle(IPC_CHANNELS.INBOX_BROWSER_LAUNCH, async () => {
    try {
      await getInboxPage();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Logout inbox browser
  ipcMain.removeHandler('inbox:logout');
  ipcMain.handle('inbox:logout', async () => {
    try {
      // 1. Navigate to LinkedIn logout + clear cookies in the inbox browser
      const result = await inboxLogout();
      if (!result.success) return result;

      // 2. Wipe inbox-specific DB data so old-account chats don't show after re-login
      try {
        wipeInboxData();
      } catch (e: any) {
        console.error('[inbox:logout] wipeInboxData failed:', e?.message);
        // Non-fatal — logout itself succeeded
      }

      console.log('[inbox:logout] Logout + inbox data wipe complete. Ready for fresh account sync.');
      return { success: true };
    } catch (e: any) {
      const msg = e?.message || 'Logout failed';
      console.error('[inbox:logout] Error:', msg);
      return { success: false, error: msg };
    }
  });

  // Server-side mutex: prevent concurrent scrape-all runs.
  // Multiple UI calls (autoSync + manual button) was causing 6 parallel scrapes.
  let _scrapeAllRunning = false;

  // Scrape ALL conversations from LinkedIn messaging sidebar → persist to inbox_contacts
  ipcMain.removeHandler('inbox:scrape-all');
  ipcMain.handle('inbox:scrape-all', async () => {
    if (_scrapeAllRunning) {
      console.log('[inbox:scrape-all] Already running — skipping duplicate call.');
      return { success: false, error: 'Sync already in progress', count: 0, busy: true };
    }
    _scrapeAllRunning = true;
    try {
      const inboxPage = await getInboxPage();
      
      const { detectLoggedInAccount } = await import('./linkedin/detectLoggedInAccount');
      const accountUrl = await detectLoggedInAccount(inboxPage);
      if (!accountUrl) {
        return { success: false, error: 'Not logged into LinkedIn in the inbox browser.', count: 0 };
      }

      const db = getDatabase();
      
      // Fetch the global sync checkpoint
      const session = db.prepare(`SELECT last_sync_all_at FROM inbox_sessions WHERE id = 'current' AND is_active = 1`).get() as any;
      const lastSyncStr = session?.last_sync_all_at;
      const lastSyncAllAt = lastSyncStr ? new Date(lastSyncStr).getTime() : null;

      const conversations = await scrapeAllLinkedInConversations(inboxPage, lastSyncAllAt);
      if (conversations.length === 0) {
        return { success: false, error: 'No conversations found.', count: 0 };
      }

      const syncTimestamp = new Date().toISOString();

      // Upsert sidebar contacts with stable-ID deduplication.
      // STRATEGY: Before generating a new ID from the threadUrl, check if an existing
      // inbox_contact record already exists for this account+name. If so, reuse its ID
      // so we UPDATE the existing row instead of INSERT a new duplicate row.
      db.transaction(() => {
        // Prepared statements for stable-ID lookup
        const findExistingByUrl = db.prepare(
          `SELECT id, lead_id FROM inbox_contacts WHERE linkedin_account_id = ? AND thread_url = ? AND thread_url != '' LIMIT 1`
        );
        const findExistingByName = db.prepare(
          `SELECT id, lead_id FROM inbox_contacts WHERE linkedin_account_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`
        );
        const matchLeadByName = db.prepare(`SELECT id FROM leads WHERE LOWER(first_name || ' ' || last_name) LIKE ? LIMIT 1`);
        const matchLeadByUrl = db.prepare(`SELECT id FROM leads WHERE thread_url = ? AND thread_url != '' LIMIT 1`);

        const upsert = db.prepare(`
          INSERT INTO inbox_contacts (id, linkedin_account_id, name, headline, avatar_url, thread_url, conversation_id, last_message, last_message_at, unread_count, sidebar_position, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            linkedin_account_id = excluded.linkedin_account_id,
            name = excluded.name,
            headline = excluded.headline,
            avatar_url = excluded.avatar_url,
            thread_url = CASE WHEN excluded.thread_url != '' THEN excluded.thread_url ELSE inbox_contacts.thread_url END,
            conversation_id = CASE WHEN excluded.conversation_id != '' THEN excluded.conversation_id ELSE inbox_contacts.conversation_id END,
            last_message = excluded.last_message,
            last_message_at = excluded.last_message_at,
            unread_count = excluded.unread_count,
            sidebar_position = excluded.sidebar_position,
            synced_at = excluded.synced_at,
            has_new_messages = CASE WHEN inbox_contacts.last_message != excluded.last_message THEN 1 ELSE inbox_contacts.has_new_messages END
        `);

        for (const conv of conversations) {
          // ── Ghost-name guard ────────────────────────────────────────────────────
          // LinkedIn accessibility labels sometimes leak as conversation names.
          // Skip any name matching these patterns — they are never real lead names.
          const ghostPatterns = [
            /^reply to conversation/i,
            /^conversation with [\"']/i,
            /^new message from/i,
            /^message from/i,
            /^send a message to/i,
          ];
          if (ghostPatterns.some(p => p.test((conv.name || '').trim()))) {
            console.log(`[inbox:scrape-all] Skipping ghost entry: "${conv.name}"`);
            continue;
          }

          const isValidThread = conv.threadUrl && conv.threadUrl.includes('/thread/');

          // ── Stable-ID Resolution ──────────────────────────────────────────────
          // Priority 1: Reuse an existing contact row that already has this threadUrl.
          let existingContact: any = null;
          if (isValidThread) {
            existingContact = findExistingByUrl.get(accountUrl, conv.threadUrl);
          }
          // Priority 2: Reuse an existing contact row that has the same name for this account
          // (handles the case where the previous sync had no threadUrl yet).
          if (!existingContact && conv.name) {
            existingContact = findExistingByName.get(accountUrl, conv.name.trim());
          }

          // Determine the stable ID: reuse existing if found, otherwise derive a new one.
          const idSource = isValidThread ? conv.threadUrl : (conv.name || `unknown-${Date.now()}`);
          const derivedId = Buffer.from(idSource).toString('base64').slice(0, 40);
          const id = existingContact ? existingContact.id : derivedId;

          // If the existing contact had a name-based ID and we now have a threadUrl,
          // we want to also update the thread_url on that existing row (handled by ON CONFLICT).

          // ── Lead Linkage ─────────────────────────────────────────────────────
          let existingLeadId: string | null = existingContact?.lead_id || null;
          if (!existingLeadId) {
            let lead: any = null;
            if (isValidThread) lead = matchLeadByUrl.get(conv.threadUrl);
            if (!lead && conv.name) {
              const cleanName = conv.name.replace(/[^\p{L}\p{N}\s]/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
              if (cleanName.length > 2) lead = matchLeadByName.get(`%${cleanName}%`);
            }
            existingLeadId = lead?.id || null;
          }

          upsert.run(
            id, accountUrl, conv.name, (conv as any).headline || '', (conv as any).avatarUrl || conv.avatarUrl || '',
            conv.threadUrl, (conv as any).conversationId || '',
            conv.lastMessage, conv.lastMessageAt, conv.unreadCount,
            (conv as any).sidebarPosition ?? 9999,
            syncTimestamp
          );

          if (existingLeadId) {
            db.prepare('UPDATE inbox_contacts SET lead_id = ? WHERE id = ?').run(existingLeadId, id);
          }
        }
      })();

      // ── Ghost-lead Cleanup ────────────────────────────────────────────────────
      // Delete any inbox_contact rows whose name matches accessibility label patterns.
      // These were created by previous scrape runs before the ghost filter was added.
      // Also delete orphan ghost rows that share a thread_url with a real contact.
      const ghostNamePatterns = [
        "name LIKE 'Reply to conversation%'",
        "name LIKE 'Conversation with \"%'",
        "name LIKE 'Conversation with ''%'",
        "name LIKE 'New message from%'",
        "name LIKE 'Message from%'",
        "name LIKE 'Send a message to%'",
      ];
      for (const pattern of ghostNamePatterns) {
        const deleted = db.prepare(`DELETE FROM inbox_contacts WHERE ${pattern}`).run();
        if (deleted.changes > 0) {
          console.log(`[inbox:scrape-all] Cleaned up ${deleted.changes} ghost contact(s) matching: ${pattern}`);
        }
      }

      // ── Sync Pruning Removed ──────────────────────────────────────────────────
      // Since we now exit early and only sync new contacts, we can no longer blindly
      // delete contacts with an old synced_at timestamp, as they are legitimately
      // just older conversations. Stable ID logic prevents new duplicates anyway.

      // Update global checkpoint — saved NOW so that any contacts newer than this
      // timestamp will be picked up on the next run.
      db.prepare(`UPDATE inbox_sessions SET last_sync_all_at = ? WHERE id = 'current' AND is_active = 1`).run(syncTimestamp);

      console.log(`[inbox:scrape-all] Saved ${conversations.length} new/updated contacts. Starting deep scrape...`);

      // One-by-one Deep Scrape
      const { scrapeAndSaveThread } = await import('./linkedin/messenger');
      
      const savedContacts = db.prepare('SELECT * FROM inbox_contacts WHERE linkedin_account_id = ? ORDER BY sidebar_position ASC').all(accountUrl) as any[];

      const failedContacts: any[] = []; // Track failures for a second pass retry

      for (const contact of savedContacts) {
        if (!contact.lead_id) {
          // Auto-create lead
          const nameParts = (contact.name || '').trim().split(' ');
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';
          const newLeadId = uuidv4();
          db.prepare(`
            INSERT OR IGNORE INTO leads (id, linkedin_url, first_name, last_name, profile_image_url, thread_url, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            newLeadId, contact.thread_url || `inbox-contact-${contact.id}`, firstName, lastName, contact.avatar_url || '',
            contact.thread_url || '', 'in_conversation', new Date().toISOString(), new Date().toISOString()
          );
          db.prepare('UPDATE inbox_contacts SET lead_id = ? WHERE id = ?').run(newLeadId, contact.id);
          contact.lead_id = newLeadId;
        }

        // ── CHECKPOINT SKIP (primary gate) ────────────────────────────────────
        // If we have a previous sync timestamp, use it as a hard cutoff.
        // Any contact whose last_message_at is older than or equal to the last sync
        // had no new activity — skip the expensive browser deep-scrape entirely.
        if (lastSyncAllAt && contact.last_message_at) {
          const contactMsgTime = new Date(contact.last_message_at).getTime();
          if (contactMsgTime <= lastSyncAllAt) {
            console.log(`[inbox:scrape-all] Skipping ${contact.name} — last msg ${contact.last_message_at} is not newer than last sync.`);
            continue;
          }
        }

        // ── SECONDARY SKIP (fallback for first-ever sync) ─────────────────────
        // After the first full sync, conversation_fully_fetched is set to 1 and
        // has_new_messages stays 0 until the upsert detects a changed last_message.
        if (contact.conversation_fully_fetched === 1 && contact.has_new_messages === 0) {
          console.log(`[inbox:scrape-all] Skipping deep scrape for ${contact.name} (no new messages).`);
          continue;
        }

        try {
          // Always pass threadUrl so scrapeAndSaveThread can extract the conversationId for the Voyager API.
          // Also pass the conversationId directly if we got it from the Voyager conversation list.
          const resolvedThreadUrl = contact.thread_url || '';
          const messages = await scrapeAndSaveThread(
            contact.lead_id, contact.name, inboxPage,
            resolvedThreadUrl,
            null // full history, no stop timestamp
          );

          if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            const needsReply = lastMsg.direction === 'inbound' ? 1 : 0;
            const preview = lastMsg.direction === 'outbound'
              ? `You: ${lastMsg.content}`.slice(0, 200)
              : lastMsg.content.slice(0, 200);

            // Update sidebar row with real data from this scrape
            db.prepare(`
              UPDATE inbox_contacts
              SET conversation_fully_fetched = 1,
                  last_synced_at   = ?,
                  needs_reply      = ?,
                  has_new_messages = 0,
                  last_message     = ?,
                  last_message_at  = ?
              WHERE id = ?
            `).run(new Date().toISOString(), needsReply, preview, lastMsg.sentAt, contact.id);
          } else {
            // Scraped 0 messages — still mark as fetched so we don't retry endlessly
            db.prepare('UPDATE inbox_contacts SET conversation_fully_fetched = 1, last_synced_at = ?, has_new_messages = 0 WHERE id = ?')
              .run(new Date().toISOString(), contact.id);
          }

          db.prepare('UPDATE conversations SET linkedin_account_id = ? WHERE lead_id = ?').run(accountUrl, contact.lead_id);

          // Delay between threads to avoid rate limits
          const { humanDelay } = await import('./browser/humanizer');
          await humanDelay(1000, 2000);
        } catch (err: any) {
          console.warn(`[inbox:scrape-all] Failed deep scrape for ${contact.name}: ${err.message}`);
          failedContacts.push(contact); // Queue for second pass
        }
      }

      // ── SECOND PASS (Self-Healing Retry Queue) ──────────────────────────────
      // If any threads failed (e.g. due to "Execution context destroyed" from a
      // background LinkedIn navigation), we wait a moment and try them one more time.
      if (failedContacts.length > 0) {
        console.log(`[inbox:scrape-all] Starting Second Pass retry for ${failedContacts.length} failed contact(s)...`);
        const { humanDelay } = await import('./browser/humanizer');
        await humanDelay(3000, 5000); // Let the page stabilize

        for (const contact of failedContacts) {
          try {
            console.log(`[inbox:scrape-all] RETRYING deep scrape for ${contact.name}...`);
            const resolvedThreadUrl = contact.thread_url || '';
            const messages = await scrapeAndSaveThread(
              contact.lead_id, contact.name, inboxPage,
              resolvedThreadUrl, null
            );

            if (messages.length > 0) {
              const lastMsg = messages[messages.length - 1];
              const needsReply = lastMsg.direction === 'inbound' ? 1 : 0;
              const preview = lastMsg.direction === 'outbound'
                ? `You: ${lastMsg.content}`.slice(0, 200)
                : lastMsg.content.slice(0, 200);

              db.prepare(`
                UPDATE inbox_contacts
                SET conversation_fully_fetched = 1, last_synced_at = ?, needs_reply = ?, has_new_messages = 0, last_message = ?, last_message_at = ?
                WHERE id = ?
              `).run(new Date().toISOString(), needsReply, preview, lastMsg.sentAt, contact.id);
            } else {
              db.prepare('UPDATE inbox_contacts SET conversation_fully_fetched = 1, last_synced_at = ?, has_new_messages = 0 WHERE id = ?')
                .run(new Date().toISOString(), contact.id);
            }

            db.prepare('UPDATE conversations SET linkedin_account_id = ? WHERE lead_id = ?').run(accountUrl, contact.lead_id);
            await humanDelay(1000, 2000);
            console.log(`[inbox:scrape-all] RETRY SUCCESS for ${contact.name}`);
          } catch (err: any) {
            console.error(`[inbox:scrape-all] RETRY FAILED for ${contact.name}: ${err.message}`);
          }
        }
      }

      logActivity('inbox_scrape_all_done', 'inbox', { count: conversations.length });
      console.log(`[inbox:scrape-all] Done — Deep scrape complete.`);
      return { success: true, count: conversations.length };
    } catch (err: any) {
      console.error('[inbox:scrape-all] Error:', err?.message);
      return { success: false, error: err?.message || 'Scrape failed', count: 0 };
    } finally {
      _scrapeAllRunning = false;
    }
  });

  // Get inbox entries — ONLY from inbox_contacts for the current LinkedIn account session.
  // Filtering by account_linkedin_url ensures contacts from previously-used LinkedIn
  // accounts never bleed into the current user's inbox view.
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_GET_LEADS);
  ipcMain.handle(IPC_CHANNELS.INBOX_GET_LEADS, () => {
    const db = getDatabase();

    // Read the currently active inbox session account URL
    const session = db.prepare(`SELECT account_linkedin_url FROM inbox_sessions WHERE id = 'current' AND is_active = 1`).get() as any;
    const currentAccountUrl = session?.account_linkedin_url || '';

    const contacts = db.prepare(`
      SELECT
        ic.id, ic.name, ic.headline, ic.avatar_url, ic.thread_url,
        ic.last_message, ic.last_message_at, ic.unread_count, ic.lead_id,
        ic.sidebar_position, ic.needs_reply, ic.conversation_fully_fetched,
        l.first_name, l.last_name, l.company, l.linkedin_url,
        l.status as lead_status, l.chatbot_state,
        l.profile_image_url
      FROM inbox_contacts ic
      LEFT JOIN leads l ON ic.lead_id = l.id
      WHERE ic.linkedin_account_id = ? OR ? = ''
      ORDER BY ic.sidebar_position ASC, ic.last_message_at DESC
    `).all(currentAccountUrl, currentAccountUrl) as any[];

    return contacts.map((c: any) => ({
      id: c.id,
      inboxContactId: c.id,
      leadId: c.lead_id,
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
      needsReply: c.needs_reply === 1,
      conversationFullyFetched: c.conversation_fully_fetched === 1,
      isLinkedInContact: true,
    }));
  });

  // Get all stored messages for a lead from DB (fast, no Puppeteer)
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_GET_MESSAGES);
  ipcMain.handle(IPC_CHANNELS.INBOX_GET_MESSAGES, (_event, leadOrContactId: string) => {
    const db = getDatabase();

    // Resolve inbox_contact id → lead_id so we always query by the canonical lead_id.
    // Messages are always stored under lead_id (never under the inbox_contact id), so
    // querying with the contact id would return 0 rows, and querying with both IDs via OR
    // would return duplicates if rows exist under both IDs from different sync runs.
    let targetLeadId = leadOrContactId;
    const contact = db.prepare('SELECT lead_id FROM inbox_contacts WHERE id = ?').get(leadOrContactId) as any;
    if (contact && contact.lead_id) {
      targetLeadId = contact.lead_id;
    }

    return db.prepare(
      'SELECT id, lead_id, direction, content, platform, is_automated, sent_at FROM conversations WHERE lead_id = ? ORDER BY sent_at ASC'
    ).all(targetLeadId).map((r: any) => ({
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
  // Works with both leads and inbox_contacts (scraped from sidebar)
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_SYNC_THREAD);
  ipcMain.handle(IPC_CHANNELS.INBOX_SYNC_THREAD, async (_event, contactId: string) => {
    try {
      const db = getDatabase();

      // Try leads table first, then inbox_contacts
      let fullName = '';
      let threadUrl = '';
      let resolvedLeadId = contactId;

      const lead = db.prepare('SELECT first_name, last_name, thread_url FROM leads WHERE id = ?').get(contactId) as any;
      if (lead) {
        fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
        threadUrl = lead.thread_url || '';
      }

      if (!fullName) {
        const contact = db.prepare('SELECT name, thread_url, lead_id, avatar_url FROM inbox_contacts WHERE id = ?').get(contactId) as any;
        if (contact) {
          fullName = contact.name || '';
          threadUrl = contact.thread_url || '';
          if (contact.lead_id) {
            resolvedLeadId = contact.lead_id;
          } else {
            // Auto-create a lead record for this inbox contact (FK requirement)
            const nameParts = (contact.name || '').trim().split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            const newLeadId = uuidv4();
            db.prepare(`
              INSERT OR IGNORE INTO leads (id, linkedin_url, first_name, last_name, profile_image_url, thread_url, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              newLeadId,
              contact.thread_url || `inbox-contact-${contactId}`,
              firstName, lastName,
              contact.avatar_url || '',
              contact.thread_url || '',
              'in_conversation',
              new Date().toISOString(),
              new Date().toISOString()
            );
            // Link inbox contact to this new lead
            db.prepare('UPDATE inbox_contacts SET lead_id = ? WHERE id = ?').run(newLeadId, contactId);
            resolvedLeadId = newLeadId;
            console.log(`[InboxSync] Auto-created lead for "${fullName}" (${newLeadId})`);
          }
        }
      }

      if (!fullName && !threadUrl) {
        return { success: false, error: 'Contact not found', messages: [] };
      }

      // Verify lead exists (for FK safety)
      const leadExists = db.prepare('SELECT id FROM leads WHERE id = ?').get(resolvedLeadId);
      if (!leadExists) {
        const nameParts = fullName.trim().split(' ');
        db.prepare(`
          INSERT OR IGNORE INTO leads (id, linkedin_url, first_name, last_name, thread_url, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(resolvedLeadId, threadUrl || `inbox-${resolvedLeadId}`, nameParts[0] || '', nameParts.slice(1).join(' ') || '', threadUrl, 'in_conversation', new Date().toISOString(), new Date().toISOString());
        console.log(`[InboxSync] Created lead record for FK safety: ${resolvedLeadId}`);
      }

      const inboxPage = await getInboxPage();

      // Pass threadUrl so scrapeAndSaveThread can use Voyager API if conversationId is available.
      // Falls back to DOM name-based search automatically if Voyager returns nothing.
      console.log(`[InboxSync] Syncing "${fullName}" (threadUrl: ${threadUrl || 'none'})`);
      const messages = await scrapeAndSaveThread(resolvedLeadId, fullName, inboxPage, threadUrl || undefined, null);


      // ── Update inbox_contacts sidebar row so the lead list reflects the fresh data ──
      // IMPORTANT: We deliberately do NOT update last_sync_all_at (the global checkpoint).
      // The individual sync is a targeted repair — the next Sync All must still look back
      // to the previous global checkpoint so no conversations are skipped.
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        const needsReply = lastMsg.direction === 'inbound' ? 1 : 0;
        const preview = lastMsg.direction === 'outbound'
          ? `You: ${lastMsg.content}`.slice(0, 200)
          : lastMsg.content.slice(0, 200);

        db.prepare(`
          UPDATE inbox_contacts
          SET
            last_message        = ?,
            last_message_at     = ?,
            needs_reply         = ?,
            has_new_messages    = 0,
            conversation_fully_fetched = 1,
            last_synced_at      = ?,
            sidebar_position    = 0
          WHERE lead_id = ?
        `).run(preview, lastMsg.sentAt, needsReply, new Date().toISOString(), resolvedLeadId);

        console.log(`[InboxSync] Updated inbox_contacts for "${fullName}": last_message_at=${lastMsg.sentAt}, needs_reply=${needsReply}`);
      }

      return { success: true, messages };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Sync failed', messages: [] };
    }
  });

  // Send a manual message from inbox (uses inbox browser, marks chatbot handed_off)
  // After a successful send, waits 4–5 seconds for LinkedIn to render the new message,
  // then immediately scrapes the thread and returns the full updated message list.
  // This avoids a race condition where a concurrent syncThread call from the renderer
  // would fight over the same inbox browser page.
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_SEND_MANUAL);
  ipcMain.handle(
    IPC_CHANNELS.INBOX_SEND_MANUAL,
    async (_event, data: { leadId: string; threadId: string; message: string }) => {
      try {
        const db = getDatabase();
        let fullName = '';
        let resolvedLeadId = data.leadId;

        // Try to get name from leads table
        const lead = db.prepare('SELECT first_name, last_name FROM leads WHERE id = ?').get(data.leadId) as any;
        if (lead) {
          fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
        }

        // Fallback to inbox_contacts table
        if (!fullName) {
          const contact = db.prepare('SELECT name, lead_id FROM inbox_contacts WHERE lead_id = ? OR id = ?').get(data.leadId, data.leadId) as any;
          if (contact) {
            fullName = contact.name || '';
            if (contact.lead_id) resolvedLeadId = contact.lead_id;
          }
        }

        const inboxPage = await getInboxPage(); // singleton
        const sendResult = await sendReplyInThreadOnPage(
          inboxPage,
          data.threadId || data.leadId,
          data.message,
          { isAutomated: false, leadId: resolvedLeadId, fullName }
        );

        if (!sendResult.success) {
          return sendResult; // propagate error — renderer will restore the compose box
        }

        // ── Post-send sync ────────────────────────────────────────────────────────
        // Wait 4–5 seconds to let LinkedIn render the newly sent message in the DOM
        // before we scrape, otherwise we'd only see messages up to the previous state.
        const { humanDelay: hDelay } = await import('./browser/humanizer');
        await hDelay(4000, 5000);

        // Now scrape the thread while the page is already open on the right conversation.
        // scrapeAndSaveThread does name-based search and replaces DB messages in full.
        const { scrapeAndSaveThread } = await import('./linkedin/messenger');
        let messages: any[] = [];
        try {
          messages = await scrapeAndSaveThread(resolvedLeadId, fullName, inboxPage, undefined);

          // Update the sidebar preview row so it reflects the just-sent message
          if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            const needsReply = lastMsg.direction === 'inbound' ? 1 : 0;
            const preview = lastMsg.direction === 'outbound'
              ? `You: ${lastMsg.content}`.slice(0, 200)
              : lastMsg.content.slice(0, 200);
            db.prepare(`
              UPDATE inbox_contacts
              SET last_message = ?, last_message_at = ?, needs_reply = ?,
                  has_new_messages = 0, conversation_fully_fetched = 1, last_synced_at = ?
              WHERE lead_id = ?
            `).run(preview, lastMsg.sentAt, needsReply, new Date().toISOString(), resolvedLeadId);
          }
        } catch (syncErr: any) {
          console.warn(`[InboxSend] Post-send sync failed (message was still sent): ${syncErr?.message}`);
          // Fall back to DB messages so the UI is not left blank
          messages = db.prepare(
            'SELECT id, lead_id, direction, content, platform, is_automated, sent_at FROM conversations WHERE lead_id = ? ORDER BY sent_at ASC'
          ).all(resolvedLeadId).map((r: any) => ({
            id: r.id, leadId: r.lead_id, direction: r.direction, content: r.content,
            platform: r.platform, isAutomated: !!r.is_automated, sentAt: r.sent_at,
          }));
        }

        return { success: true, messages };
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

  // ---- AI Reply Generation for Inbox ----
  ipcMain.removeHandler(IPC_CHANNELS.INBOX_AI_REPLY);
  ipcMain.handle(
    IPC_CHANNELS.INBOX_AI_REPLY,
    async (_event, data: { leadId: string; referenceText?: string }) => {
      try {
        const db = getDatabase();
        const settings = getSettingsStore().get('settings');

        // Fetch lead profile
        const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(data.leadId) as any;

        // Fetch all messages for context (most recent 30 to stay within token limits)
        const rawMsgs = db.prepare(
          `SELECT direction, content, sent_at FROM conversations
           WHERE lead_id = ?
           ORDER BY sent_at ASC
           LIMIT 30`
        ).all(data.leadId) as any[];

        // Also check inbox_contacts if no lead row (pure inbox contact)
        let leadName = '';
        let leadHeadline = '';
        let leadCompany = '';
        if (lead) {
          leadName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
          leadHeadline = lead.headline || '';
          leadCompany = lead.company || '';
        } else {
          // Try inbox_contacts
          const contact = db.prepare('SELECT name, headline FROM inbox_contacts WHERE id = ?').get(data.leadId) as any;
          if (contact) {
            leadName = contact.name || '';
            leadHeadline = contact.headline || '';
          }
        }

        // Build lead profile summary for the prompt
        let leadProfileSummary = `Name: ${leadName || 'Unknown'}\nHeadline: ${leadHeadline || 'N/A'}\nCompany: ${leadCompany || 'N/A'}`;
        if (lead) {
          if (lead.about) leadProfileSummary += `\nAbout: ${lead.about.substring(0, 500)}`;
          if (lead.skills_json) {
            try {
              const skills = JSON.parse(lead.skills_json);
              if (Array.isArray(skills) && skills.length > 0) leadProfileSummary += `\nSkills: ${skills.slice(0, 10).join(', ')}`;
            } catch (e) {}
          }
          if (lead.experience_json) {
            try {
              const exp = JSON.parse(lead.experience_json);
              if (Array.isArray(exp) && exp.length > 0) {
                leadProfileSummary += `\nExperience: ${exp.slice(0, 3).map((e: any) => `${e.title} at ${e.company}`).join('; ')}`;
              }
            } catch (e) {}
          }
        }

        // Build conversation transcript
        const transcript = rawMsgs.length > 0
          ? rawMsgs.map(m => `[${m.direction === 'outbound' ? 'You (Veda AI Lab LLC)' : leadName || 'Lead'}]: ${m.content}`).join('\n')
          : '(No messages yet — this is the first message in the conversation.)';

        // Add reference context if provided
        let referenceContext = "";
        if (data.referenceText && data.referenceText.trim()) {
          referenceContext = `\n[CRITICAL OVERRIDE] USER INTENT & INSTRUCTIONS:\n"${data.referenceText.trim()}"\nFOLLOW THE ABOVE INTENT EXACTLY. If the user specifies a particular topic (e.g., "reply to job offer"), focus ENTIRELY on that. The user's instructions here take absolute precedence over any other persona or outreach guidelines.`;
        }

        // Compose the prompt — no system prompt injection needed, generateWithOllama prepends VEDA_CONTEXT automatically
        const prompt = `
You are representing Veda AI Lab LLC. Your goal is to write a highly personalized LinkedIn message.

LEAD PROFILE:
${leadProfileSummary}

FULL CONVERSATION HISTORY:
${transcript}

${referenceContext}

TASK:
Write the single best next reply message. 

GUIDELINES:
- PRIMARY RULE: If USER INTENT & INSTRUCTIONS are provided above, you MUST follow them exactly. If the user wants to reply to a specific topic (like a job, a question, or a meeting), do that.
- PERSONA: Maintain a professional, peer-level, and deeply human tone. 
- VEDA CONTEXT: Only mention Veda AI Lab LLC's specific services if it aligns with the USER INTENT or if the conversation history makes it the natural next step. Do not force a pitch if the user's instruction points elsewhere.
- LENGTH: Your response MUST be concise (4-5 sentences max, approx 7-8 lines). 
- NO greeting (e.g. "Hi [Name],") and NO subject line — just the message body.
- NO preamble or meta-commentary — output ONLY the message text.

Write the reply now:`.trim();

        const { generateWithOllama } = await import('./ai/mixtral/client');
        const reply = await generateWithOllama(prompt, settings.ai, {
          maxTokens: 300, // Reduced as we want shorter messages
          temperature: 0.75,
        });

        // Strip any meta prefixes like "Reply:", "Message:", quotes, etc.
        const clean = reply
          .replace(/^(reply|message|response|here is|here's|draft)[:\s]+/i, '')
          .replace(/^["']|["']$/g, '')
          .trim();

        return { success: true, reply: clean };
      } catch (err: any) {
        console.error('[INBOX_AI_REPLY] Failed:', err?.message);
        return { success: false, error: err?.message || 'AI generation failed' };
      }
    }
  );
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
