/**
 * Inbox Scraper — Hybrid LinkedIn messaging sidebar scraper
 *
 * Strategy:
 *   Phase 1A: Use LinkedIn's internal Voyager API (inside the browser context)
 *             to fetch the full conversation list as structured JSON.
 *             This gives us stable entityUrns, participant names, and last message data
 *             without touching the DOM at all.
 *
 *   Phase 1B: Fallback — if the API fetch returns no results (e.g. the page
 *             isn't on a linkedin.com context), fall back to the original
 *             DOM-based sidebar scraping + click-to-capture-URL mechanism.
 *
 *   In both cases the inboxScraper only populates the conversation LIST metadata
 *   (name, avatarUrl, threadUrl, lastMessage, lastMessageAt, unreadCount).
 *   Full message history is fetched separately by fetchFullThreadHistory().
 */

import type { Page } from 'puppeteer-core';
import { humanDelay } from '../browser/humanizer';
import { logActivity } from '../storage/database';
import {
  fetchConversationList,
  extractConversationIdFromUrl,
  type VoyagerConversation,
} from './voyagerClient';

export interface ScrapedConversation {
  name: string;
  headline: string;
  avatarUrl: string;
  threadUrl: string;
  lastMessage: string;
  lastMessageAt: string;  // Always ISO 8601 string
  unreadCount: number;
  sidebarPosition: number; // 0 = most recent (top of LinkedIn sidebar)
  /** Voyager conversation ID, e.g. "2-ABC123=" — present when fetched via API */
  conversationId?: string;
}

/**
 * Convert LinkedIn's various timestamp formats to an ISO string.
 *
 * LinkedIn uses:
 *  - "2:35 PM"          → today's date + time
 *  - "Yesterday"        → yesterday at noon
 *  - "Mon", "Tue", etc  → last occurrence of that weekday
 *  - "Jun 26"           → this year (or last year if future)
 *  - "2d ago", "4d ago" → N days ago
 *  - "1w ago", "2w ago" → N weeks ago
 *  - "1mo ago"          → 1 month ago
 *  - Full ISO string    → pass through
 *
 * Returns the ISO string, or now() as fallback.
 */
