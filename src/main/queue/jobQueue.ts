/**
 * SQLite-Backed Job Queue — VirtuLinked AI
 *
 * A durable, persistent job queue backed by the existing SQLite database.
 * Provides BullMQ-equivalent features without any external dependencies:
 *
 * - Jobs survive app restarts and crashes (persisted to disk)
 * - Delayed jobs (run_at scheduling)
 * - Automatic retry with exponential backoff
 * - Concurrency control (one job at a time per job type)
 * - Priority ordering
 * - Crash recovery (resumes "running" jobs on boot)
 */

import { getDatabase, logActivity } from "../storage/database";
import { v4 as uuid } from "uuid";
import { isBrowserLocked, setBrowserLocked } from "../browser/engine";

// ============================================================
// Types
// ============================================================

export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface Job<T = any> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface EnqueueOptions {
  /** Delay in milliseconds from now before the job becomes eligible */
  delayMs?: number;
  /** Specific date/time to run the job at */
  runAt?: Date;
  /** Higher = processed first (default: 0) */
  priority?: number;
  /** How many times to retry on failure (default: 3) */
  maxAttempts?: number;
  /** Optional unique key — if a pending job with this key exists, skip enqueue */
  dedupeKey?: string;
}

export type JobHandler<T = any> = (job: Job<T>) => Promise<void>;

// ============================================================
// Queue Engine
// ============================================================

export class JobQueue {
  private handlers: Map<string, JobHandler<any>> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;
  private running = false;
  private processingJobIds: Set<string> = new Set();
  private readonly POLL_INTERVAL_MS = 5000; // Poll every 5 seconds

  constructor() {
    // On startup, heal any "running" jobs left by a previous crash
    this.recoverCrashedJobs();
  }

  // ============================================================
  // Enqueue a Job
  // ============================================================

  /**
   * Add a job to the queue. Returns the job ID.
   */
  enqueue<T = any>(
    type: string,
    payload: T,
    options: EnqueueOptions = {},
  ): string {
    const {
      delayMs = 0,
      runAt,
      priority = 0,
      maxAttempts = 3,
      dedupeKey,
    } = options;

    const db = getDatabase();

    // Deduplication — skip if pending job with this key already exists
    if (dedupeKey) {
      const existing = db
        .prepare(
          `SELECT id FROM job_queue WHERE type = ? AND status = 'pending' AND json_extract(payload, '$.dedupeKey') = ?`,
        )
        .get(type, dedupeKey) as { id: string } | undefined;
      if (existing) {
        return existing.id;
      }
    }

    const jobId = uuid();
    const effectiveRunAt = runAt
      ? runAt.toISOString()
      : new Date(Date.now() + delayMs).toISOString();

    const payloadWithKey = dedupeKey ? { ...payload, dedupeKey } : payload;

    db.prepare(
      `
      INSERT INTO job_queue (id, type, payload, status, priority, max_attempts, run_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `,
    ).run(
      jobId,
      type,
      JSON.stringify(payloadWithKey),
      priority,
      maxAttempts,
      effectiveRunAt,
    );

    return jobId;
  }

