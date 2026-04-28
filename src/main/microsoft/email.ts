/**
 * Microsoft 365 Integration - Email & Calendar via Graph API
 *
 * Handles OAuth2 authentication, email sending, and meeting booking
 * using the Microsoft Graph API with MSAL for desktop apps.
 */

import {
  PublicClientApplication,
  InteractionRequiredAuthError,
} from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import type {
  AppSettings,
  LinkedInProfile,
  EmailRecord,
} from "../../shared/types";
import { getDatabase, logActivity } from "../storage/database";
import { v4 as uuid } from "uuid";
import { vaultCachePlugin } from "./cachePlugin";

let msalInstance: PublicClientApplication | null = null;
let graphClient: Client | null = null;
let accessToken: string | null = null;
let authenticatedUserEmail: string | null = null;
let lastClientId: string | null = null;
let lastTenantId: string | null = null;

/**
 * Initialize MSAL for desktop OAuth2 (PKCE flow)
 */
export function initializeMSAL(settings: AppSettings["microsoft"]): void {
  if (!settings.clientId || !settings.tenantId) {
    throw new Error("Microsoft client ID and tenant ID are required");
  }

  lastClientId = settings.clientId;
  lastTenantId = settings.tenantId;

  msalInstance = new PublicClientApplication({
    auth: {
      clientId: settings.clientId,
      authority: `https://login.microsoftonline.com/${settings.tenantId}`,
    },
    cache: {
      cachePlugin: vaultCachePlugin,
    },
  });
}

/**
 * Helper to perform login via Electron's BrowserWindow instead of System Browser,
 * allowing us to detect errors like "AADSTS700016" natively without hanging.
 */
