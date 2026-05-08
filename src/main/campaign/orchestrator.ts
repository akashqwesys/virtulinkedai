/**
 * Campaign Orchestration Engine — State Machine
 *
 * Manages campaigns and delegates execution to the JobQueue.
 */

import type { Campaign, AppSettings } from "../../shared/types";
import { getDatabase, logActivity } from "../storage/database";
import { v4 as uuid } from "uuid";
import { jobQueue } from "../queue/jobQueue";
import { JOB_TYPES } from "../queue/jobs";
import type { ScrapeProfilePayload } from "../queue/jobs";
import { abortCampaignImport } from "../linkedin/scraper";

// ============================================================
// Bimodal Stagger — human browsing gaps
// ============================================================

/**
 * Returns a human-realistic inter-action delay in ms.
 *
 * Human LinkedIn browsing is NOT uniform:
 *  - 80% of gaps: 60–120 seconds (focused browsing)
 *  - 20% of gaps: 5–12 minutes  (distraction, reading, context switch)
 *
 * A statistically uniform 1-3 min gap is a fingerprint.
 */
function humanStaggerMs(): number {
  if (Math.random() < 0.80) {
    // Short gap: 60–120 seconds with Gaussian clustering around 90s
    const mean = 90_000;
    const stdDev = 15_000;
    const u = Math.random(), v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u || 1e-9)) * Math.cos(2 * Math.PI * v);
    return Math.max(60_000, Math.min(120_000, mean + z * stdDev));
  } else {
    // Long gap: 5–12 minutes (natural distraction)
    return 5 * 60_000 + Math.random() * 7 * 60_000;
  }
}

// ============================================================
// Campaign Runner
// ============================================================

export class CampaignRunner {
  private settings: AppSettings;

  constructor(settings: AppSettings) {
    this.settings = settings;
  }

  /**
   * Start or resume a campaign
   */
  async startCampaign(campaignId: string): Promise<void> {
    const db = getDatabase();
    const campaign = db
      .prepare("SELECT * FROM campaigns WHERE id = ?")
      .get(campaignId) as any;
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    if (campaign.status === "active") return;

    // Mark active
    db.prepare(
      "UPDATE campaigns SET status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
    ).run(campaignId);

    // ── Re-enqueue system-level polling jobs if none are currently pending ──
    // When a campaign is resumed after all campaigns were paused, the system
    // jobs (CHECK_MESSAGES, CHECK_ENGAGED_REPLIES, etc.) will have been cancelled.
    // We must re-schedule them here so polling resumes.
    const systemJobs = [
      { type: JOB_TYPES.CHECK_ACCEPTANCE, dedupeKey: 'periodic_acceptance_check', delayMs: 2 * 60 * 1000, intervalMinutes: 120 },
      { type: JOB_TYPES.CHECK_MESSAGES, dedupeKey: 'periodic_message_check', delayMs: 5 * 60 * 1000, intervalMinutes: 30 },
      { type: JOB_TYPES.CHECK_ENGAGED_REPLIES, dedupeKey: 'periodic_engaged_replies_check', delayMs: 10 * 60 * 1000, intervalMinutes: 120 },
    ];

    for (const sj of systemJobs) {
      const existingPending = db.prepare(
        `SELECT id FROM job_queue WHERE type = ? AND status IN ('pending', 'running') LIMIT 1`
      ).get(sj.type);

      if (!existingPending) {
        jobQueue.enqueue(
          sj.type,
          { recurringIntervalMinutes: sj.intervalMinutes },
          { delayMs: sj.delayMs, maxAttempts: 2, dedupeKey: sj.dedupeKey },
        );
        console.log(`[Orchestrator] Campaign resumed — re-enqueued ${sj.type}.`);
      }
    }

    logActivity("campaign_started", "campaign", {
      campaignId,
    });
  }