  /**
   * Cancel a pending or running job by ID
   */
  cancel(jobId: string): boolean {
    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE job_queue SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND status IN ('pending', 'running')`,
      )
      .run(jobId);
    return result.changes > 0;
  }

  /**
   * Cancel all pending jobs of a given type
   */
  cancelByType(type: string): number {
    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE job_queue SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE type = ? AND status = 'pending'`,
      )
      .run(type);
    return result.changes;
  }

  // ============================================================
  // Worker Registration
  // ============================================================

  /**
   * Register a handler function for a specific job type.
   * The handler receives the full Job object and must return a Promise.
   */
  process<T = any>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler<any>);
  }

  // ============================================================
  // Queue Polling
  // ============================================================

  /**
   * Start the queue polling loop
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.pollInterval = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[JobQueue] Poll error:", err);
      });
    }, this.POLL_INTERVAL_MS);

    // Poll immediately on start
    this.poll().catch((err) =>
      console.error("[JobQueue] Initial poll error:", err),
    );

    logActivity("job_queue_started", "queue", {
      pollIntervalMs: this.POLL_INTERVAL_MS,
    });
    console.log(
      "[JobQueue] Started. Polling every",
      this.POLL_INTERVAL_MS / 1000,
      "seconds.",
    );
  }

  /**
   * Stop the queue polling loop
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.running = false;
    logActivity("job_queue_stopped", "queue");
    console.log("[JobQueue] Stopped.");
  }

  private isProcessing = false;

  /**
   * Process the next available batch of jobs
   */
  private async poll(): Promise<void> {
    if (!this.running || this.isProcessing || isBrowserLocked()) return;
    this.isProcessing = true;

    try {
      const db = getDatabase();

      while (this.running) {
        // Fetch next eligible job
        const row = db
          .prepare(
            `
          SELECT * FROM job_queue
          WHERE status = 'pending'
            AND run_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          ORDER BY priority DESC, run_at ASC
          LIMIT 1
        `,
          )
          .get() as any;

        if (!row) break;

        // Skip if already being processed 
        if (this.processingJobIds.has(row.id)) break;

        const handler = this.handlers.get(row.type);
        if (!handler) {
          console.warn(`[JobQueue] No handler for job type ${row.type}`);
          break;
        }

        // Atomically claim the job
        const claimed = db
          .prepare(
            `
          UPDATE job_queue
          SET status = 'running', started_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), attempts = attempts + 1
          WHERE id = ? AND status = 'pending'
        `,
          )
          .run(row.id);

        if (claimed.changes === 0) continue;

        this.processingJobIds.add(row.id);

        // Execute serially! A single browser page cannot run concurrent humanizer actions.
        try {
          // Lock browser so manual user flows (Import) wait for background jobs to finish
          setBrowserLocked(true);
          await this.executeJob(row, handler);
        } finally {
          this.processingJobIds.delete(row.id);
          setBrowserLocked(false);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Execute a single job and handle success/failure
   */
  private async executeJob(row: any, handler: JobHandler<any>): Promise<void> {
    const db = getDatabase();

    const job: Job = {
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload || "{}"),
      status: "running",
      priority: row.priority,
      attempts: row.attempts + 1, // DB was just incremented, reflect that locally!
      maxAttempts: row.max_attempts,
      runAt: new Date(row.run_at),
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
      createdAt: new Date(row.created_at),
    };

    // console.log(
    console.log(
      `[JobQueue] Executing job ${job.type} (${job.id}), attempt ${job.attempts}/${job.maxAttempts}`,
    );

    try {
      await handler(job);

      // Mark as done (only if it wasn't intercepted by the handler and marked skipped)
      db.prepare(
        `
        UPDATE job_queue
        SET status = 'done', completed_at = datetime('now'), error_message = NULL
        WHERE id = ? AND status IN ('running', 'pending')
      `,
      ).run(job.id);

      logActivity("job_completed", "queue", {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[JobQueue] Job ${job.type} (${job.id}) failed:`, message);

      const isWorkingHoursError = message.includes("Outside working hours");
      const isAutoPilotError = message.includes("AutoPilot is running");
      const isCampaignPausedError = message.includes("Campaign is paused");
      const isLimitError = message.toLowerCase().includes("limit reached");
      const isPausedError = isWorkingHoursError || isAutoPilotError || isCampaignPausedError || isLimitError;

      if (!isPausedError && job.attempts >= job.maxAttempts) {
        // Exhausted retries — mark as permanently failed
        db.prepare(
          `
          UPDATE job_queue
          SET status = 'failed', completed_at = datetime('now'), error_message = ?
          WHERE id = ?
        `,
        ).run(message, job.id);

        logActivity(
          "job_failed_permanently",
          "queue",
          { jobId: job.id, type: job.type, error: message },
          "error",
          message,
        );
      } else {
        // If it's a paused job, retry in 5-15 minutes, and DON'T increment attempt count.
        // Otherwise use exponential backoff: 30s, 5min, 30min
        const backoffMs = isPausedError 
            ? (isAutoPilotError ? 5 * 60 * 1000 : 15 * 60 * 1000)
            : Math.pow(5, job.attempts) * 30 * 1000;
        
        const attemptsToSave = isPausedError 
            ? Math.max(0, job.attempts - 1) 
            : job.attempts;

        const retryAt = new Date(Date.now() + backoffMs).toISOString();

        db.prepare(
          `
          UPDATE job_queue
          SET status = 'pending', run_at = ?, error_message = ?, attempts = ?
          WHERE id = ?
        `,
        ).run(retryAt, message, attemptsToSave, job.id);

        logActivity("job_retrying", "queue", {
          jobId: job.id,
          type: job.type,
          attempts: attemptsToSave,
          retryAt,
          error: message,
        });
      }
    }
  }

  // ============================================================
  // Crash Recovery
  // ============================================================

  /**
   * On startup, reset any jobs stuck in 'running' state from a previous crash.
   * They get rescheduled to retry immediately.
   */
  private recoverCrashedJobs(): void {
    try {
      const db = getDatabase();

      // Find all jobs stuck in 'running' state from a previous crash
      const stuckJobs = db
        .prepare(`SELECT id, type, payload FROM job_queue WHERE status = 'running'`)
        .all() as any[];

      if (stuckJobs.length === 0) return;

      let recovered = 0;
      let cancelled = 0;

      for (const row of stuckJobs) {
        let campaignId: string | null = null;
        try {
          const payload = JSON.parse(row.payload || "{}");
          campaignId = payload.campaignId || payload.leadId ? null : null;
          if (payload.campaignId) campaignId = payload.campaignId;
          // For lead-scoped jobs, look up the lead's campaign
          if (!campaignId && payload.leadId) {
            const lead = db.prepare("SELECT campaign_id FROM leads WHERE id = ?").get(payload.leadId) as any;
            if (lead) campaignId = lead.campaign_id;
          }
        } catch { /* ignore parse errors */ }

        // If the job belongs to a paused/non-active campaign, cancel it
        if (campaignId) {
          const campaign = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(campaignId) as any;
          if (campaign && campaign.status !== "active") {
            db.prepare(
              `UPDATE job_queue SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
            ).run(row.id);
            cancelled++;
            continue;
          }
        }

        // Safe to recover — campaign is still active (or job is system-level)
        db.prepare(
          `UPDATE job_queue SET status = 'pending', run_at = datetime('now') WHERE id = ?`
        ).run(row.id);
        recovered++;
      }

      if (recovered > 0 || cancelled > 0) {
        console.log(
          `[JobQueue] Crash recovery: recovered ${recovered} job(s), cancelled ${cancelled} job(s) (paused campaigns).`,
        );
        logActivity("job_queue_crash_recovery", "queue", { recovered, cancelled });
      }
    } catch (err) {
      // DB might not be initialized yet if called too early
      console.warn("[JobQueue] Could not run crash recovery yet:", err);
    }
  }

  // ============================================================
  // Introspection
  // ============================================================

  /**
   * Get queue statistics
   */
  getStats(): Record<string, number> {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT status, COUNT(*) as count FROM job_queue GROUP BY status`,
      )
      .all() as { status: string; count: number }[];

    const stats: Record<string, number> = {
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of rows) {
      stats[row.status] = row.count;
    }
    return stats;
  }

  /**
   * Get recent jobs for debugging
   */
  getRecentJobs(limit = 50): Job[] {
    const db = getDatabase();
    const rows = db
      .prepare(`SELECT * FROM job_queue ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload || "{}"),
      status: row.status as JobStatus,
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      runAt: new Date(row.run_at),
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Purge old completed/cancelled jobs older than N days
   */
  pruneOldJobs(olderThanDays = 7): number {
    const db = getDatabase();
    const cutoff = new Date(
      Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const result = db
      .prepare(
        `DELETE FROM job_queue WHERE status IN ('done', 'failed', 'cancelled') AND completed_at < ?`,
      )
      .run(cutoff);
    return result.changes;
  }
}

// Singleton instance — shared across the entire main process
export const jobQueue = new JobQueue();
