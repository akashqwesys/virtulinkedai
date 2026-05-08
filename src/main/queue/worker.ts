/**
 * Queue Worker — VirtuLinked AI
 *
 * Registers all job handlers with the JobQueue singleton and starts
 * the polling loop. This is the single entry point that connects
 * job types to their execution logic.
 *
 * Called once on app startup from `src/main/index.ts`.
 */

import { jobQueue } from "./jobQueue";
import { JOB_TYPES } from "./jobs";
import type {
  ScrapeProfilePayload,
  SendConnectionPayload,
  CheckAcceptancePayload,
  SendWelcomeDmPayload,
  SendIntroEmailPayload,
  SendWelcomeEmailPayload,
  SendFollowupEmailPayload,
  SendMeetingConfirmationPayload,
  PublishScheduledPostPayload,
  RunEngagementSessionPayload,
  CheckMessagesPayload,
  PruneJobQueuePayload,
  SendReplyDmPayload,
  CheckEngagedRepliesPayload,
  CheckLeadThreadPayload,
  CheckDmFollowupsPayload,
} from "./jobs";
import type { Job } from "./jobQueue";
import { getDatabase, logActivity } from "../storage/database";
import { isWithinWorkingHours, DailyLimitManager } from "../browser/humanizer";
import { scrapeProfile } from "../linkedin/scraper";
import { sendConnectionRequest } from "../linkedin/connector";
import { sendMessage, sendWelcomeDM, sendReplyInThread } from "../linkedin/messenger";
import { generatePersonalizedEmail } from "../ai/personalizer";
import { sendPersonalizedLeadEmail } from "../microsoft/email";
import { createTextPost } from "../content/scheduler";
import { runEngagementSession } from "../engagement/feed";
import { checkAllPendingConnections } from "../linkedin/connectionChecker";
import {
  readUnreadMessages,
  processChatbotMessage,
  checkLeadThreadForReply,
} from "../linkedin/messenger";
import { launchBrowser, getBrowserStatus, getPage } from "../browser/engine";
import { isAutoPilotRunning } from "../linkedin/autopilot";
import { checkAllEngagedLeads } from "../linkedin/connectionChecker";

// Settings and limit manager — injected once at app start
let _settings: any = null;
let _limitManager: DailyLimitManager | null = null;

// ============================================================
// Warmup Multiplier — ramps limits from startPercent → 100%
// ============================================================

function getWarmupMultiplier(settings: any): number {
  const w = settings?.warmup;
  if (!w || !w.enabled) return 1.0;

  const day = Math.max(0, w.currentDay || 0);
  const rampDays = Math.max(1, w.rampUpDays || 14);
  const startPct = Math.max(5, Math.min(100, w.startPercent || 20));

  if (day >= rampDays) return 1.0;

  // Linear ramp: startPct% on day 0, 100% on rampUpDays
  const pct = startPct + ((100 - startPct) * day) / rampDays;
  const multiplier = Math.min(1.0, pct / 100);

  console.log(`[Worker] Warmup day ${day}/${rampDays}: limits at ${Math.round(pct)}% (×${multiplier.toFixed(2)})`);
  return multiplier;
}

function applyWarmupToLimits(
  limits: { connectionRequests: number; profileViews: number; messages: number; postEngagements: number },
  multiplier: number,
): typeof limits {
  return {
    connectionRequests: Math.max(1, Math.round(limits.connectionRequests * multiplier)),
    profileViews:        Math.max(1, Math.round(limits.profileViews        * multiplier)),
    messages:            Math.max(1, Math.round(limits.messages            * multiplier)),
    postEngagements:     Math.max(1, Math.round(limits.postEngagements     * multiplier)),
  };
}

/**
 * Initialize worker with app settings.
 * Called from main index.ts after settings are loaded.
 */
export function initWorker(settings: any): void {
  _settings = settings;
  const rawLimits = {
    connectionRequests: settings.dailyLimits.connectionRequests,
    profileViews:       settings.dailyLimits.profileViews,
    messages:           settings.dailyLimits.messages,
    postEngagements:    settings.dailyLimits.postEngagements,
  };
  const warmupMultiplier = getWarmupMultiplier(settings);
  const effectiveLimits = applyWarmupToLimits(rawLimits, warmupMultiplier);

  _limitManager = new DailyLimitManager(
    effectiveLimits,
    settings.dailyLimits.randomizePercent,
  );
}

/**
 * Update settings (called when user changes settings)
 */
export function updateWorkerSettings(settings: any): void {
  _settings = settings;
  const rawLimits = {
    connectionRequests: settings.dailyLimits.connectionRequests,
    profileViews:       settings.dailyLimits.profileViews,
    messages:           settings.dailyLimits.messages,
    postEngagements:    settings.dailyLimits.postEngagements,
  };
  const warmupMultiplier = getWarmupMultiplier(settings);
  const effectiveLimits = applyWarmupToLimits(rawLimits, warmupMultiplier);

  _limitManager = new DailyLimitManager(
    effectiveLimits,
    settings.dailyLimits.randomizePercent,
  );
}

export function getLimitManager(): DailyLimitManager | null {
  return _limitManager;
}

// ============================================================
// Safety Gate — Check working hours before any action
// ============================================================

function enforceWorkingHours(): void {
  if (!_settings) return;
  if (!isWithinWorkingHours(_settings.workingHours)) {
    throw new Error("Outside working hours — job will be retried later");
  }
}

// ============================================================
// Browser Guard — Ensure browser is running before LinkedIn jobs
// ============================================================