  /**
   * Pause a campaign
   */
  pauseCampaign(campaignId: string): void {
    const db = getDatabase();
    db.prepare(
      "UPDATE campaigns SET status = 'paused', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
    ).run(campaignId);

    // ── Signal any in-flight importFromSearchUrl loops to stop ────────────
    abortCampaignImport(campaignId);

    let cancelledCount = 0;

    // ── Hard-cancel ALL pending & running jobs for this campaign's leads ──
    // Cancel by leadId (covers SCRAPE_PROFILE, SEND_CONNECTION, CHECK_LEAD_THREAD, etc.)
    const leads = db.prepare("SELECT id FROM leads WHERE campaign_id = ?").all(campaignId) as any[];
    for (const lead of leads) {
      const result = db.prepare(
        `UPDATE job_queue SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE status IN ('pending', 'running') AND json_extract(payload, '$.leadId') = ?`
      ).run(lead.id);
      cancelledCount += result.changes;
    }

    // ── Cancel campaign-level jobs that reference this campaignId in their payload ──
    const campaignJobResult = db.prepare(
      `UPDATE job_queue SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE status IN ('pending', 'running') AND json_extract(payload, '$.campaignId') = ?`
    ).run(campaignId);
    cancelledCount += campaignJobResult.changes;

    // ── If NO campaigns remain active, cancel all system-level recurring jobs too ──
    // System jobs (CHECK_MESSAGES, CHECK_ENGAGEMENT_REPLIES, CHECK_ACCEPTANCE,
    // CHECK_DM_FOLLOWUPS) have no campaignId in payload, so they survive the
    // above sweeps. When all campaigns are paused these jobs serve no purpose.
    const anyActiveCampaign = db.prepare("SELECT id FROM campaigns WHERE status = 'active' LIMIT 1").get();
    if (!anyActiveCampaign) {
      const systemJobTypes = [
        'CHECK_MESSAGES',
        'CHECK_ENGAGED_REPLIES',
        'CHECK_ACCEPTANCE',
        'CHECK_DM_FOLLOWUPS',
        'CHECK_LEAD_THREAD',
      ];
      for (const jobType of systemJobTypes) {
        const r = db.prepare(
          `UPDATE job_queue SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
           WHERE status IN ('pending', 'running') AND type = ?`
        ).run(jobType);
        cancelledCount += r.changes;
      }
      console.log(`[Orchestrator] No active campaigns remain — cancelled all system-level polling jobs.`);
    }

    console.log(`[Orchestrator] Campaign ${campaignId} paused. Cancelled ${cancelledCount} pending/running job(s).`);
    logActivity("campaign_paused", "campaign", { campaignId, cancelledJobs: cancelledCount });
  }

  /**
   * Register a new campaign
   */
  registerCampaign(campaign: Campaign, leadUrls: string[]): string {
    const db = getDatabase();

    db.prepare(
      `
          INSERT OR REPLACE INTO campaigns (id, name, description, status, steps_json, stats_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
    ).run(
      campaign.id,
      campaign.name,
      campaign.description || "",
      "draft",
      JSON.stringify(campaign.steps || []),
      JSON.stringify(campaign.stats || {}),
      new Date().toISOString(),
      new Date().toISOString(),
    );

    const insertLead = db.prepare(`
          INSERT INTO leads (id, campaign_id, linkedin_url, status, created_at, updated_at)
          VALUES (?, ?, ?, 'queued', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        `);

    const insertHistory = db.prepare(`
          INSERT INTO activity_log (action, module, details_json) 
          VALUES ('lead_state_transition', 'campaign', ?)
        `);

    db.transaction(() => {
      for (const url of leadUrls) {
        const leadId = uuid();
        insertLead.run(leadId, campaign.id, url);
        insertHistory.run(
          JSON.stringify({
            leadId,
            from: null,
            to: "queued",
            details: "Added to campaign",
          }),
        );
      }
    })();

    logActivity("campaign_registered", "campaign", {
      campaignId: campaign.id,
      name: campaign.name,
      leadsCount: leadUrls.length,
    });

    return campaign.id;
  }

  // ============================================================
  // Public API
  // ============================================================

  getCampaignStats(campaignId: string): {
    total: number;
    byState: Record<string, number>;
    pending: number;
    progress: number;
  } | null {
    const db = getDatabase();
    const leads = db
      .prepare("SELECT status FROM leads WHERE campaign_id = ?")
      .all(campaignId) as any[];

    if (!leads.length) return null;

    const byState: Record<string, number> = {};
    for (const lead of leads) {
      byState[lead.status] = (byState[lead.status] || 0) + 1;
    }

    const terminal = [
      "converted",
      "meeting_booked",
      "rejected",
      "handed_off",
      "error",
    ];
    const completed = leads.filter((l) => terminal.includes(l.status)).length;
    const pending = leads.length - completed;

    return {
      total: leads.length,
      byState,
      pending,
      progress:
        leads.length > 0 ? Math.round((completed / leads.length) * 100) : 0,
    };
  }

  getLeads(campaignId: string): any[] {
    const db = getDatabase();
    return db
      .prepare("SELECT * FROM leads WHERE campaign_id = ?")
      .all(campaignId) as any[];
  }

  /**
   * Stop all campaigns (cleanup on app exit)
   */
  stopAll(): void {
    // Now handled by jobQueue.stop() at app exit
  }
}
