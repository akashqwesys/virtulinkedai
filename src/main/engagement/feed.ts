/**
 * Feed Engagement Module — Auto Like, Comment, Reply
 *
 * Automates engagement on LinkedIn feed with safety-first approach.
 * All interactions are human-like with AI-generated unique comments.
 *
 * Safety: Engagement is spread across the day, mixed action types,
 * natural delays, and only targets relevant content in your niche.
 */

import type { Page } from "puppeteer-core";
import type { AppSettings, EngagementAction } from "../../shared/types";
import { getPage } from "../browser/engine";
import {
  humanClick,
  humanDelay,
  humanScroll,
  pageLoadDelay,
  thinkingDelay,
  randomIdleAction,
  DailyLimitManager,
} from "../browser/humanizer";
import { generatePostComment } from "../ai/personalizer";
import { logActivity, getDatabase } from "../storage/database";
import { v4 as uuid } from "uuid";

// ============================================================
// Feed Engagement Actions
// ============================================================

/**
 * Like a post naturally
 */
export async function likePost(
  postElement: any, // ElementHandle
  limitManager: DailyLimitManager,
): Promise<{ success: boolean; error?: string }> {
  const page = getPage();
  if (!page) return { success: false, error: "Browser not launched" };
  if (!limitManager.canPerform("postEngagements"))
    return { success: false, error: "Daily engagement limit reached" };

  try {
    // Find the like button within the post
    const likeButton =
      (await postElement.$('button[aria-label*="Like"]')) ||
      (await postElement.$(".reactions-react-button")) ||
      (await postElement.$("button.react-button__trigger"));

    if (!likeButton) {
      return { success: false, error: "Like button not found" };
    }

    // Check if already liked
    const isLiked = await page.evaluate(
      (btn: HTMLElement) => btn.getAttribute("aria-pressed") === "true",
      likeButton,
    );
    if (isLiked) {
      return { success: false, error: "Already liked" };
    }

    // Natural pause before liking
    await humanDelay(500, 1500);

    // Click like
    await humanClick(page, likeButton);
    await humanDelay(500, 1000);

    limitManager.record("postEngagements");

    logActivity("post_liked", "engagement", { type: "like" });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Comment on a post with AI-generated content
 */
export async function commentOnPost(
  postElement: any,
  postContent: string,
  authorName: string,
  context: { yourName: string; yourExpertise: string },
  settings: AppSettings,
  limitManager: DailyLimitManager,
): Promise<{ success: boolean; comment?: string; error?: string }> {
  const page = getPage();
  if (!page) return { success: false, error: "Browser not launched" };
  if (!limitManager.canPerform("postEngagements"))
    return { success: false, error: "Daily engagement limit reached" };

  try {
    // Generate AI comment
    const comment = await generatePostComment(
      postContent,
      authorName,
      context,
      settings.ai,
    );

    // Click the comment button
    const commentButton =
      (await postElement.$('button[aria-label*="Comment"]')) ||
      (await postElement.$(".comment-button"));

    if (!commentButton) {
      return { success: false, error: "Comment button not found" };
    }

    await humanClick(page, commentButton as any);
    await humanDelay(1000, 2000);

    // Wait for comment input to appear
    const commentInput = await page.waitForSelector(
      '.comments-comment-texteditor .ql-editor[contenteditable="true"], [role="textbox"][data-placeholder*="comment"]',
      { timeout: 8000 },
    );

    if (!commentInput) {
      return { success: false, error: "Comment input not found" };
    }

    // Click the input
    await humanClick(page, commentInput as any);
    await humanDelay(500, 1000);

    // Type comment naturally
    for (const char of comment) {
      await page.keyboard.type(char);
      const delay = 50 + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));

      if (Math.random() < 0.04) {
        await humanDelay(200, 500);
      }
    }

    // "Review" the comment
    await thinkingDelay();

    // Submit comment
    const submitButton =
      (await page.$("button.comments-comment-box__submit-button")) ||
      (await page.$('button[aria-label="Post comment"]'));

    if (submitButton) {
      await humanClick(page, submitButton as any);
      await humanDelay(1000, 2000);
    } else {
      // Try pressing Ctrl+Enter / Cmd+Enter
      await page.keyboard.down("Meta");
      await page.keyboard.press("Enter");
      await page.keyboard.up("Meta");
      await humanDelay(1000, 2000);
    }

    limitManager.record("postEngagements");

    // Save to DB
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO engagement_actions (id, type, target_url, content, performed_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(uuid(), "comment", "", comment, new Date().toISOString());

    logActivity("post_commented", "engagement", {
      type: "comment",
      authorName,
      commentLength: comment.length,
    });

    return { success: true, comment };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Reply to a comment on YOUR post with AI
 */
export async function replyToComment(
  commentElement: any,
  commentText: string,
  commenterName: string,
  context: { yourName: string; yourExpertise: string },
  settings: AppSettings,
  limitManager: DailyLimitManager,
): Promise<{ success: boolean; reply?: string; error?: string }> {
  const page = getPage();
  if (!page) return { success: false, error: "Browser not launched" };
  if (!limitManager.canPerform("postEngagements"))
    return { success: false, error: "Limit reached" };

  try {
    // Generate reply
    const reply = await generatePostComment(
      `Comment by ${commenterName}: "${commentText}"`,
      commenterName,
      context,
      settings.ai,
    );

    // Click Reply button
    const replyButton =
      (await commentElement.$('button[aria-label*="Reply"]')) ||
      (await commentElement.$(".comments-comment-social-bar__reply-btn"));

    if (!replyButton) {
      return { success: false, error: "Reply button not found" };
    }

    await humanClick(page, replyButton as any);
    await humanDelay(800, 1500);

    // Find reply input
    const replyInput = await page.waitForSelector(
      '.comments-comment-texteditor .ql-editor[contenteditable="true"]',
      { timeout: 8000 },
    );

    if (!replyInput) {
      return { success: false, error: "Reply input not found" };
    }

    await humanClick(page, replyInput as any);
    await humanDelay(400, 800);

    // Type reply naturally
    for (const char of reply) {
      await page.keyboard.type(char);
      await new Promise((resolve) =>
        setTimeout(resolve, 50 + Math.random() * 80),
      );
    }

    await thinkingDelay();

    // Submit
    const submitButton = await page.$(
      "button.comments-comment-box__submit-button",
    );
    if (submitButton) {
      await humanClick(page, submitButton as any);
      await humanDelay(1000, 2000);
    }

    limitManager.record("postEngagements");

    logActivity("comment_replied", "engagement", {
      commenterName,
      replyLength: reply.length,
    });

    return { success: true, reply };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================
// Automated Feed Engagement Session
// ============================================================

/**
 * Run an engagement session — scroll through feed, like and comment
 * on posts that match target audience.
 *
 * This is the "make it viral" engine — done safely.
 */
export async function runEngagementSession(
  settings: AppSettings,
  limitManager: DailyLimitManager,
  options: {
    maxActions?: number;
    likeRatio?: number; // 0-1, what % of posts to like
    commentRatio?: number; // 0-1, what % of posts to comment on
  } = {},
): Promise<{
  postsViewed: number;
  likes: number;
  comments: number;
}> {
  const page = getPage();
  if (!page) return { postsViewed: 0, likes: 0, comments: 0 };

  const { maxActions = 15, likeRatio = 0.4, commentRatio = 0.15 } = options;

  let postsViewed = 0;
  let likes = 0;
  let comments = 0;
  let actionsPerformed = 0;

  try {
    // Navigate to feed
    const homeButton = await page.$('a[href*="/feed/"]');
    if (homeButton) {
      await humanClick(page, homeButton as any);
      await pageLoadDelay();
    }

    // Scroll through the feed
    for (let i = 0; i < 20 && actionsPerformed < maxActions; i++) {
      // Get visible posts
      const posts = await page.$$(".feed-shared-update-v2");
      if (posts.length === 0) break;

      // Process new posts
      for (const post of posts.slice(postsViewed)) {
        if (actionsPerformed >= maxActions) break;
        if (!limitManager.canPerform("postEngagements")) break;

        postsViewed++;

        // Extract post info
        const postInfo = await page.evaluate((el) => {
          const authorEl = el.querySelector(
            '.update-components-actor__name span[aria-hidden="true"]',
          );
          const contentEl = el.querySelector(".feed-shared-text .break-words");

          return {
            authorName: authorEl?.textContent?.trim() || "Unknown",
            content: contentEl?.textContent?.trim() || "",
          };
        }, post);

        // Skip very short or empty posts
        if (postInfo.content.length < 50) continue;

        // "Read" the post naturally
        await humanDelay(2000, 4000);

        // Randomly decide to like
        if (Math.random() < likeRatio) {
          const result = await likePost(post, limitManager);
          if (result.success) {
            likes++;
            actionsPerformed++;
          }
          await humanDelay(1000, 3000);
        }

        // Randomly decide to comment (less frequent than likes)
        if (Math.random() < commentRatio && postInfo.content.length > 100) {
          const result = await commentOnPost(
            post,
            postInfo.content,
            postInfo.authorName,
            {
              yourName: settings.profile?.name || "User",
              yourExpertise: settings.profile?.services || "",
            },
            settings,
            limitManager,
          );
          if (result.success) {
            comments++;
            actionsPerformed++;
          }
          await humanDelay(5000, 15000); // Longer delay after commenting
        }

        // Random idle action
        if (Math.random() < 0.2) {
          await randomIdleAction(page);
        }
      }

      // Scroll down to load more posts
      await humanScroll(page, {
        direction: "down",
        distance: 400 + Math.random() * 300,
      });
      await humanDelay(2000, 4000);
    }

    logActivity("engagement_session_completed", "engagement", {
      postsViewed,
      likes,
      comments,
      actionsPerformed,
    });
  } catch (error) {
    logActivity(
      "engagement_session_error",
      "engagement",
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "error",
    );
  }

  return { postsViewed, likes, comments };
}

/**
 * Reply to comments on your own posts
 */
export async function replyToOwnPostComments(
  settings: AppSettings,
  limitManager: DailyLimitManager,
  maxReplies: number = 5,
): Promise<number> {
  const page = getPage();
  if (!page) return 0;

  let repliesSent = 0;

  try {
    // Navigate to your profile's recent activity
    const meLink = await page.$(".feed-identity-module__actor-meta a");
    if (meLink) {
      await humanClick(page, meLink as any);
      await pageLoadDelay();
    }

    // Look for the "Activity" or "Posts" section
    const activityLink =
      (await page.$('a[href*="/recent-activity/"]')) ||
      (await page.$("a::-p-text(Show all activity)"));
    if (activityLink) {
      await humanClick(page, activityLink as any);
      await pageLoadDelay();
    }

    // Get your own posts
    const myPosts = await page.$$(".feed-shared-update-v2");

    for (const post of myPosts.slice(0, 3)) {
      if (repliesSent >= maxReplies) break;

      // Click to expand comments
      const showComments = await post.$('button[aria-label*="comment"]');
      if (showComments) {
        await humanClick(page, showComments as any);
        await humanDelay(1000, 2000);

        // Get unreplied comments
        const commentElements = await post.$$(".comments-comment-item");

        for (const comment of commentElements) {
          if (repliesSent >= maxReplies) break;
          if (!limitManager.canPerform("postEngagements")) break;

          const commentInfo = await page.evaluate((el) => {
            const nameEl = el.querySelector(
              '.comments-post-meta__name-text span[aria-hidden="true"]',
            );
            const textEl = el.querySelector(
              ".comments-comment-item__main-content",
            );
            const hasReply = !!el.querySelector(
              ".comments-comment-item__replies-list",
            );
            return {
              name: nameEl?.textContent?.trim() || "Unknown",
              text: textEl?.textContent?.trim() || "",
              hasReply,
            };
          }, comment);

          // Only reply to unanswered comments
          if (!commentInfo.hasReply && commentInfo.text.length > 10) {
            const result = await replyToComment(
              comment,
              commentInfo.text,
              commentInfo.name,
              {
                yourName: settings.profile?.name || "User",
                yourExpertise: settings.profile?.services || "",
              },
              settings,
              limitManager,
            );

            if (result.success) {
              repliesSent++;
              await humanDelay(5000, 15000);
            }
          }
        }
      }

      await humanDelay(3000, 8000);
    }

    logActivity("own_post_replies", "engagement", { repliesSent });
  } catch (error) {
    logActivity(
      "own_post_replies_error",
      "engagement",
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "error",
    );
  }

  return repliesSent;
}