async function ensureBrowserRunning(): Promise<void> {
  if (isAutoPilotRunning()) {
    throw new Error("Job paused: AutoPilot is running. Cannot use browser concurrently.");
  }

  const status = getBrowserStatus();
  const wasNotRunning = status.status !== "running" || !getPage();

  if (wasNotRunning) {
    console.log("[Worker] Browser not running — attempting auto-launch...");
    const result = await launchBrowser();
    if (!result.success) {
      throw new Error(`Browser auto-launch failed: ${result.error || "Unknown error"}. Please launch the browser manually from the Dashboard.`);
    }
    console.log("[Worker] Browser auto-launched successfully.");
  }

  // ── Page Stabilization Wait ─────────────────────────────────────────
  // Whether we just launched/reconnected OR the browser was already running,
  // the page may be mid-navigation (LinkedIn's own redirects, prior job's
  // final page.goto, etc.). If we call page.evaluate() while the page is
  // still loading, Puppeteer throws "Execution context was destroyed".
  // We wait here for the page to reach a stable state before returning.
  const page = getPage();
  if (page) {
    try {
      // Poll until the page reports 'complete' load state (max 15s)
      await page.waitForFunction(
        () => document.readyState === 'complete',
        { timeout: 15000 }
      );
    } catch (_) {
      // If it times out (e.g. stuck on a spinner), continue anyway.
      // The scraper has its own waitForSelector guards.
    }
    // Extra buffer: LinkedIn's SPA router fires after DOMContentLoaded
    await new Promise((r) => setTimeout(r, wasNotRunning ? 3000 : 500));
  }
}

// ============================================================
// Campaign Guard — Ensure campaign is active before running jobs
// ============================================================
function enforceCampaignActive(campaignId: string | null | undefined): void {
  if (!campaignId) return; // System-level jobs have no campaignId — they use enforceAnyActiveCampaign() instead
  const db = getDatabase();
  const campaign = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(campaignId) as any;
  if (!campaign || campaign.status !== "active") {
    throw new Error("Job paused: Campaign is paused or not active.");
  }
}

/**
 * For system-level recurring jobs (CHECK_ACCEPTANCE, CHECK_MESSAGES, etc.)
 * that don't belong to a single campaign — throw if NO campaign is active at all.
 * The queue treats "Campaign is paused" errors as soft retries (reschedules),
 * so the job will automatically resume once the user unpauses.
 */
function enforceAnyActiveCampaign(): void {
  const db = getDatabase();
  const active = db.prepare("SELECT id FROM campaigns WHERE status = 'active' LIMIT 1").get();
  if (!active) {
    throw new Error("Job paused: Campaign is paused — no active campaigns.");
  }
}

// ============================================================
// Handler: Scrape Profile
// ============================================================

jobQueue.process<ScrapeProfilePayload>(
  JOB_TYPES.SCRAPE_PROFILE,
  async (job: Job<ScrapeProfilePayload>) => {
    enforceWorkingHours();
    await ensureBrowserRunning();

    const { leadId, linkedinUrl, campaignId } = job.payload;
    enforceCampaignActive(campaignId);

    if (!_limitManager?.canPerform("profileViews"))
      throw new Error("Daily profile view limit reached");
    
    // Guard: skip if lead was deleted while job was queued/running
    const db = getDatabase();
    const leadEntity = db.prepare("SELECT id, status FROM leads WHERE id = ?").get(leadId) as any;
    if (!leadEntity) {
      console.log(`[Worker] Skipping SCRAPE_PROFILE — lead ${leadId} was deleted.`);
      return; // Clean exit, job will be marked as done
    }

    if (
      leadEntity.status === "profile_scraped" ||
      leadEntity.status === "connection_requested" ||
      leadEntity.status === "connected" ||
      leadEntity.status === "messaged" ||
      leadEntity.status === "engaged" ||
      leadEntity.status === "handed_off" ||
      leadEntity.status === "meeting_booked"
    ) {
      console.log(`[Worker] Skipping SCRAPE_PROFILE — lead ${leadId} already scraped or processed (status: ${leadEntity.status}).`);
      return; 
    }

    const profile = await scrapeProfile(linkedinUrl, { readNaturally: true }, _settings?.ai);

    if (!profile) throw new Error(`Failed to scrape profile: ${linkedinUrl}`);

    _limitManager.record("profileViews");

    // Persist to DB
    db.prepare(
      `
    UPDATE leads SET
      first_name = @firstName, last_name = @lastName, headline = @headline, company = @company, role = @role,
      location = @location, about = @about, email = @email, skills_json = @skills, experience_json = @experience,
      recent_posts_json = @recentPosts, profile_image_url = @profileImageUrl, scraped_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      status = 'profile_scraped', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), raw_data_json = @rawData
    WHERE id = @id
  `,
    ).run({
      // Coerce every field to null if undefined — SQLite3 rejects undefined bindings.
      firstName:      profile.firstName       ?? null,
      lastName:       profile.lastName        ?? null,
      headline:       profile.headline        ?? null,
      company:        profile.company         ?? null,
      role:           profile.headline        ?? null, // default role to headline
      location:       profile.location        ?? null,
      about:          profile.about           ?? null,
      email:          profile.email           ?? null,
      skills:         JSON.stringify(profile.skills       ?? []),
      experience:     JSON.stringify(profile.experience   ?? []),
      recentPosts:    JSON.stringify(profile.recentPosts  ?? []),
      profileImageUrl: profile.profileImageUrl ?? null,
      rawData:        JSON.stringify(profile),
      id:             leadId,
    });

    logActivity("profile_scraped_via_queue", "queue", {
      leadId,
      linkedinUrl,
      campaignId,
    });

    // Enqueue the next step — send connection request immediately (delay is now handled inside the job to preserve lock)
    jobQueue.enqueue<SendConnectionPayload>(
      JOB_TYPES.SEND_CONNECTION,
      { leadId, linkedinUrl, campaignId },
      {
        delayMs: 0,
        priority: 100,
      },
    );
  },
);

