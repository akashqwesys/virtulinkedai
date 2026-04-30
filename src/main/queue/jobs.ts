/**
 * Job Type Definitions — VirtuLinked AI Queue
 *
 * Centralized catalogue of all job types and their typed payloads.
 * Every background task in the application flows through these types.
 */

// ============================================================
// Job Type Constants
// ============================================================

export const JOB_TYPES = {
  // LinkedIn Automation
  SCRAPE_PROFILE: "SCRAPE_PROFILE",
  SEND_CONNECTION: "SEND_CONNECTION",
  CHECK_ACCEPTANCE: "CHECK_ACCEPTANCE",
  SEND_WELCOME_DM: "SEND_WELCOME_DM",
  SEND_REPLY_DM: "SEND_REPLY_DM",
  CHECK_ENGAGED_REPLIES: "CHECK_ENGAGED_REPLIES",
  CHECK_LEAD_THREAD: "CHECK_LEAD_THREAD",
  CHECK_DM_FOLLOWUPS: "CHECK_DM_FOLLOWUPS",

  // Email Sequence
  SEND_INTRO_EMAIL: "SEND_INTRO_EMAIL",
  SEND_WELCOME_EMAIL: "SEND_WELCOME_EMAIL",
  SEND_FOLLOWUP_EMAIL: "SEND_FOLLOWUP_EMAIL",
  SEND_MEETING_CONFIRMATION: "SEND_MEETING_CONFIRMATION",
  ENRICH_LEAD_EMAIL: "ENRICH_LEAD_EMAIL",

  // Content & Posting
  PUBLISH_SCHEDULED_POST: "PUBLISH_SCHEDULED_POST",
  RUN_ENGAGEMENT_SESSION: "RUN_ENGAGEMENT_SESSION",

  // Maintenance
  CHECK_MESSAGES: "CHECK_MESSAGES",
  PRUNE_JOB_QUEUE: "PRUNE_JOB_QUEUE",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

// ============================================================
// Job Payload Types
// ============================================================

export interface ScrapeProfilePayload {
  leadId: string;
  linkedinUrl: string;
  campaignId: string;
}

export interface SendConnectionPayload {
  leadId: string;
  linkedinUrl: string;
  campaignId: string;
}

export interface CheckAcceptancePayload {
  /** If provided, only check connections for this campaign */
  campaignId?: string;
  /** Re-enqueue after checking (for recurring checks) */
  recurringIntervalMinutes?: number;
}

export interface SendWelcomeDmPayload {
  leadId: string;
  linkedinUrl: string;
  campaignId: string;
}

export interface SendReplyDmPayload {
  leadId: string;
  linkedinUrl: string;
  replyContent: string;
  threadId: string;
}

export interface CheckEngagedRepliesPayload {
  /** Re-enqueue after checking (for recurring checks) */
  recurringIntervalMinutes?: number;
}

export interface CheckLeadThreadPayload {
  leadId: string;
  linkedinUrl: string;
  campaignId: string;
}

export interface CheckDmFollowupsPayload {
  campaignId?: string;
}

export interface SendIntroEmailPayload {
  leadId: string;
  campaignId: string;
  recipientEmail: string;
}

export interface SendWelcomeEmailPayload {
  leadId: string;
  campaignId: string;
  recipientEmail: string;
}

export interface SendFollowupEmailPayload {
  leadId: string;
  campaignId: string;
  recipientEmail: string;
}

export interface EnrichLeadEmailPayload {
  leadId: string;
  campaignId: string;
}

export interface SendMeetingConfirmationPayload {
  leadId: string;
  campaignId: string;
  recipientEmail: string;
  meetingUrl?: string;
  startTime?: string; // ISO string
}

export interface PublishScheduledPostPayload {
  postId: string;
  content: string;
  type: string;
  hashtags: string[];
}

export interface RunEngagementSessionPayload {
  maxActions?: number;
  likeRatio?: number;
  commentRatio?: number;
}

export interface CheckMessagesPayload {
  maxMessages?: number;
  /** Re-enqueue after checking */
  recurringIntervalMinutes?: number;
}

export interface PruneJobQueuePayload {
  olderThanDays?: number;
}
