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
  PublishScheduledPostPayload,
  RunEngagementSessionPayload,
  CheckMessagesPayload,
  PruneJobQueuePayload,
  SendReplyDmPayload,
} from "./jobs";
import type { Job } from "./jobQueue";
import { getDatabase, logActivity } from "../storage/database";
import { isWithinWorkingHours, DailyLimitManager } from "../browser/humanizer";
import { scrapeProfile } from "../linkedin/scraper";
import { sendConnectionRequest } from "../linkedin/connector";
import { sendMessage, sendWelcomeDM } from "../linkedin/messenger";
import { generatePersonalizedEmail } from "../ai/personalizer";
import { sendPersonalizedLeadEmail } from "../microsoft/email";
import { createTextPost } from "../content/scheduler";
import { runEngagementSession } from "../engagement/feed";
import { checkAllPendingConnections } from "../linkedin/connectionChecker";
import {
  readUnreadMessages,
  processChatbotMessage,
} from "../linkedin/messenger";
import { launchBrowser, getBrowserStatus, getPage } from "../browser/engine";
import { isAutoPilotRunning } from "../linkedin/autopilot";

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

  // console.log(`[Worker] Warmup day ${day}/${rampDays}: limits at ${Math.round(pct)}% (×${multiplier.toFixed(2)})`);
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
  if (status.status !== "running" || !getPage()) {
    // console.log("[Worker] Browser not running — attempting auto-launch...");
    const result = await launchBrowser();
    if (!result.success) {
      throw new Error(`Browser auto-launch failed: ${result.error || "Unknown error"}. Please launch the browser manually from the Dashboard.`);
    }
    // Wait a moment for the browser to stabilize
    await new Promise((r) => setTimeout(r, 2000));
    // console.log("[Worker] Browser auto-launched successfully.");
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
    if (!_limitManager?.canPerform("profileViews"))
      throw new Error("Daily profile view limit reached");

    const { leadId, linkedinUrl, campaignId } = job.payload;
    
    // Guard: skip if lead was deleted while job was queued/running
    const db = getDatabase();
    const leadExists = db.prepare("SELECT id FROM leads WHERE id = ?").get(leadId);
    if (!leadExists) {
      // console.log(`[Worker] Skipping SCRAPE_PROFILE — lead ${leadId} was deleted.`);
      return; // Clean exit, job will be marked as done
    }
    
    const profile = await scrapeProfile(linkedinUrl, { readNaturally: true }, _settings?.ai);

    if (!profile) throw new Error(`Failed to scrape profile: ${linkedinUrl}`);

    _limitManager.record("profileViews");

    // Persist to DB
    db.prepare(
      `
    UPDATE leads SET
      first_name = ?, last_name = ?, headline = ?, company = ?, role = ?,
      location = ?, about = ?, skills_json = ?, experience_json = ?,
      recent_posts_json = ?, profile_image_url = ?, scraped_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      status = 'profile_scraped', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), raw_data_json = ?
    WHERE id = ?
  `,
    ).run(
      profile.firstName,
      profile.lastName,
      profile.headline,
      profile.company,
      profile.headline,
      profile.location,
      profile.about,
      JSON.stringify(profile.skills),
      JSON.stringify(profile.experience),
      JSON.stringify(profile.recentPosts || []),
      profile.profileImageUrl,
      JSON.stringify(profile),
      leadId,
    );

    logActivity("profile_scraped_via_queue", "queue", {
      leadId,
      linkedinUrl,
      campaignId,
    });

    // Enqueue the next step — send connection request (with 5-15s human delay)
    jobQueue.enqueue<SendConnectionPayload>(
      JOB_TYPES.SEND_CONNECTION,
      { leadId, linkedinUrl, campaignId },
      {
        delayMs: 5000 + Math.random() * 10000,
        priority: 5,
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
    if (!_limitManager?.canPerform("connectionRequests"))
      throw new Error("Daily connection request limit reached");

    const { leadId, linkedinUrl, campaignId } = job.payload;
    const db = getDatabase();
    const lead = db
      .prepare("SELECT * FROM leads WHERE id = ?")
      .get(leadId) as any;
    if (!lead) {
      // console.log(`[Worker] Skipping SEND_CONNECTION — lead ${leadId} was deleted.`);
      return; // Clean exit
    }

    const profile = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : null;
    if (!profile) throw new Error("Profile data not available");

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
      if (result.error === "COMPLETED_SKIPPED") {
        // console.log(`[Worker] Job ${job.id} marked as COMPLETED_SKIPPED based on relationship state.`);
        // Returning successfully allows JobQueue to mark it 'completed' natively without throwing.
        // If we strictly want 'COMPLETED_SKIPPED' in DB, we can manually update it here:
        db.prepare(`UPDATE job_queue SET status = 'COMPLETED_SKIPPED' WHERE id = ?`).run(job.id);
        return;
      }
      
      if (result.error === "EMAIL_NEEDED") {
        // console.log(`[Worker] Connect unavailable, but Message available. Triggering Module C Email via MS Graph API.`);
        // Placeholder for MS Graph integration
        if (lead.email) {
          jobQueue.enqueue<SendIntroEmailPayload>(
            JOB_TYPES.SEND_INTRO_EMAIL,
            { leadId, campaignId, recipientEmail: lead.email },
            { delayMs: 1000, priority: 5 }
          );
        }
        return; // Gracefully complete the job
      }

      throw new Error(result.error || "Connection request failed");
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

    // Trigger intro email if email is available
    const recipientEmail = lead.email;
    if (recipientEmail) {
      jobQueue.enqueue<SendIntroEmailPayload>(
        JOB_TYPES.SEND_INTRO_EMAIL,
        { leadId, campaignId, recipientEmail },
        {
          delayMs: 60000, // 1 minute after connection
          priority: 4,
        },
      );
    }

    // Schedule follow-up check after 3 days
    jobQueue.enqueue<CheckAcceptancePayload>(
      JOB_TYPES.CHECK_ACCEPTANCE,
      { campaignId },
      {
        delayMs: 3 * 24 * 60 * 60 * 1000, // 3 days
        maxAttempts: 1,
      },
    );

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
    await ensureBrowserRunning();

    const result = await checkAllPendingConnections(_settings);
    logActivity("acceptance_check_via_queue", "queue", result);

    // Re-enqueue as a recurring job if requested
    const { recurringIntervalMinutes } = job.payload;
    if (recurringIntervalMinutes) {
      jobQueue.enqueue<CheckAcceptancePayload>(
        JOB_TYPES.CHECK_ACCEPTANCE,
        {
          recurringIntervalMinutes,
        },
        {
          delayMs: recurringIntervalMinutes * 60 * 1000,
          maxAttempts: 1,
          dedupeKey: "periodic_acceptance_check",
        },
      );
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
    if (!_limitManager?.canPerform("messages"))
      throw new Error("Daily message limit reached");

    const { leadId, linkedinUrl, campaignId } = job.payload;
    const db = getDatabase();
    const lead = db
      .prepare("SELECT * FROM leads WHERE id = ?")
      .get(leadId) as any;
    if (!lead) {
      // console.log(`[Worker] Skipping SEND_WELCOME_DM — lead ${leadId} was deleted.`);
      return;
    }

    const profile = lead.raw_data_json ? JSON.parse(lead.raw_data_json) : { id: leadId, linkedinUrl };
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

    // Re-enqueue if recurring
    const { recurringIntervalMinutes } = job.payload;
    if (recurringIntervalMinutes) {
      jobQueue.enqueue<CheckMessagesPayload>(
        JOB_TYPES.CHECK_MESSAGES,
        {
          recurringIntervalMinutes,
        },
        {
          delayMs: recurringIntervalMinutes * 60 * 1000,
          maxAttempts: 2,
          dedupeKey: "periodic_message_check",
        },
      );
    }
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
    if (!_limitManager?.canPerform("messages"))
      throw new Error("Daily message limit reached");

    const { leadId, linkedinUrl, replyContent, threadId } = job.payload;
    const db = getDatabase();

    const result = await sendMessage(linkedinUrl, replyContent, {
      isAutomated: true,
      checkHandoff: true,
      leadId: leadId
    });

    if (result.success) {
      _limitManager.record("messages");
      db.prepare(
        `UPDATE leads SET status = 'in_conversation', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
      ).run(leadId);
      logActivity("bot_reply_sent_via_queue", "queue", { leadId });
    } else if (result.handedOff) {
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
          // console.log(`[Worker] Warmup advanced: day ${currentDay} → ${nextDay}/${rampUpDays}`);
          logActivity("warmup_day_advanced", "queue", { from: currentDay, to: nextDay, rampUpDays });

          // Re-apply limits with new warmup day
          updateWorkerSettings(_settings);
        } catch (e) {
          // console.warn("[Worker] Could not persist warmup.currentDay:", e);
        }
      } else {
        // console.log("[Worker] Warmup complete — running at full daily limits.");
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

  // Schedule recurring maintenance jobs
  jobQueue.enqueue<CheckAcceptancePayload>(
    JOB_TYPES.CHECK_ACCEPTANCE,
    {
      recurringIntervalMinutes: 60,
    },
    {
      delayMs: 5 * 60 * 1000, // Start first check after 5 min
      maxAttempts: 1,
      dedupeKey: "periodic_acceptance_check",
    },
  );

  jobQueue.enqueue<CheckMessagesPayload>(
    JOB_TYPES.CHECK_MESSAGES,
    {
      recurringIntervalMinutes: 30,
    },
    {
      delayMs: 10 * 60 * 1000, // First check after 10 min
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

  // console.log("[Worker] Queue worker started with recurring jobs scheduled.");
}

/**
 * Stop the queue worker gracefully.
 */
export function stopQueueWorker(): void {
  jobQueue.stop();
}
