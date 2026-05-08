/**
 * voyagerClient.ts — LinkedIn Voyager API Client
 *
 * Fetches message history directly from LinkedIn's internal Voyager API,
 * running every fetch() call inside the browser's own context so that all
 * authentication cookies and browser headers are automatically applied.
 *
 * API facts (confirmed from live network inspection):
 *   - Conversations list : GET /voyager/api/messaging/conversations?count=20&start=N
 *   - Thread events      : GET /voyager/api/messaging/conversations/{URN}/events?count=100
 *   - Pagination         : cursor-based via `createdBefore=<epoch_ms>` parameter
 *   - Auth               : Cookies (`li_at`) + `csrf-token` header = value of `JSESSIONID` cookie
 *   - Protocol header    : `x-restli-protocol-version: 2.0.0`
 *
 * IMPORTANT: All network requests are made via page.evaluate() → window.fetch(),
 * which means they originate from inside a live linkedin.com tab. LinkedIn sees
 * them as native app requests, not external automation.
 */

import type { Page } from 'puppeteer-core';
import { humanDelay } from '../browser/humanizer';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface VoyagerMessage {
  /** Stable event URN, e.g. "urn:li:msg_event:(...)" */
  eventUrn: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Raw epoch ms from LinkedIn */
  createdAt: number;
  /** Plain text content of the message */
  text: string;
  /** true  = sent by us (the logged-in account)
   *  false = sent by the other participant  */
  isMe: boolean;
  /** Display name of the sender */
  senderName: string;
}

export interface VoyagerConversation {
  /** The URL-safe conversation ID extracted from the entityUrn */
  conversationId: string;
  /** Full entityUrn string, e.g. "urn:li:msg_conversation:(...)" */
  entityUrn: string;
  /** Display name of the other participant */
  participantName: string;
  /** Text snippet of the last message */
  lastMessageSnippet: string;
  /** Epoch ms of last message */
  updatedTime: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the CSRF token from the JSESSIONID cookie.
 * LinkedIn requires `csrf-token: ajax:XXXXXXXXXXXXXXXX` on all API calls.
 * Returns empty string if the cookie is not present.
 */
async function getCsrfToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const match = document.cookie.match(/JSESSIONID=["']?(ajax:[^"';]+)/);
    return match ? match[1] : '';
  });
}

/**
 * Build the standard headers needed for every Voyager API call.
 * These are the same headers the LinkedIn web app sends.
 */