// ============================================================
// Handler: Send Connection Request
// ============================================================

jobQueue.process<SendConnectionPayload>(
  JOB_TYPES.SEND_CONNECTION,
  async (job: Job<SendConnectionPayload>) => {
    enforceWorkingHours();
    await ensureBrowserRunning();

    const { leadId, linkedinUrl, campaignId } = job.payload;
    enforceCampaignActive(campaignId);

    // Simulate human delay BEFORE acting, while holding the queue lock to prevent other tasks from interrupting
    await new Promise((r) => setTimeout(r, 5000 + Math.random() * 10000));

    if (!_limitManager?.canPerform("connectionRequests"))
      throw new Error("Daily connection request limit reached");
    const db = getDatabase();
    const lead = db
      .prepare("SELECT * FROM leads WHERE id = ?")
      .get(leadId) as any;
    if (!lead) {
      console.log(`[Worker] Skipping SEND_CONNECTION — lead ${leadId} was deleted.`);
      return; 
    }

    if (lead.status !== "profile_scraped" && lead.status !== "new") {
      console.log(`[Worker] Skipping SEND_CONNECTION — lead ${leadId} already processed by another routine (status: ${lead.status}).`);
      return;
    }

    // Unpack profile data using DB columns as fallbacks, as rawData may be sparse
    const profile = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : {};
    profile.id = lead.id;
    profile.linkedinUrl = lead.linkedin_url;
    profile.firstName = lead.first_name || profile.firstName || "Unknown";
    profile.lastName = lead.last_name || profile.lastName || "";
    profile.company = lead.company || profile.company || "";
    profile.headline = lead.headline || profile.headline || "";
    profile.location = lead.location || profile.location || "";

    const context = {
      yourName: _settings?.personalization?.yourName || "User",
      yourCompany: _settings?.personalization?.yourCompany || "",
      yourServices: _settings?.personalization?.yourServices || "",
    };

    const result = await sendConnectionRequest(
      profile,
      context,
      _settings,
      _limitManager!,
    );
    if (!result.success) {
      if (
        result.error === "COMPLETED_SKIPPED" || 
        result.error === "MODAL_NOT_FOUND" ||
        (result.error && (result.error.includes("Connect button not found") || result.error.includes("NOT_FOUND")))
      ) {
        console.log(`[Worker] Job ${job.id} marked as COMPLETED_SKIPPED based on relationship state or missing UI element: ${result.error}`);
        db.prepare(`UPDATE job_queue SET status = 'COMPLETED_SKIPPED' WHERE id = ?`).run(job.id);
        
        // Progress lead to connection_requested so pipeline doesn't loop
        db.prepare(
          `UPDATE leads SET status = 'connection_requested',
          connection_requested_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE id = ?`
        ).run(leadId);
        
        return;
      }
      
      if (result.error === "EMAIL_NEEDED") {
        console.log("[Worker] Connect unavailable, but Message available. Triggering Module C Email via MS Graph API.");
        // Placeholder for MS Graph integration
        if (lead.email) {
          jobQueue.enqueue<SendIntroEmailPayload>(
            JOB_TYPES.SEND_INTRO_EMAIL,
            { leadId, campaignId, recipientEmail: lead.email },
            { delayMs: 0, priority: 100 }
          );
        }
        
        // Progress lead to connection_requested to unblock pipeline
        db.prepare(
          `UPDATE leads SET status = 'connection_requested',
          connection_requested_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE id = ?`
        ).run(leadId);
        
        return; // Gracefully complete the job
      }

      throw new Error(result.error || "Connection request failed");

    } else if (result.error === "LINKEDIN_LIMIT_REACHED") {
      // ── LinkedIn monthly invitation limit hit ────────────────────────────
      // The "Add a note" button opened a warning popup instead of a textarea.
      // We have dismissed the popup. Now pivot to email outreach for this lead.
      console.log(`[Worker] LinkedIn monthly invitation limit reached. Pivoting to email for lead ${leadId}.`);
      logActivity("linkedin_invite_limit_reached_worker", "queue", { leadId, linkedinUrl });

      // Attempt to resolve recipient email
      let recipientEmail: string = lead.email || "";

      if (recipientEmail) {
        jobQueue.enqueue<SendIntroEmailPayload>(
          JOB_TYPES.SEND_INTRO_EMAIL,
          { leadId, campaignId, recipientEmail },
          { delayMs: 0, priority: 100 },
        );
        console.log(`[Worker] SEND_INTRO_EMAIL enqueued for ${profile.firstName} ${profile.lastName} → ${recipientEmail}`);
      } else {
        console.log(`[Worker] No email found for lead ${leadId} in database. Cannot send email fallback.`);
      }

      // Advance lead status so the pipeline doesn't re-attempt the connection
      db.prepare(
        `UPDATE leads SET status = 'connection_requested',
        connection_requested_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?`
      ).run(leadId);
      return; // Complete gracefully
    }

    // Note: limitManager.record("connectionRequests") is now called inside
    // sendConnectionRequest() after post-send verification — no duplicate here.

    db.prepare(
      `
    UPDATE leads SET status = 'connection_requested',
    connection_requested_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = ?
  `,
    ).run(leadId);

    // Trigger connection email immediately if email is available
    const recipientEmail = lead.email;
    if (recipientEmail) {
      console.log(`[Worker] Email found (${recipientEmail}), enqueuing connection email immediately.`);
      jobQueue.enqueue<SendIntroEmailPayload>(
        JOB_TYPES.SEND_INTRO_EMAIL,
        { leadId, campaignId, recipientEmail },
        {
          delayMs: 0, // Delay handled inside the job to preserve sequence lock
          priority: 100,
        },
      );
    }

    logActivity("connection_sent_via_queue", "queue", {
      leadId,
      linkedinUrl,
      campaignId,
    });
  },
);