function linkedInTimeToISO(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return new Date().toISOString();

  // Already ISO
  if (s.includes('T') && s.includes(':') && s.length > 10) return s;

  const now = new Date();

  // "X min ago", "1h ago" — not used by LinkedIn sidebar usually, but handle
  const minsMatch = s.match(/^(\d+)\s*min/i);
  if (minsMatch) {
    const d = new Date(now.getTime() - parseInt(minsMatch[1]) * 60_000);
    return d.toISOString();
  }

  const hrsMatch = s.match(/^(\d+)h\s*ago/i);
  if (hrsMatch) {
    const d = new Date(now.getTime() - parseInt(hrsMatch[1]) * 3_600_000);
    return d.toISOString();
  }

  // "Xd ago" or "X days ago"
  const daysMatch = s.match(/^(\d+)\s*d(?:ay)?s?\s*ago/i);
  if (daysMatch) {
    const d = new Date(now.getTime() - parseInt(daysMatch[1]) * 86_400_000);
    return d.toISOString();
  }

  // "Xw ago"
  const weeksMatch = s.match(/^(\d+)\s*w(?:eek)?s?\s*ago/i);
  if (weeksMatch) {
    const d = new Date(now.getTime() - parseInt(weeksMatch[1]) * 7 * 86_400_000);
    return d.toISOString();
  }

  // "Xmo ago" / "X month ago"
  const moMatch = s.match(/^(\d+)\s*mo(?:nth)?s?\s*ago/i);
  if (moMatch) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - parseInt(moMatch[1]));
    return d.toISOString();
  }

  // "Yesterday"
  if (/^yesterday$/i.test(s)) {
    const d = new Date(now.getTime() - 86_400_000);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  }

  // Weekday names "Mon", "Tue", "Wed", etc. → within last 7 days
  const weekdays = ['sun','mon','tue','wed','thu','fri','sat'];
  const wdMatch = s.match(/^(sun|mon|tue|wed|thu|fri|sat)/i);
  if (wdMatch) {
    const targetWd = weekdays.indexOf(wdMatch[1].toLowerCase());
    const d = new Date(now);
    const currentWd = d.getDay();
    let daysBack = currentWd - targetWd;
    if (daysBack <= 0) daysBack += 7;
    d.setDate(d.getDate() - daysBack);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  }

  // Time like "3:45 PM" or "10:30 AM" → today
  const timeMatch = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (timeMatch) {
    const d = new Date(now);
    let hours = parseInt(timeMatch[1]);
    const mins = parseInt(timeMatch[2]);
    const ampm = (timeMatch[3] || '').toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    d.setHours(hours, mins, 0, 0);
    return d.toISOString();
  }

  // "Jun 26" or "Jun 26, 2024" — month + day (+ optional year)
  const monthDayMatch = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  if (monthDayMatch) {
    const monthStr = monthDayMatch[1];
    const day = parseInt(monthDayMatch[2]);
    const year = monthDayMatch[3] ? parseInt(monthDayMatch[3]) : now.getFullYear();
    const parsed = new Date(`${monthStr} ${day}, ${year} 12:00:00`);
    if (!isNaN(parsed.getTime())) {
      // If this date is in the future, use previous year
      if (parsed.getTime() > now.getTime() + 86_400_000) {
        parsed.setFullYear(year - 1);
      }
      return parsed.toISOString();
    }
  }

  // Last fallback: try Date constructor
  const attempt = new Date(s);
  if (!isNaN(attempt.getTime())) return attempt.toISOString();

  // Give up — return now
  return new Date().toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1A: API-based conversation list (primary path)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure the browser page is on a LinkedIn messaging URL before attempting
 * any API or DOM extraction.
 */
async function ensureOnMessagingPage(page: Page): Promise<boolean> {
  const currentUrl = page.url();

  if (currentUrl.includes('linkedin.com') && !currentUrl.includes('/login') && !currentUrl.includes('/checkpoint')) {
    // Already on LinkedIn — navigate to messaging root to get sidebar
    try {
      await (page as any).goto('https://www.linkedin.com/messaging/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
    } catch {
      // domcontentloaded may timeout — page is still usable
    }
    return true;
  }

  if (!currentUrl.includes('linkedin.com')) {
    console.warn('[InboxScrape] Not on LinkedIn.');
    return false;
  }
  if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
    console.warn('[InboxScrape] Not logged in.');
    return false;
  }
  return true;
}

/**
 * Convert a VoyagerConversation into a ScrapedConversation.
 * Derives the threadUrl from the conversationId.
 */
