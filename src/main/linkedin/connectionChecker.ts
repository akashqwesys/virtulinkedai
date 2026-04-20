/**
 * Connection Status Checker
 *
 * Checks each pending lead's LinkedIn profile directly to detect
 * whether their connection request was accepted.
 *
 * Strategy: Navigate to the lead's profile page and inspect the
 * connection degree badge + button states using multiple fallback
 * selectors to handle LinkedIn's constantly-evolving DOM.
 */

import type { Page } from "puppeteer-core";
import { getPage } from "../browser/engine";
import {
  humanDelay,
  pageLoadDelay,
  randomIdleAction,
  inPageNavigate,
} from "../browser/humanizer";
import { getDatabase, logActivity } from "../storage/database";
import type { AppSettings } from "../../shared/types";
import { v4 as uuid } from "uuid";

interface PendingConnection {
  leadId: string;
  linkedinUrl: string;
  requestedAt: string;
  campaign_id: string;
}

export function startConnectionChecker(
  settings: AppSettings,
  intervalMinutes: number = 60,
): void {
  // Deprecated: Now handled by JobQueue recurring task 'CHECK_ACCEPTANCE'.
}

export function stopConnectionChecker(): void {
  // Deprecated: Handled by JobQueue on shutdown.
}

/**
 * Check all pending connection requests by visiting each lead's profile page.
 * Determines connection status using a multi-signal DOM inspection strategy.
 */
