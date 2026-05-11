/**
 * LinkedIn Messenger - DM Management & Auto-Reply Chatbot
 *
 * Handles sending/reading LinkedIn messages with natural behavior.
 * Includes the auto-reply chatbot that guides conversations toward
 * booking a meeting.
 *
 * Robust selector strategy to handle LinkedIn's evolving DOM.
 */

import type { Page } from "puppeteer-core";
import type {
  LinkedInProfile,
  AppSettings,
  ConversationMessage,
  ChatbotState,
} from "../../shared/types";
import { getPage } from "../browser/engine";
import {
  humanClick,
  humanType,
  humanTypeSlowly,
  humanDelay,
  humanScroll,
  pageLoadDelay,
  thinkingDelay,
  randomIdleAction,
  inPageNavigate,
} from "../browser/humanizer";
import { generateChatbotReply, analyzeSentiment } from "../ai/personalizer";
import { getDatabase, logActivity } from "../storage/database";
import { v4 as uuid } from "uuid";

// Chatbot states are persisted to the leads table in the database

/**
 * Send a reply directly in an existing LinkedIn messaging thread.
 * Uses the thread URL (/messaging/thread/XXX/) to navigate directly
 * into the conversation â€” no profile navigation needed.
 */
export async function sendReplyInThread(
  threadId: string,
  message: string,
  options: { isAutomated?: boolean; leadId?: string } = {},
): Promise<{ success: boolean; error?: string }> {
  const page = getPage();
  if (!page) throw new Error("Browser not launched");

  try {
    // Build the thread URL â€” threadId can be the full URL or just the ID
    let threadUrl = threadId;
    if (!threadId.startsWith("http")) {
      threadUrl = `https://www.linkedin.com/messaging/thread/${threadId}/`;
    } else if (threadId.includes("/messaging/") && !threadId.includes("/thread/")) {
      // It's a conversation list URL â€” use it directly
      threadUrl = threadId;
    }

    await inPageNavigate(page, threadUrl);
    await pageLoadDelay();
    await humanDelay(1200, 2500);

    // Wait for the compose box
    const composeBox = await page.waitForSelector(
      [
        '.msg-form__contenteditable',
        '[contenteditable="true"][role="textbox"]',
        '.msg-form__msg-content-container [contenteditable]',
        'div[data-placeholder*="Write a message"]',
        'div[data-placeholder*="message"]',
        '.msg-form [contenteditable]',
      ].join(", "),
      { timeout: 15000 }
    ).catch(() => null);

    if (!composeBox) {
      return { success: false, error: "Message compose box not found in thread" };
    }

    // Click and focus
    await humanClick(page, composeBox as any);
    await humanDelay(400, 900);

    // Type character by character with natural cadence
    for (const char of message) {
      await page.keyboard.type(char);
      const delay = 45 + Math.random() * 90;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (Math.random() < 0.04) {
        await humanDelay(150, 400); // Brief mid-thought pause
      }
    }

    // Pause to "review" message before sending
    await thinkingDelay();

    // Send
    const sent = await clickMessageSendButton(page);
    if (!sent) {
      return { success: false, error: "Send button not found in thread" };
    }

    await humanDelay(800, 1500);

    // Persist to conversations table
    if (options.leadId) {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO conversations (id, lead_id, direction, content, platform, is_automated, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuid(), options.leadId, 'outbound', message, 'linkedin', options.isAutomated ? 1 : 0, new Date().toISOString());
    }

    logActivity("thread_reply_sent", "linkedin", {
      threadId,
      messageLength: message.length,
      isAutomated: options.isAutomated ?? false,
    });

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logActivity("thread_reply_failed", "linkedin", { threadId, error: msg }, "error", msg);
    return { success: false, error: msg };
  }
}

/**
 * Send a LinkedIn DM to a connected user
 */
