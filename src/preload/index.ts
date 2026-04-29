// Preload script - Exposes safe APIs to renderer via contextBridge
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/types";

// Type-safe IPC wrapper
const createIpcInvoke = (channel: string) => {
  return (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
};

const createIpcOn = (channel: string) => {
  return (callback: (...args: unknown[]) => void) => {
    const subscription = (
      _event: Electron.IpcRendererEvent,
      ...args: unknown[]
    ) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  };
};

// Expose protected APIs to renderer
contextBridge.exposeInMainWorld("api", {
  // Browser Control
  browser: {
    launch: createIpcInvoke(IPC_CHANNELS.BROWSER_LAUNCH),
    getStatus: createIpcInvoke(IPC_CHANNELS.BROWSER_STATUS),
    close: createIpcInvoke(IPC_CHANNELS.BROWSER_CLOSE),
    onStatus: createIpcOn(IPC_CHANNELS.BROWSER_STATUS),
  },

  // LinkedIn
  linkedin: {
    login: createIpcInvoke(IPC_CHANNELS.LINKEDIN_LOGIN),
    getLoginStatus: createIpcInvoke(IPC_CHANNELS.LINKEDIN_LOGIN_STATUS),
    logout: createIpcInvoke(IPC_CHANNELS.LINKEDIN_LOGOUT),
    scrapeProfile: createIpcInvoke(IPC_CHANNELS.LINKEDIN_SCRAPE_PROFILE),
    scrapeCompany: createIpcInvoke(IPC_CHANNELS.LINKEDIN_SCRAPE_COMPANY),
    importSearch: createIpcInvoke(IPC_CHANNELS.LINKEDIN_IMPORT_SEARCH),
    sendConnection: createIpcInvoke(IPC_CHANNELS.LINKEDIN_SEND_CONNECTION),
    checkConnections: createIpcInvoke(IPC_CHANNELS.LINKEDIN_CHECK_CONNECTIONS),
    sendMessage: createIpcInvoke(IPC_CHANNELS.LINKEDIN_SEND_MESSAGE),
    onLoginStatus: createIpcOn(IPC_CHANNELS.LINKEDIN_LOGIN_STATUS),
    startAutoPilot: createIpcInvoke("LINKEDIN_START_AUTOPILOT"),
    stopAutoPilot: createIpcInvoke("LINKEDIN_STOP_AUTOPILOT"),
  },

  // Campaigns
  campaigns: {
    create: createIpcInvoke(IPC_CHANNELS.CAMPAIGN_CREATE),
    update: createIpcInvoke(IPC_CHANNELS.CAMPAIGN_UPDATE),
    start: createIpcInvoke(IPC_CHANNELS.CAMPAIGN_START),
    pause: createIpcInvoke(IPC_CHANNELS.CAMPAIGN_PAUSE),
    getStatus: createIpcInvoke(IPC_CHANNELS.CAMPAIGN_STATUS),
    list: createIpcInvoke(IPC_CHANNELS.CAMPAIGN_LIST),
    addLeads: createIpcInvoke(IPC_CHANNELS.CAMPAIGN_ADD_LEADS),
    importFromPage: createIpcInvoke(IPC_CHANNELS.CAMPAIGN_IMPORT_FROM_PAGE),
    delete: createIpcInvoke(IPC_CHANNELS.CAMPAIGN_DELETE),
  },


  // Leads
  leads: {
    save: createIpcInvoke(IPC_CHANNELS.LEAD_SAVE),
    delete: createIpcInvoke(IPC_CHANNELS.LEAD_DELETE),
    list: createIpcInvoke(IPC_CHANNELS.LEAD_LIST),
    get: createIpcInvoke(IPC_CHANNELS.LEAD_GET),
  },

  // Email
  email: {
    authenticate: createIpcInvoke(IPC_CHANNELS.EMAIL_AUTH),
    send: createIpcInvoke(IPC_CHANNELS.EMAIL_SEND),
    getStatus: createIpcInvoke(IPC_CHANNELS.EMAIL_STATUS),
    disconnect: createIpcInvoke("email:disconnect"),
  },

  // Calendar
  calendar: {
    createMeeting: createIpcInvoke(IPC_CHANNELS.CALENDAR_CREATE_MEETING),
    getAvailableSlots: createIpcInvoke(IPC_CHANNELS.CALENDAR_AVAILABLE_SLOTS),
  },

  // Content
  content: {
    schedule: createIpcInvoke(IPC_CHANNELS.CONTENT_SCHEDULE),
    cancel: createIpcInvoke(IPC_CHANNELS.CONTENT_CANCEL),
    publish: createIpcInvoke(IPC_CHANNELS.CONTENT_PUBLISH),
    list: createIpcInvoke(IPC_CHANNELS.CONTENT_LIST),
    suggestTimes: createIpcInvoke(IPC_CHANNELS.CONTENT_SUGGEST_TIMES),
  },

  // Engagement
  engagement: {
    runSession: createIpcInvoke(IPC_CHANNELS.ENGAGEMENT_RUN_SESSION),
    replyComments: createIpcInvoke(IPC_CHANNELS.ENGAGEMENT_REPLY_COMMENTS),
  },

  // Sales Navigator
  salesNav: {
    detect: createIpcInvoke(IPC_CHANNELS.SALES_NAV_DETECT),
    search: createIpcInvoke(IPC_CHANNELS.SALES_NAV_SEARCH),
    scrape: createIpcInvoke(IPC_CHANNELS.SALES_NAV_SCRAPE),
    sendInMail: createIpcInvoke(IPC_CHANNELS.SALES_NAV_INMAIL),
  },

  // Email Templates
  emailTemplates: {
    list: createIpcInvoke(IPC_CHANNELS.EMAIL_TEMPLATES_LIST),
    save: createIpcInvoke(IPC_CHANNELS.EMAIL_TEMPLATES_SAVE),
    delete: createIpcInvoke(IPC_CHANNELS.EMAIL_TEMPLATES_DELETE),
  },

  // Connection Checker
  connectionChecker: {
    start: createIpcInvoke(IPC_CHANNELS.CONNECTION_CHECKER_START),
    stop: createIpcInvoke(IPC_CHANNELS.CONNECTION_CHECKER_STOP),
    run: createIpcInvoke(IPC_CHANNELS.CONNECTION_CHECKER_RUN),
    history: createIpcInvoke(IPC_CHANNELS.CONNECTION_CHECKER_HISTORY),
  },

  // AI
  ai: {
    generate: createIpcInvoke(IPC_CHANNELS.AI_GENERATE),
    getStatus: createIpcInvoke(IPC_CHANNELS.AI_STATUS),
  },

  // Settings
  settings: {
    get: createIpcInvoke(IPC_CHANNELS.SETTINGS_GET),
    update: createIpcInvoke(IPC_CHANNELS.SETTINGS_UPDATE),
  },

  // Activity
  activity: {
    log: createIpcInvoke(IPC_CHANNELS.ACTIVITY_LOG),
    list: createIpcInvoke(IPC_CHANNELS.ACTIVITY_LIST),
  },

  // System
  system: {
    wipeData: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_WIPE_DATA),
    getDbPath: createIpcInvoke(IPC_CHANNELS.SYSTEM_GET_DB_PATH),
  },

  // Events from main process
  on: {
    notification: createIpcOn(IPC_CHANNELS.NOTIFICATION),
    appReady: createIpcOn(IPC_CHANNELS.APP_READY),
    autoPilotLog: createIpcOn("autopilot-log"),
    inboxNewMessage: createIpcOn(IPC_CHANNELS.INBOX_NEW_MESSAGE),
  },

  // Inbox
  inbox: {
    getBrowserStatus: createIpcInvoke(IPC_CHANNELS.INBOX_BROWSER_STATUS),
    getLeads: createIpcInvoke(IPC_CHANNELS.INBOX_GET_LEADS),
    getMessages: createIpcInvoke(IPC_CHANNELS.INBOX_GET_MESSAGES),
    syncThread: createIpcInvoke(IPC_CHANNELS.INBOX_SYNC_THREAD),
    sendManual: createIpcInvoke(IPC_CHANNELS.INBOX_SEND_MANUAL),
    sendWelcome: createIpcInvoke(IPC_CHANNELS.INBOX_SEND_WELCOME),
    scheduleMeeting: createIpcInvoke(IPC_CHANNELS.INBOX_SCHEDULE_MEETING),
    pollUnread: createIpcInvoke(IPC_CHANNELS.INBOX_POLL_UNREAD),
    scrapeAll: createIpcInvoke('inbox:scrape-all'),
    generateAiReply: createIpcInvoke(IPC_CHANNELS.INBOX_AI_REPLY),
  },
});