// ============================================================
// Handler: Check Acceptance Status
// ============================================================

jobQueue.process<CheckAcceptancePayload>(
  JOB_TYPES.CHECK_ACCEPTANCE,
  async (job: Job<CheckAcceptancePayload>) => {
    if (!_settings) return;
    enforceAnyActiveCampaign(); // skip all LinkedIn work if no campaign is active
    await ensureBrowserRunning();

    const db = getDatabase();

    // Skip if no pending leads remain (avoids pointless browser navigation)
    const pendingCount = (db.prepare(
      `SELECT COUNT(*) AS cnt FROM leads WHERE status IN ('connection_requested', 'waiting_acceptance', 'connection_sent')`
    ).get() as any)?.cnt ?? 0;

    if (pendingCount === 0) {
      console.log("[Worker] CHECK_ACCEPTANCE — no pending leads, checking for recently connected leads needed Welcome DMs...");
      logActivity("acceptance_check_skipped_no_pending", "queue", { pendingCount });
      
      const { checkRecentConnectionsList } = await import("../linkedin/connectionChecker");
      let cid = job.payload.campaignId;
      if (!cid) {
        const activeCampaign = db.prepare("SELECT id FROM campaigns WHERE status = 'active' LIMIT 1").get() as any;
        cid = activeCampaign?.id;
      }
      if (cid) {
         await checkRecentConnectionsList(cid, _settings);
      } else {
         console.log("[Worker] No active campaign found to assign stray leads to.");
      }
    } else {
      const result = await checkAllPendingConnections(_settings);
      logActivity("acceptance_check_via_queue", "queue", result);
    }

  },
);

// ============================================================
// Handler: Send Welcome DM
// ============================================================

jobQueue.process<SendWelcomeDmPayload>(
  JOB_TYPES.SEND_WELCOME_DM,
  async (job: Job<SendWelcomeDmPayload>) => {
    enforceWorkingHours();
    await ensureBrowserRunning();

    const { leadId, linkedinUrl, campaignId } = job.payload;
    enforceCampaignActive(campaignId);

    if (!_limitManager?.canPerform("messages"))
      throw new Error("Daily message limit reached");
    const db = getDatabase();
    const lead = db
      .prepare("SELECT * FROM leads WHERE id = ?")
      .get(leadId) as any;
    if (!lead) {
      console.log(`[Worker] Skipping SEND_WELCOME_DM — lead ${leadId} was deleted.`);
      return;
    }

    const profile = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : { 
      id: leadId, 
      linkedinUrl,
      firstName: lead.first_name || "",
      lastName: lead.last_name || "",
      headline: lead.headline || "",
      company: lead.company || ""
    };
    
    // Ensure firstName is available for search
    if (!profile.firstName && lead.first_name) profile.firstName = lead.first_name;
    if (!profile.lastName && lead.last_name) profile.lastName = lead.last_name;

    const context = {
      yourName: _settings?.personalization?.yourName || "User",
      yourCompany: _settings?.personalization?.yourCompany || "",
      yourServices: _settings?.personalization?.yourServices || "",
    };

    const result = await sendWelcomeDM(profile, context, _settings);
    if (!result.success) throw new Error(result.message || "Failed to send welcome DM");
    
    _limitManager.record("messages");

    db.prepare(
      `UPDATE leads SET status = 'welcome_sent', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
    ).run(leadId);
    logActivity("welcome_dm_sent_via_queue", "queue", { leadId, campaignId });
  },
);

// ============================================================
// Handler: Send Intro Email
// ============================================================

jobQueue.process<SendIntroEmailPayload>(
  JOB_TYPES.SEND_INTRO_EMAIL,
  async (job: Job<SendIntroEmailPayload>) => {
    const { leadId, campaignId, recipientEmail } = job.payload;
    enforceCampaignActive(campaignId);

    // Add a slight delay to ensure the queue remains locked and simulates natural flow
    await new Promise((r) => setTimeout(r, 1000));

    const db = getDatabase();
    const lead = db
      .prepare("SELECT * FROM leads WHERE id = ?")
      .get(leadId) as any;
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    const profile = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : {};
    const context = {
      yourName: _settings?.profile?.name || "User",
      yourCompany: _settings?.profile?.company || "",
      yourServices: _settings?.profile?.services || "",
      emailType: "intro" as const,
    };

    const emailContent = await generatePersonalizedEmail(
      profile,
      context,
      _settings?.ai,
    );
    await sendPersonalizedLeadEmail(
      profile,
      emailContent,
      recipientEmail,
      "intro",
      _settings,
    );

    db.prepare(
      `UPDATE leads SET status = 'email_sent', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
    ).run(leadId);
    logActivity("intro_email_sent_via_queue", "queue", {
      leadId,
      campaignId,
      recipientEmail,
    });
  },
);

// ============================================================
// Handler: Send Follow-up Email (3-Day Nudge)
// ============================================================