function voyagerToScraped(
  conv: VoyagerConversation,
  index: number
): ScrapedConversation {
  const threadUrl = `https://www.linkedin.com/messaging/thread/${encodeURIComponent(conv.conversationId)}/`;
  const lastMessageAt = conv.updatedTime
    ? new Date(conv.updatedTime).toISOString()
    : new Date().toISOString();

  return {
    name: conv.participantName,
    headline: '',
    avatarUrl: '',
    threadUrl,
    lastMessage: conv.lastMessageSnippet,
    lastMessageAt,
    unreadCount: 0,
    sidebarPosition: index,
    conversationId: conv.conversationId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1B: DOM-based conversation discovery (fallback)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scrape the sidebar conversation list using DOM selectors.
 * This is the original DOM-based approach, kept as fallback.
 * Uses the exact HTML structure confirmed from live LinkedIn HTML.
 *
 * Container: ul.msg-conversations-container__conversations-list
 * Items:     li.msg-conversation-listitem
 * Name:      h3.msg-conversation-listitem__participant-names span.truncate
 * Snippet:   p.msg-conversation-card__message-snippet
 * Time:      time.msg-conversation-listitem__time-stamp
 * Sponsored: span.msg-conversation-card__pill containing "Sponsored"
 */
async function scrapeInboxViaDOM(
  page: Page,
  checkpointCutoff: number | null
): Promise<ScrapedConversation[]> {

  // Wait for the messaging SPA to render
  console.log('[InboxScrape] Waiting for messaging UI to render (DOM fallback)...');
  await page.waitForFunction(
    () => {
      if (document.querySelector('[class*="msg-conversations-container"]')) return true;
      const msgEls = document.querySelectorAll('[class*="msg-"]');
      for (const el of msgEls) {
        if (el.querySelectorAll('li').length > 0) return true;
      }
      const lis = document.querySelectorAll('li');
      let lisWithImgs = 0;
      for (const li of lis) {
        if (li.querySelector('img') && (li.textContent || '').trim().length > 3) lisWithImgs++;
      }
      return lisWithImgs >= 2;
    },
    { timeout: 20000, polling: 600 }
  ).catch(() => null);

  await humanDelay(2500, 3500);

  // Scroll conversation list to lazy-load more items
  console.log('[InboxScrape] Scrolling to load sidebar conversations...');
  for (let scrollAttempts = 0; scrollAttempts < 20; scrollAttempts++) {
    const scrollResult = await page.evaluate(async () => {
      const container =
        document.querySelector('[class*="msg-conversations-container"] ul') ||
        document.querySelector('[class*="msg-conversations-container"]') ||
        document.querySelector('[class*="conversations-list"]');
      const target = container || document.body;

      const items = Array.from(document.querySelectorAll('li')).filter(li => {
        const img = li.querySelector('img[src*="licdn"], img[src*="media"], img[src*="profile"]');
        const text = (li.textContent || '').trim();
        return !!img && text.length > 5;
      });

      let oldestTimeStr = '';
      if (items.length > 0) {
        const oldestItem = items[items.length - 1];
        const timeEl = oldestItem.querySelector('time');
        oldestTimeStr = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
      }

      (target as HTMLElement).scrollTop += 600;
      await new Promise(r => setTimeout(r, 600));

      return { count: items.length, oldestTimeStr };
    }).catch(() => ({ count: 0, oldestTimeStr: '' }));

    const oldestIso = linkedInTimeToISO(scrollResult.oldestTimeStr);
    const oldestDate = new Date(oldestIso);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    console.log(`[InboxScrape] Scroll ${scrollAttempts + 1}: ${scrollResult.count} contacts loaded, oldest ~${oldestIso}`);

    if (checkpointCutoff && oldestDate.getTime() <= checkpointCutoff) {
      console.log(`[InboxScrape] Found messages older than checkpoint. Stopping scroll.`);
      break;
    }

    if (scrollResult.count >= 20 && oldestDate < thirtyDaysAgo) {
      console.log('[InboxScrape] Reached 20+ contacts and 30 days history. Stopping scroll.');
      break;
    }

    if (scrollAttempts === 19) {
      console.log('[InboxScrape] Reached max scroll attempts.');
    }
  }
  await humanDelay(800, 1200);

  // Extract conversation data from sidebar DOM
  const rawConversations = await page.evaluate(() => {
    const results: Array<{
      name: string;
      avatarUrl: string;
      lastMessage: string;
      lastMessageAtRaw: string;
      unreadCount: number;
      index: number;
      isSponsored: boolean;
    }> = [];

    function clean(t: string | null | undefined): string {
      return (t || '').replace(/\s+/g, ' ').trim();
    }

    // Find conversation list items — try multiple strategies
    let conversationItems: Element[] = [];

    const container = document.querySelector('[class*="msg-conversations-container"]');
    if (container) {
      conversationItems = Array.from(container.querySelectorAll('li')).filter(li => {
        const hasImg = !!li.querySelector('img');
        const text = (li.textContent || '').trim();
        const isVisible = (li as HTMLElement).offsetParent !== null;
        return hasImg && isVisible && text.length > 5 && text.length < 600;
      });
    }

    if (conversationItems.length === 0) {
      conversationItems = Array.from(document.querySelectorAll(
        'li[class*="conversation"], li[class*="msg-convo"], [class*="msg-conversation-listitem"]'
      ));
    }

    if (conversationItems.length === 0) {
      const allLis = Array.from(document.querySelectorAll('li'));
      conversationItems = allLis.filter(li => {
        const hasImg = !!li.querySelector('img');
        const text = (li.textContent || '').trim();
        const isInMsgScope = !!li.closest('[class*="msg-"]');
        const isVisible = (li as HTMLElement).offsetParent !== null;
        return hasImg && isVisible && text.length > 5 && text.length < 600 && isInMsgScope;
      });
    }

    if (conversationItems.length === 0) {
      const allLis = Array.from(document.querySelectorAll('li'));
      conversationItems = allLis.filter(li => {
        const img = li.querySelector('img[src*="licdn"], img[src*="media"], img[src*="profile"]');
        const text = (li.textContent || '').trim();
        const isVisible = (li as HTMLElement).offsetParent !== null;
        return !!img && isVisible && text.length > 5 && text.length < 600;
      });
    }

    console.log('[InboxScrape DOM] Found ' + conversationItems.length + ' candidate conversation items');

    for (let i = 0; i < conversationItems.length; i++) {
      const item = conversationItems[i];

      // ── Sponsored filter ─────────────────────────────────────────────────────
      // Skip sponsored messages — they have a pill with text "Sponsored"
      const sponsoredPill = item.querySelector('span.msg-conversation-card__pill, [class*="pill"]');
      const isSponsored = sponsoredPill
        ? (sponsoredPill.textContent || '').toLowerCase().includes('sponsored')
        : false;
      if (isSponsored) {
        console.log('[InboxScrape DOM] Skipping sponsored item at index ' + i);
        continue;
      }

      // ── Name extraction ──────────────────────────────────────────────────────
      // Priority 1: h3 > span.truncate (confirmed from live HTML)
      let name = '';
      const h3 = item.querySelector('h3.msg-conversation-listitem__participant-names span.truncate');
      if (h3) name = clean(h3.textContent);

      // Priority 2: any h3
      if (!name) {
        const h3El = item.querySelector('h3');
        if (h3El) name = clean(h3El.textContent);
      }

      // Priority 3: class-based selectors
      if (!name) {
        const nameEl = item.querySelector(
          '[class*="participant"],[class*="person-name"],[class*="entity-name"],[class*="actor-name"]'
        );
        if (nameEl) name = clean(nameEl.textContent);
      }

      // Priority 4: bold tags
      if (!name) {
        const boldEl = item.querySelector('strong, b');
        if (boldEl) name = clean(boldEl.textContent);
      }

      name = name.split('\n')[0].trim();

      // Ghost-name filter
      const ghostPatterns = [
        /^reply to conversation/i,
        /^conversation with [\"']/i,
        /^new message from/i,
        /^message from/i,
        /^send a message to/i,
      ];
      if (ghostPatterns.some(p => p.test(name))) {
        console.log(`[InboxScrape DOM] Skipping ghost item: "${name}"`);
        continue;
      }

      name = name.replace(/\s+\d+\s+new\s+message.*/i, '').trim();
      if (!name || name.length < 2) continue;

      // ── Avatar ───────────────────────────────────────────────────────────────
      const img = item.querySelector(
        'img.presence-entity__image, img[src*="licdn"], img[src*="media"], img[src*="profile"], img[alt]'
      ) as HTMLImageElement | null;
      const avatarUrl = img?.src || '';

      // ── Last message snippet ─────────────────────────────────────────────────
      // Use the exact class from the live HTML
      let lastMessage = '';
      const snippetEl = item.querySelector('p.msg-conversation-card__message-snippet');
      if (snippetEl) {
        // Remove the "You: " prefix if present — we track direction separately
        lastMessage = clean(snippetEl.textContent);
      }
      if (!lastMessage) {
        const textEls = Array.from(item.querySelectorAll('p, [class*="snippet"], [class*="subtitle"], [class*="preview"]'));
        for (const el of textEls) {
          if (el.closest('h3') || el.closest('time')) continue;
          const t = clean(el.textContent);
          if (t && t.length > 3 && t !== name && !t.includes('linkedin.com')) {
            lastMessage = t;
            break;
          }
        }
      }

      // ── Timestamp ────────────────────────────────────────────────────────────
      // Priority: datetime attribute on time.msg-conversation-listitem__time-stamp
      const timeEl = item.querySelector('time.msg-conversation-listitem__time-stamp, time[class*="time-stamp"]');
      const lastMessageAtRaw =
        timeEl?.getAttribute('datetime') ||
        timeEl?.textContent?.trim() ||
        '';

      // ── Unread badge ─────────────────────────────────────────────────────────
      let unreadCount = 0;
      const badge = item.querySelector('[class*="badge"], [class*="unread"], [class*="notification"]');
      if (badge) {
        const n = parseInt(clean(badge.textContent) || '1');
        unreadCount = isNaN(n) ? 1 : Math.max(0, n);
      }

      results.push({
        name,
        avatarUrl,
        lastMessage: lastMessage.slice(0, 200),
        lastMessageAtRaw,
        unreadCount,
        index: i,
        isSponsored: false,
      });
    }

    return results;
  });

  console.log('[InboxScrape] DOM: Extracted ' + rawConversations.length + ' conversations.');

  if (rawConversations.length === 0) return [];

  // Deduplicate before clicking so we don't click the same person multiple times (ghost rows)
  const dedupedConversations = rawConversations.filter(
    (c, idx, arr) => arr.findIndex(x => x.name === c.name) === idx
  );

  // Phase 2: Click each unique conversation to capture the thread URL
  console.log('[InboxScrape] Clicking conversations to capture thread URLs...');
  const finalResults: ScrapedConversation[] = [];

  for (const conv of dedupedConversations) {
    // Early-exit checkpoint — sidebar is sorted newest-first
    if (checkpointCutoff) {
      const convTime = new Date(linkedInTimeToISO(conv.lastMessageAtRaw)).getTime();
      if (convTime <= checkpointCutoff) {
        console.log(`[InboxScrape] EARLY EXIT: "${conv.name}" is older than checkpoint.`);
        break;
      }
    }

    try {
      const previousUrl = page.url();

      const clicked = await page.evaluate((targetName: string) => {
        const h3s = Array.from(document.querySelectorAll(
          'h3.msg-conversation-listitem__participant-names span.truncate, h3.msg-conversation-listitem__participant-names, [class*="participant-names"]'
        ));
        
        for (const h3 of h3s) {
          const text = (h3.textContent || '').trim();
          if (text.includes(targetName) || targetName.includes(text)) {
            const li = h3.closest('li');
            if (li) {
               (li as HTMLElement).click();
               return true;
            }
          }
        }
        return false;
      }, conv.name);

      if (clicked) {
        try {
          await page.waitForFunction(
            (prevUrl) => window.location.href !== prevUrl && window.location.href.includes('/thread/'),
            {},
            previousUrl
          );
          await humanDelay(700, 1200);
        } catch {
          // URL didn't change — thread may not have a separate URL
        }
      }

      const currentUrl = page.url();
      const threadUrl = (currentUrl !== previousUrl && currentUrl.includes('/messaging/thread/'))
        ? currentUrl : '';

      // Also extract the conversationId from the URL
      const conversationId = extractConversationIdFromUrl(threadUrl) ?? undefined;

      finalResults.push({
        name: conv.name,
        headline: '',
        avatarUrl: conv.avatarUrl,
        threadUrl,
        lastMessage: conv.lastMessage,
        lastMessageAt: linkedInTimeToISO(conv.lastMessageAtRaw),
        unreadCount: conv.unreadCount,
        sidebarPosition: conv.index,
        conversationId,
      });

      console.log(`[InboxScrape] ✓ [#${conv.index}] ${conv.name} → ${threadUrl}`);
    } catch (err) {
      console.warn(`[InboxScrape] Error clicking ${conv.name}:`, err);
      finalResults.push({
        name: conv.name,
        headline: '',
        avatarUrl: conv.avatarUrl,
        threadUrl: '',
        lastMessage: conv.lastMessage,
        lastMessageAt: linkedInTimeToISO(conv.lastMessageAtRaw),
        unreadCount: conv.unreadCount,
        sidebarPosition: conv.index,
      });
    }
  }

  // Navigate back to /messaging/ root
  try {
    await (page as any).goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
  } catch {}

  return finalResults;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export: scrapeInboxConversations
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeInboxConversations(
  page: Page,
  lastSyncAllAt: number | null = null
): Promise<ScrapedConversation[]> {
  try {
    console.log('[InboxScrape] Starting conversation discovery...');

    const isOnLinkedIn = await ensureOnMessagingPage(page);
    if (!isOnLinkedIn) return [];

    // Wait for the page to stabilize after navigation
    await humanDelay(2000, 3000);

    // 5-min grace buffer for LinkedIn's fuzzy sidebar timestamps
    const checkpointCutoff = lastSyncAllAt ? lastSyncAllAt - 5 * 60_000 : null;

    // ── Phase 1A: Try the Voyager API first ───────────────────────────────────
    console.log('[InboxScrape] Phase 1A: Attempting Voyager API fetch...');
    let voyagerConversations: VoyagerConversation[] = [];
    try {
      voyagerConversations = await fetchConversationList(page);
    } catch (apiErr) {
      console.warn('[InboxScrape] Voyager API failed, will use DOM fallback:', apiErr);
    }

    if (voyagerConversations.length > 0) {
      console.log(`[InboxScrape] Voyager API returned ${voyagerConversations.length} conversations.`);

      // Apply checkpoint filter — LinkedIn API returns newest-first
      const filtered: ScrapedConversation[] = [];
      for (let i = 0; i < voyagerConversations.length; i++) {
        const conv = voyagerConversations[i];

        if (checkpointCutoff && conv.updatedTime <= checkpointCutoff) {
          console.log(`[InboxScrape] EARLY EXIT: "${conv.participantName}" is older than checkpoint.`);
          break;
        }

        filtered.push(voyagerToScraped(conv, i));
      }

      // Deduplicate by name (keep first occurrence = most recent)
      const deduped = filtered.filter(
        (c, idx, arr) => idx === 0 || arr.findIndex(x => x.name === c.name) === idx
      );

      logActivity('inbox_sidebar_scraped', 'inbox', {
        count: deduped.length,
        method: 'voyager_api',
      });
      console.log(`[InboxScrape] ✅ Voyager API: ${deduped.length} conversations discovered.`);
      return deduped;
    }

    // ── Phase 1B: DOM fallback ───────────────────────────────────────────────
    console.log('[InboxScrape] Phase 1B: Falling back to DOM-based sidebar scraping...');
    const domResults = await scrapeInboxViaDOM(page, checkpointCutoff);

    // Deduplicate by name
    const deduped = domResults.filter(
      (c, idx, arr) => idx === 0 || arr.findIndex(x => x.name === c.name) === idx
    );

    logActivity('inbox_sidebar_scraped', 'inbox', {
      count: deduped.length,
      method: 'dom_fallback',
    });
    console.log(`[InboxScrape] ✅ DOM fallback: ${deduped.length} conversations scraped.`);
    return deduped;

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logActivity('inbox_sidebar_scrape_failed', 'inbox', { error: msg }, 'error', msg);
    console.error('[InboxScrape] Failed:', msg);
    return [];
  }
}