async function performInteractiveAuth(
  msalInstance: PublicClientApplication,
  settings: AppSettings["microsoft"]
) {
  let customReject: ((e: Error) => void) | null = null;
  let authWindow: any = null;
  
  const rejectPromise = new Promise<any>((_, reject) => {
    customReject = reject;
  });

  const msalOptions = {
    scopes: settings.scopes,
    openBrowser: async (url: string) => {
      const { BrowserWindow } = await import("electron");
      authWindow = new BrowserWindow({
        width: 800,
        height: 700,
        title: "Microsoft 365 Sign In",
        alwaysOnTop: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      authWindow.setMenuBarVisibility(false);

      const checkInterval = setInterval(async () => {
        if (!authWindow || authWindow.isDestroyed()) {
          clearInterval(checkInterval);
          return;
        }
        try {
          const pageText = await authWindow.webContents.executeJavaScript(`document.body.innerText`);
          if (pageText.includes("AADSTS") || pageText.includes("trouble signing you in")) {
            const match = pageText.match(/(AADSTS\d+:[^\n]+)/);
            const errorMsg = match
              ? match[1].trim()
              : "Microsoft Login Error: Invalid Application or Tenant configuration. Please verify your credentials.";
            clearInterval(checkInterval);
            authWindow.destroy();
            customReject!(new Error(errorMsg));
          }
        } catch { /* ignore */ }
      }, 1000);

      authWindow.on("closed", () => {
        clearInterval(checkInterval);
        customReject!(new Error("Login window was closed by the user."));
      });

      await authWindow.loadURL(url);
    },
    successTemplate: '<h1 style="font-family:sans-serif;text-align:center;margin-top:20%">Authentication Successful</h1><p style="text-align:center;">Returning to app...</p>',
    errorTemplate: '<h1 style="font-family:sans-serif;text-align:center;margin-top:20%;color:red;">Authentication Failed</h1><p style="text-align:center;">Please try again.</p>',
  };

  try {
    const tokenResponse = await Promise.race([
      msalInstance.acquireTokenInteractive(msalOptions),
      rejectPromise,
    ]);
    return tokenResponse;
  } finally {
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.destroy();
    }
  }
}

/**
 * Authenticate with Microsoft (interactive login)
 * Opens a browser window for the user to sign in
 */
export async function authenticate(
  settings: AppSettings["microsoft"],
): Promise<{ success: boolean; userEmail?: string; error?: string }> {
  try {
    if (!msalInstance || lastClientId !== settings.clientId || lastTenantId !== settings.tenantId) {
      initializeMSAL(settings);
    }

    // Try silent token acquisition first (cached token)
    const accounts = await msalInstance!.getTokenCache().getAllAccounts();
    let tokenResponse;

    if (accounts.length > 0) {
      try {
        tokenResponse = await msalInstance!.acquireTokenSilent({
          account: accounts[0],
          scopes: settings.scopes,
        });
      } catch (silentError) {
        if (silentError instanceof InteractionRequiredAuthError) {
          // Token expired, need interactive login
          tokenResponse = await performInteractiveAuth(msalInstance!, settings);
        } else {
          throw silentError;
        }
      }
    } else {
      // No cached accounts, interactive login required
      tokenResponse = await performInteractiveAuth(msalInstance!, settings);
    }

    if (tokenResponse) {
      accessToken = tokenResponse.accessToken;

      // Initialize Graph client
      graphClient = Client.init({
        authProvider: (done) => {
          done(null, accessToken!);
        },
      });

      authenticatedUserEmail = tokenResponse.account?.username || "";
      logActivity("microsoft_auth_success", "microsoft", { userEmail: authenticatedUserEmail });

      return { success: true, userEmail: authenticatedUserEmail };
    }

    return { success: false, error: "No token response received" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity(
      "microsoft_auth_failed",
      "microsoft",
      { error: message },
      "error",
      message,
    );
    return { success: false, error: message };
  }
}

/**
 * Get current Microsoft 365 connection status without triggering a new login.
 * Tries to silently restore a cached token on first call.
 */
export async function getConnectionStatus(
  settings: AppSettings["microsoft"],
): Promise<{ connected: boolean; userEmail?: string }> {
  try {
    // If we already have a token in memory, return immediately
    if (accessToken && authenticatedUserEmail && lastClientId === settings.clientId && lastTenantId === settings.tenantId) {
      return { connected: true, userEmail: authenticatedUserEmail };
    }

    // Try to restore from token cache (silent — no browser popup)
    if (!msalInstance || lastClientId !== settings.clientId || lastTenantId !== settings.tenantId) {
      if (!settings.clientId || !settings.tenantId) {
        return { connected: false };
      }
      initializeMSAL(settings);
    }

    const accounts = await msalInstance!.getTokenCache().getAllAccounts();
    if (accounts.length === 0) return { connected: false };

    const tokenResponse = await msalInstance!.acquireTokenSilent({
      account: accounts[0],
      scopes: settings.scopes,
    });

    if (tokenResponse) {
      accessToken = tokenResponse.accessToken;
      authenticatedUserEmail = tokenResponse.account?.username || "";

      graphClient = Client.init({
        authProvider: (done) => done(null, accessToken!),
      });

      return { connected: true, userEmail: authenticatedUserEmail };
    }
  } catch {
    // Silent token acquisition failed — user needs to log in interactively
  }

  return { connected: false };
}

/**
 * Disconnect Microsoft 365 — clears all cached tokens and resets in-memory state.
 */
export async function disconnectMicrosoft(): Promise<{ success: boolean }> {
  try {
    if (msalInstance) {
      const accounts = await msalInstance.getTokenCache().getAllAccounts();
      for (const account of accounts) {
        await msalInstance.getTokenCache().removeAccount(account);
      }
    }
  } catch (e) {
    console.warn("[Microsoft] Failed to remove MSAL accounts:", e);
  }

  // Reset in-memory state
  accessToken = null;
  graphClient = null;
  authenticatedUserEmail = null;
  msalInstance = null;

  logActivity("microsoft_disconnected", "microsoft", {});
  return { success: true };
}

/**
 * Send an email via O365 mailbox using Graph API
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  options: {
    isHtml?: boolean;
    cc?: string[];
    bcc?: string[];
    saveToSentItems?: boolean;
    replyTo?: string;
  } = {},
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!graphClient) {
    return {
      success: false,
      error: "Not authenticated with Microsoft. Please sign in first.",
    };
  }

  const { isHtml = true, cc = [], bcc = [], saveToSentItems = true } = options;

  try {
    const mailPayload = {
      message: {
        subject,
        body: {
          contentType: isHtml ? "HTML" : "Text",
          content: body,
        },
        toRecipients: [{ emailAddress: { address: to } }],
        ccRecipients: cc.map((addr) => ({ emailAddress: { address: addr } })),
        bccRecipients: bcc.map((addr) => ({ emailAddress: { address: addr } })),
      },
      saveToSentItems,
    };

    await graphClient.api("/me/sendMail").post(mailPayload);

    logActivity("email_sent", "microsoft", {
      to,
      subject,
      bodyLength: body.length,
      isHtml,
    });

    return { success: true, messageId: uuid() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity(
      "email_send_failed",
      "microsoft",
      {
        to,
        subject,
        error: message,
      },
      "error",
      message,
    );
    return { success: false, error: message };
  }
}

/**
 * Send a personalized email to a lead
 * Uses email template + AI-generated content
 */
export async function sendPersonalizedLeadEmail(
  profile: LinkedInProfile,
  emailContent: { subject: string; body: string },
  recipientEmail: string,
  type: "intro" | "follow_up" | "welcome" | "meeting_confirm",
  settings: AppSettings,
): Promise<EmailRecord | null> {
  const emailId = uuid();
  const trackingDomain = settings.analytics?.trackingDomain;

  let processedBody = emailContent.body;

  // 1. Wrap hyperlinks with tracking if domain is configured
  if (trackingDomain) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    processedBody = emailContent.body.replace(urlRegex, (url) => {
      const encodedUrl = encodeURIComponent(url);
      const trackingUrl = `${trackingDomain}/track/click?eid=${emailId}&url=${encodedUrl}`;
      return `<a href="${trackingUrl}">${url}</a>`;
    });
  }

  // Wrap body in a clean HTML template
  let htmlBody = `
    <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
      ${processedBody
        .split("\n")
        .map((line) =>
          line.trim()
            ? `<p style="margin: 0 0 16px 0; line-height: 1.6;">${line}</p>`
            : "",
        )
        .join("")}
    </div>
  `;

  // 2. Embed invisible tracking pixel
  if (trackingDomain) {
    const pixelUrl = `${trackingDomain}/track/open?eid=${emailId}`;
    htmlBody += `<img src="${pixelUrl}" width="1" height="1" style="display:none !important;" />`;
  }

  const result = await sendEmail(
    recipientEmail,
    emailContent.subject,
    htmlBody,
    {
      isHtml: true,
      saveToSentItems: true,
    },
  );

  if (result.success) {
    const emailRecord: EmailRecord = {
      id: emailId,
      leadId: profile.id,
      subject: emailContent.subject,
      body: emailContent.body,
      type,
      sentAt: new Date().toISOString(),
      openedAt: null,
      clickedAt: null,
      repliedAt: null,
    };

    // Save email to database
    const db = getDatabase();
    db.prepare(`
      INSERT INTO emails (id, lead_id, subject, body, type, sent_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      emailRecord.id,
      emailRecord.leadId,
      emailRecord.subject,
      emailRecord.body,
      emailRecord.type,
      emailRecord.sentAt
    );

    return emailRecord;
  }

  return null;
}

/**
 * Create a Microsoft Teams meeting
 */
export async function createMeeting(
  attendeeEmail: string,
  attendeeName: string,
  options: {
    subject?: string;
    startTime: Date;
    durationMinutes?: number;
    body?: string;
    isOnline?: boolean;
  },
): Promise<{
  success: boolean;
  meetingUrl?: string;
  eventId?: string;
  error?: string;
}> {
  if (!graphClient) {
    return { success: false, error: "Not authenticated with Microsoft" };
  }

  const {
    subject = `Meeting with ${attendeeName}`,
    startTime,
    durationMinutes = 30,
    body = "",
    isOnline = true,
  } = options;

  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

  try {
    const event = await graphClient.api("/me/events").post({
      subject,
      body: {
        contentType: "HTML",
        content:
          body ||
          `<p>Looking forward to our conversation, ${attendeeName}!</p>`,
      },
      start: {
        dateTime: startTime.toISOString(),
        timeZone: "Asia/Kolkata",
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: "Asia/Kolkata",
      },
      location: {
        displayName: isOnline ? "Microsoft Teams" : "",
      },
      attendees: [
        {
          emailAddress: {
            address: attendeeEmail,
            name: attendeeName,
          },
          type: "required",
        },
      ],
      isOnlineMeeting: isOnline,
      onlineMeetingProvider: isOnline ? "teamsForBusiness" : undefined,
      allowNewTimeProposals: true,
    });

    const meetingUrl = event.onlineMeeting?.joinUrl || event.webLink || "";

    logActivity("meeting_created", "microsoft", {
      attendeeEmail,
      attendeeName,
      subject,
      startTime: startTime.toISOString(),
      durationMinutes,
      meetingUrl,
      eventId: event.id,
    });

    return {
      success: true,
      meetingUrl,
      eventId: event.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity(
      "meeting_create_failed",
      "microsoft",
      {
        attendeeEmail,
        error: message,
      },
      "error",
      message,
    );
    return { success: false, error: message };
  }
}

/**
 * Get available time slots for a meeting
 */
export async function getAvailableSlots(
  dateRange: { start: Date; end: Date },
  durationMinutes: number = 30,
): Promise<Array<{ start: Date; end: Date }>> {
  if (!graphClient) return [];

  try {
    const response = await graphClient.api("/me/calendar/getSchedule").post({
      schedules: ["me"],
      startTime: {
        dateTime: dateRange.start.toISOString(),
        timeZone: "Asia/Kolkata",
      },
      endTime: {
        dateTime: dateRange.end.toISOString(),
        timeZone: "Asia/Kolkata",
      },
      availabilityViewInterval: durationMinutes,
    });

    // Parse availability and find free slots
    const availableSlots: Array<{ start: Date; end: Date }> = [];
    const scheduleInfo = response?.value?.[0];

    if (scheduleInfo?.availabilityView) {
      const view = scheduleInfo.availabilityView as string;
      const slotStart = new Date(dateRange.start);

      for (let i = 0; i < view.length; i++) {
        if (view[i] === "0") {
          // 0 = free
          const start = new Date(
            slotStart.getTime() + i * durationMinutes * 60000,
          );
          const end = new Date(start.getTime() + durationMinutes * 60000);

          // Only include slots during working hours (9-18 IST)
          const hour = start.getHours();
          if (hour >= 9 && hour < 18) {
            availableSlots.push({ start, end });
          }
        }
      }
    }

    return availableSlots;
  } catch (error) {
    logActivity(
      "available_slots_failed",
      "microsoft",
      {
        error: error instanceof Error ? error.message : "Unknown",
      },
      "error",
    );
    return [];
  }
}
