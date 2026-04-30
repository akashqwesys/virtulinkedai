import { jobQueue } from "../queue/jobQueue";
import { JOB_TYPES } from "../queue/jobs";
import type { AppSettings } from "../../shared/types";
import { getDatabase, logActivity } from "../storage/database";
import { isAutoPilotRunning } from "../linkedin/autopilot";
import { isBrowserLocked } from "../browser/engine";
import { isWithinWorkingHours } from "../browser/humanizer";

class PipelineRunner {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private settings: AppSettings | null = null;

  // Cooldown tracking (in milliseconds)
  private lastCheckAcceptance = 0;
  private lastCheckMessages = 0;

  // Cooldown durations
  private readonly COOLDOWN_ACCEPTANCE_MS = 60 * 60 * 1000; // 1 hour
  private readonly COOLDOWN_MESSAGES_MS = 15 * 60 * 1000;   // 15 minutes

  public init(settings: AppSettings) {
    this.settings = settings;
  }

  public updateSettings(settings: AppSettings) {
    this.settings = settings;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Check frequently (every 10 seconds), but we'll return early if a job is running
    this.timer = setInterval(() => this.step(), 10000);
    console.log("[PipelineRunner] Started heartbeat (10s).");
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log("[PipelineRunner] Stopped.");
  }

  private async step(): Promise<void> {
    if (!this.settings) return;

    // 1. Check if ANY job is currently running in the job queue.
    // We strictly process one lead at a time.
    const stats = jobQueue.getStats();
    if (stats.running > 0) {
      return; // Do nothing, wait for current job to finish.
    }

    // 2. Global pauses
    if (isAutoPilotRunning() || isBrowserLocked()) return; // Manual browser usage has priority
    if (!isWithinWorkingHours(this.settings.workingHours)) return; // Sleep

    // Find the active campaign first.
    const db = getDatabase();
    const activeCampaign = db.prepare("SELECT id FROM campaigns WHERE status = 'active' LIMIT 1").get() as { id: string } | undefined;
    
    if (!activeCampaign) return; // No active campaign, nothing to do
    
    const campaignId = activeCampaign.id;

    // 3. Determine sequence
    const prioritizedSection = this.settings.pipeline?.prioritizedSection;
    
    let sections: string[] = [];
    if (prioritizedSection && prioritizedSection !== "none") {
      sections = [prioritizedSection]; // Force priority
    } else {
      sections = ["queue", "connecting", "connected", "engaged"]; // Default flow
    }

    // 4. Evaluate sections in order
    for (const section of sections) {
      if (section === "queue") {
         const foundJob = this.tryRunQueueSection(db, campaignId);
         if (foundJob) return; // Stop if we enqueued something
      } 
      else if (section === "connecting") {
         const foundJob = this.tryRunConnectingSection(db, campaignId);
         if (foundJob) return;
      }
      else if (section === "connected") {
         const foundJob = this.tryRunConnectedSection(db, campaignId);
         if (foundJob) return;
      }
      else if (section === "engaged") {
         const foundJob = this.tryRunEngagedSection(db, campaignId);
         if (foundJob) return;
      }
    }
  }

  // --- Section Handlers ---
  // A handler returns true if it enqueued a job (which means the runner should sleep).
  // It returns false if it found nothing to do, allowing the runner to slide to the next section.

