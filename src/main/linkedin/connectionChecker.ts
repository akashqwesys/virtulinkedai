/**
 * Connection Status Checker
 *
 * Periodically checks the status of pending connection requests
 * to detect when connections are accepted or declined.
 * Triggers campaign state transitions accordingly.
 */

import type { Page } from "puppeteer-core";
import { getPage } from "../browser/engine";
import {
  humanClick,
  humanDelay,
  humanScroll,
  pageLoadDelay,
  randomIdleAction,
  isWithinWorkingHours,
  inPageNavigate,
} from "../browser/humanizer";
import { getDatabase, logActivity } from "../storage/database";
import type { AppSettings } from "../../shared/types";

interface PendingConnection {
  leadId: string;
  linkedinUrl: string;
  requestedAt: string;
}

let checkInterval: NodeJS.Timeout | null = null;

export function startConnectionChecker(
  settings: AppSettings,
  intervalMinutes: number = 60,
): void {
  // Deprecated: Now handled by JobQueue recurring task 'CHECK_ACCEPTANCE'.
  // Leaving empty signature for backward compatibility.
}

/**
 * Stop the periodic checker
 */
export function stopConnectionChecker(): void {
  // Deprecated: Handled by JobQueue on shutdown.
}

/**
 * Check all pending connection requests
 */
export async function checkAllPendingConnections(settings?: AppSettings): Promise<{
  checked: number;
  accepted: number;
  withdrawn: number;
}> {
  const page = getPage();
  if (!page) return { checked: 0, accepted: 0, withdrawn: 0 };

  const db = getDatabase();

  // Get all leads in "connection_requested" or "waiting_acceptance" state
  const pendingLeads = db
    .prepare(
      `
    SELECT id, linkedin_url, campaign_id, connection_requested_at
    FROM leads
    WHERE status IN ('connection_requested', 'waiting_acceptance', 'connection_sent')
    ORDER BY connection_requested_at ASC
  `,
    )
    .all() as (PendingConnection & { campaign_id: string })[];

  if (pendingLeads.length === 0)
    return { checked: 0, accepted: 0, withdrawn: 0 };

  let accepted = 0;
  let withdrawn = 0;

  try {
    // Method 1: Check "Sent" invitations page via SPA routing
    await inPageNavigate(page, "https://www.linkedin.com/mynetwork/invitation-manager/sent/");

    // Get all sent invitations that are still pending
    const pendingInvitations = new Set<string>();
    await humanScroll(page, { direction: "down", distance: 500 });
    await humanDelay(1000, 2000);

    const invitationCards = await page.$$(
      ".invitation-card, .mn-invitation-list__item",
    );
    for (const card of invitationCards) {
      const url = await page.evaluate((el) => {
        const link = el.querySelector('a[href*="/in/"]');
        return link?.getAttribute("href") || "";
      }, card);
      if (url) pendingInvitations.add(url.split("?")[0]);
    }

    // Method 2: Check connections page to see who's now connected via SPA
    await inPageNavigate(page, "https://www.linkedin.com/mynetwork/invite-connect/connections/");

    // For each pending lead, check their status
    for (const lead of pendingLeads) {
      const normalizedUrl = lead.linkedinUrl.split("?")[0];

      // If not in pending invitations, they either accepted or withdrew
      if (!pendingInvitations.has(normalizedUrl)) {
        // Check if they're now a connection
        const isConnected = await checkIfConnected(page, normalizedUrl);

        if (isConnected) {
          // Connection accepted!
          db.prepare(
            "UPDATE leads SET status = 'connection_accepted', connection_accepted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
          ).run(lead.leadId);

          db.prepare(
            "INSERT INTO connection_checks (lead_id, linkedin_url, previous_status, current_status) VALUES (?, ?, ?, ?)",
          ).run(lead.leadId, lead.linkedinUrl, "pending", "accepted");

          accepted++;
          logActivity("connection_accepted", "linkedin", {
            leadId: lead.leadId,
            linkedinUrl: lead.linkedinUrl,
          });

          // Enqueue Welcome DM with delay
          if (settings) {
            const delayMs =
              settings.chatbot.responseDelayMinMinutes * 60 * 1000 +
              Math.random() *
                ((settings.chatbot.responseDelayMaxMinutes -
                  settings.chatbot.responseDelayMinMinutes) *
                  60 *
                  1000);
            
            const { jobQueue } = await import("../queue/jobQueue");
            const { JOB_TYPES } = await import("../queue/jobs");
            
            jobQueue.enqueue(
              JOB_TYPES.SEND_WELCOME_DM,
              {
                leadId: lead.leadId,
                linkedinUrl: lead.linkedinUrl,
                campaignId: lead.campaign_id,
              },
              { delayMs }
            );
            
            logActivity("welcome_dm_enqueued", "campaign", { 
              leadId: lead.leadId, 
              delayMinutes: Math.round(delayMs / 60000) 
            });
          }
        } else {
          // Connection was withdrawn or declined
          const requestAge = Date.now() - new Date(lead.requestedAt).getTime();
          if (requestAge > 30 * 24 * 60 * 60 * 1000) {
            // > 30 days
            db.prepare(
              "UPDATE leads SET status = 'rejected', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            ).run(lead.leadId);

            db.prepare(
              "INSERT INTO connection_checks (lead_id, linkedin_url, previous_status, current_status) VALUES (?, ?, ?, ?)",
            ).run(lead.leadId, lead.linkedinUrl, "pending", "withdrawn");

            withdrawn++;
          }
        }
      }

      // Small delay between checks to look natural
      await humanDelay(500, 1500);
    }

    // Random idle action after checking
    if (Math.random() < 0.5) {
      await randomIdleAction(page);
    }

    logActivity("connection_check_completed", "linkedin", {
      totalChecked: pendingLeads.length,
      accepted,
      withdrawn,
    });
  } catch (error) {
    logActivity(
      "connection_check_error",
      "linkedin",
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "error",
    );
  }

  return { checked: pendingLeads.length, accepted, withdrawn };
}

/**
 * Check if a specific profile is now connected
 */
async function checkIfConnected(
  page: Page,
  profileUrl: string,
): Promise<boolean> {
  try {
    // Quick visit the profile via SPA
    await inPageNavigate(page, profileUrl);
    await humanDelay(1500, 3000);

    // Check for "Connected" indicator
    const connectionIndicator =
      (await page.$(".pv-top-card--list .dist-value")) ||
      (await page.$("[data-test-distance-badge]")) ||
      (await page.$(".distance-badge"));

    if (connectionIndicator) {
      const text = await page.evaluate(
        (el) => el.textContent?.trim(),
        connectionIndicator,
      );
      return text?.includes("1st") || false;
    }

    // Alternative: check if "Message" button exists (1st connections have it)
    const messageButton = await page.$("button::-p-text(Message)");
    const connectButton = await page.$("button::-p-text(Connect)");

    // If Message exists but not Connect, they're a 1st connection
    return !!messageButton && !connectButton;
  } catch {
    return false;
  }
}

/**
 * Get recent connection check results
 */
export function getRecentChecks(limit: number = 50): any[] {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT cc.*, l.first_name, l.last_name, l.company
    FROM connection_checks cc
    LEFT JOIN leads l ON cc.lead_id = l.id
    ORDER BY cc.checked_at DESC
    LIMIT ?
  `,
    )
    .all(limit);
}
