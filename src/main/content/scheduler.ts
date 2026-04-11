/**
 * Content Scheduler — Auto-posting & Feed Management
 *
 * Schedules and publishes LinkedIn posts with optimal timing,
 * manages a content queue, and handles AI-enhanced content.
 */

import type { Page } from "puppeteer-core";
import type { ScheduledPost, AppSettings } from "../../shared/types";
import { getPage } from "../browser/engine";
import {
  humanClick,
  humanType,
  humanDelay,
  humanScroll,
  pageLoadDelay,
  thinkingDelay,
  randomIdleAction,
  DailyLimitManager,
} from "../browser/humanizer";
import { logActivity, getDatabase } from "../storage/database";
import { jobQueue } from "../queue/jobQueue";
import { JOB_TYPES } from "../queue/jobs";
import type { PublishScheduledPostPayload } from "../queue/jobs";

// ============================================================
// Post Creation
// ============================================================

/**
 * Create a new LinkedIn text post naturally
 */
export async function createTextPost(
  content: string,
  limitManager: DailyLimitManager,
): Promise<{ success: boolean; error?: string }> {
  const page = getPage();
  if (!page) return { success: false, error: "Browser not launched" };
  if (!limitManager.canPerform("contentPosts"))
    return { success: false, error: "Daily content post limit reached" };

  try {
    // Navigate to feed if not already there
    const currentUrl = page.url();
    if (!currentUrl.includes("/feed")) {
      const homeButton = await page.$('a[href*="/feed/"]');
      if (homeButton) {
        await humanClick(page, homeButton as any);
        await pageLoadDelay();
      }
    }

    // Click "Start a post" button
    const startPostButton =
      (await page.$(".share-box-feed-entry__trigger")) ||
      (await page.$('button[aria-label*="Start a post"]')) ||
      (await page.$(".share-box__open"));

    if (!startPostButton) {
      return { success: false, error: "Start a post button not found" };
    }

    await humanClick(page, startPostButton as any);
    await humanDelay(1500, 3000);

    // Wait for the post editor to open
    const editor = await page.waitForSelector(
      '.ql-editor[contenteditable="true"], [role="textbox"][contenteditable="true"]',
      { timeout: 10000 },
    );

    if (!editor) {
      return { success: false, error: "Post editor not found" };
    }

    // Click the editor
    await humanClick(page, editor as any);
    await humanDelay(500, 1000);

    // Type the content naturally
    for (const char of content) {
      if (char === "\n") {
        await page.keyboard.press("Enter");
      } else {
        await page.keyboard.type(char);
      }
      const delay = 40 + Math.random() * 80;
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Occasional pause (thinking/composing)
      if (Math.random() < 0.03) {
        await humanDelay(300, 800);
      }
    }

    // Pause to "review" the post
    await thinkingDelay();

    // Click Post button
    const postButton =
      (await page.$("button.share-actions__primary-action")) ||
      (await page.$('button[aria-label="Post"]')) ||
      (await page.$("button::-p-text(Post)"));

    if (!postButton) {
      return { success: false, error: "Post button not found" };
    }

    await humanClick(page, postButton as any);
    await humanDelay(2000, 4000);

    limitManager.record("contentPosts");

    logActivity("content_posted", "content", {
      contentLength: content.length,
      type: "text",
    });

    // Random idle action after posting
    await randomIdleAction(page);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity(
      "content_post_failed",
      "content",
      { error: message },
      "error",
      message,
    );
    return { success: false, error: message };
  }
}

// ============================================================
// Post Scheduling
// ============================================================

/**
 * Schedule a post for a specific date/time
 */
export function schedulePost(
  post: ScheduledPost,
  limitManager: DailyLimitManager,
): { success: boolean; jobId: string } {
  // Save to database
  const db = getDatabase();
  db.prepare(
    `
    INSERT OR REPLACE INTO scheduled_posts (id, content, post_type, scheduled_at, status, hashtags, media_urls, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    post.id,
    post.content,
    post.type,
    post.scheduledAt,
    "scheduled",
    JSON.stringify(post.hashtags || []),
    JSON.stringify(post.mediaUrls || []),
    new Date().toISOString(),
  );

  // Schedule with job queue instead of node-schedule
  const scheduledDate = new Date(post.scheduledAt);
  jobQueue.enqueue<PublishScheduledPostPayload>(
    JOB_TYPES.PUBLISH_SCHEDULED_POST,
    {
      postId: post.id,
      content: post.content,
      type: post.type,
      hashtags: post.hashtags || [],
    },
    {
      runAt: scheduledDate,
      maxAttempts: 3,
    },
  );

  logActivity("post_scheduled", "content", {
    postId: post.id,
    scheduledAt: post.scheduledAt,
    type: post.type,
  });

  return { success: true, jobId: post.id };
}

/**
 * Cancel a scheduled post
 */
export function cancelScheduledPost(postId: string): boolean {
  // Find the job in job_queue and cancel it
  const db = getDatabase();

  // Check if the scheduled post exists
  const exists = db
    .prepare("SELECT id FROM scheduled_posts WHERE id = ?")
    .get(postId);
  if (exists) {
    db.prepare("UPDATE scheduled_posts SET status = ? WHERE id = ?").run(
      "cancelled",
      postId,
    );
    jobQueue.cancel(postId); // This drops it from the queue if the jobId matches, but we don't have the queue jobId saved
    // Actually, since we didn't save the queue jobId, we construct a query to cancel by postId in payload
    db.prepare(
      `
          UPDATE job_queue SET status = 'cancelled' 
          WHERE type = ? AND json_extract(payload, '$.postId') = ? AND status = 'pending'
        `,
    ).run(JOB_TYPES.PUBLISH_SCHEDULED_POST, postId);

    logActivity("post_cancelled", "content", { postId });
    return true;
  }
  return false;
}

/**
 * Get all scheduled posts
 */
export function getScheduledPosts(): ScheduledPost[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM scheduled_posts ORDER BY scheduled_at ASC")
    .all() as any[];
  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    type: row.post_type,
    scheduledAt: row.scheduled_at,
    status: row.status,
    hashtags: JSON.parse(row.hashtags || "[]"),
    mediaUrls: JSON.parse(row.media_urls || "[]"),
    publishedAt: row.published_at || null,
    engagement: null,
  }));
}

// ============================================================
// Optimal Posting Time Discovery
// ============================================================

/**
 * Suggest optimal posting times based on common LinkedIn engagement data
 */
export function suggestPostingTimes(): Array<{
  day: string;
  times: string[];
  engagement: "high" | "medium";
}> {
  // Based on LinkedIn engagement research
  return [
    { day: "Tuesday", times: ["08:00", "10:00", "12:00"], engagement: "high" },
    {
      day: "Wednesday",
      times: ["08:00", "10:00", "12:00"],
      engagement: "high",
    },
    { day: "Thursday", times: ["08:00", "10:00", "14:00"], engagement: "high" },
    { day: "Monday", times: ["08:00", "10:00"], engagement: "medium" },
    { day: "Friday", times: ["09:00", "11:00"], engagement: "medium" },
  ];
}

/**
 * Cancel all scheduled jobs on app exit
 */
export function cancelAllJobs(): void {
  // Deprecated. Handled by JobQueue on shutdown.
}