export async function sendMessage(
  profileUrl: string,
  message: string,
  options: { isAutomated?: boolean; checkHandoff?: boolean; leadId?: string } = {},
): Promise<{ success: boolean; error?: string; handedOff?: boolean }> {
  const page = getPage();
  if (!page) throw new Error("Browser not launched");

  try {
    // Navigate to profile via SPA routing
    await inPageNavigate(page, profileUrl);
    await pageLoadDelay();
    await humanDelay(1000, 2000);

    // Find and click Message button â€” try multiple selectors
    const messageButton = await findMessageButton(page);

    if (!messageButton) {
      return {
        success: false,
        error: "Message button not found â€” may not be connected or profile not loaded",
      };
    }

    await humanClick(page, messageButton as any);
    await humanDelay(2000, 3500); // Wait for messaging panel to open

    // Wait for the compose box to appear
    const composeBox = await page.waitForSelector(
      [
        '.msg-form__contenteditable',
        '[contenteditable="true"][role="textbox"]',
        '.msg-form__msg-content-container [contenteditable]',
        'div[data-placeholder*="Write a message"]',
        'div[data-placeholder*="message"]',
        '.msg-form [contenteditable]',
      ].join(", "),
      { timeout: 12000 }
    ).catch(() => null);

    if (!composeBox) {
      return { success: false, error: "Message compose box not found after waiting" };
    }

    // Check for manual handoff signal (human already replied in this thread)
    if (options.checkHandoff && options.leadId) {
      await humanDelay(800, 1500);
      const isManualIntervention = await page.evaluate(() => {
        const groups = document.querySelectorAll(
          '.msg-s-message-list__event, .msg-s-message-group, .msg-s-event-listitem'
        );
        if (groups.length === 0) return false;
        const lastGroup = groups[groups.length - 1];
        return (
          lastGroup.className.includes("--viewer") ||
          lastGroup.querySelector('span[aria-hidden="true"]')?.textContent?.trim().toLowerCase() === "you"
        );
      });

      if (isManualIntervention) {
        handoffConversation(options.leadId);
        logActivity("manual_handoff_detected", "linkedin", { leadId: options.leadId });
        return { success: false, handedOff: true, error: "Human intervention detected â€” campaign paused for lead" };
      }
    }

    // Click and focus the compose box
    await humanClick(page, composeBox as any);
    await humanDelay(400, 800);

    // Type character by character for natural feel
    for (const char of message) {
      await page.keyboard.type(char);
      const delay = 45 + Math.random() * 90;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (Math.random() < 0.04) {
        await humanDelay(150, 400);
      }
    }

    // Pause to "review" message
    await thinkingDelay();

    // Find and click Send button
    const sent = await clickMessageSendButton(page);

    if (!sent) {
      return { success: false, error: "Send button not found" };
    }

    await humanDelay(800, 1500);

    const db = getDatabase();
    let leadIdToSave = options.leadId;
    if (!leadIdToSave) {
      const normalizeUrl = profileUrl.split('?')[0].replace(/\/$/, '');
      const lead = db.prepare("SELECT id FROM leads WHERE linkedin_url LIKE ?").get(`%${normalizeUrl}%`) as any;
      if (lead) leadIdToSave = lead.id;
    }

    if (leadIdToSave) {
      db.prepare(`
        INSERT INTO conversations (id, lead_id, direction, content, platform, is_automated, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(uuid(), leadIdToSave, 'outbound', message, 'linkedin', options.isAutomated ? 1 : 0, new Date().toISOString());
    }

    logActivity("message_sent", "linkedin", {
      profileUrl,
      messageLength: message.length,
      isAutomated: options.isAutomated ?? false,
    });

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logActivity("message_send_failed", "linkedin", { profileUrl, error: msg }, "error", msg);
    return { success: false, error: msg };
  }
}

/**
 * Find the Message button on a LinkedIn profile page.
 * Uses multiple selector strategies.
 */
async function findMessageButton(page: Page): Promise<any | null> {
  // Strategy 1: aria-label based selectors
  const ariaSelectors = [
    'button[aria-label*="Message"]',
    'button[aria-label="Message"]',
    'a[aria-label*="Message"]',
    // Sales Navigator specific
    'button[aria-label*="Message lead"]',
    'button[aria-label*="message"]'
  ];
  for (const sel of ariaSelectors) {
    const btn = await page.$(sel);
    if (btn) return btn;
  }

  // Strategy 2: data-control-name
  const dataBtn = await page.$('[data-control-name="message"], [data-control-name="message_lead"], [data-control-name="send_inmail"]');
  if (dataBtn) return dataBtn;

  // Strategy 3: Text-based search in profile action area
  const textBtn = await page.evaluateHandle(() => {
    const containers = [
      ".pvs-profile-actions",
      ".pv-top-card-v2-ctas",
      ".pv-s-profile-actions",
      ".profile-header-actions",
      "main section:first-of-type",
      // Sales Navigator specific container
      ".profile-topcard-actions",
      ".artdeco-card .profile-topcard"
    ];

    for (const sel of containers) {
      const container = document.querySelector(sel);
      if (!container) continue;
      const buttons = container.querySelectorAll("button, a");
      for (const btn of buttons) {
        if (btn.textContent?.trim().toLowerCase() === "message") return btn;
      }
    }

    // Wider fallback â€” any visible button with text "Message"
    const allButtons = document.querySelectorAll("button, a[href*='/messaging/'], a[href*='/sales/inbox']");
    for (const btn of allButtons) {
      const text = btn.textContent?.trim().toLowerCase() || "";
      if (text === "message" && (btn as HTMLElement).offsetParent !== null) return btn;
    }
    return null;
  });

  return textBtn.asElement() || null;
}

/**
 * Click the Send button in the messaging compose window.
 */
async function clickMessageSendButton(page: Page): Promise<boolean> {
  const sendSelectors = [
    'button[type="submit"].msg-form__send-button',
    "button.msg-form__send-button",
    'button[aria-label="Send"]',
    'button[aria-label*="Send message"]',
    '.msg-form__send-btn',
    'button[type="submit"][class*="send"]',
  ];

  for (const sel of sendSelectors) {
    const btn = await page.$(sel);
    if (btn) {
      await humanClick(page, btn as any);
      return true;
    }
  }

  // Text-based fallback in compose area
  const sendByText = await page.evaluateHandle(() => {
    const forms = document.querySelectorAll(
      ".msg-form, .msg-compose-form, [class*='msg-form']"
    );
    for (const form of forms) {
      const btns = form.querySelectorAll("button");
      for (const btn of btns) {
        const txt = btn.textContent?.trim().toLowerCase() || "";
        const label = btn.getAttribute("aria-label")?.toLowerCase() || "";
        if (txt === "send" || label.includes("send")) return btn;
      }
    }
    return null;
  });

  const el = sendByText.asElement();
  if (el) {
    await humanClick(page, el as any);
    return true;
  }

  // Last resort: keyboard shortcut (Ctrl+Enter or just Enter)
  try {
    await page.keyboard.press("Enter");
    await humanDelay(800, 1500);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read unread messages from LinkedIn messaging.
 * Two-pass approach:
 *  Pass 1 â€” scan sidebar for unread thread metadata
 *  Pass 2 â€” click into each thread to get full message text + confirmed thread URL
 */
export async function readUnreadMessages(): Promise<
  Array<{
    senderName: string;
    senderUrl: string;
    lastMessage: string;
    unreadCount: number;
    threadId: string;
  }>
> {
  const page = getPage();
  if (!page) throw new Error("Browser not launched");

  try {
    await inPageNavigate(page, "https://www.linkedin.com/messaging/");
    await humanDelay(1500, 2500);

    // â”€â”€ Pass 1: Collect unread thread sidebar data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const threadMeta = await page.evaluate(() => {
      const itemSelectors = [
        ".msg-conversation-listitem",
        ".msg-conversations-list-item",
        "[data-view-name='message-list-item']",
      ];

      let items: NodeListOf<Element> | null = null;
      for (const sel of itemSelectors) {
        const found = document.querySelectorAll(sel);
        if (found.length > 0) { items = found; break; }
      }

      if (!items) return [];

      const unreadThreads: Array<{
        senderName: string;
        senderUrl: string;          // Profile URL (for lead matching)
        snippetText: string;        // Sidebar preview â€” may be truncated
        unreadCount: number;
        threadHref: string;         // /messaging/thread/XXX/ URL
      }> = [];

      items.forEach((item) => {
        const isUnread =
          item.classList.contains("msg-conversation-listitem--unread") ||
          item.classList.contains("msg-conversations-list-item--unread") ||
          !!item.querySelector(".msg-conversation-card__unread-count, .notification-badge");

        if (!isUnread) return;

        const nameEl =
          item.querySelector(".msg-conversation-card__participant-names") ||
          item.querySelector("[class*='participant-names']") ||
          item.querySelector("h3");

        const messageEl =
          item.querySelector(".msg-conversation-card__message-snippet") ||
          item.querySelector("[class*='message-snippet']") ||
          item.querySelector("p");

        // The anchor that links to the thread (href = /messaging/thread/XXX/)
        const threadLinkEl = item.querySelector("a[href*='/messaging/thread/']") as HTMLAnchorElement | null;
        // The anchor that links to the sender profile (href = /in/XXX/)
        const profileLinkEl = item.querySelector("a[href*='/in/']") as HTMLAnchorElement | null;

        const countEl =
          item.querySelector(".msg-conversation-card__unread-count") ||
          item.querySelector(".notification-badge");

        const threadLink = threadLinkEl?.href || (item.querySelector("a") as HTMLAnchorElement | null)?.href || "";

        unreadThreads.push({
          senderName: nameEl?.textContent?.trim() || "Unknown",
          senderUrl: profileLinkEl?.href || "",
          snippetText: messageEl?.textContent?.trim() || "",
          unreadCount: parseInt(countEl?.textContent?.trim() || "1"),
          threadHref: threadLink,
        });
      });

      return unreadThreads;
    });

    if (threadMeta.length === 0) {
      logActivity("unread_messages_read", "linkedin", { unreadThreads: 0 });
      return [];
    }

    // â”€â”€ Pass 2: Click into each thread to get full last message + thread URL â”€
    const results: Array<{
      senderName: string;
      senderUrl: string;
      lastMessage: string;
      unreadCount: number;
      threadId: string;
    }> = [];

    for (const meta of threadMeta) {
      try {
        // Navigate directly to the thread
        const threadUrl = meta.threadHref || "https://www.linkedin.com/messaging/";
        await inPageNavigate(page, threadUrl);
        await humanDelay(1200, 2200);

        // Extract last message from the open thread + confirm sender profile URL
        const threadData = await page.evaluate(() => {
          // Get the URL of the thread (definitive)
          const threadId = window.location.href;

          // Get all message items in the conversation
          const messageSelectors = [
            ".msg-s-message-list__event",
            ".msg-s-event-listitem",
            ".msg-s-message-group",
          ];

          let messageItems: NodeListOf<Element> | null = null;
          for (const sel of messageSelectors) {
            const found = document.querySelectorAll(sel);
            if (found.length > 0) { messageItems = found; break; }
          }

          // Get last message text (most recent)
          let lastMessage = "";
          if (messageItems && messageItems.length > 0) {
            const lastItem = messageItems[messageItems.length - 1];
            const textEl = lastItem.querySelector(
              ".msg-s-event__content, .msg-s-message-group__content, p, [class*='event-content']"
            );
            lastMessage = textEl?.textContent?.trim() || "";
          }

          // Get sender profile URL from the thread header
          const profileLink = document.querySelector(
            ".msg-entity-lockup__entity-title a, .msg-thread__link-to-profile, a[href*='/in/']"
          ) as HTMLAnchorElement | null;
          const senderUrl = profileLink?.href || "";

          return { threadId, lastMessage, senderUrl };
        });

        results.push({
          senderName: meta.senderName,
          senderUrl: threadData.senderUrl || meta.senderUrl,
          lastMessage: threadData.lastMessage || meta.snippetText,
          unreadCount: meta.unreadCount,
          threadId: threadData.threadId || meta.threadHref,
        });

        await humanDelay(600, 1200);
      } catch (threadErr) {
        // If we fail to open the thread, fall back to sidebar data
        results.push({
          senderName: meta.senderName,
          senderUrl: meta.senderUrl,
          lastMessage: meta.snippetText,
          unreadCount: meta.unreadCount,
          threadId: meta.threadHref,
        });
      }
    }

    logActivity("unread_messages_read", "linkedin", { unreadThreads: results.length });
    return results;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logActivity("read_messages_failed", "linkedin", { error: msg }, "error", msg);
    return [];
  }

}

/**
 * Process a chatbot conversation for a specific lead
 */
export async function processChatbotMessage(
  leadId: string,
  profile: LinkedInProfile,
  incomingMessage: string,
  context: {
    yourName: string;
    yourCompany: string;
    yourServices: string;
  },
  settings: AppSettings,
): Promise<{
  reply: string | null;
  newState: ChatbotState;
  action: "reply" | "handoff" | "book_meeting" | "wait";
}> {
  const db = getDatabase();
  
  // Persist the incoming message
  db.prepare(`
    INSERT INTO conversations (id, lead_id, direction, content, platform, sent_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuid(), leadId, 'inbound', incomingMessage, 'linkedin', new Date().toISOString());

  const lead = db.prepare("SELECT status, interaction_count, chatbot_state FROM leads WHERE id = ?").get(leadId) as any;
  if (!lead) return { reply: null, newState: "idle", action: "wait" };

  // Hard stop â€” lead handed off to human
  if (lead.status === "handed_off") {
    return { reply: null, newState: "handed_off", action: "handoff" };
  }

  // Hard stop â€” meeting already booked
  if (lead.status === "meeting_booked") {
    return { reply: null, newState: "meeting_booked", action: "wait" };
  }

  const messageCount = (lead.interaction_count || 0) + 1;
  const currentState = (lead.chatbot_state || "idle") as ChatbotState;

  // Build conversation history from DB
  const convRows = db.prepare(
    "SELECT direction, content FROM conversations WHERE lead_id = ? ORDER BY sent_at ASC LIMIT 12"
  ).all() as any[];
  const history = convRows.map(r => ({
    role: r.direction === 'inbound' ? 'user' : ('assistant' as "user" | "assistant"),
    content: r.content
  }));

  // Run sentiment analysis on the incoming message
  const analysis = await analyzeSentiment(incomingMessage, settings.ai);

  // â”€â”€ Negative Sentiment / Disinterest â†’ handoff â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (analysis.intent === "not_interested" || analysis.sentiment === "negative") {
    if (settings.chatbot.handoffOnNegativeSentiment) {
      db.prepare("UPDATE leads SET status = 'handed_off', chatbot_state = 'handed_off' WHERE id = ?").run(leadId);
      return { reply: null, newState: "handed_off", action: "handoff" };
    }
  }

  // â”€â”€ Determine next objective based on state + sentiment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let objective: "build_rapport" | "share_value" | "suggest_meeting" | "book_appointment" = "build_rapport";
  let action: "reply" | "handoff" | "book_meeting" | "wait" = "reply";
  let newState: ChatbotState = "building_rapport";

  if (analysis.intent === "ready_to_meet") {
    // Lead is explicitly ready â€” go straight to booking
    objective = "book_appointment";
    newState = "booking_appointment";
    action = "book_meeting";
  } else if (messageCount > (settings.chatbot.maxAutoMessages || 5)) {
    // We already sent the 5th booking message, and they replied again.
    // Hard stop â€” Hand off to human. No more than 5 AI messages sent.
    db.prepare("UPDATE leads SET status = 'handed_off', chatbot_state = 'handed_off' WHERE id = ?").run(leadId);
    return { reply: null, newState: "handed_off", action: "handoff" };
  } else if (messageCount === (settings.chatbot.maxAutoMessages || 5)) {
    // 5th message trigger â€” hard push to book a meeting
    objective = "book_appointment";
    newState = "booking_appointment";
  } else if (currentState === "suggesting_meeting" || currentState === "booking_appointment") {
    // Already pushed for meeting â€” keep pushing to convert
    objective = messageCount >= 4 ? "book_appointment" : "suggest_meeting";
    newState = messageCount >= 4 ? "booking_appointment" : "suggesting_meeting";
  } else if (analysis.intent === "interested" || analysis.intent === "curious") {
    if (messageCount >= 3) {
      objective = "suggest_meeting";
      newState = "suggesting_meeting";
    } else {
      objective = "share_value";
      newState = "sharing_value";
    }
  } else if (analysis.intent === "question") {
    // Answer their question, then pivot to value
    objective = "share_value";
    newState = "sharing_value";
  } else {
    // Neutral / greeting (like "Hey, Deep") â†’ start with rapport building
    if (messageCount <= 1) {
      objective = "build_rapport";
      newState = "building_rapport";
    } else if (messageCount === 2) {
      objective = "share_value";
      newState = "sharing_value";
    } else {
      objective = "suggest_meeting";
      newState = "suggesting_meeting";
    }
  }

  // Generate the reply via NVIDIA API (build.nvidia.com)
  const replyRaw = await generateChatbotReply(
    profile,
    history,
    { ...context, objective },
    settings.ai,
  );

  // â”€â”€ Calendar Link Auto-Insert (PDF C2: auto-insert meeting links) â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // When the lead is ready to meet, fetch available slots and append to the DM.
  let reply = replyRaw;
  if (action === "book_meeting") {
    try {
      const { getAvailableSlots } = await import("../microsoft/email");
      const now = new Date();
      const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const slots = await getAvailableSlots({ start: now, end: oneWeekLater }, 30);

      if (slots.length > 0) {
        const slotLines = slots.slice(0, 3).map((s) => {
          return `â€¢ ${s.start.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} IST`;
        });
        reply = `${replyRaw}\n\nHere are a few times that work for me:\n${slotLines.join("\n")}\n\nDoes any of these work for you?`;
      }
    } catch (e) {
      console.warn("[Messenger] Could not fetch calendar slots:", e);
      // Non-fatal â€” reply continues without slot list
    }

    // â”€â”€ Enqueue Meeting Confirmation Email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const leadEmailRow = db.prepare("SELECT email, campaign_id FROM leads WHERE id = ?").get(leadId) as any;
      if (leadEmailRow?.email) {
        const { jobQueue } = await import("../queue/jobQueue");
        const { JOB_TYPES } = await import("../queue/jobs");
        jobQueue.enqueue(
          JOB_TYPES.SEND_MEETING_CONFIRMATION,
          {
            leadId,
            campaignId: leadEmailRow.campaign_id,
            recipientEmail: leadEmailRow.email,
          },
          { delayMs: 0 },
        );
        logActivity("meeting_confirmation_email_enqueued", "campaign", { leadId });
      }
    } catch (e) {
      console.warn("[Messenger] Could not enqueue meeting confirmation email:", e);
    }
  }

  // Persist updated state
  db.prepare(`
    UPDATE leads SET interaction_count = ?, chatbot_state = ? WHERE id = ?
  `).run(messageCount, newState, leadId);

  logActivity("chatbot_reply_processed", "linkedin", {
    leadId,
    leadName: `${profile.firstName} ${profile.lastName}`,
    sentiment: analysis.sentiment,
    intent: analysis.intent,
    previousState: currentState,
    newState,
    objective,
    action,
    messageCount,
  });

  return { reply, newState, action };
}


/**
 * Send initial welcome DM after connection is accepted via Inbox search.
 */
export async function sendWelcomeDM(
  profile: LinkedInProfile,
  context: {
    yourName: string;
    yourCompany: string;
    yourServices: string;
    objectiveOverride?: "follow_up_1" | "follow_up_2" | "follow_up_3";
  },
  settings: AppSettings,
): Promise<{ success: boolean; message: string }> {
  const db = getDatabase();
  const page = getPage();
  if (!page) return { success: false, message: "Browser not launched" };

  try {
    // 1. Inbox Navigation
    await inPageNavigate(page, "https://www.linkedin.com/messaging/");
    await pageLoadDelay();
    await humanDelay(1500, 3000);

    // 2. Search by Name
    console.log(`[Messenger] Searching inbox for lead: ${profile.firstName} ${profile.lastName}`);
    const searchSelectors = [
      'input.msg-search-form__search-field',
      '[placeholder*="Search messages"]',
      'input[role="combobox"]',
    ];
    
    let searchInput;
    for (const sel of searchSelectors) {
      searchInput = await page.$(sel).catch(() => null);
      if (searchInput) break;
    }

    if (!searchInput) {
      throw new Error("Message search bar not found");
    }

    // Type the name to search
    await humanClick(page, searchInput as any);
    await humanDelay(300, 600);

    // Clear just in case
    await page.keyboard.down("Meta");
    await page.keyboard.press("a");
    await page.keyboard.up("Meta");
    await page.keyboard.press("Backspace");
    await humanDelay(200, 400);

    const fullName = `${profile.firstName} ${profile.lastName}`.trim();
    for (const char of fullName) {
      await page.keyboard.type(char, { delay: 60 + Math.random() * 50 });
    }
    
    // Pause briefly before pressing Enter
    await humanDelay(2000, 3000);

    // Press Enter to submit search
    await page.keyboard.press("Enter");
    
    // Wait 8-10s for search results to fully load as requested
    console.log(`[Messenger] Waiting 8-10 seconds for search results...`);
    await humanDelay(8000, 10000);

    // Look for search results and click the first matching profile
    const resultItem = await page.waitForSelector('.msg-conversation-listitem, .msg-conversations-list-item, [data-view-name="message-list-item"]', { timeout: 12000 }).catch(() => null);

    if (!resultItem) {
      console.warn(`[Messenger] No search results found for ${fullName} in inbox.`);
      throw new Error("No search results found â€” lead may not exist in inbox yet");
    }

    await humanClick(page, resultItem as any);
    await humanDelay(2000, 3500);

    // 3. Thread Context Extraction â€” scroll up to load full history first
    await humanDelay(1000, 1800);
    // Scroll the message list to the very top so ALL messages are loaded
    await page.evaluate(() => {
      const msgList = document.querySelector('.msg-s-message-list, .msg-s-message-list-container, [data-view-name="conversation"]');
      if (msgList) msgList.scrollTop = 0;
      else window.scrollTo(0, 0);
    }).catch(() => null);
    await humanDelay(1500, 2500); // LinkedIn lazy-loads older messages on scroll

    let history: Array<{role: 'user' | 'assistant', content: string}> = [];
    const messages = await page.evaluate(() => {
      const msgs: Array<{sender: string, text: string}> = [];
      // Cast a wide net â€” include all event types
      const blocks = document.querySelectorAll(
        '.msg-s-message-list__event, .msg-s-message-group, .msg-s-event-listitem'
      );
      blocks.forEach(block => {
        const senderEl =
          block.querySelector('.msg-s-message-group__name') ||
          block.querySelector('.msg-s-message-list-item__user-name') ||
          block.querySelector('[data-test-id="message-sender-name"]');

        const textElements = block.querySelectorAll(
          '.msg-s-event-listitem__body, .msg-s-event__content p, .msg-s-event__content span, p'
        );

        const texts: string[] = [];
        textElements.forEach(el => {
          const t = el.textContent?.trim();
          if (t && t.length > 0) texts.push(t);
        });

        // Deduplicate nested elements that share the same text
        const unique = [...new Set(texts)];

        if (unique.length > 0) {
          msgs.push({
            sender: senderEl?.textContent?.trim() || 'Unknown',
            text: unique.join(' '),
          });
        }
      });
      return msgs;
    });

    // Determine who is 'user' (the lead) and who is 'assistant' (us)
    const myNamePart = context.yourName.split(' ')[0].toLowerCase();
    for (const msg of messages) {
      const senderLower = msg.sender.toLowerCase();
      const role = (senderLower.includes('you') || senderLower.includes(myNamePart))
        ? 'assistant'
        : 'user';
      history.push({ role, content: msg.text });
    }

    // Deduplicate consecutive duplicate messages (LinkedIn DOM can render duplicates)
    history = history.filter((m, i) =>
      i === 0 || m.content !== history[i - 1].content
    );

    console.log(`[Messenger] Full thread loaded: ${history.length} message(s) extracted.`);
    if (history.length > 0) {
      console.log('[Messenger] Conversation history:');
      history.forEach((m, i) => {
        const label = m.role === 'assistant' ? `[You]` : `[Lead]`;
        console.log(`  ${i + 1}. ${label} ${m.content.substring(0, 120)}${m.content.length > 120 ? '...' : ''}`);
      });
    }

    // 4. AI Generation
    db.prepare(`
      UPDATE leads SET interaction_count = 1, chatbot_state = 'initial_message' WHERE id = ?
    `).run(profile.id);

    // Determine objective based on conversation state
    let objective: 'build_rapport' | 'share_value' | 'suggest_meeting' | 'book_appointment' | 'follow_up_1' | 'follow_up_2' | 'follow_up_3' = 'build_rapport';
    const userHasReplied = history.some(m => m.role === 'user');
    const assistantCount = history.filter(m => m.role === 'assistant').length;

    if (context.objectiveOverride) {
      objective = context.objectiveOverride;
    } else {
      if (assistantCount === 0 && !userHasReplied) {
      objective = 'build_rapport';   // Fresh thread â€” open with rapport
    } else if (assistantCount >= 1 && userHasReplied && assistantCount < 3) {
      objective = 'share_value';     // They replied â€” demonstrate value
      } else if (assistantCount >= 3) {
        objective = 'suggest_meeting';
      }
    }

    const welcomeMessage = await generateChatbotReply(
      profile,
      history,
      { ...context, objective },
      settings.ai,
    );

    // â”€â”€ Log the generated message before sending â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    console.log(`\n[Messenger] â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`);
    console.log(`[Messenger] AI-GENERATED MESSAGE (objective: ${objective})`);
    console.log(`[Messenger] â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€`);
    console.log(`[Messenger] "${welcomeMessage}"`);
    console.log(`[Messenger] â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n`);

    // 5. Human-like Typing & Sending
    const composeBox = await page.waitForSelector(
      '.msg-form__contenteditable, [contenteditable="true"][role="textbox"], .msg-form__msg-content-container [contenteditable]',
      { timeout: 8000 }
    ).catch(() => null);

    if (!composeBox) {
      throw new Error("Compose text box not found after selecting thread");
    }

    console.log(`[Messenger] Typing AI message into compose box...`);
    await humanTypeSlowly(page, '.msg-form__contenteditable, [contenteditable="true"][role="textbox"]', welcomeMessage);
    await humanDelay(1000, 2000);

    const sendBtn = await page.waitForSelector(
      'button.msg-form__send-button:not([disabled])',
      { timeout: 5000 }
    ).catch(() => null);

    if (sendBtn) {
      await humanClick(page, sendBtn as any);
      await humanDelay(1500, 2500);
      
      // 6. State Updates (do not override to waiting_reply if we are already in follow-up)
      if (!context.objectiveOverride) {
        db.prepare(`UPDATE leads SET chatbot_state = 'waiting_reply' WHERE id = ?`).run(profile.id);
      }
      
      return { success: true, message: welcomeMessage };
    } else {
      // Fallback to Enter key
      await page.keyboard.press("Enter");
      await humanDelay(1500, 2000);
      
      if (!context.objectiveOverride) {
        db.prepare(`UPDATE leads SET chatbot_state = 'waiting_reply' WHERE id = ?`).run(profile.id);
      }
      
      return { success: true, message: welcomeMessage };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logActivity("welcome_dm_failed", "linkedin", { leadId: profile.id, error: msg }, "error", msg);
    return { success: false, message: msg };
  }
}

/**
 * Mark a conversation as handed off to human
 */
export function handoffConversation(leadId: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE leads SET status = 'handed_off', chatbot_state = 'handed_off', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?
  `).run(leadId);
}

/**
 * Proactively check a lead's thread to see if they replied.
 * Useful for bypassing the unread messages badge which can be unreliable.
 */
export async function checkLeadThreadForReply(
  leadId: string,
  profile: LinkedInProfile,
  context: { yourName: string; yourCompany: string; yourServices: string },
  settings: AppSettings
): Promise<{ checked: boolean; replied: boolean; action?: string; error?: string }> {
  const db = getDatabase();
  const page = getPage();
  if (!page) return { checked: false, replied: false, error: "Browser not launched" };

  try {
    // 1. Inbox Navigation
    await inPageNavigate(page, "https://www.linkedin.com/messaging/");
    await pageLoadDelay();
    await humanDelay(1500, 3000);

    // 2. Search by Name
    console.log(`[Messenger] Checking thread for engaged lead: ${profile.firstName} ${profile.lastName}`);
    const searchSelectors = [
      'input.msg-search-form__search-field',
      '[placeholder*="Search messages"]',
      'input[role="combobox"]',
    ];
    
    let searchInput;
    for (const sel of searchSelectors) {
      searchInput = await page.$(sel).catch(() => null);
      if (searchInput) break;
    }

    if (!searchInput) {
      throw new Error("Message search bar not found");
    }

    await humanClick(page, searchInput as any);
    await humanDelay(300, 600);

    await page.keyboard.down("Meta");
    await page.keyboard.press("a");
    await page.keyboard.up("Meta");
    await page.keyboard.press("Backspace");
    await humanDelay(200, 400);

    const fullName = `${profile.firstName} ${profile.lastName}`.trim();
    for (const char of fullName) {
      await page.keyboard.type(char, { delay: 60 + Math.random() * 50 });
    }
    
    await humanDelay(2000, 3000);
    await page.keyboard.press("Enter");
    
    // Wait 8-10s for search results to fully load
    console.log(`[Messenger] Waiting 8-10 seconds for search results...`);
    await humanDelay(8000, 10000);

    const resultItem = await page.waitForSelector('.msg-conversation-listitem, .msg-conversations-list-item, [data-view-name="message-list-item"]', { timeout: 12000 }).catch(() => null);

    if (!resultItem) {
      return { checked: true, replied: false, error: "Thread not found in inbox" };
    }

    await humanClick(page, resultItem as any);
    await humanDelay(2000, 3500);

    // 3. Extract Context
    await humanDelay(1000, 1800);
    await page.evaluate(() => {
      const msgList = document.querySelector('.msg-s-message-list, .msg-s-message-list-container, [data-view-name="conversation"]');
      if (msgList) msgList.scrollTop = 0;
      else window.scrollTo(0, 0);
    }).catch(() => null);
    await humanDelay(1500, 2500);

    const messages = await page.evaluate((leadName: string) => {
      const msgs: Array<{sender: string, text: string}> = [];
      const bubbles = Array.from(document.querySelectorAll('.msg-s-event-listitem__message-bubble, [class*="message-bubble"]'));
      
      let lastSender = 'Unknown';
      let currentIsMe = false;
      const leadNameLower = leadName.toLowerCase().trim();
      const leadFirstName = leadNameLower.split(' ')[0];

      for (const bubble of bubbles) {
        // 1. Extract text
        const paragraphs = bubble.querySelectorAll('p');
        if (paragraphs.length === 0) continue;

        const textParts: string[] = [];
        paragraphs.forEach(p => {
          if (
            p.closest('button') || p.closest('[class*="reaction"]') ||
            p.closest('[class*="toolbar"]') || p.closest('[class*="emoji"]') ||
            p.closest('[class*="quick-reply"]') || p.closest('[class*="actions"]')
          ) return;
          const t = (p.textContent || '').trim();
          if (t && t.length > 0) textParts.push(t);
        });

        let messageText = textParts.join('\n').trim();
        if (!messageText || messageText.length < 1) continue;

        // 2. Traverse up
        const group = bubble.closest('.msg-s-message-group, .msg-s-message-list__event, li.msg-s-message-list__event');
        if (!group) continue;

        // 3. Find sender name
        let extractedName = '';
        const img = group.querySelector('img[alt]');
        const link = group.querySelector('a[href*="/in/"]');
        
        const altText = img?.getAttribute('alt') || '';
        const ariaText = link?.getAttribute('aria-label') || link?.getAttribute('title') || '';
        
        const possibleNames = [altText, ariaText];
        for (const n of possibleNames) {
          if (!n) continue;
          const cleaned = n.replace(/profile picture of/i, '')
                           .replace(/photo of/i, '')
                           .replace(/view/i, '')
                           .replace(/['"]?s profile/i, '')
                           .trim();
          if (cleaned.length > 2 && !cleaned.toLowerCase().includes('linkedin')) {
            extractedName = cleaned;
            break;
          }
        }

        if (!extractedName) {
          const clone = group.cloneNode(true) as HTMLElement;
          const bodyEls = clone.querySelectorAll('[class*="message-bubble"], .msg-s-event-listitem__body, .msg-s-message-group__list, ul');
          bodyEls.forEach(b => b.remove());
          
          let hText = (clone.textContent || '').replace(/\s+/g, ' ').trim();
          hText = hText.replace(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/ig, '');
          hText = hText.replace(/yesterday|today/ig, '');
          hText = hText.trim();
          
          if (hText.length > 2 && hText.length < 50) {
            extractedName = hText;
          }
        }

        // 4. Direction
        if (extractedName) {
          lastSender = extractedName;
          const eLower = extractedName.toLowerCase();
          
          if (eLower === 'you') {
            currentIsMe = true;
          } else if (
            eLower === leadNameLower || 
            leadNameLower.includes(eLower) || 
            eLower.includes(leadNameLower) || 
            (leadFirstName.length > 2 && eLower.includes(leadFirstName))
          ) {
            currentIsMe = false;
          } else {
            currentIsMe = true;
          }
        } else {
          const gCls = (group.className || '').toString();
          const bCls = (bubble.className || '').toString();
          if (gCls.includes('--viewer') || gCls.includes('outbound') || bCls.includes('right') || bCls.includes('self')) {
            currentIsMe = true;
          } else if (gCls.includes('--non-viewer') || gCls.includes('inbound') || bCls.includes('left') || bCls.includes('other')) {
            currentIsMe = false;
          }
        }

        msgs.push({
          sender: currentIsMe ? 'You' : lastSender,
          text: messageText,
        });
      }
      return msgs;
    }, fullName);

    const history: Array<{role: 'user' | 'assistant', content: string}> = [];
    for (const msg of messages) {
      const role = msg.sender === 'You' ? 'assistant' : 'user';
      if (history.length === 0 || history[history.length - 1].content !== msg.text) {
        history.push({ role, content: msg.text });
      }
    }

    if (history.length === 0) return { checked: true, replied: false };

    const lastMessage = history[history.length - 1];

    if (lastMessage.role === 'assistant') {
      console.log(`[Messenger] Thread verified: No new replies from ${fullName}.`);
      return { checked: true, replied: false };
    }

    // 4. Verification: User replied. Check if we ALREADY recorded this in DB.
    const lastDbMessage = db.prepare("SELECT content, direction FROM conversations WHERE lead_id = ? ORDER BY sent_at DESC LIMIT 1").get(leadId) as any;
    
    // If the DB says the last message was outbound OR the text doesn't match the new inbound text, process it.
    if (!lastDbMessage || lastDbMessage.direction === 'outbound' || lastDbMessage.content !== lastMessage.content) {
      console.log(`[Messenger] NEW reply detected from ${fullName} in thread checking! Processing...`);
      
      const pchatResult = await processChatbotMessage(
        leadId,
        profile,
        lastMessage.content,
        context,
        settings
      );

      // If we got a reply from AI, type it directly here instead of enqueueing since thread is open!
      if (pchatResult.action === 'reply' && pchatResult.reply) {
        console.log(`[Messenger] Typing AI message into compose box...`);
        const composeBox = await page.waitForSelector(
          '.msg-form__contenteditable, [contenteditable="true"][role="textbox"]',
          { timeout: 8000 }
        ).catch(() => null);

        if (composeBox) {
          await humanTypeSlowly(page, '.msg-form__contenteditable, [contenteditable="true"][role="textbox"]', pchatResult.reply);
          await humanDelay(1000, 2000);

          const sendBtn = await page.$('button.msg-form__send-button:not([disabled])');
          if (sendBtn) {
             await humanClick(page, sendBtn as any);
          } else {
             await page.keyboard.press("Enter");
          }
          await humanDelay(1500, 2500);

          // Update DB - Record our outbound reply
          db.prepare(`
            INSERT INTO conversations (id, lead_id, direction, content, platform, is_automated, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(uuid(), leadId, 'outbound', pchatResult.reply, 'linkedin', 1, new Date().toISOString());

          db.prepare(`UPDATE leads SET chatbot_state = 'waiting_reply' WHERE id = ?`).run(leadId);
        }
      }
      return { checked: true, replied: true, action: pchatResult.action };
    }

    console.log(`[Messenger] Reply from ${fullName} was already processed previously.`);
    return { checked: true, replied: false };

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logActivity("thread_check_failed", "linkedin", { leadId, error: msg }, "error", msg);
    return { checked: false, replied: false, error: msg };
  }
}
/**
 * Scrape ALL conversations from the LinkedIn messaging sidebar.
 * Uses the inbox browser page — never touches the campaign browser.
 * Delegates to the inboxScraper module which uses DOM-agnostic discovery.
 */