jobQueue.process<SendFollowupEmailPayload>(
  JOB_TYPES.SEND_FOLLOWUP_EMAIL,
  async (job: Job<SendFollowupEmailPayload>) => {
    const { leadId, campaignId, recipientEmail } = job.payload;
    enforceCampaignActive(campaignId);

    // Add a slight delay to ensure the queue remains locked and simulates natural flow
    await new Promise((r) => setTimeout(r, 1000));

    const db = getDatabase();
    const lead = db
      .prepare("SELECT * FROM leads WHERE id = ?")
      .get(leadId) as any;
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    // Only send if they haven't accepted the connection yet
    if (
      [
        "connection_accepted",
        "welcome_sent",
        "in_conversation",
        "meeting_booked",
      ].includes(lead.status)
    ) {
      logActivity("followup_skipped_already_progressed", "queue", {
        leadId,
        currentStatus: lead.status,
      });
      return;
    }

    const profile = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : {};
    const context = {
      yourName: _settings?.profile?.name || "User",
      yourCompany: _settings?.profile?.company || "",
      yourServices: _settings?.profile?.services || "",
      emailType: "follow_up" as const,
    };

    const emailContent = await generatePersonalizedEmail(
      profile,
      context,
      _settings?.ai,
    );
    await sendPersonalizedLeadEmail(
      profile,
      emailContent,
      recipientEmail,
      "follow_up",
      _settings,
    );

    db.prepare(
      `UPDATE leads SET status = 'follow_up_sent', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
    ).run(leadId);
    logActivity("followup_email_sent_via_queue", "queue", {
      leadId,
      campaignId,
      recipientEmail,
    });
  },
);

// ============================================================
// Handler: Send Welcome Email (after connection accepted)
// ============================================================

jobQueue.process<SendWelcomeEmailPayload>(
  JOB_TYPES.SEND_WELCOME_EMAIL,
  async (job: Job<SendWelcomeEmailPayload>) => {
    const { leadId, campaignId, recipientEmail } = job.payload;
    enforceCampaignActive(campaignId);

    const db = getDatabase();
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as any;
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    // Skip if already sent or lead has progressed past this
    const alreadySent = db.prepare(
      `SELECT id FROM emails WHERE lead_id = ? AND type = 'welcome'`
    ).get(leadId);
    if (alreadySent) {
      console.log(`[Worker] SEND_WELCOME_EMAIL skipped — already sent for lead ${leadId}`);
      return;
    }

    const profile = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : {};
    const context = {
      yourName: _settings?.personalization?.yourName || "User",
      yourCompany: _settings?.personalization?.yourCompany || "",
      yourServices: _settings?.personalization?.yourServices || "",
      emailType: "welcome" as const,
    };

    const emailContent = await generatePersonalizedEmail(profile, context, _settings?.ai);
    await sendPersonalizedLeadEmail(profile, emailContent, recipientEmail, "welcome", _settings);

    logActivity("welcome_email_sent_via_queue", "queue", { leadId, campaignId, recipientEmail });
  },
);

// ============================================================
// Handler: Send Meeting Confirmation Email
// ============================================================

jobQueue.process<SendMeetingConfirmationPayload>(
  JOB_TYPES.SEND_MEETING_CONFIRMATION,
  async (job: Job<SendMeetingConfirmationPayload>) => {
    const { leadId, campaignId, recipientEmail, meetingUrl, startTime } = job.payload;
    enforceCampaignActive(campaignId);

    const db = getDatabase();
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as any;
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    // Skip if already sent
    const alreadySent = db.prepare(
      `SELECT id FROM emails WHERE lead_id = ? AND type = 'meeting_confirm'`
    ).get(leadId);
    if (alreadySent) {
      console.log(`[Worker] SEND_MEETING_CONFIRMATION skipped — already sent for lead ${leadId}`);
      return;
    }

    const profile = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : {};
    // Inject meeting details into profile so AI can reference them
    if (meetingUrl) profile.meetingUrl = meetingUrl;
    if (startTime) profile.meetingTime = new Date(startTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const context = {
      yourName: _settings?.personalization?.yourName || "User",
      yourCompany: _settings?.personalization?.yourCompany || "",
      yourServices: _settings?.personalization?.yourServices || "",
      emailType: "meeting_confirm" as const,
    };

    const emailContent = await generatePersonalizedEmail(profile, context, _settings?.ai);
    await sendPersonalizedLeadEmail(profile, emailContent, recipientEmail, "meeting_confirm", _settings);

    db.prepare(
      `UPDATE leads SET status = 'meeting_booked', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    ).run(leadId);

    logActivity("meeting_confirmation_email_sent", "queue", { leadId, campaignId, recipientEmail, meetingUrl });
  },
);

// ============================================================
// Handler: Check DM Follow-ups
// ============================================================

