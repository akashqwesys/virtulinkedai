// Shared types between main and renderer processes

// ============================================================
// Lead / Profile Types
// ============================================================
export interface LinkedInProfile {
  id: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  headline: string;
  company: string;
  role: string;
  location: string;
  about: string;
  experience: Experience[];
  education: Education[];
  skills: string[];
  recentPosts: Post[];
  mutualConnections: string[];
  profileImageUrl: string;
  connectionDegree: "1st" | "2nd" | "3rd" | "Out of Network";
  isSalesNavigator: boolean;
  scrapedAt: string;
  rawData: Record<string, unknown>;
}

export interface Experience {
  title: string;
  company: string;
  duration: string;
  description: string;
  isCurrent: boolean;
}

export interface Education {
  school: string;
  degree: string;
  field: string;
  years: string;
}

export interface Post {
  content: string;
  date: string;
  likes: number;
  comments: number;
  url: string;
}

// ============================================================
// Lead Pipeline Types
// ============================================================
export type LeadStatus =
  | "new"
  | "profile_scraped"
  | "connection_requested"
  | "connection_accepted"
  | "email_sent"
  | "email_opened"
  | "replied"
  | "meeting_booked"
  | "converted"
  | "rejected"
  | "unresponsive";

export interface Lead {
  id: string;
  profile: LinkedInProfile;
  status: LeadStatus;
  campaignId: string | null;
  connectionNote: string | null;
  connectionRequestedAt: string | null;
  connectionAcceptedAt: string | null;
  emailsSent: EmailRecord[];
  conversations: ConversationMessage[];
  score: number;
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Campaign Types
// ============================================================
export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  steps: CampaignStep[];
  leadIds: string[];
  stats: CampaignStats;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignStep {
  id: string;
  type: "connect" | "email" | "message" | "follow_up" | "wait" | "condition";
  config: Record<string, unknown>;
  delayDays: number;
  order: number;
}

export interface CampaignStats {
  totalLeads: number;
  connectionsSent: number;
  connectionsAccepted: number;
  emailsSent: number;
  emailsOpened: number;
  repliesReceived: number;
  meetingsBooked: number;
}

// ============================================================
// Email Types
// ============================================================
export interface EmailRecord {
  id: string;
  leadId: string;
  subject: string;
  body: string;
  type: "intro" | "follow_up" | "welcome" | "meeting_confirm";
  sentAt: string;
  openedAt: string | null;
  clickedAt: string | null;
  repliedAt: string | null;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  type: "intro" | "follow_up" | "welcome" | "meeting_confirm";
}

// ============================================================
// Conversation / Chatbot Types
// ============================================================
export interface ConversationMessage {
  id: string;
  leadId: string;
  direction: "inbound" | "outbound";
  content: string;
  platform: "linkedin" | "email";
  isAutomated: boolean;
  sentAt: string;
}

export type ChatbotState =
  | "idle"
  | "initial_message"
  | "waiting_reply"
  | "building_rapport"
  | "sharing_value"
  | "suggesting_meeting"
  | "meeting_booked"
  | "handed_off";

// ============================================================
// Content / Engagement Types
// ============================================================
export interface ScheduledPost {
  id: string;
  content: string;
  mediaUrls: string[];
  type: "text" | "image" | "video" | "carousel" | "poll" | "article";
  hashtags?: string[];
  scheduledAt: string;
  publishedAt: string | null;
  status: "draft" | "scheduled" | "published" | "failed" | "cancelled";
  engagement: PostEngagement | null;
}

export interface PostEngagement {
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  measuredAt: string;
}

export interface EngagementAction {
  id: string;
  type: "like" | "comment" | "share";
  targetPostUrl: string;
  content: string | null; // for comments
  performedAt: string;
  status: "pending" | "completed" | "failed";
}

// ============================================================
// Settings / Config Types
// ============================================================
export interface AppSettings {
  // LinkedIn Account
  linkedinAccountType: "normal" | "sales_navigator";

  // Working Hours
  workingHours: {
    enabled: boolean;
    startHour: number; // 0-23
    endHour: number; // 0-23
    timezone: string;
    randomizeStart: boolean; // ±30min
    workDays: number[]; // 0=Sun, 1=Mon, ...
  };

  // Daily Limits
  dailyLimits: {
    connectionRequests: number;
    profileViews: number;
    messages: number;
    postEngagements: number;
    contentPosts: number;
    randomizePercent: number; // ±X%
  };

  // AI Provider
  ai: {
    provider: "ollama";
    ollamaBaseUrl: string; // e.g., http://35.175.238.52
    ollamaApiPort: number; // 11434
    ollamaGeneratePort: number; // 8080
    primaryModel: string; // mixtral:8x7b-instruct-v0.1-q3_K_M
    fallbackModel: string; // mistral:7b-instruct-v0.3-q4_K_M
    temperature: number;
    maxTokens: number;
  };