export async function scrapeAllLinkedInConversations(
  page: import('puppeteer-core').Page,
  lastSyncAllAt: number | null = null,
): Promise<Array<{
  name: string;
  headline: string;
  avatarUrl: string;
  threadUrl: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}>> {
  const { scrapeInboxConversations } = await import('./inboxScraper');
  return scrapeInboxConversations(page as any, lastSyncAllAt);
}



/**
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * INBOX BROWSER FUNCTIONS
 * These variants accept an explicit `page` parameter (the inbox browser page)
 * so they never touch the campaign browser (getPage()).
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

/**
 * Send a message in a LinkedIn thread using the inbox browser page.
 * Identical to sendReplyInThread() but takes an explicit Page parameter.
 */
export async function sendReplyInThreadOnPage(
  page: import('puppeteer-core').Page,
  threadId: string,
  message: string,
  options: { isAutomated?: boolean; leadId?: string; fullName?: string } = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    let threadUrl = threadId;
    if (!threadId.startsWith("http")) {
      threadUrl = `https://www.linkedin.com/messaging/thread/${threadId}/`;
    }

    // Helper: perform name-based inbox search and click first result
    const navigateViaSearch = async (): Promise<boolean> => {
      if (!options.fullName) return false;
      console.log(`[InboxSend] Navigating to inbox and searching for: ${options.fullName}`);
      await inPageNavigate(page as any, "https://www.linkedin.com/messaging/");
      await pageLoadDelay();
      await humanDelay(1500, 2500);

      const searchSelectors = [
        'input.msg-search-form__search-field',
        '[placeholder*="Search messages"]',
        'input[role="combobox"]',
      ];

      let searchInput: any = null;
      for (const sel of searchSelectors) {
        searchInput = await page.$(sel).catch(() => null);
        if (searchInput) break;
      }

      if (searchInput) {
        await humanClick(page as any, searchInput);
        await humanDelay(300, 600);
        await page.keyboard.down("Control");
        await page.keyboard.press("a");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");
        await humanDelay(200, 400);

        const cleanName = options.fullName.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
        for (const char of cleanName) {
          await page.keyboard.type(char, { delay: 55 + Math.random() * 45 });
        }
        await humanDelay(2000, 3000);
        await page.keyboard.press("Enter");
        await humanDelay(8000, 10000);
      }

      const resultItem = await page.waitForSelector(
        '.msg-conversation-listitem, .msg-conversations-list-item, [data-view-name="message-list-item"]',
        { timeout: 12000 }
      ).catch(() => null);

      if (!resultItem) return false;

      await humanClick(page as any, resultItem as any);
      await humanDelay(2000, 3500);

      // Save thread URL for future direct navigation
      const resolvedUrl = page.url();
      if (resolvedUrl && resolvedUrl.includes('/messaging/thread/') && options.leadId) {
        const db = getDatabase();
        db.prepare("UPDATE leads SET thread_url = ? WHERE id = ?").run(resolvedUrl, options.leadId);
        db.prepare("UPDATE inbox_contacts SET thread_url = ? WHERE lead_id = ?").run(resolvedUrl, options.leadId);
      }
      return true;
    };

    if (!isValidLinkedInThreadUrl(threadUrl) && options.fullName) {
      // Invalid or placeholder URL — always use name-based search
      console.log(`[InboxSend] Invalid/placeholder thread URL ("${threadUrl}"). Falling back to search for: ${options.fullName}`);
      const found = await navigateViaSearch();
      if (!found) {
        return { success: false, error: "Could not find conversation via search" };
      }
    } else {
      // Direct navigation attempt with a valid LinkedIn thread URL
      await inPageNavigate(page as any, threadUrl);
      await pageLoadDelay();
      await humanDelay(1200, 2500);
    }

    let composeBox = await page.waitForSelector(
      [
        '.msg-form__contenteditable',
        '[contenteditable="true"][role="textbox"]',
        '.msg-form__msg-content-container [contenteditable]',
        'div[data-placeholder*="Write a message"]',
        'div[data-placeholder*="message"]',
        '.msg-form [contenteditable]',
      ].join(", "),
      { timeout: 10000 }
    ).catch(() => null);

    // If compose box not found (LinkedIn "conversation failed to load" error), retry via name search
    if (!composeBox && options.fullName) {
      console.warn(`[InboxSend] Compose box not found after direct nav — LinkedIn may have shown an error. Retrying via search for: ${options.fullName}`);
      const found = await navigateViaSearch();
      if (!found) {
        return { success: false, error: "Could not find conversation via search after direct nav failed" };
      }
      composeBox = await page.waitForSelector(
        [
          '.msg-form__contenteditable',
          '[contenteditable="true"][role="textbox"]',
          '.msg-form__msg-content-container [contenteditable]',
          'div[data-placeholder*="Write a message"]',
          'div[data-placeholder*="message"]',
          '.msg-form [contenteditable]',
        ].join(", "),
        { timeout: 10000 }
      ).catch(() => null);
    }

    if (!composeBox) {
      return { success: false, error: "Compose box not found in thread — LinkedIn conversation may be unavailable" };
    }

    await humanClick(page as any, composeBox as any);
    await humanDelay(400, 900);

    for (const char of message) {
      await page.keyboard.type(char);
      const delay = 45 + Math.random() * 90;
      await new Promise((r) => setTimeout(r, delay));
      if (Math.random() < 0.04) await humanDelay(150, 400);
    }

    await thinkingDelay();

    // Click send button
    const sendSelectors = [
      'button[type="submit"].msg-form__send-button',
      'button.msg-form__send-button',
      'button[aria-label="Send"]',
      'button[aria-label*="Send message"]',
      '.msg-form__send-btn',
    ];
    let sent = false;
    for (const sel of sendSelectors) {
      const btn = await page.$(sel);
      if (btn) { await humanClick(page as any, btn as any); sent = true; break; }
    }
    if (!sent) {
      await page.keyboard.press("Enter");
    }

    // Wait for the message to actually send (compose box clears)
    try {
      await page.waitForFunction(
        () => {
          const boxes = document.querySelectorAll('.msg-form__contenteditable, [contenteditable="true"][role="textbox"], .msg-form__msg-content-container [contenteditable], .msg-form [contenteditable]');
          for (const box of Array.from(boxes)) {
            if (box.textContent && box.textContent.trim().length > 0) return false;
          }
          return true;
        },
        { timeout: 8000 }
      );
    } catch (e) {
      console.warn('[Inbox] Compose box did not clear in time after sending');
    }

    await humanDelay(1500, 2500);

    if (options.leadId) {
      try {
        const db = getDatabase();
        const isoNow = new Date().toISOString();
        const crypto = require('crypto');
        
        // Ensure lead exists for FK constraint safety
        const leadExists = db.prepare('SELECT id FROM leads WHERE id = ?').get(options.leadId);
        if (!leadExists && options.fullName) {
          const nameParts = options.fullName.trim().split(' ');
          db.prepare(`
            INSERT OR IGNORE INTO leads (id, linkedin_url, first_name, last_name, thread_url, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(options.leadId, threadUrl || `inbox-${options.leadId}`, nameParts[0] || '', nameParts.slice(1).join(' ') || '', threadUrl || '', 'in_conversation', isoNow, isoNow);
          console.log(`[InboxSend] Created lead skeleton for FK safety: ${options.leadId}`);
        }

        db.prepare(`
          INSERT INTO conversations (id, lead_id, direction, content, platform, is_automated, sent_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), options.leadId, 'outbound', message, 'linkedin', options.isAutomated ? 1 : 0, isoNow);

        // ALSO update the inbox_contacts table with the new message preview and timestamp
        // so the left sidebar correctly shows the message we just sent.
        db.prepare(`
          UPDATE inbox_contacts 
          SET last_message = ?, last_message_at = ?, has_new_messages = 0, needs_reply = 0, conversation_fully_fetched = 1, synced_at = ?
          WHERE lead_id = ?
        `).run(`You: ${message}`.slice(0, 200), isoNow, isoNow, options.leadId);

        // Mark lead as handed off to human (manual send stops AI chatbot)
        if (!options.isAutomated) {
          db.prepare(`
            UPDATE leads SET status = 'in_conversation', chatbot_state = 'handed_off', updated_at = ?
            WHERE id = ? AND chatbot_state != 'handed_off'
          `).run(isoNow, options.leadId);
        }
      } catch (dbErr) {
        console.error('[InboxSend] DB update failed after successful send:', dbErr);
        // We do NOT throw here! The message was successfully sent on LinkedIn.
        // Returning success: false would cause the UI to revert the message into the textbox.
        // The subsequent syncThread call will repair the DB state anyway.
      }
    }

    logActivity("inbox_manual_reply_sent", "inbox", {
      threadId,
      messageLength: message.length,
      isAutomated: options.isAutomated ?? false,
    });

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logActivity("inbox_manual_reply_failed", "inbox", { threadId, error: msg }, "error", msg);
    return { success: false, error: msg };
  }
}