jobQueue.process<CheckDmFollowupsPayload>(
  JOB_TYPES.CHECK_DM_FOLLOWUPS,
  async (job: Job<CheckDmFollowupsPayload>) => {
    enforceWorkingHours();
    await ensureBrowserRunning();

    const db = getDatabase();
    
    // Find leads waiting for reply who haven't progressed
    const leads = db.prepare(`
      SELECT l.id, l.campaign_id, l.first_name, l.last_name, l.headline, l.company, l.linkedin_url, l.raw_data_json, l.chatbot_state 
      FROM leads l
      INNER JOIN campaigns c ON l.campaign_id = c.id
      WHERE l.chatbot_state IN ('waiting_reply', 'waiting_reply_1', 'waiting_reply_2')
      AND l.status NOT IN ('handed_off', 'meeting_booked')
      AND c.status = 'active'
    `).all() as any[];

    for (const lead of leads) {
      // Get the last message in this lead's thread
      const lastMsg = db.prepare(`
        SELECT direction, sent_at FROM conversations 
        WHERE lead_id = ? ORDER BY sent_at DESC LIMIT 1
      `).get(lead.id) as any;

      if (!lastMsg || lastMsg.direction !== 'outbound') continue;

      const sentTime = new Date(lastMsg.sent_at).getTime();
      const now = Date.now();
      const daysSince = (now - sentTime) / (1000 * 60 * 60 * 24);

      if (daysSince >= 3) {
        let objective: "follow_up_1" | "follow_up_2" | "follow_up_3" = "follow_up_1";
        let newState = "waiting_reply_1";

        if (lead.chatbot_state === 'waiting_reply_2') {
          objective = "follow_up_3";
          newState = "waiting_reply_3";
        } else if (lead.chatbot_state === 'waiting_reply_1') {
          objective = "follow_up_2";
          newState = "waiting_reply_2";
        }

        console.log(`[Worker] Triggering ${objective} for ${lead.first_name} ${lead.last_name}`);

        const parsedData = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : {};
        const profile = {
          ...parsedData,
          id: lead.id, 
          linkedinUrl: lead.linkedin_url,
          firstName: parsedData.firstName || lead.first_name || "Unknown",
          lastName: parsedData.lastName || lead.last_name || "",
          headline: parsedData.headline || lead.headline || "",
          company: parsedData.company || lead.company || ""
        };

        const context = {
          yourName: _settings?.personalization?.yourName || "User",
          yourCompany: _settings?.personalization?.yourCompany || "",
          yourServices: _settings?.personalization?.yourServices || "",
          objectiveOverride: objective
        };

        try {
          const result = await sendWelcomeDM(profile, context, _settings);
          if (result.success) {
            db.prepare(`UPDATE leads SET chatbot_state = ? WHERE id = ?`).run(newState, lead.id);
            logActivity("dm_followup_sent", "queue", { leadId: lead.id, objective });
          }
        } catch (e) {
          console.error(`[Worker] Failed to send ${objective} for ${lead.id}`, e);
        }
      }
    }
  }
);

// ============================================================
// Handler: Publish Scheduled Post
// ============================================================

jobQueue.process<PublishScheduledPostPayload>(
  JOB_TYPES.PUBLISH_SCHEDULED_POST,
  async (job: Job<PublishScheduledPostPayload>) => {
    enforceWorkingHours();
    await ensureBrowserRunning();
    if (!_limitManager) throw new Error("Limit manager not initialized");

    const { postId, content } = job.payload;

    const result = await createTextPost(content, _limitManager);

    const db = getDatabase();
    db.prepare(
      `
    UPDATE scheduled_posts SET status = ?, published_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = ?
  `,
    ).run(result.success ? "published" : "failed", postId);

    if (!result.success) throw new Error(result.error || "Post failed");
    logActivity("scheduled_post_published_via_queue", "queue", { postId });
  },
);

// ============================================================
// Handler: Run Engagement Session
// ============================================================

jobQueue.process<RunEngagementSessionPayload>(
  JOB_TYPES.RUN_ENGAGEMENT_SESSION,
  async (job: Job<RunEngagementSessionPayload>) => {
    enforceWorkingHours();
    await ensureBrowserRunning();
    if (!_settings || !_limitManager) throw new Error("Worker not initialized");

    const result = await runEngagementSession(
      _settings,
      _limitManager,
      job.payload,
    );
    logActivity("engagement_session_via_queue", "queue", result);
  },
);

// ============================================================
// Handler: Check DM Messages (Chatbot)
// ============================================================

jobQueue.process<CheckMessagesPayload>(
  JOB_TYPES.CHECK_MESSAGES,
  async (job: Job<CheckMessagesPayload>) => {
    if (!_settings) return;
    enforceAnyActiveCampaign(); // skip inbox scanning if no campaign is active
    await ensureBrowserRunning();

    const messages = await readUnreadMessages();
    const db = getDatabase();

    for (const msg of messages) {
      // Find lead by linkedinUrl
      const baseUrl = msg.senderUrl.split('?')[0].replace(/\/$/, '');
      const lead = db.prepare("SELECT * FROM leads WHERE linkedin_url LIKE ?").get(`%${baseUrl}%`) as any;

      if (!lead) {
        logActivity("message_ignored_not_lead", "linkedin", { sender: msg.senderName, url: msg.senderUrl });
        continue;
      }

      if (!lead.campaign_id) {
        logActivity("message_ignored_no_campaign", "linkedin", { sender: msg.senderName, url: msg.senderUrl });
        continue;
      }

      const campaign = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(lead.campaign_id) as any;
      if (!campaign || campaign.status !== 'active') {
        logActivity("message_ignored_campaign_paused", "linkedin", { sender: msg.senderName, url: msg.senderUrl });
        continue;
      }

      const profile = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : { firstName: msg.senderName, linkedinUrl: msg.senderUrl };
      const context = {
        yourName: _settings?.personalization?.yourName || "User",
        yourCompany: _settings?.personalization?.yourCompany || "",
        yourServices: _settings?.personalization?.yourServices || "",
      };

      const result = await processChatbotMessage(
        lead.id,
        profile,
        msg.lastMessage,
        context,
        _settings,
      );

      if (result.action === 'reply' && result.reply) {
         // Random delay between 2 and 15 minutes
         const delayMins = 2 + Math.random() * 13;
         jobQueue.enqueue<SendReplyDmPayload>(
            JOB_TYPES.SEND_REPLY_DM,
            {
              leadId: lead.id,
              linkedinUrl: lead.linkedin_url,
              replyContent: result.reply,
              threadId: msg.threadId
            },
            {
               delayMs: delayMins * 60 * 1000,
            }
         );
      }
    }

    logActivity("messages_checked_via_queue", "queue", {
      messagesChecked: messages.length,
    });

  },
);

