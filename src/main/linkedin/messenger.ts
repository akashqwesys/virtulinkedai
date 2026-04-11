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
  humanDelay,
  humanScroll,
  pageLoadDelay,
  thinkingDelay,
  randomIdleAction,
  inPageNavigate,
} from "../browser/humanizer";
import { generateChatbotReply, analyzeSentiment } from "../ai/personalizer";
import { logActivity } from "../storage/database";
import { v4 as uuid } from "uuid";

// Chatbot conversation state tracker
const conversationStates = new Map<
  string,
  {
    state: ChatbotState;
    messageCount: number;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    lastAutoReplyAt: Date | null;
    handedOff: boolean;
  }
>();

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

    // Find and click Message button — try multiple selectors
    const messageButton = await findMessageButton(page);

    if (!messageButton) {
      return {
        success: false,
        error: "Message button not found — may not be connected or profile not loaded",
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
        return { success: false, handedOff: true, error: "Human intervention detected — campaign paused for lead" };
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
  ];
  for (const sel of ariaSelectors) {
    const btn = await page.$(sel);
    if (btn) return btn;
  }

  // Strategy 2: data-control-name
  const dataBtn = await page.$('[data-control-name="message"]');
  if (dataBtn) return dataBtn;

  // Strategy 3: Text-based search in profile action area
  const textBtn = await page.evaluateHandle(() => {
    const containers = [
      ".pvs-profile-actions",
      ".pv-top-card-v2-ctas",
      ".pv-s-profile-actions",
      ".profile-header-actions",
      "main section:first-of-type",
    ];

    for (const sel of containers) {
      const container = document.querySelector(sel);
      if (!container) continue;
      const buttons = container.querySelectorAll("button, a");
      for (const btn of buttons) {
        if (btn.textContent?.trim().toLowerCase() === "message") return btn;
      }
    }

    // Wider fallback — any visible button with text "Message"
    const allButtons = document.querySelectorAll("button, a[href*='/messaging/']");
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
 * Read unread messages from LinkedIn messaging
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

    const threads = await page.evaluate(() => {
      // Try multiple selectors for conversation list items
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
        senderUrl: string;
        lastMessage: string;
        unreadCount: number;
        threadId: string;
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

        const linkEl = item.querySelector("a") as HTMLAnchorElement | null;
        const countEl =
          item.querySelector(".msg-conversation-card__unread-count") ||
          item.querySelector(".notification-badge");

        unreadThreads.push({
          senderName: nameEl?.textContent?.trim() || "Unknown",
          senderUrl: linkEl?.href || "",
          lastMessage: messageEl?.textContent?.trim() || "",
          unreadCount: parseInt(countEl?.textContent?.trim() || "1"),
          threadId: item.getAttribute("data-thread-id") || linkEl?.href || "",
        });
      });

      return unreadThreads;
    });

    logActivity("unread_messages_read", "linkedin", { unreadThreads: threads.length });
    return threads;
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
  let convo = conversationStates.get(leadId);
  if (!convo) {
    convo = {
      state: "waiting_reply",
      messageCount: 0,
      history: [],
      lastAutoReplyAt: null,
      handedOff: false,
    };
    conversationStates.set(leadId, convo);
  }

  if (convo.handedOff) {
    return { reply: null, newState: "handed_off", action: "handoff" };
  }

  convo.history.push({ role: "user", content: incomingMessage });
  convo.messageCount++;

  const analysis = await analyzeSentiment(incomingMessage, settings.ai);

  let objective: "build_rapport" | "share_value" | "suggest_meeting" = "build_rapport";
  let action: "reply" | "handoff" | "book_meeting" | "wait" = "reply";
  let newState: ChatbotState = "building_rapport";

  if (
    analysis.intent === "not_interested" ||
    analysis.sentiment === "negative"
  ) {
    if (settings.chatbot.handoffOnNegativeSentiment) {
      convo.handedOff = true;
      return { reply: null, newState: "handed_off", action: "handoff" };
    }
  }

  if (analysis.intent === "ready_to_meet") {
    action = "book_meeting";
    newState = "suggesting_meeting";
    objective = "suggest_meeting";
  } else if (analysis.intent === "interested" || analysis.intent === "curious") {
    if (convo.messageCount >= 3) {
      objective = "suggest_meeting";
      newState = "suggesting_meeting";
    } else {
      objective = "share_value";
      newState = "sharing_value";
    }
  } else if (analysis.intent === "question") {
    objective = "share_value";
    newState = "sharing_value";
  }

  if (convo.messageCount >= settings.chatbot.maxAutoMessages) {
    objective = "suggest_meeting";
    newState = "suggesting_meeting";
  }

  const reply = await generateChatbotReply(
    profile,
    convo.history,
    { ...context, objective },
    settings.ai,
  );

  convo.history.push({ role: "assistant", content: reply });
  convo.state = newState;
  convo.lastAutoReplyAt = new Date();

  logActivity("chatbot_reply_processed", "linkedin", {
    leadId,
    leadName: `${profile.firstName} ${profile.lastName}`,
    sentiment: analysis.sentiment,
    intent: analysis.intent,
    newState,
    action,
    messageCount: convo.messageCount,
  });

  return { reply, newState, action };
}

/**
 * Send initial welcome DM after connection is accepted.
 */
export async function sendWelcomeDM(
  profile: LinkedInProfile,
  context: {
    yourName: string;
    yourCompany: string;
    yourServices: string;
  },
  settings: AppSettings,
): Promise<{ success: boolean; message: string }> {
  conversationStates.set(profile.id, {
    state: "initial_message",
    messageCount: 1,
    history: [],
    lastAutoReplyAt: null,
    handedOff: false,
  });

  const welcomeMessage = await generateChatbotReply(
    profile,
    [],
    { ...context, objective: "build_rapport" },
    settings.ai,
  );

  const result = await sendMessage(profile.linkedinUrl, welcomeMessage, {
    isAutomated: true,
  });

  if (result.success) {
    const convo = conversationStates.get(profile.id);
    if (convo) {
      convo.history.push({ role: "assistant", content: welcomeMessage });
      convo.state = "waiting_reply";
    }
    return { success: true, message: welcomeMessage };
  } else {
    return { success: false, message: result.error || "Failed to send message" };
  }
}

/**
 * Mark a conversation as handed off to human
 */
export function handoffConversation(leadId: string): void {
  const convo = conversationStates.get(leadId);
  if (convo) {
    convo.handedOff = true;
    convo.state = "handed_off";
  }
}