/**
 * Scrape a lead's full LinkedIn thread using the inbox browser page.
 * Saves/updates messages in the conversations table.
 * Returns the full conversation history from DB.
 *
 * Uses the inbox browser page (passed explicitly) â€” never touches campaign browser.
 */
/**
 * Returns true only if `url` is a genuine LinkedIn messaging thread URL.
 * Placeholder/fake URLs (e.g. "inbox-<uuid>" or anything that doesn't contain
 * "linkedin.com/messaging/thread/") are considered invalid and will trigger
 * the name-based search fallback instead of a direct goto().
 */
function isValidLinkedInThreadUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname.includes('linkedin.com') && u.pathname.includes('/messaging/thread/');
  } catch {
    return false;
  }
}

export async function scrapeAndSaveThread(
  leadId: string,
  fullName: string,
  page: import('puppeteer-core').Page,
  threadUrl?: string,
  /** Epoch ms — only fetch messages newer than this (incremental sync) */
  stopAtTimestamp: number | null = null
): Promise<Array<{
  id: string;
  leadId: string;
  direction: string;
  content: string;
  platform: string;
  isAutomated: boolean;
  sentAt: string;
}>> {
  const db = getDatabase();

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // PRIMARY PATH — Voyager API
    // Attempt to fetch full message history directly from LinkedIn's internal
    // API using the conversationId extracted from the thread URL.
    // This is invisible to LinkedIn's anti-bot detection because the fetch()
    // runs inside the browser's own context with all native cookies/headers.
    // ══════════════════════════════════════════════════════════════════════════
    const { extractConversationIdFromUrl, fetchFullThreadHistory } = await import('./voyagerClient');
    const conversationId = threadUrl ? extractConversationIdFromUrl(threadUrl) : null;

    if (conversationId) {
      console.log(`[InboxScrape] Voyager API: fetching thread for "${fullName}" (id=${conversationId})`);

      // Ensure the browser is on a linkedin.com page so cookies are available
      const currentUrl = page.url();
      if (!currentUrl.includes('linkedin.com')) {
        await inPageNavigate(page as any, 'https://www.linkedin.com/messaging/');
        await pageLoadDelay();
        await humanDelay(1000, 1500);
      }

      const voyagerMessages = await fetchFullThreadHistory(
        page as any,
        conversationId,
        stopAtTimestamp
      );

      if (voyagerMessages.length > 0) {
        console.log(`[InboxScrape] Voyager API returned ${voyagerMessages.length} messages for "${fullName}".`);

        // Full-replace strategy — same as DOM path
        db.prepare('DELETE FROM conversations WHERE lead_id = ?').run(leadId);

        const insertStmt = db.prepare(`
          INSERT INTO conversations (id, lead_id, direction, content, platform, is_automated, sent_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const msg of voyagerMessages) {
          insertStmt.run(uuid(), leadId, msg.isMe ? 'outbound' : 'inbound', msg.text, 'linkedin', 0, msg.timestamp);
        }

        console.log(`[InboxScrape] Thread saved via Voyager for "${fullName}": ${voyagerMessages.length} messages.`);
        logActivity('inbox_thread_synced', 'inbox', { leadId, fullName, newMessages: voyagerMessages.length, method: 'voyager' });

        return db.prepare(
          'SELECT id, lead_id, direction, content, platform, is_automated, sent_at FROM conversations WHERE lead_id = ? ORDER BY sent_at ASC'
        ).all(leadId).map((r: any) => ({
          id: r.id, leadId: r.lead_id, direction: r.direction, content: r.content,
          platform: r.platform, isAutomated: !!r.is_automated, sentAt: r.sent_at,
        }));
      }

      console.warn(`[InboxScrape] Voyager API returned 0 messages for "${fullName}" — falling back to DOM scrape.`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FALLBACK PATH — DOM-based name search + scroll
    // Used when: no conversationId available, or Voyager returned 0 results.
    // ══════════════════════════════════════════════════════════════════════════

    // 1. Navigate to messaging hub
    await inPageNavigate(page as any, "https://www.linkedin.com/messaging/");
    await pageLoadDelay();
    await humanDelay(1500, 2500);

    // 2. Type lead name into the search box
    console.log(`[InboxScrape] Searching inbox for: ${fullName}`);
    const searchSelectors = [
      'input.msg-search-form__search-field',
      '[placeholder*="Search messages"]',
      'input[role="combobox"]',
    ];

    let searchInput: any = null;
    for (const sel of searchSelectors) {
      searchInput = await page.$(sel).catch(() => null);
      if (searchInput) break;
    }

    if (searchInput) {
      await humanClick(page as any, searchInput);
      await humanDelay(300, 600);
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await humanDelay(200, 400);

      const cleanName = fullName.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
      console.log(`[InboxScrape] Typing cleaned name: "${cleanName}"`);

      for (const char of cleanName) {
        await page.keyboard.type(char, { delay: 55 + Math.random() * 45 });
      }
      await humanDelay(2000, 3000);
      await page.keyboard.press('Enter');
      console.log(`[InboxScrape] Waiting 6-7 seconds for search results to load...`);
      await humanDelay(6000, 7000);
    }

    // 3. Click the first matching conversation result
    const resultItem = await page.waitForSelector(
      '.msg-conversation-listitem, .msg-conversations-list-item, [data-view-name="message-list-item"]',
      { timeout: 12000 }
    ).catch(() => null);

    if (!resultItem) {
      console.warn(`[InboxScrape] No thread found for "${fullName}" — falling back to cached DB messages.`);
      return db.prepare(
        'SELECT id, lead_id, direction, content, platform, is_automated, sent_at FROM conversations WHERE lead_id = ? ORDER BY sent_at ASC'
      ).all(leadId).map((r: any) => ({
        id: r.id, leadId: r.lead_id, direction: r.direction, content: r.content,
        platform: r.platform, isAutomated: !!r.is_automated, sentAt: r.sent_at,
      }));
    }

    await humanClick(page as any, resultItem as any);
    await humanDelay(2000, 3500);

    await page.waitForSelector('.msg-s-message-list-content, .msg-s-message-list, .msg-s-message-list-container', { timeout: 15000 }).catch(() => null);
    await humanDelay(200, 300);

    // 4. Save thread URL for future direct navigation
    const currentThreadUrl = page.url();
    if (currentThreadUrl && currentThreadUrl.includes('/messaging/thread/')) {
      db.prepare('UPDATE leads SET thread_url = ? WHERE id = ?').run(currentThreadUrl, leadId);
      db.prepare('UPDATE inbox_contacts SET thread_url = ? WHERE lead_id = ?').run(currentThreadUrl, leadId);
    }

    // 5. Scroll to TOP repeatedly until all older messages are loaded
    console.log(`[InboxScrape] DOM: Scrolling to load full chat history for "${fullName}"...`);
    let previousHeight = -1;
    for (let scrollAttempt = 0; scrollAttempt < 15; scrollAttempt++) {
      const currentHeight = await page.evaluate(() => {
        const msgList =
          document.querySelector('.msg-s-message-list-content') ||
          document.querySelector('.msg-s-message-list') ||
          document.querySelector('.msg-s-message-list-container');
        if (!msgList) return 0;
        msgList.scrollTop = 0;
        return msgList.scrollHeight;
      }).catch(() => 0);

      if (currentHeight === previousHeight) {
        console.log(`[InboxScrape] Full history loaded after ${scrollAttempt + 1} scroll(s).`);
        break;
      }
      previousHeight = currentHeight;
      await humanDelay(1500, 2000);
    }

    // 6. Extract ALL messages from the fully loaded chat
    const rawMessages = await page.evaluate((leadName: string) => {
      const msgs: Array<{ sender: string; text: string; timestamp: string; isMe: boolean }> = [];

      const msgList =
        document.querySelector('.msg-s-message-list-content') ||
        document.querySelector('.msg-s-message-list') ||
        document.querySelector('.msg-s-message-list-container');

      if (!msgList) return msgs;

      function parseDateHeading(raw: string): string {
        const text = raw.replace(/[\u200B-\u200D\uFEFF\n\r]/g, '').trim();
        const lower = text.toLowerCase();
        if (lower === 'today') return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (lower === 'yesterday') {
          const d = new Date(Date.now() - 86400000);
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        for (let i = 0; i < days.length; i++) {
          if (lower === days[i] || lower.startsWith(days[i])) {
            const currentDay = new Date().getDay();
            let daysAgo = currentDay - i;
            if (daysAgo <= 0) daysAgo += 7;
            const d = new Date(Date.now() - daysAgo * 86400000);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }
        }
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const parts = lower.split(/[\s,]+/);
        for (const part of parts) {
          if (part.length >= 3 && months.includes(part.substring(0, 3))) return text;
        }
        return '';
      }

      function buildISO(dateStr: string, timeStr: string): string {
        const year = new Date().getFullYear();
        const d = new Date(`${dateStr}, ${year} ${timeStr}`);
        if (!isNaN(d.getTime())) {
          if (d.getTime() > Date.now() + 86400000) d.setFullYear(year - 1);
          return d.toISOString();
        }
        const fallback = new Date(`${new Date().toDateString()} ${timeStr}`);
        return isNaN(fallback.getTime()) ? new Date().toISOString() : fallback.toISOString();
      }

      function extractTimeFromA11y(el: Element): string {
        const text = (el.textContent || '').trim();
        const m = text.match(/\bat\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
        return m ? m[1].trim() : '';
      }

      let currentDateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      let lastParsedTimestamp = 0;
      let lastKnownGroupTimestamp = '';

      const eventLIs = Array.from(msgList.querySelectorAll(':scope > li, .msg-s-message-list__event'));

      for (const li of eventLIs) {
        const dateHeadingEl = li.querySelector('time.msg-s-message-list__time-heading');
        if (dateHeadingEl) {
          const parsed = parseDateHeading((dateHeadingEl.textContent || '').trim());
          if (parsed) currentDateStr = parsed;
        }

        const eventDiv = li.querySelector('.msg-s-event-listitem');
        if (!eventDiv) continue;

        const isMe = !eventDiv.classList.contains('msg-s-event-listitem--other');

        let senderName = '';
        const nameEl = eventDiv.querySelector('.msg-s-message-group__name');
        if (nameEl) senderName = (nameEl.textContent || '').trim();
        if (!senderName) {
          const imgEl = li.querySelector('img.msg-s-event-listitem__profile-picture') as HTMLImageElement | null;
          if (imgEl) senderName = (imgEl.getAttribute('title') || imgEl.getAttribute('alt') || '').trim();
        }

        let groupTimeStr = '';
        const groupTimestampEl = li.querySelector('time.msg-s-message-group__timestamp');
        if (groupTimestampEl) groupTimeStr = (groupTimestampEl.textContent || '').trim();
        if (!groupTimeStr) {
          const a11yEl = li.querySelector('span.msg-s-event-listitem--group-a11y-heading');
          if (a11yEl) groupTimeStr = extractTimeFromA11y(a11yEl);
        }

        let groupTimestamp: string;
        if (groupTimeStr) {
          groupTimestamp = buildISO(currentDateStr, groupTimeStr);
          lastKnownGroupTimestamp = groupTimestamp;
        } else {
          groupTimestamp = lastKnownGroupTimestamp;
        }

        const bubbles = Array.from(li.querySelectorAll('.msg-s-event-listitem__message-bubble, [class*="message-bubble"]'));
        if (bubbles.length === 0) continue;

        let lastGroupTimestamp = groupTimestamp;

        for (const bubble of bubbles) {
          let text = '';
          const bodyParagraphs = bubble.querySelectorAll('p.msg-s-event-listitem__body');
          if (bodyParagraphs.length > 0) {
            const parts: string[] = [];
            bodyParagraphs.forEach(p => { const t = (p.textContent || '').trim(); if (t) parts.push(t); });
            text = parts.join('\n').trim();
          }
          if (!text) {
            const clone = bubble.cloneNode(true) as HTMLElement;
            ['.msg-s-event-listitem__actions-container','button','[class*="reaction"]','[class*="emoji"]','img','svg'].forEach(sel => {
              clone.querySelectorAll(sel).forEach(el => el.remove());
            });
            text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
            if (text.length > 500) text = text.slice(0, 500) + '... [Shared Content]';
            if (!text) text = bubble.querySelector('a') ? '[Shared Link/Post]' : '[Attachment/Media]';
          }
          if (!text) continue;

          let timestamp = lastGroupTimestamp || new Date().toISOString();
          if (lastGroupTimestamp && groupTimestamp) lastGroupTimestamp = groupTimestamp;

          let d = new Date(timestamp);
          if (isNaN(d.getTime())) d = new Date();
          else d.setSeconds(d.getSeconds() + msgs.length);

          if (lastParsedTimestamp > 0 && d.getTime() <= lastParsedTimestamp) {
            d = new Date(lastParsedTimestamp + 1000);
          }

          timestamp = d.toISOString();
          lastParsedTimestamp = d.getTime();

          msgs.push({ sender: isMe ? 'You' : (senderName || leadName), text, timestamp, isMe });
        }
      }

      return msgs;
    }, fullName);

    // 7. Save to DB
    if (rawMessages.length === 0) {
      console.warn(`[InboxScrape] No messages scraped for "${fullName}" — skipping DB update to avoid data loss.`);
    } else {
      db.prepare('DELETE FROM conversations WHERE lead_id = ?').run(leadId);

      const insertStmt = db.prepare(`
        INSERT INTO conversations (id, lead_id, direction, content, platform, is_automated, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const msg of rawMessages) {
        insertStmt.run(uuid(), leadId, msg.isMe ? 'outbound' : 'inbound', msg.text, 'linkedin', 0, msg.timestamp);
      }

      console.log(`[InboxScrape] DOM: Thread saved for "${fullName}": ${rawMessages.length} messages.`);
    }
    logActivity('inbox_thread_synced', 'inbox', { leadId, fullName, newMessages: rawMessages.length, method: 'dom' });

    return db.prepare(
      'SELECT id, lead_id, direction, content, platform, is_automated, sent_at FROM conversations WHERE lead_id = ? ORDER BY sent_at ASC'
    ).all(leadId).map((r: any) => ({
      id: r.id, leadId: r.lead_id, direction: r.direction, content: r.content,
      platform: r.platform, isAutomated: !!r.is_automated, sentAt: r.sent_at,
    }));

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logActivity('inbox_thread_scrape_failed', 'inbox', { leadId, fullName, error: msg }, 'error', msg);
    console.error(`[InboxScrape] Failed for "${fullName}":`, msg);

    return db.prepare(
      'SELECT id, lead_id, direction, content, platform, is_automated, sent_at FROM conversations WHERE lead_id = ? ORDER BY sent_at ASC'
    ).all(leadId).map((r: any) => ({
      id: r.id, leadId: r.lead_id, direction: r.direction, content: r.content,
      platform: r.platform, isAutomated: !!r.is_automated, sentAt: r.sent_at,
    }));
  }
}