// ============================================================
// Handler: Send Reply DM (Chatbot Delay)
// ============================================================

jobQueue.process<SendReplyDmPayload>(
  JOB_TYPES.SEND_REPLY_DM,
  async (job: Job<SendReplyDmPayload>) => {
    enforceWorkingHours();
    await ensureBrowserRunning();

    const { leadId, linkedinUrl, replyContent, threadId } = job.payload;
    const db = getDatabase();
    const lead = db.prepare("SELECT campaign_id FROM leads WHERE id = ?").get(leadId) as any;
    if (!lead?.campaign_id) {
      throw new Error("Job paused: Campaign is paused — lead has no associated campaign.");
    }
    enforceCampaignActive(lead.campaign_id);

    if (!_limitManager?.canPerform("messages"))
      throw new Error("Daily message limit reached");

    let result: { success: boolean; error?: string; handedOff?: boolean };

    // Prefer thread-based sending (direct URL) — avoids profile nav issues
    if (threadId) {
      console.log(`[Worker] SEND_REPLY_DM — using thread-based send for thread: ${threadId}`);
      result = await sendReplyInThread(threadId, replyContent, {
        isAutomated: true,
        leadId,
      });
    } else {
      console.log(`[Worker] SEND_REPLY_DM — falling back to profile-based send for: ${linkedinUrl}`);
      result = await sendMessage(linkedinUrl, replyContent, {
        isAutomated: true,
        checkHandoff: true,
        leadId,
      });
    }

    if (result.success) {
      _limitManager.record("messages");
      db.prepare(
        `UPDATE leads SET status = 'in_conversation', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
      ).run(leadId);
      logActivity("bot_reply_sent_via_queue", "queue", { leadId, viaThead: !!threadId });
    } else if ((result as any).handedOff) {
      logActivity("bot_reply_cancelled_handoff", "queue", { leadId });
      db.prepare(
        `UPDATE leads SET status = 'handed_off', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
      ).run(leadId);
    } else {
      throw new Error(result.error || "Message send failed");
    }
  },
);

// ============================================================
// Handler: Check Engaged Replies (Proactive Thread Polling)
// ============================================================

jobQueue.process<CheckEngagedRepliesPayload>(
  JOB_TYPES.CHECK_ENGAGED_REPLIES,
  async (job: Job<CheckEngagedRepliesPayload>) => {
    if (!_settings) return;
    enforceAnyActiveCampaign(); // skip thread polling if no campaign is active
    await ensureBrowserRunning();

    // The function below queries "engaged" leads and delegates `CHECK_LEAD_THREAD` jobs
    await checkAllEngagedLeads(_settings);

    // Re-enqueue if it's recurring
    const intervalMinutes = job.payload.recurringIntervalMinutes;
    if (intervalMinutes) {
      jobQueue.enqueue<CheckEngagedRepliesPayload>(
        JOB_TYPES.CHECK_ENGAGED_REPLIES,
        { recurringIntervalMinutes: intervalMinutes },
        {
          delayMs: intervalMinutes * 60 * 1000,
          maxAttempts: 2,
          dedupeKey: "periodic_engaged_replies_check",
        },
      );
    }
  },
);

// ============================================================
// Handler: Check Individual Lead Thread
// ============================================================

jobQueue.process<CheckLeadThreadPayload>(
  JOB_TYPES.CHECK_LEAD_THREAD,
  async (job: Job<CheckLeadThreadPayload>) => {
    enforceWorkingHours();
    await ensureBrowserRunning();

    const { leadId, linkedinUrl, campaignId } = job.payload;

    // Strict campaign check: if the campaign is missing or paused, cancel this job immediately.
    // We do NOT use enforceCampaignActive() here because that silently passes null (for system jobs).
    // CHECK_LEAD_THREAD is always a lead-level job — it must have a valid, active campaign.
    if (!campaignId) {
      throw new Error("Job paused: Campaign is paused — lead has no associated campaign.");
    }
    enforceCampaignActive(campaignId);

    const db = getDatabase();
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as any;
    if (!lead) return;

    const parsedData = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : {};
    const profile = {
      ...parsedData,
      firstName: parsedData.firstName || lead.first_name || "Unknown",
      lastName: parsedData.lastName || lead.last_name || "",
      linkedinUrl
    };

    const context = {
      yourName: _settings?.personalization?.yourName || "User",
      yourCompany: _settings?.personalization?.yourCompany || "",
      yourServices: _settings?.personalization?.yourServices || "",
    };

    const result = await checkLeadThreadForReply(leadId, profile, context, _settings);

    if (result.error) {
       throw new Error(result.error);
    }
  },
);

// ============================================================
// Handler: Prune Old Jobs
// ============================================================

