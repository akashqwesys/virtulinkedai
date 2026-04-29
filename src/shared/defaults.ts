// Default application settings
import type { AppSettings } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  linkedinAccountType: "normal",

  workingHours: {
    enabled: true,
    startHour: 9,
    endHour: 18,
    timezone: "Asia/Kolkata",
    randomizeStart: true,
    workDays: [1, 2, 3, 4, 5], // Mon-Fri
  },

  dailyLimits: {
    // Conservative limits — safe for freshly restored accounts.
    // The warmup ramp-up further reduces these on early days.
    connectionRequests: 10,
    profileViews: 40,
    messages: 20,
    postEngagements: 15,
    contentPosts: 1,
    randomizePercent: 20,  // Higher variance = less predictable patterns
  },

  ai: {
    provider: "nvidia",
    ollamaBaseUrl: "http://localhost",
    ollamaApiPort: 11434,
    ollamaGeneratePort: 8080,
    nvidiaApiKey: "", // User will need to enter this in settings
    primaryModel: "meta/llama-3.3-70b-instruct",
    fallbackModel: "meta/llama-3.1-8b-instruct",
    temperature: 0.7,
    maxTokens: 512,
  },

  microsoft: {
    clientId: "",
    tenantId: "",
    redirectUri: "http://localhost:3847/auth/callback",
    scopes: ["Mail.Send", "Mail.ReadWrite", "Calendars.ReadWrite", "User.Read"],
  },

  enrichment: {
    provider: "none",
    apiKey: "",
  },

  warmup: {
    enabled: true,
    currentDay: 0,
    rampUpDays: 14,
    startPercent: 20,
  },

  profile: {
    name: "",
    company: "",
    services: "",
  },

  chatbot: {
    enabled: true,
    responseDelayMinMinutes: 2,
    responseDelayMaxMinutes: 15,
    maxAutoMessages: 5,
    handoffOnNegativeSentiment: true,
  },
  
  analytics: {
    trackingDomain: "", // e.g., https://my-ngrok-tunnel.ngrok.io
  },
};