export async function checkAllPendingConnections(settings?: AppSettings): Promise<{
  checked: number;
  accepted: number;
  withdrawn: number;
}> {
  const page = getPage();
  if (!page) return { checked: 0, accepted: 0, withdrawn: 0 };

  const db = getDatabase();

  const pendingLeads = db
    .prepare(
      `SELECT l.id AS leadId, l.linkedin_url AS linkedinUrl, l.campaign_id, l.connection_requested_at AS requestedAt
       FROM leads l
       LEFT JOIN campaigns c ON l.campaign_id = c.id
       WHERE l.status IN ('connection_requested', 'waiting_acceptance', 'connection_sent')
         AND (l.campaign_id IS NULL OR c.status = 'active')
       ORDER BY l.connection_requested_at ASC`,
    )
    .all() as PendingConnection[];

  if (pendingLeads.length === 0) {
    console.log("[ConnectionChecker] No pending leads to check.");
    return { checked: 0, accepted: 0, withdrawn: 0 };
  }

  console.log(`[ConnectionChecker] Checking ${pendingLeads.length} pending lead(s)...`);

  let accepted = 0;
  let withdrawn = 0;

  for (const lead of pendingLeads) {
    try {
      const { isConnected, signal } = await checkConnectionStatus(page, lead.linkedinUrl);

      console.log(
        `[ConnectionChecker] Lead ${lead.leadId} (${lead.linkedinUrl}): isConnected=${isConnected}, signal="${signal}"`
      );

      if (isConnected) {
        // ── Mark as accepted ─────────────────────────────────────────────
        db.prepare(
          `UPDATE leads
           SET status = 'connection_accepted',
               connection_accepted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
               updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
           WHERE id = ?`,
        ).run(lead.leadId);

        // Safe insert — connection_checks table may not have all columns on older DBs
        try {
          db.prepare(
            `INSERT INTO connection_checks (lead_id, linkedin_url, previous_status, current_status)
             VALUES (?, ?, ?, ?)`,
          ).run(lead.leadId, lead.linkedinUrl, "pending", "accepted");
        } catch (_) {}

        accepted++;
        logActivity("connection_accepted", "linkedin", {
          leadId: lead.leadId,
          linkedinUrl: lead.linkedinUrl,
          detectionSignal: signal,
        });

        // ── Enqueue Welcome DM ────────────────────────────────────────────
        if (settings) {
          const minDelay = (settings.chatbot?.responseDelayMinMinutes ?? 2) * 60 * 1000;
          const maxDelay = (settings.chatbot?.responseDelayMaxMinutes ?? 15) * 60 * 1000;
          const delayMs = minDelay + Math.random() * (maxDelay - minDelay);

          const { jobQueue } = await import("../queue/jobQueue");
          const { JOB_TYPES } = await import("../queue/jobs");

          jobQueue.enqueue(
            JOB_TYPES.SEND_WELCOME_DM,
            {
              leadId: lead.leadId,
              linkedinUrl: lead.linkedinUrl,
              campaignId: lead.campaign_id,
            },
            { delayMs },
          );

          logActivity("welcome_dm_enqueued", "campaign", {
            leadId: lead.leadId,
            delayMinutes: Math.round(delayMs / 60000),
          });

          // ── Enqueue Welcome Email (1 hour after acceptance) ───────────────
          // Only if the lead already has an email address on file.
          const leadRow = db.prepare("SELECT email FROM leads WHERE id = ?").get(lead.leadId) as any;
          if (leadRow?.email) {
            jobQueue.enqueue(
              JOB_TYPES.SEND_WELCOME_EMAIL,
              {
                leadId: lead.leadId,
                campaignId: lead.campaign_id,
                recipientEmail: leadRow.email,
              },
              { delayMs: 60 * 60 * 1000 }, // 1 hour
            );
            logActivity("welcome_email_enqueued", "campaign", {
              leadId: lead.leadId,
              delayMinutes: 60,
            });
          }

        }
      } else {
        // ── Check if stale (> 30 days) → mark withdrawn ──────────────────
        const requestAge = lead.requestedAt ? Date.now() - new Date(lead.requestedAt).getTime() : 0;
        if (requestAge > 30 * 24 * 60 * 60 * 1000) {
          db.prepare(
            `UPDATE leads
             SET status = 'rejected',
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?`,
          ).run(lead.leadId);

          try {
            db.prepare(
              `INSERT INTO connection_checks (lead_id, linkedin_url, previous_status, current_status)
               VALUES (?, ?, ?, ?)`,
            ).run(lead.leadId, lead.linkedinUrl, "pending", "withdrawn");
          } catch (_) {}

          withdrawn++;
          logActivity("connection_withdrawn", "linkedin", {
            leadId: lead.leadId,
            linkedinUrl: lead.linkedinUrl,
            requestAgeHours: Math.round(requestAge / 3600000),
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ConnectionChecker] Error checking lead ${lead.leadId}: ${msg}`);
      logActivity("connection_check_lead_error", "linkedin", {
        leadId: lead.leadId,
        error: msg,
      }, "error");
    }

    // Human-like pause between profile visits
    await humanDelay(2000, 4000);
  }

  // ── Log overall result ────────────────────────────────────────────────────
  logActivity("connection_check_completed", "linkedin", {
    totalChecked: pendingLeads.length,
    accepted,
    withdrawn,
  });

  console.log(
    `[ConnectionChecker] Done. Checked: ${pendingLeads.length}, Accepted: ${accepted}, Withdrawn: ${withdrawn}`
  );

  // ── Stale Connection Follow-up (pending > 3 days, no follow-up email) ───
  try {
    const staleLeads = db.prepare(`
      SELECT l.id, l.email, l.first_name, l.last_name, l.company, l.campaign_id
      FROM leads l
      LEFT JOIN campaigns c ON l.campaign_id = c.id
      WHERE l.status IN ('connection_requested', 'waiting_acceptance', 'connection_sent')
        AND l.connection_requested_at < datetime('now', '-3 days')
        AND (l.campaign_id IS NULL OR c.status = 'active')
        AND NOT EXISTS (
          SELECT 1 FROM emails e
          WHERE e.lead_id = l.id AND e.type = 'follow_up'
        )
    `).all() as any[];

    if (staleLeads.length > 0) {
      console.log(`[ConnectionChecker] ${staleLeads.length} stale lead(s) for follow-up email.`);
      const { jobQueue } = await import("../queue/jobQueue");
      const { JOB_TYPES } = await import("../queue/jobs");

      for (const staleLead of staleLeads) {
        if (staleLead.email) {
          jobQueue.enqueue(
            JOB_TYPES.SEND_FOLLOWUP_EMAIL,
            { leadId: staleLead.id, campaignId: staleLead.campaign_id, recipientEmail: staleLead.email },
            { delayMs: 0, priority: 4 },
          );
        } else {
          jobQueue.enqueue(
            JOB_TYPES.ENRICH_LEAD_EMAIL,
            { leadId: staleLead.id, campaignId: staleLead.campaign_id },
            { delayMs: 0, priority: 3 },
          );
        }
      }
    }
  } catch (err) {
    console.warn("[ConnectionChecker] Stale-lead follow-up error:", err);
  }

  return { checked: pendingLeads.length, accepted, withdrawn };
}

/**
 * Determine the connection status of a lead by visiting their profile.
 *
 * Returns { isConnected, signal } where:
 *  - isConnected: true if the lead is a 1st-degree connection
 *  - signal: which detection method fired (useful for debugging)
 *
 * Strategy (in order of reliability):
 *  1. Degree badge text scan — look for "1st" in all known badge containers
 *  2. Button aria-label scan — "Message [name]" button only appears for 1st connections
 *  3. Button text scan — "Message" exists but "Connect"/"Follow"/"Pending" does NOT
 *  4. Page-wide text scan — fallback using page.evaluate() to search entire DOM
 */
async function checkConnectionStatus(
  page: Page,
  profileUrl: string,
): Promise<{ isConnected: boolean; signal: string }> {
  // Normalize URL — strip query params and trailing slash
  const cleanUrl = profileUrl.split("?")[0].replace(/\/$/, "") + "/";

  try {
    let result = { isConnected: false, signal: "inconclusive" };
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await inPageNavigate(page, cleanUrl);
        
        // Provide a strong guarantee the main profile card has mounted before we scan
        await page.waitForSelector('.pv-top-card, .ph5.pb5, main, .core-rail', { timeout: 15000 }).catch(() => null);
        
        await pageLoadDelay();
        await humanDelay(1500, 2500);

        result = await page.evaluate(() => {
          // ── Signal 1: Degree badge text ────────────────────────────────────
      // LinkedIn renders a "1st" badge near the profile name in various containers.
      // The class names change often; we search by text content across all known selectors.
      const badgeSelectors = [
        ".pv-top-card--list .dist-value",
        "[data-test-distance-badge]",
        ".distance-badge span",
        ".profile-topcard__connection-badge",
        ".artdeco-entity-lockup__degree",
        ".pvs-header__title .text-body-small",
        "span.dist-value",
        // Generic: any small badge-like element near the name
        ".pv-top-card-v2-ctas + span",
        ".ph5 .dist-value",
      ];

      for (const sel of badgeSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const txt = el.textContent?.trim() || "";
          if (txt.includes("1st") || txt === "1") {
            return { isConnected: true, signal: `badge-selector:${sel}` };
          }
        }
      }

      // ── Signal 2: aria-label on Message button ─────────────────────────
      // When connected, LinkedIn renders: <button aria-label="Message [Name]">
      // The "Message" aria-label ONLY exists for 1st-degree connections.
      const allButtons = Array.from(document.querySelectorAll("button, a[role='button']"));
      for (const btn of allButtons) {
        const label = btn.getAttribute("aria-label") || "";
        const txt = btn.textContent?.trim() || "";
        // "Pending" button = request still sent (not yet accepted)
        if (label.toLowerCase().includes("pending") || txt.toLowerCase() === "pending") {
          return { isConnected: false, signal: "button:pending-detected" };
        }
      }

      // Check for Message button (exists only for 1st connections on their profile)
      let hasMessageButton = false;
      let hasConnectButton = false;
      let hasPendingButton = false;
      let hasFollowButton = false;

      for (const btn of allButtons) {
        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        const txt = (btn.textContent?.trim() || "").toLowerCase();
        const combined = label + " " + txt;

        if (
          combined.includes("message") &&
          !combined.includes("inmail") &&
          !combined.includes("send inmail")
        ) {
          hasMessageButton = true;
        }
        if (combined.includes("connect")) hasConnectButton = true;
        if (combined.includes("pending")) hasPendingButton = true;
        if (combined.includes("follow") && !combined.includes("unfollow")) hasFollowButton = true;
      }

      if (hasPendingButton) {
        return { isConnected: false, signal: "button:pending" };
      }

      if (hasMessageButton && !hasConnectButton) {
        return { isConnected: true, signal: "button:message-no-connect" };
      }

      // ── Signal 3: Page-wide text search for "1st" degree badge ─────────
      // Scan all spans/divs for "• 1st" or "1st degree connection"
      const textCandidates = document.querySelectorAll("span, div, p");
      for (const el of textCandidates) {
        const txt = el.textContent?.trim() || "";
        // Match "1st", "• 1st", "1st degree", "1st-degree"
        if (/^(•\s*)?1st(\s*degree)?$/i.test(txt)) {
          return { isConnected: true, signal: "text-scan:1st-degree" };
        }
      }

      // ── Signal 4: Check that "Connect" button exists → NOT connected ───
      if (hasConnectButton) {
        return { isConnected: false, signal: "button:connect-present" };
      }

      // If none of the signals resolved it conclusively
      return { isConnected: false, signal: "inconclusive" };
    });

        // If evaluate succeeded, break the retry loop
        break;
      } catch (evalErr: any) {
        if (
          evalErr.message.includes("Execution context was destroyed") ||
          evalErr.message.includes("Cannot inspect context") ||
          evalErr.message.includes("Cannot read properties of null")
        ) {
          console.warn(`[ConnectionChecker] Evaluate failed (attempt ${attempt}/3): ${evalErr.message}`);
          if (attempt === 3) throw evalErr;
          console.log(`[ConnectionChecker] Waiting 10 seconds for the navigation to settle before attempting again...`);
          await humanDelay(10000, 12000); // Wait 10-12s before retrying
        } else {
          // Unrelated error, throw immediately
          throw evalErr;
        }
      }
    }

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isConnected: false, signal: `error:${msg.substring(0, 80)}` };
  }
}

/**
 * Get recent connection check results
 */
export function getRecentChecks(limit: number = 50): any[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT cc.*, l.first_name, l.last_name, l.company
       FROM connection_checks cc
       LEFT JOIN leads l ON cc.lead_id = l.id
       ORDER BY cc.checked_at DESC
       LIMIT ?`,
    )
    .all(limit);
}

/**
 * Fallback: find leads in the DB that are already connected (connection_accepted)
 * but have never received a Welcome DM, and enqueue SEND_WELCOME_DM for each.
 *
 * SEND_WELCOME_DM already handles the full messaging workflow:
 *   → navigate to LinkedIn Messaging inbox
 *   → search for lead by first+last name
 *   → read existing conversation thread for context
 *   → generate AI reply via Ollama
 *   → send with human-like typing
 *
 * This is identical to the workflow triggered after a connection request is accepted.
 * No browser navigation is needed here — the DB is the source of truth.
 */
export async function checkRecentConnectionsList(campaignId: string, settings?: AppSettings): Promise<void> {
  if (!settings) {
    console.log("[ConnectionChecker] No settings provided — skipping connected-lead DM check.");
    return;
  }

  const db = getDatabase();
  const { jobQueue } = await import("../queue/jobQueue");
  const { JOB_TYPES } = await import("../queue/jobs");

  // Build campaign filter — if a specific campaign is provided use it,
  // otherwise check all active campaigns.
  let campaignFilter = "";
  const params: any[] = [];

  if (campaignId) {
    campaignFilter = "AND l.campaign_id = ?";
    params.push(campaignId);
  }

  // Find every connection_accepted lead that has NEVER received an outbound DM
  const pendingDmLeads = db.prepare(`
    SELECT l.id, l.campaign_id, l.linkedin_url, l.first_name, l.last_name, l.status
    FROM leads l
    WHERE l.status IN ('connection_accepted', 'welcome_pending')
      ${campaignFilter}
      AND NOT EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.lead_id = l.id
          AND c.direction = 'outbound'
      )
    ORDER BY l.connection_accepted_at ASC
    LIMIT 20
  `).all(...params) as any[];

  if (pendingDmLeads.length === 0) {
    console.log("[ConnectionChecker] No connection_accepted leads pending a Welcome DM.");
    return;
  }

  console.log(`[ConnectionChecker] Found ${pendingDmLeads.length} connected lead(s) that need a Welcome DM.`);

  for (const lead of pendingDmLeads) {
    const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.linkedin_url;

    // Deduplicate: skip if a SEND_WELCOME_DM job is already pending/running for this lead
    const existingJob = db.prepare(`
      SELECT id FROM job_queue
      WHERE type = 'SEND_WELCOME_DM'
        AND status IN ('pending', 'running')
        AND json_extract(payload, '$.leadId') = ?
    `).get(lead.id);

    if (existingJob) {
      console.log(`[ConnectionChecker] Welcome DM already queued for "${fullName}" — skipping.`);
      continue;
    }

    const minDelay = (settings.chatbot?.responseDelayMinMinutes ?? 2) * 60 * 1000;
    const maxDelay = (settings.chatbot?.responseDelayMaxMinutes ?? 15) * 60 * 1000;
    const delayMs = minDelay + Math.random() * (maxDelay - minDelay);

    jobQueue.enqueue(
      JOB_TYPES.SEND_WELCOME_DM,
      {
        leadId: lead.id,
        linkedinUrl: lead.linkedin_url,
        campaignId: lead.campaign_id || campaignId,
      },
      { delayMs },
    );

    logActivity('welcome_dm_enqueued', 'campaign', {
      leadId: lead.id,
      name: fullName,
      delayMinutes: Math.round(delayMs / 60_000),
      source: 'connected_leads_fallback',
    });

    console.log(`[ConnectionChecker] Welcome DM queued for "${fullName}" in ${Math.round(delayMs / 60_000)} min. [Messaging inbox → search by name → AI reply]`);
  }
}

/**
 * Proactively check threads of all 'engaged' leads to handle replies
 * that might have missed the unread badge detection.
 */
export async function checkAllEngagedLeads(settings?: AppSettings): Promise<void> {
  if (!settings) return;
  const db = getDatabase();
  const { jobQueue } = await import("../queue/jobQueue");
  const { JOB_TYPES } = await import("../queue/jobs");

  // Get engaged leads (those we have messaged and are waiting for replies from or in active conversation)
  const engagedLeads = db.prepare(`
    SELECT l.id, l.campaign_id, l.linkedin_url, l.status, l.first_name, l.last_name, l.company, l.headline
    FROM leads l
    LEFT JOIN campaigns c ON l.campaign_id = c.id
    WHERE l.status IN ('welcome_sent', 'in_conversation', 'replied')
      AND (l.campaign_id IS NULL OR c.status = 'active')
  `).all() as any[];

  if (engagedLeads.length === 0) {
    console.log("[ConnectionChecker] No engaged leads to check for replies.");
    return;
  }

  console.log(`[ConnectionChecker] Enqueuing thread check for ${engagedLeads.length} engaged lead(s).`);

  // Enqueue a CHECK_LEAD_THREAD job for each one with spread delays
  for (let i = 0; i < engagedLeads.length; i++) {
    const lead = engagedLeads[i];
    
    // Spread them out by ~2-5 minutes each to emulate human browsing and avoid aggressive burst clicking
    const minDelay = i * (2 * 60 * 1000 + (Math.random() * 60000)) + 5000;
    
    // Deduplicate jobs
    const existingJob = db.prepare(`
      SELECT id FROM job_queue
      WHERE type = 'CHECK_LEAD_THREAD'
        AND status IN ('pending', 'running')
        AND json_extract(payload, '$.leadId') = ?
    `).get(lead.id);

    if (existingJob) continue;

    jobQueue.enqueue(
      JOB_TYPES.CHECK_LEAD_THREAD,
      {
        leadId: lead.id,
        linkedinUrl: lead.linkedin_url,
        campaignId: lead.campaign_id,
      },
      { delayMs: minDelay }
    );
  }
}