  private tryRunQueueSection(db: any, campaignId: string): boolean {
    // Look for ONE lead in 'queued' or 'new'
    const queuedLead = db.prepare(`SELECT id, linkedin_url FROM leads WHERE campaign_id = ? AND status IN ('queued', 'new') LIMIT 1`).get(campaignId) as any;
    
    if (queuedLead) {
      jobQueue.enqueue(
        JOB_TYPES.SCRAPE_PROFILE,
        {
          leadId: queuedLead.id,
          linkedinUrl: queuedLead.linkedin_url,
          campaignId: campaignId,
        },
        { priority: 10 } // High priority since it's the tip of the spear
      );
      return true;
    }

    // If no raw queued leads, check if there are any scraped leads waiting for connection sending
    // Wait, SCRAPE_PROFILE chains immediately into SEND_CONNECTION natively in worker.ts
    // with a 10-second delay. Since we return if running > 0, it shouldn't be interrupted.
    // However, if the app crashed between scrape and connection, we might have stranded 'profile_scraped' leads.
    const strandedLead = db.prepare(`SELECT id, linkedin_url FROM leads WHERE campaign_id = ? AND status = 'profile_scraped' LIMIT 1`).get(campaignId) as any;
    if (strandedLead) {
      // Fast check if it already has a pending SEND_CONNECTION job
      const pendingJobsCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM job_queue WHERE type = ? AND status = 'pending' AND payload LIKE ?`).get(JOB_TYPES.SEND_CONNECTION, `%${strandedLead.id}%`) as any).cnt;
      
      if (pendingJobsCount === 0) {
        jobQueue.enqueue(
          JOB_TYPES.SEND_CONNECTION,
          {
            leadId: strandedLead.id,
            linkedinUrl: strandedLead.linkedin_url,
            campaignId: campaignId,
          },
          { priority: 9 }
        );
        return true;
      } else {
        // A job is already pending for this. Let the queue run it. We just yield so it can run.
        return true; 
      }
    }

    return false;
  }

  private tryRunConnectingSection(db: any, campaignId: string): boolean {
    // Are there actually leads waiting for acceptance?
    const waitingCount = (db.prepare(`SELECT COUNT(*) as cnt FROM leads WHERE campaign_id = ? AND status IN ('connection_requested', 'connection_sent', 'waiting_acceptance')`).get(campaignId) as any).cnt;
    
    if (waitingCount === 0) return false;

    // Check Cooldown
    const now = Date.now();
    if (now - this.lastCheckAcceptance < this.COOLDOWN_ACCEPTANCE_MS) {
      // Cooldown active. Slide to next section.
      return false;
    }

    this.lastCheckAcceptance = now;

    // Check if the job already exists
    const pendingJobsCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM job_queue WHERE type = ? AND status IN ('pending', 'running')`).get(JOB_TYPES.CHECK_ACCEPTANCE) as any).cnt;
    if (pendingJobsCount === 0) {
       jobQueue.enqueue(
         JOB_TYPES.CHECK_ACCEPTANCE,
         { campaignId },
         { priority: 8 }
       );
    }
    
    return true; // We triggered (or confirmed) an acceptance check
  }

  private tryRunConnectedSection(db: any, campaignId: string): boolean {
    const connectedLead = db.prepare(`SELECT id, linkedin_url FROM leads WHERE campaign_id = ? AND status = 'connection_accepted' LIMIT 1`).get(campaignId) as any;
    
    if (connectedLead) {
       const pendingJobsCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM job_queue WHERE type = ? AND status = 'pending' AND payload LIKE ?`).get(JOB_TYPES.SEND_WELCOME_DM, `%${connectedLead.id}%`) as any).cnt;
       
       if (pendingJobsCount === 0) {
         jobQueue.enqueue(
           JOB_TYPES.SEND_WELCOME_DM,
           {
             leadId: connectedLead.id,
             linkedinUrl: connectedLead.linkedin_url,
             campaignId: campaignId,
           },
           { priority: 7 }
         );
       }
       return true;
    }

    return false;
  }

  private tryRunEngagedSection(db: any, campaignId: string): boolean {
    const engagedCount = (db.prepare(`SELECT COUNT(*) as cnt FROM leads WHERE campaign_id = ? AND status IN ('welcome_sent', 'replied', 'in_conversation', 'email_sent', 'follow_up_sent')`).get(campaignId) as any).cnt;
    
    if (engagedCount === 0) return false;

    // Check Cooldown
    const now = Date.now();
    if (now - this.lastCheckMessages < this.COOLDOWN_MESSAGES_MS) {
      return false; // Slide passed
    }

    this.lastCheckMessages = now;

    const pendingJobsCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM job_queue WHERE type = ? AND status IN ('pending', 'running')`).get(JOB_TYPES.CHECK_MESSAGES) as any).cnt;
    if (pendingJobsCount === 0) {
       jobQueue.enqueue(
         JOB_TYPES.CHECK_MESSAGES,
         { campaignId },
         { priority: 6 }
       );
    }

    const pendingFollowupCheckCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM job_queue WHERE type = ? AND status IN ('pending', 'running')`).get(JOB_TYPES.CHECK_DM_FOLLOWUPS) as any).cnt;
    if (pendingFollowupCheckCount === 0) {
       jobQueue.enqueue(
         JOB_TYPES.CHECK_DM_FOLLOWUPS,
         { campaignId },
         { priority: 5 }
       );
    }

    return true;
  }
}

export const pipelineRunner = new PipelineRunner();