jobQueue.process<PruneJobQueuePayload>(
  JOB_TYPES.PRUNE_JOB_QUEUE,
  async (job: Job<PruneJobQueuePayload>) => {
    const pruned = jobQueue.pruneOldJobs(job.payload.olderThanDays || 7);
    logActivity("job_queue_pruned", "queue", { prunedCount: pruned });

    // ── Warmup Auto-Increment ─────────────────────────────────────────────
    // Each day the prune job fires, advance warmup.currentDay by 1 if the
    // account is still in the warmup period. This means limits ramp up
    // automatically without any manual intervention.
    if (_settings?.warmup?.enabled) {
      const w = _settings.warmup;
      const currentDay = w.currentDay || 0;
      const rampUpDays = w.rampUpDays || 14;

      if (currentDay < rampUpDays) {
        const nextDay = currentDay + 1;
        _settings = { ..._settings, warmup: { ...w, currentDay: nextDay } };

        // Persist the updated day back to electron-store (lazy import to avoid circular deps)
        try {
          const { default: ElectronStore } = await import("electron-store") as any;
          const store = new ElectronStore({ defaults: { settings: {} } });
          const saved = store.get("settings") as any;
          if (saved) {
            store.set("settings", {
              ...saved,
              warmup: { ...saved.warmup, currentDay: nextDay },
            });
          }
          console.log(`[Worker] Warmup advanced: day ${currentDay} → ${nextDay}/${rampUpDays}`);
          logActivity("warmup_day_advanced", "queue", { from: currentDay, to: nextDay, rampUpDays });

          // Re-apply limits with new warmup day
          updateWorkerSettings(_settings);
        } catch (e) {
          console.warn("[Worker] Could not persist warmup.currentDay:", e);
        }
      } else {
        console.log("[Worker] Warmup complete — running at full daily limits.");
      }
    }

    // Re-schedule daily pruning
    jobQueue.enqueue<PruneJobQueuePayload>(
      JOB_TYPES.PRUNE_JOB_QUEUE,
      { olderThanDays: 7 },
      {
        delayMs: 24 * 60 * 60 * 1000, // 24 hours
        maxAttempts: 1,
        dedupeKey: "daily_prune",
      },
    );
  },
);

// ============================================================
// Start the Worker
// ============================================================

/**
 * Start the queue worker. Call this once from main/index.ts after app is ready.
 */
export function startQueueWorker(settings: any): void {
  initWorker(settings);
  jobQueue.start();

  const db = getDatabase();

  // ── Startup: Cancel all pending jobs for non-active campaigns ──────────────
  // This is the definitive safety net. Any job that survived a crash or restart
  // and belongs to a paused/draft campaign will be cancelled immediately.
  // We do two passes:
  //  1. Jobs with campaignId directly in payload
  //  2. Jobs with leadId in payload — we look up the lead's campaign
  try {
    const pendingJobs = db.prepare(
      `SELECT id, type, payload FROM job_queue WHERE status IN ('pending', 'running')`
    ).all() as any[];

    let startupCancelled = 0;
    for (const row of pendingJobs) {
      let campaignId: string | null = null;
      try {
        const payload = JSON.parse(row.payload || "{}");
        if (payload.campaignId) {
          campaignId = payload.campaignId;
        } else if (payload.leadId) {
          const lead = db.prepare("SELECT campaign_id FROM leads WHERE id = ?").get(payload.leadId) as any;
          if (lead) campaignId = lead.campaign_id;
        }
      } catch { /* skip unparseable */ }

      if (campaignId) {
        const campaign = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(campaignId) as any;
        if (campaign && campaign.status !== "active") {
          db.prepare(
            `UPDATE job_queue SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
          ).run(row.id);
          startupCancelled++;
        }
      }
    }

    if (startupCancelled > 0) {
      console.log(`[Worker] Startup sweep: cancelled ${startupCancelled} job(s) from non-active campaigns.`);
      logActivity("startup_job_sweep", "queue", { cancelledCount: startupCancelled });
    }
  } catch (err) {
    console.warn("[Worker] Startup job sweep failed (non-critical):", err);
  }

  // Cancel any stale CHECK_ACCEPTANCE jobs that may have been scheduled
  // with old long delays. Re-enqueue fresh ones with a short initial delay.
  db.prepare(
    `UPDATE job_queue
     SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE type = ? AND status = 'pending'`
  ).run(JOB_TYPES.CHECK_ACCEPTANCE);

  // Fresh acceptance check: first run in 2 minutes, then every 2 hours
  jobQueue.enqueue<CheckAcceptancePayload>(
    JOB_TYPES.CHECK_ACCEPTANCE,
    {
      recurringIntervalMinutes: 120,
    },
    {
      delayMs: 2 * 60 * 1000, // First check after 2 minutes
      maxAttempts: 2,
      dedupeKey: "periodic_acceptance_check",
    },
  );

  // Cancel stale message checks too and re-enqueue
  db.prepare(
    `UPDATE job_queue
     SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE type = ? AND status = 'pending'`
  ).run(JOB_TYPES.CHECK_MESSAGES);

  jobQueue.enqueue<CheckMessagesPayload>(
    JOB_TYPES.CHECK_MESSAGES,
    {
      recurringIntervalMinutes: 30,
    },
    {
      delayMs: 5 * 60 * 1000, // First check after 5 minutes
      maxAttempts: 2,
      dedupeKey: "periodic_message_check",
    },
  );


  jobQueue.enqueue<PruneJobQueuePayload>(
    JOB_TYPES.PRUNE_JOB_QUEUE,
    { olderThanDays: 7 },
    {
      delayMs: 60 * 60 * 1000, // First prune after 1 hour
      maxAttempts: 1,
      dedupeKey: "daily_prune",
    },
  );

  // STARTUP CHECK: Active Engaged leads
  jobQueue.enqueue<CheckEngagedRepliesPayload>(
    JOB_TYPES.CHECK_ENGAGED_REPLIES,
    {
      recurringIntervalMinutes: 120, // Run every 2 hours
    },
    {
      delayMs: 30 * 60 * 1000, // First run 30 min after startup
      maxAttempts: 2,
      dedupeKey: "periodic_engaged_replies_check",
    },
  );

  console.log("[Worker] Queue worker started with recurring jobs scheduled.");
}

/**
 * Stop the queue worker gracefully.
 */
export function stopQueueWorker(): void {
  jobQueue.stop();
}