  // Microsoft 365
  microsoft: {
    clientId: string;
    tenantId: string;
    redirectUri: string;
    scopes: string[];
  };

  // Warm-up
  warmup: {
    enabled: boolean;
    currentDay: number;
    rampUpDays: number; // 14 days default
    startPercent: number; // 20%
  };

  // Your Profile (used for AI personalization context)
  profile: {
    name: string;
    company: string;
    services: string;
  };

  // Chatbot
  chatbot: {
    enabled: boolean;
    responseDelayMinMinutes: number; // 2
    responseDelayMaxMinutes: number; // 15
    maxAutoMessages: number; // 5
    handoffOnNegativeSentiment: boolean;
  };
  
  // Analytics Tracking
  analytics: {
    trackingDomain: string; // e.g., https://my-ngrok-tunnel.ngrok.io
  };
}

// ============================================================
// IPC Channel Types (Main <-> Renderer Communication)
// ============================================================
export const IPC_CHANNELS = {
  // Browser
  BROWSER_LAUNCH: "browser:launch",
  BROWSER_STATUS: "browser:status",
  BROWSER_CLOSE: "browser:close",

  // LinkedIn
  LINKEDIN_LOGIN: "linkedin:login",
  LINKEDIN_LOGIN_STATUS: "linkedin:login-status",
  LINKEDIN_LOGOUT: "linkedin:logout",
  LINKEDIN_SCRAPE_PROFILE: "linkedin:scrape-profile",
  LINKEDIN_SCRAPE_COMPANY: "linkedin:scrape-company",
  LINKEDIN_IMPORT_SEARCH: "linkedin:import-search",
  LINKEDIN_SEND_CONNECTION: "linkedin:send-connection",
  LINKEDIN_CHECK_CONNECTIONS: "linkedin:check-connections",
  LINKEDIN_SEND_MESSAGE: "linkedin:send-message",

  // Campaigns
  CAMPAIGN_CREATE: "campaign:create",
  CAMPAIGN_START: "campaign:start",
  CAMPAIGN_PAUSE: "campaign:pause",
  CAMPAIGN_STATUS: "campaign:status",
  CAMPAIGN_LIST: "campaign:list",
  CAMPAIGN_ADD_LEADS: "campaign:add-leads",
  CAMPAIGN_UPDATE: "campaign:update",
  CAMPAIGN_IMPORT_FROM_PAGE: "campaign:import-from-page",
  CAMPAIGN_DELETE: "campaign:delete",

  // Leads
  LEAD_SAVE: "lead:save",
  LEAD_DELETE: "lead:delete",
  LEAD_LIST: "lead:list",
  LEAD_GET: "lead:get",

  // Email
  EMAIL_AUTH: "email:auth",
  EMAIL_SEND: "email:send",
  EMAIL_STATUS: "email:status",

  // Calendar
  CALENDAR_CREATE_MEETING: "calendar:create-meeting",
  CALENDAR_AVAILABLE_SLOTS: "calendar:available-slots",

  // Content
  CONTENT_SCHEDULE: "content:schedule",
  CONTENT_CANCEL: "content:cancel",
  CONTENT_PUBLISH: "content:publish",
  CONTENT_LIST: "content:list",
  CONTENT_SUGGEST_TIMES: "content:suggest-times",

  // Engagement
  ENGAGEMENT_RUN_SESSION: "engagement:run-session",
  ENGAGEMENT_REPLY_COMMENTS: "engagement:reply-comments",

  // Sales Navigator
  SALES_NAV_DETECT: "sales-nav:detect",
  SALES_NAV_SEARCH: "sales-nav:search",
  SALES_NAV_SCRAPE: "sales-nav:scrape",
  SALES_NAV_INMAIL: "sales-nav:inmail",

  // Email Templates
  EMAIL_TEMPLATES_LIST: "email-templates:list",
  EMAIL_TEMPLATES_SAVE: "email-templates:save",
  EMAIL_TEMPLATES_DELETE: "email-templates:delete",

  // Connection Checker
  CONNECTION_CHECKER_START: "connection-checker:start",
  CONNECTION_CHECKER_STOP: "connection-checker:stop",
  CONNECTION_CHECKER_RUN: "connection-checker:run",
  CONNECTION_CHECKER_HISTORY: "connection-checker:history",

  // AI
  AI_GENERATE: "ai:generate",
  AI_STATUS: "ai:status",

  // Settings
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",

  // Activity
  ACTIVITY_LOG: "activity:log",
  ACTIVITY_LIST: "activity:list",

  // General
  APP_READY: "app:ready",
  NOTIFICATION: "notification",
  SYSTEM_WIPE_DATA: "system:wipe-data",
} as const;
