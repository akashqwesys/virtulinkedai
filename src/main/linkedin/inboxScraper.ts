/**
 * Inbox Scraper — DOM-agnostic LinkedIn messaging sidebar scraper
 *
 * LinkedIn 2026 DOM facts (from live debug):
 *  - Thread links (a[href*="/messaging/thread/"]) do NOT exist in sidebar
 *  - Conversation items are <li> inside a container with class containing "msg-conversations-container"
 *  - Classes use "msg-cross-pillar-*" and "msg-conversations-container__*" prefixes
 *  - Conversation items are clickable divs, NOT anchor tags
 *  - Clicking a conversation changes the URL to /messaging/thread/XXX/
 *
 * Strategy: Find conversation <li> items by their structure (img + text),
 * extract name/avatar/preview directly, then click each to capture thread URL.
 */

import type { Page } from 'puppeteer-core';
import { humanDelay } from '../browser/humanizer';
import { logActivity } from '../storage/database';

export interface ScrapedConversation {
  name: string;
  headline: string;
  avatarUrl: string;
  threadUrl: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

export async function scrapeInboxConversations(
  page: Page,
): Promise<ScrapedConversation[]> {
  try {
    console.log('[InboxScrape] Navigating to LinkedIn messaging...');

    // Force navigate to /messaging/ root
    try {
      await (page as any).goto('https://www.linkedin.com/messaging/', {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });
    } catch {
      // networkidle2 may timeout — page is still usable
    }

    const currentUrl = page.url();
    console.log('[InboxScrape] Page: ' + currentUrl);

    if (!currentUrl.includes('linkedin.com')) {
      console.warn('[InboxScrape] Not on LinkedIn.');
      return [];
    }
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      console.warn('[InboxScrape] Not logged in.');
      return [];
    }

    // Wait for the messaging SPA to render
    console.log('[InboxScrape] Waiting for messaging UI to render...');

    // Wait for msg-conversations-container or any msg- prefixed container
    const containerReady = await page.waitForFunction(
      () => {
        // Check for conversation container
        if (document.querySelector('[class*="msg-conversations-container"]')) return true;
        // Check for any li elements inside msg- scoped containers
        const msgEls = document.querySelectorAll('[class*="msg-"]');
        for (const el of msgEls) {
          if (el.querySelectorAll('li').length > 0) return true;
        }
        // Check for li elements with images (conversation items always have avatars)
        const lis = document.querySelectorAll('li');
        let lisWithImgs = 0;
        for (const li of lis) {
          if (li.querySelector('img') && (li.textContent || '').trim().length > 3) lisWithImgs++;
        }
        return lisWithImgs >= 2;
      },
      { timeout: 20000, polling: 600 }
    ).catch(() => null);

    if (containerReady) {
      console.log('[InboxScrape] Messaging container detected.');
      await humanDelay(2500, 3500); // extra time for full render
    } else {
      console.warn('[InboxScrape] Container not detected, trying after hard wait...');
      await humanDelay(8000, 10000);
    }

    // Scroll the conversation list to lazy-load more items
    await page.evaluate(async () => {
      // Find the scrollable conversations list
      const container =
        document.querySelector('[class*="msg-conversations-container"] ul') ||
        document.querySelector('[class*="msg-conversations-container"]') ||
        document.querySelector('[class*="conversations-list"]');

      const target = container || document.body;
      for (let i = 0; i < 4; i++) {
        (target as HTMLElement).scrollTop += 400;
        await new Promise(r => setTimeout(r, 500));
      }
      (target as HTMLElement).scrollTop = 0;
      await new Promise(r => setTimeout(r, 400));
    }).catch(() => null);
    await humanDelay(800, 1200);

    // ── Phase 1: Extract conversation data from sidebar DOM ──
    const rawConversations = await page.evaluate(() => {
      const results: Array<{
        name: string;
        avatarUrl: string;
        lastMessage: string;
        lastMessageAt: string;
        unreadCount: number;
        index: number; // position index for click-based URL capture
      }> = [];

      function clean(t: string | null | undefined): string {
        return (t || '').replace(/\s+/g, ' ').trim();
      }

      // Find conversation list items
      // LinkedIn 2026 uses <li> elements inside the msg-conversations-container
      let conversationItems: Element[] = [];

      // Try 1: Items inside msg-conversations-container
      const container = document.querySelector('[class*="msg-conversations-container"]');
      if (container) {
        conversationItems = Array.from(container.querySelectorAll('li'));
        // Filter to only items that have an image (avatar) and meaningful text
        conversationItems = conversationItems.filter(li => {
          const hasImg = !!li.querySelector('img');
          const text = (li.textContent || '').trim();
          return hasImg && text.length > 5 && text.length < 600;
        });
      }

      // Try 2: Any li with class containing "conversation" or "msg-convo"
      if (conversationItems.length === 0) {
        conversationItems = Array.from(document.querySelectorAll(
          'li[class*="conversation"], li[class*="msg-convo"], [class*="msg-conversation-listitem"]'
        ));
      }

      // Try 3: Generic — all <li> elements with images inside msg-scoped parents
      if (conversationItems.length === 0) {
        const allLis = Array.from(document.querySelectorAll('li'));
        conversationItems = allLis.filter(li => {
          const hasImg = !!li.querySelector('img');
          const text = (li.textContent || '').trim();
          const isInMsgScope = !!li.closest('[class*="msg-"]');
          return hasImg && text.length > 5 && text.length < 600 && isInMsgScope;
        });
      }

      // Try 4: Broadest — any <li> with profile-like image + name text
      if (conversationItems.length === 0) {
        const allLis = Array.from(document.querySelectorAll('li'));
        conversationItems = allLis.filter(li => {
          const img = li.querySelector('img[src*="licdn"], img[src*="media"], img[src*="profile"]');
          const text = (li.textContent || '').trim();
          return !!img && text.length > 5 && text.length < 600;
        });
      }

      console.log('[InboxScrape DOM] Found ' + conversationItems.length + ' candidate conversation items');

      for (let i = 0; i < conversationItems.length; i++) {
        const item = conversationItems[i];
        let name = '';

        // Extract name — try multiple strategies
        // Strategy 1: h3 tag
        const h3 = item.querySelector('h3');
        if (h3) name = clean(h3.textContent);

        // Strategy 2: class-based name selectors
        if (!name) {
          const nameEl = item.querySelector(
            '[class*="participant"],[class*="person-name"],[class*="entity-name"],[class*="actor-name"]'
          );
          if (nameEl) name = clean(nameEl.textContent);
        }

        // Strategy 3: strong/b tags
        if (!name) {
          const boldEl = item.querySelector('strong, b');
          if (boldEl) name = clean(boldEl.textContent);
        }

        // Strategy 4: First meaningful span
        if (!name) {
          const spans = Array.from(item.querySelectorAll('span'));
          for (const span of spans) {
            if (span.closest('time') || span.closest('[class*="badge"]')) continue;
            const children = span.children;
            // Prefer leaf spans (no child elements = actual text node)
            if (children.length > 2) continue;
            const t = clean(span.textContent);
            if (t.length > 1 && t.length < 50 && !t.includes('/') && !t.match(/^\d+[mhd]?\s*(ago)?$/)) {
              name = t;
              break;
            }
          }
        }

        // Strategy 5: aria-label on clickable elements
        if (!name) {
          const clickable = item.querySelector('[role="button"], a, button');
          const label = clickable?.getAttribute('aria-label') || '';
          if (label && label.length < 100) {
            name = label.replace(/^conversation with /i, '').replace(/\s*\d+\s*new\s*message.*$/i, '').trim();
          }
        }

        name = name.split('\n')[0].trim();
        if (!name || name.length < 2) continue;

        // Avatar
        const img = item.querySelector(
          'img[src*="licdn"], img[src*="media"], img[src*="profile"], img[alt]'
        ) as HTMLImageElement | null;
        const avatarUrl = img?.src || '';

        // Last message preview
        let lastMessage = '';
        const textEls = Array.from(item.querySelectorAll('p, [class*="snippet"], [class*="subtitle"], [class*="preview"], [class*="last-message"]'));
        for (const el of textEls) {
          if (el.closest('h3') || el.closest('time')) continue;
          const t = clean(el.textContent);
          if (t && t.length > 3 && t !== name && !t.includes('linkedin.com')) {
            lastMessage = t;
            break;
          }
        }
        // If no <p> found, try spans that look like message previews
        if (!lastMessage) {
          const spans = Array.from(item.querySelectorAll('span'));
          for (const span of spans) {
            if (span.closest('h3') || span.closest('time') || span.closest('[class*="badge"]')) continue;
            const t = clean(span.textContent);
            if (t && t.length > 10 && t !== name && t.length < 200) {
              lastMessage = t;
              break;
            }
          }
        }

        // Timestamp
        const timeEl = item.querySelector('time');
        const lastMessageAt = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || new Date().toISOString();

        // Unread badge
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
          lastMessageAt,
          unreadCount,
          index: i,
        });
      }

      return results;
    });

    console.log('[InboxScrape] Phase 1: Extracted ' + rawConversations.length + ' conversations from DOM.');

    if (rawConversations.length === 0) {
      // Extended debug for troubleshooting
      const debug = await page.evaluate(() => {
        const container = document.querySelector('[class*="msg-conversations-container"]');
        const containerHTML = container ? container.innerHTML.substring(0, 500) : 'NO CONTAINER FOUND';
        const allLis = document.querySelectorAll('li');
        const liSamples: string[] = [];
        for (let i = 0; i < Math.min(allLis.length, 3); i++) {
          liSamples.push(allLis[i].innerHTML.substring(0, 200));
        }
        return {
          url: window.location.href,
          containerFound: !!container,
          containerChildCount: container?.children.length || 0,
          containerHTML,
          totalLis: allLis.length,
          liSamples,
        };
      });
      console.warn('[InboxScrape] Extended debug:', JSON.stringify(debug, null, 2));
      return [];
    }

    // ── Phase 2: Click each conversation item to capture its thread URL ──
    console.log('[InboxScrape] Phase 2: Clicking conversations to capture thread URLs...');
    const finalResults: ScrapedConversation[] = [];

    for (const conv of rawConversations) {
      try {
        // Click the conversation item by index
        const clicked = await page.evaluate((idx: number) => {
          const container = document.querySelector('[class*="msg-conversations-container"]');
          let items: Element[] = [];
          if (container) {
            items = Array.from(container.querySelectorAll('li')).filter(li => {
              const hasImg = !!li.querySelector('img');
              const text = (li.textContent || '').trim();
              return hasImg && text.length > 5 && text.length < 600;
            });
          }
          if (!items.length) {
            items = Array.from(document.querySelectorAll('li')).filter(li => {
              const hasImg = !!li.querySelector('img');
              const isInMsg = !!li.closest('[class*="msg-"]');
              return hasImg && isInMsg && (li.textContent || '').trim().length > 5;
            });
          }

          const target = items[idx];
          if (!target) return false;
          (target as HTMLElement).click();
          return true;
        }, conv.index);

        if (!clicked) {
          console.warn(`[InboxScrape] Could not click conversation #${conv.index} (${conv.name})`);
          // Still add it without thread URL
          finalResults.push({
            name: conv.name,
            headline: '',
            avatarUrl: conv.avatarUrl,
            threadUrl: '',
            lastMessage: conv.lastMessage,
            lastMessageAt: conv.lastMessageAt,
            unreadCount: conv.unreadCount,
          });
          continue;
        }

        // Wait for URL to change to /messaging/thread/XXX/
        await humanDelay(1500, 2500);
        const threadUrl = page.url();

        finalResults.push({
          name: conv.name,
          headline: '',
          avatarUrl: conv.avatarUrl,
          threadUrl: threadUrl.includes('/messaging/') ? threadUrl : '',
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
          unreadCount: conv.unreadCount,
        });

        console.log(`[InboxScrape] ✓ ${conv.name} → ${threadUrl}`);
      } catch (err) {
        console.warn(`[InboxScrape] Error clicking ${conv.name}:`, err);
        finalResults.push({
          name: conv.name,
          headline: '',
          avatarUrl: conv.avatarUrl,
          threadUrl: '',
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
          unreadCount: conv.unreadCount,
        });
      }
    }

    // Navigate back to /messaging/ root after clicking through
    try {
      await (page as any).goto('https://www.linkedin.com/messaging/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
    } catch {}

    const deduped = finalResults.filter(
      (c, idx, arr) => idx === 0 || arr.findIndex(x => x.name === c.name) === idx
    );

    logActivity('inbox_sidebar_scraped', 'inbox', { count: deduped.length });
    console.log('[InboxScrape] ✅ Scraped ' + deduped.length + ' conversations total.');
    return deduped;

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logActivity('inbox_sidebar_scrape_failed', 'inbox', { error: msg }, 'error', msg);
    console.error('[InboxScrape] Failed:', msg);
    return [];
  }
}