async function buildVoyagerHeaders(page: Page): Promise<Record<string, string>> {
  const csrfToken = await getCsrfToken(page);
  return {
    'accept': 'application/vnd.linkedin.normalized+json+2.1',
    'accept-language': 'en-US,en;q=0.9',
    'csrf-token': csrfToken,
    'x-restli-protocol-version': '2.0.0',
    'x-li-lang': 'en_US',
    'x-li-track': JSON.stringify({ clientVersion: '1.13.8109', mpVersion: '1.13.8109' }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: in-browser fetch wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a Voyager GET request inside the browser's own context.
 * Returns the parsed JSON body, or null on failure.
 */
async function voyagerGet(
  page: Page,
  endpoint: string,
  headers: Record<string, string>
): Promise<any | null> {
  const result = await page.evaluate(
    async (url: string, hdrs: Record<string, string>) => {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: hdrs,
          credentials: 'include',
        });
        if (!response.ok) {
          console.warn(`[Voyager] HTTP ${response.status} for ${url}`);
          return { _httpError: response.status };
        }
        return await response.json();
      } catch (err: any) {
        return { _fetchError: err?.message || 'Unknown fetch error' };
      }
    },
    endpoint,
    headers
  ).catch(() => null);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Conversation list
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the full list of conversations from the Voyager API.
 * Paginates using start/count until all conversations are loaded or maxPages reached.
 * Automatically skips Sponsored messages (they have no entityUrn matching msg_conversation).
 */
export async function fetchConversationList(
  page: Page,
  maxPages = 50
): Promise<VoyagerConversation[]> {
  const headers = await buildVoyagerHeaders(page);
  const allConversations: VoyagerConversation[] = [];
  const pageSize = 20;

  console.log('[Voyager] Fetching conversation list...');

  for (let pageNum = 0; pageNum < maxPages; pageNum++) {
    const start = pageNum * pageSize;
    // Added q=messengerConversations parameter as it is strictly required by LinkedIn's newer API routing
    const url = `https://www.linkedin.com/voyager/api/messaging/conversations?q=messengerConversations&count=${pageSize}&start=${start}`;

    const data = await voyagerGet(page, url, headers);

    if (!data || data._fetchError || data._httpError === 429) {
      if (data?._httpError === 429) {
        console.warn('[Voyager] Rate-limited (429). Backing off 60s...');
        await humanDelay(60000, 70000);
      }
      break;
    }

    const elements: any[] = data?.elements ?? [];
    if (elements.length === 0) {
      console.log(`[Voyager] Conversation list exhausted at page ${pageNum}.`);
      break;
    }

    for (const elem of elements) {
      const entityUrn: string = elem?.entityUrn ?? '';

      // Only process real DM conversations (not Sponsored/InMail)
      if (!entityUrn.includes('msg_conversation')) continue;

      // Extract the conversation ID from the URN
      // URN format: "urn:li:msg_conversation:(2-XXXX)"
      const urnMatch = entityUrn.match(/\(([^)]+)\)/);
      const conversationId = urnMatch ? urnMatch[1] : entityUrn;

      // Extract participant name from participants array
      let participantName = '';
      const participants: any[] = elem?.participants ?? [];
      for (const p of participants) {
        const miniProfile = p?.['com.linkedin.voyager.messaging.MessagingMember']?.miniProfile
          ?? p?.miniProfile
          ?? null;
        if (miniProfile) {
          const firstName: string = miniProfile.firstName ?? '';
          const lastName: string = miniProfile.lastName ?? '';
          participantName = `${firstName} ${lastName}`.trim();
          break;
        }
      }

      // Extract last message snippet
      const lastEvent = elem?.lastEvent ?? {};
      const msgEvent = lastEvent?.eventContent?.['com.linkedin.voyager.messaging.event.MessageEvent']
        ?? lastEvent?.eventContent?.['com.linkedin.voyager.messaging.event.messageEvent']
        ?? null;
      const lastMessageSnippet: string = msgEvent?.attributedBody?.text ?? msgEvent?.body ?? '';
      const updatedTime: number = elem?.lastActivityAt ?? elem?.updatedTime ?? 0;

      // Skip if no name could be resolved (typically system/sponsored threads)
      if (!participantName) continue;

      allConversations.push({
        conversationId,
        entityUrn,
        participantName,
        lastMessageSnippet: lastMessageSnippet.slice(0, 200),
        updatedTime,
      });
    }

    console.log(`[Voyager] Conversation page ${pageNum + 1}: ${elements.length} entries, ${allConversations.length} total valid.`);

    // If we got fewer items than page size, we're on the last page
    if (elements.length < pageSize) break;

    // Human-like delay between pages
    await humanDelay(1500, 2500);
  }

  return allConversations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Thread message history (full, with cursor pagination)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a single Voyager event element into a VoyagerMessage.
 * Returns null for system events (typing indicators, reactions, etc.).
 */
function parseEventElement(elem: any, loggedInMemberId: string): VoyagerMessage | null {
  const entityUrn: string = elem?.entityUrn ?? '';
  const createdAt: number = elem?.createdAt ?? 0;

  // Extract the sender's member URN
  const fromMember = elem?.from?.['com.linkedin.voyager.messaging.MessagingMember']
    ?? elem?.from
    ?? null;
  const senderUrn: string = fromMember?.miniProfile?.entityUrn ?? '';
  const firstName: string = fromMember?.miniProfile?.firstName ?? '';
  const lastName: string = fromMember?.miniProfile?.lastName ?? '';
  const senderName: string = `${firstName} ${lastName}`.trim();

  // Determine direction: compare sender URN to logged-in member URN
  const isMe = loggedInMemberId ? senderUrn.includes(loggedInMemberId) : false;

  // Extract message text from the event content
  const msgEvent = elem?.eventContent?.['com.linkedin.voyager.messaging.event.MessageEvent']
    ?? elem?.eventContent?.['com.linkedin.voyager.messaging.event.messageEvent']
    ?? null;

  // Skip non-message events (reactions, typing indicators, etc.)
  if (!msgEvent) return null;

  const text: string = msgEvent?.attributedBody?.text
    ?? msgEvent?.body
    ?? '';

  if (!text.trim()) return null;

  const timestamp = new Date(createdAt).toISOString();

  return {
    eventUrn: entityUrn,
    timestamp,
    createdAt,
    text: text.trim(),
    isMe,
    senderName,
  };
}

/**
 * Fetch the logged-in member's URN so we can distinguish outbound vs inbound messages.
 * Reads from the miniProfile in the global state if available.
 */
async function getLoggedInMemberUrn(page: Page): Promise<string> {
  return page.evaluate(() => {
    try {
      // LinkedIn's global state exposes the member ID in multiple places
      const state = (window as any).__REDUX_STATE__
        ?? (window as any)._INITIAL_DATA__
        ?? {};

      // Try the identity store
      const memberId: string = state?.globalState?.ownedBy?.urnId
        ?? state?.liPMI?.memberId
        ?? '';

      if (memberId) return `urn:li:member:${memberId}`;

      // Fallback: parse from cookie
      const liAl = document.cookie.match(/li_mc=([^;]+)/);
      return liAl ? `urn:li:member:${liAl[1].split('%3A')[0]}` : '';
    } catch {
      return '';
    }
  }).catch(() => '');
}

/**
 * Fetch ALL messages from a conversation thread using cursor-based pagination.
 * Walks backwards in time from the most recent message until the beginning.
 *
 * @param page          - The Puppeteer page (must be on a linkedin.com URL)
 * @param conversationId - The conversation ID (not the full URN)
 * @param stopAtTimestamp - Optional: stop fetching pages when messages are older than this epoch ms
 *                          Used for incremental sync to avoid re-fetching old messages.
 * @returns Array of VoyagerMessage sorted oldest-first
 */
export async function fetchFullThreadHistory(
  page: Page,
  conversationId: string,
  stopAtTimestamp: number | null = null
): Promise<VoyagerMessage[]> {
  const headers = await buildVoyagerHeaders(page);
  const loggedInMemberUrn = await getLoggedInMemberUrn(page);
  const allMessages: VoyagerMessage[] = [];
  const count = 100; // Max per page

  console.log(`[Voyager] Fetching full history for conversation: ${conversationId}`);

  let createdBefore: number | null = null; // null = start from the most recent
  let pageNum = 0;
  const MAX_PAGES = 100; // Safety limit (10,000 messages)

  while (pageNum < MAX_PAGES) {
    // Build the URL — add createdBefore cursor only when paginating
    let url = `https://www.linkedin.com/voyager/api/messaging/conversations/${encodeURIComponent(conversationId)}/events?count=${count}`;
    if (createdBefore !== null) {
      url += `&createdBefore=${createdBefore}`;
    }

    const data = await voyagerGet(page, url, headers);

    if (!data || data._fetchError) {
      console.warn(`[Voyager] Fetch failed for conversation ${conversationId}: ${JSON.stringify(data)}`);
      break;
    }

    if (data._httpError === 429) {
      console.warn('[Voyager] Rate-limited on thread fetch. Waiting 60s...');
      await humanDelay(60000, 70000);
      // Retry the same page — do NOT increment pageNum
      continue;
    }

    const elements: any[] = data?.elements ?? [];

    if (elements.length === 0) {
      console.log(`[Voyager] Thread ${conversationId} fully loaded after ${pageNum} page(s).`);
      break;
    }

    // Parse and accumulate messages for this page
    let oldestTimestampInPage = Infinity;
    let hitStopTimestamp = false;

    for (const elem of elements) {
      const msg = parseEventElement(elem, loggedInMemberUrn);
      if (!msg) continue;

      // Incremental sync: if this message is older than our stop point, we're done
      if (stopAtTimestamp !== null && msg.createdAt <= stopAtTimestamp) {
        hitStopTimestamp = true;
        break;
      }

      allMessages.push(msg);
      if (msg.createdAt < oldestTimestampInPage) {
        oldestTimestampInPage = msg.createdAt;
      }
    }

    console.log(`[Voyager] Thread page ${pageNum + 1}: ${elements.length} events, ${allMessages.length} valid messages total.`);

    if (hitStopTimestamp) {
      console.log(`[Voyager] Hit incremental stop timestamp. Thread sync complete.`);
      break;
    }

    // If we got fewer items than requested, we've reached the start of the conversation
    if (elements.length < count) {
      console.log(`[Voyager] Reached beginning of conversation.`);
      break;
    }

    // Set cursor to just before the oldest message in this page
    createdBefore = oldestTimestampInPage - 1;
    pageNum++;

    // Small delay to avoid rate-limiting
    await humanDelay(600, 1000);
  }

  // Sort oldest-first (API returns newest-first)
  allMessages.sort((a, b) => a.createdAt - b.createdAt);

  console.log(`[Voyager] Completed thread ${conversationId}: ${allMessages.length} messages (oldest-first).`);
  return allMessages;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: URN resolution from a thread URL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the conversation ID from a LinkedIn thread URL.
 * Handles both URL formats:
 *   - /messaging/thread/2-XXXXXXXX=/
 *   - /messaging/thread/urn:li:msg_conversation:(2-XXXXXXXX)/
 */
export function extractConversationIdFromUrl(threadUrl: string): string | null {
  if (!threadUrl) return null;
  try {
    const u = new URL(threadUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    const threadIdx = parts.findIndex(p => p === 'thread');
    if (threadIdx === -1 || threadIdx + 1 >= parts.length) return null;

    const threadSegment = decodeURIComponent(parts[threadIdx + 1]);

    // Format 1: plain ID like "2-ABC123="
    if (!threadSegment.startsWith('urn:')) {
      return threadSegment.replace(/\/$/, '');
    }

    // Format 2: URN-encoded
    const urnMatch = threadSegment.match(/\(([^)]+)\)/);
    return urnMatch ? urnMatch[1] : null;
  } catch {
    return null;
  }
}
