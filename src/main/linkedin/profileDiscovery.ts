/**
 * Profile Discovery Engine — v4 (Entity-First State Machine)
 *
 * Architecture: Linked Helper-grade Entity-Based Discovery.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  PHASE 1  Container Lock & Entity Extraction                    │
 * │  Lock onto the search list container. Extract ALL visible       │
 * │  [role="listitem"] elements as "Lead Entities" with their       │
 * │  profile URLs and names. Never scroll globally — only scroll    │
 * │  to center a specific lead that is already in the entity list.  │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  PHASE 2  Targeted Lead Selection                               │
 * │  Pick from the unvisited candidate pool. scrollIntoView center  │
 * │  triggers LinkedIn's IntersectionObserver (human gaze signal).  │
 * │  SQLite duplicate guard before any click.                       │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  PHASE 3  Precision Anchor Interaction                          │
 * │  Find the <a href*="/in/"> inside the listitem (the name link). │
 * │  Bézier mouse move → MouseDown → 200ms → MouseUp.              │
 * │  Event.isTrusted === true (hardware-level trusted event).       │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  PHASE 4  State-Aware Navigation & Return                       │
 * │  Wait for /in/ URL + networkIdle. Scraper handoff.             │
 * │  window.history.back() preserves LazyColumn scroll + cache.    │
 * │  1.5s stability wait before next candidate.                     │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  PHASE 5  Anti-Detection Safeguards                             │
 * │  45–90s rest every 3 profiles. All interaction within <main>.   │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * KEY FIXES vs v3:
 *   v3 used geometric offset from Connect button → risky (hit whitespace)
 *   v4 directly targets the <a> tag bounding box center → precision click
 *
 *   v3 used sequential cardIndex → linear bot-like pattern
 *   v4 uses random selection from unvisited entity pool → human-like
 *
 *   v3 data-testid="lazy-column" fallback → not in DOM on this LI version
 *   v4 uses [role="list"] inside main as container, [role="listitem"] as entities
 */

import type { Page } from "puppeteer-core";
import { humanDelay, humanMouseMove, smoothScrollToEntity, humanScroll } from "../browser/humanizer";
import { getDatabase } from "../storage/database";
import { performSearch } from "../browser/session";
import { BrowserWindow } from "electron";

export function sendDiscoveryLog(message: string) {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    windows[0].webContents.send(
      "autopilot-log",
      `[${new Date().toLocaleTimeString()}] ${message}`
    );
  }
  console.log(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoveredProfile {
  profileUrl: string;
  name: string;
  headline: string;
}

/** A lead entity extracted in Phase 1 */
interface LeadEntity {
  /** 0-based index into document.querySelectorAll('[role="listitem"]') */
  domIndex: number;
  profileUrl: string;
  name: string;
  headline: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DB_SKIP_STATUSES = new Set([
  "connection_requested",
  "connected",
  "messaged",
  "profile_scraped",
]);

// ─────────────────────────────────────────────────────────────────────────────
// ProfileDiscoveryEngine v4
// ─────────────────────────────────────────────────────────────────────────────

export class ProfileDiscoveryEngine {
  private page: Page;
  private searchUrl: string;

  /** Session-level visited URLs (across all pages) */
  private sessionVisited = new Set<string>();

  /** Unvisited candidate pool for the current page */
  private candidatePool: LeadEntity[] = [];

  /** Current pagination page (1-based, for logging) */
  private pageNum = 1;

  /** Whether init() has succeeded */
  private initialized = false;

  /** Track total profiles processed for rest-period triggering (injected from autopilot) */
  public profilesThisBatch = 0;

  /** Organic Drop-off: Capped limit per page (e.g. 6-7 out of 10) */
  private maxProfilesPerPage = 0;
  private processedProfilesThisPage = 0;

  constructor(page: Page, searchUrl: string) {
    this.page = page;
    this.searchUrl = searchUrl;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Navigate to the search URL, wait for container lock, and extract
   * the first pool of lead entities.
   */
  async init(): Promise<void> {
    const page = this.page;

    let isKeywordMatch = !this.searchUrl.startsWith("http");
    let keywordToSearch = this.searchUrl;

    if (!isKeywordMatch) {
      try {
        const urlObj = new URL(this.searchUrl);
        const keywordsParam = urlObj.searchParams.get("keywords");
        if (keywordsParam) {
          isKeywordMatch = true;
          keywordToSearch = keywordsParam;
          sendDiscoveryLog(`[Discovery] Extracted keyword "${keywordToSearch}" from URL to perform human-centric search (searching keyword like ${keywordToSearch}).`);
        }
      } catch {
        // ignore invalid URL parsing errors
      }
    }

    if (isKeywordMatch) {
      sendDiscoveryLog(`[Discovery] Searching keyword (like ${keywordToSearch})... Performing human-centric search.`);
      await performSearch(page, keywordToSearch, "people");
    } else {
      const onSearch =
        page.url().includes("linkedin.com/search/results/people") ||
        page.url().includes(this.searchUrl.split("?")[0]);

      if (!onSearch) {
        sendDiscoveryLog("[Discovery] Navigating to search URL directly (no keywords found)...");
        await page.goto(this.searchUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      } else {
        sendDiscoveryLog("[Discovery] Already on search page.");
      }

      // Explicit Check for filter if user pasted a global /all/ search URL
      if (this.searchUrl.includes("/search/results/") && !this.searchUrl.includes("/search/results/people/")) {
        const { applySearchFilter } = await import("../browser/session");
        await applySearchFilter(page, "people");
      }
    }

    await this._containerLockAndExtract();

    this.pageNum = 1;
    this.initialized = true;
    
    // Set human drop-off rate for page 1 (process ~6-7 profiles instead of all 10)
    this.maxProfilesPerPage = Math.floor(Math.random() * 2) + 6; // 6 to 7
    this.processedProfilesThisPage = 0;
    
    sendDiscoveryLog(
      `[Discovery] ✅ Page hydrated. Human reading mode: Will process ${this.maxProfilesPerPage} random profiles to mimic selective scrolling.`
    );
  }

  /**
   * Phase 2–4: Select next unvisited candidate, scroll it to center,
   * click the name anchor directly, wait for navigation, return profile data.
   *
   * Returns null when the pool is empty (caller should call goToNextPage()).
   */
  async discoverNextProfile(): Promise<DiscoveredProfile | null> {
    if (!this.initialized) throw new Error("[Discovery] call init() first.");

    // ── Phase 2: Pick from unvisited candidate pool ───────────────────────
    const candidate = this._pickCandidate();

    if (!candidate) {
      sendDiscoveryLog("[Discovery] Candidate pool empty. Page exhausted.");
      return null;
    }

    sendDiscoveryLog(
      `[Discovery] Selected candidate: "${candidate.name}" → ${candidate.profileUrl} (domIndex ${candidate.domIndex})`
    );

    // Mark visited immediately to prevent double-processing
    this.sessionVisited.add(candidate.profileUrl);

    // ── Phase 2: Human Gaze — scroll listitem to viewport center ─────────
    await smoothScrollToEntity(this.page, candidate.domIndex);

    // Let IntersectionObserver fire (LinkedIn's "human gaze" proof)
    await humanDelay(1200, 3000);

    // ── Phase 3: Precision Anchor Interaction ─────────────────────────────
    const result = await this._clickAnchorAndNavigate(candidate);
    return result;
  }

  /**
   * Phase 4 Return: Execute history.back() and wait for list stability.
   * Called AFTER scraper + connector have finished on the profile page.
   */
  async rewindToSearch(): Promise<boolean> {
    const page = this.page;
    sendDiscoveryLog("[Discovery] history.back() — restoring search context...");

    await page.evaluate(() => window.history.back());

    // Wait for search URL to reappear
    const returned = await page
      .waitForFunction(
        () =>
          window.location.href.includes("/search/results") ||
          window.location.href.includes("/search/people"),
        { timeout: 15000 }
      )
      .then(() => true)
      .catch(() => false);

    if (!returned) {
      console.warn("[Discovery] history.back() failed. Hard navigating to searchUrl...");
      await page.goto(this.searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    }

    // Phase 4: 1.5s stability wait (let LazyColumn re-render)
    await humanDelay(1500, 2500);

    // Re-extract entities in case the pool was stale (React may have re-hydrated
    // different items after back-navigation)
    await this._refreshCandidatePool();

    sendDiscoveryLog(
      `[Discovery] Search context restored. Pool has ${this.candidatePool.length} unvisited candidates.`
    );
    return true;
  }

  /**
   * Navigate to the next pagination page. Returns false if no next page.
   */
  async goToNextPage(): Promise<boolean> {
    const page = this.page;
    sendDiscoveryLog(`[Discovery] Trying to move to page ${this.pageNum + 1}...`);

    // Scroll to bottom to render pagination within <main>
    await page.evaluate(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
    );
    await humanDelay(1200, 2000);

    // Locate Next button (multiple fallbacks)
    const nextHandle = await page.evaluateHandle(() => {
      const selectors = [
        'button.artdeco-pagination__button--next',
        'button[aria-label="Next"]',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel) as HTMLButtonElement | null;
        if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
          const r = btn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return btn;
        }
      }
      // Text fallback
      const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
      for (const btn of btns) {
        if (
          btn.textContent?.trim().toLowerCase() === "next" &&
          !btn.disabled &&
          btn.getAttribute("aria-disabled") !== "true"
        ) {
          const r = btn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return btn;
        }
      }
      return null;
    });

    const nextBtn = nextHandle.asElement() as any;
    if (!nextBtn) {
      sendDiscoveryLog("[Discovery] No Next button found. All pages exhausted.");
      return false;
    }

    const box = await nextBtn.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await humanMouseMove(page, cx, cy);
      await humanDelay(80, 180);
      await page.mouse.down();
      await humanDelay(150, 250);
      await page.mouse.up();
    } else {
      await page.evaluate((el: Element) => (el as HTMLElement).click(), nextBtn);
    }

    await humanDelay(1800, 3000);

    // Container lock on new page
    await this._containerLockAndExtract();
    this.pageNum++;
    
    // Reset drop-off tracker for the new page
    this.maxProfilesPerPage = Math.floor(Math.random() * 2) + 6; // 6 to 7
    this.processedProfilesThisPage = 0;
    
    sendDiscoveryLog(
      `[Discovery] Page ${this.pageNum} loaded. Pool: ${this.candidatePool.length} candidates. Will process ${this.maxProfilesPerPage} profiles.`
    );
    return true;
  }

  /** Advance (skip) without navigating — used externally for already-visited profiles */
  advance(): void {
    // Pool-based model: candidates are already removed when picked; advance is a no-op
    sendDiscoveryLog("[Discovery] advance() called — pool manages itself.");
  }

  getState(): { pageNum: number; poolSize: number } {
    return { pageNum: this.pageNum, poolSize: this.candidatePool.length };
  }

  // ─── Private — Phase 1: Container Lock & Entity Extraction ────────────────

  /**
   * Phase 1 full sequence:
   * 1. Lock onto main search container
   * 2. Trigger React hydration if needed (300px scroll)
   * 3. Extract all listitem entities into candidatePool
   */
  private async _containerLockAndExtract(): Promise<void> {
    sendDiscoveryLog("[Discovery] Phase 1: Container lock & entity extraction...");

    // Step 1: Wait for the container — try data-testid first, then semantic fallbacks
    const containerFound = await this.page
      .waitForFunction(
        () => {
          // LinkedIn may or may not have data-testid="lazy-column"
          const byTestId = document.querySelector('[data-testid="lazy-column"]');
          if (byTestId) return true;

          // Semantic: a [role="list"] inside <main>
          const main = document.querySelector("main");
          if (!main) return false;
          const roleList = main.querySelector('[role="list"]');
          if (roleList) return true;

          // Final fallback: any listitem or standard ul > li
          return document.querySelectorAll('ul[role="list"] > li, .reusable-search__entity-result-list > li, [role="listitem"]').length > 0;
        },
        { timeout: 25000 }
      )
      .then(() => true)
      .catch(() => false);

    if (!containerFound) {
      console.warn("[Discovery] Container not found in 25s. Attempting scroll...");
    }

    // Step 2: Check listitem count
    let count = await this.page.evaluate(
      () => document.querySelectorAll('ul[role="list"] > li, .reusable-search__entity-result-list > li, [role="listitem"]').length
    );

    if (count === 0) {
      console.warn("[Discovery] CONTAINER_EMPTY. Could not extract entities. Will try next page.");
      this.candidatePool = [];
      return;
    }

    sendDiscoveryLog(`[Discovery] Container locked. ${count} listitems found.`);
    
    // ── Phase 1: Emulate human reading behaviour by naturally scrolling ──
    const page = this.page;
    sendDiscoveryLog(`[Discovery] Emulating human name-reading (scrolling up/down 1-2 times)...`);
    
    // A specific sequence of scrolling: Down slightly, pause, down more, up slightly, down to bottom, up to top.
    const scrollCycles = Math.floor(Math.random() * 2) + 2; // 2 to 3 iterations
    
    for (let c = 0; c < scrollCycles; c++) {
       // Scroll down
       await humanScroll(page, {
         direction: "down",
         distance: 300 + Math.random() * 400,
       });
       await humanDelay(1000, 2500); // Wait as if reading
       
       // Occasionally reverse scroll slightly
       if (Math.random() < 0.3) {
          await humanScroll(page, {
             direction: "up",
             distance: 100 + Math.random() * 200,
          });
          await humanDelay(1500, 3000);
       }
    }
    
    // Finally ensure we scroll the rest of the page to hydrate all lazy-loaded lists
    for (let i = 0; i < 2; i++) {
      await humanScroll(page, { direction: "down", distance: 500 });
      await humanDelay(500, 1000);
    }
    // Return completely to top 
    await humanScroll(page, { direction: "up", distance: 2000 });
    await humanDelay(800, 1500);

    // Step 3: Extract all lead entities
    await this._extractEntities();
  }

  /**
   * Extract LeadEntity objects from all current [role="listitem"] elements
   * that are inside <main> and contain a valid /in/ profile link.
   * Filters out already-visited (sessionVisited or DB) leads.
   */
  private async _extractEntities(): Promise<void> {
    const rawEntities: LeadEntity[] = await this.page.evaluate(() => {
      const main = document.querySelector("main");
      const allItems = Array.from(
        document.querySelectorAll('ul[role="list"] > li, .reusable-search__entity-result-list > li, [role="listitem"]')
      ) as HTMLElement[];

      const results: Array<{
        domIndex: number;
        profileUrl: string;
        name: string;
        headline: string;
      }> = [];

      allItems.forEach((card, idx) => {
        // Restrict to cards inside <main>
        if (main && !main.contains(card)) return;

        // Must be visible (have a bounding box with height)
        const cardRect = card.getBoundingClientRect();
        if (cardRect.width === 0 && cardRect.height === 0) return;

        // Find the primary profile name link: <a href*="/in/">
        const links = Array.from(
          card.querySelectorAll('a[href*="/in/"]')
        ) as HTMLAnchorElement[];

        if (links.length === 0) return;

        // Use the FIRST /in/ link that has a non-zero bounding box
        let profileUrl = "";
        let linkRect: DOMRect | null = null;

        for (const link of links) {
          const r = link.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            try {
              const u = new URL(link.href);
              const canonical = `${u.origin}${u.pathname}`.replace(/\/$/, "");
              if (canonical.includes("/in/")) {
                profileUrl = canonical;
                linkRect = r;
                break;
              }
            } catch {
              // ignore malformed hrefs
            }
          }
        }

        if (!profileUrl) return;

        // Extract name from "View X's profile" accessibility span
        const allSpans = Array.from(
          card.querySelectorAll("span")
        ) as HTMLSpanElement[];
        const viewSpan = allSpans.find((s) =>
          /view .+(?:[''\u2019]s)? profile/i.test(s.textContent || "")
        );
        const spanText = viewSpan?.textContent?.trim() || "";
        const nameMatch = spanText.match(
          /^View (.+?)(?:['\u2019]s? profile)?$/i
        );
        const name = nameMatch?.[1]?.trim() || spanText || "Unknown";

        // Extract headline: first short leaf-node text that isn't the name or CTA text
        let headline = "";
        const leafEls = Array.from(
          card.querySelectorAll("span, div")
        ) as HTMLElement[];
        for (const el of leafEls) {
          if (el.children.length > 0) continue;
          const txt = (el.innerText || el.textContent || "").trim();
          if (
            txt.length > 5 &&
            txt.length < 200 &&
            !txt.startsWith("View ") &&
            !["connect", "follow", "message", "pending", "withdraw"].includes(
              txt.toLowerCase()
            ) &&
            !txt.toLowerCase().includes("mutual connection") &&
            txt !== name
          ) {
            headline = txt;
            break;
          }
        }

        results.push({ domIndex: idx, profileUrl, name, headline });
      });

      return results;
    });

    // Filter out session-visited and DB-processed
    const freshCandidates = rawEntities.filter(
      (e) =>
        !this.sessionVisited.has(e.profileUrl) &&
        !this._isDbProcessed(e.profileUrl)
    );

    this.candidatePool = freshCandidates;
    const fetchedNames = freshCandidates.map(c => c.name).join(", ");
    sendDiscoveryLog(
      `[Discovery] Entity extraction: ${rawEntities.length} raw, ` +
        `${freshCandidates.length} fresh candidates.`
    );
    sendDiscoveryLog(`[Discovery] Fetching names of profiles: [${fetchedNames}]`);
  }

  /**
   * Refresh the candidate pool after history.back() without full re-lock.
   * Re-extracts entities and filters already-visited.
   */
  private async _refreshCandidatePool(): Promise<void> {
    const count = await this.page.evaluate(
      () => document.querySelectorAll('ul[role="list"] > li, .reusable-search__entity-result-list > li, [role="listitem"]').length
    );

    if (count === 0) {
      console.warn("[Discovery] Post-back: no listitems found. Pool stays empty.");
      this.candidatePool = [];
      return;
    }

    await this._extractEntities();
  }

  // ─── Private — Phase 2: Candidate Selection ───────────────────────────────

  /**
   * Pick one unvisited candidate randomly from the pool and remove it.
   * Returns null when the pool is empty.
   */
  private _pickCandidate(): LeadEntity | null {
    if (this.candidatePool.length === 0) return null;

    // Organic drop-off: We only visit maxProfilesPerPage (e.g. 6-7 profiles) per page
    if (this.processedProfilesThisPage >= this.maxProfilesPerPage) {
      sendDiscoveryLog(`[Discovery] Hit organic drop-off limit (${this.processedProfilesThisPage}/${this.maxProfilesPerPage}). Treating remaining pool as uninteresting.`);
      return null;
    }

    // Random selection — non-linear, human-like
    const idx = Math.floor(Math.random() * this.candidatePool.length);
    const [candidate] = this.candidatePool.splice(idx, 1);
    
    this.processedProfilesThisPage++;
    return candidate;
  }

  // ─── Private — Phase 3: Precision Click ──────────────────────────────────

  /**
   * Phase 3 + 4: Locate the <a> tag bounding box inside the listitem,
   * Bézier-move the mouse to its center, fire a hardware-level click,
   * then wait for profile page navigation and hydration.
   */
  private async _clickAnchorAndNavigate(
    candidate: LeadEntity
  ): Promise<DiscoveredProfile | null> {
    const page = this.page;
    
    sendDiscoveryLog(`[Discovery] Interacting with target profile card... (domIndex: ${candidate.domIndex})`);

    // 1. Get live bounding boxes for both the Card and the Name Link
    const boxes = await page.evaluate((idx: number) => {
      const items = document.querySelectorAll('ul[role="list"] > li, .reusable-search__entity-result-list > li, [role="listitem"]');
      const card = items[idx] as HTMLElement;
      const anchor = card?.querySelector('a[href*="/in/"]') as HTMLElement;
      if (!card || !anchor) return null;

      const cRect = card.getBoundingClientRect();
      const aRect = anchor.getBoundingClientRect();
      return {
        card: { x: cRect.left, y: cRect.top, w: cRect.width, h: cRect.height },
        anchor: { x: aRect.left, y: aRect.top, w: aRect.width, h: aRect.height }
      };
    }, candidate.domIndex);

    if (!boxes) {
      console.warn(`[Discovery] No visible boxes for "${candidate.name}" (domIndex ${candidate.domIndex}). Skipping.`);
      return null;
    }

    // PHASE A: The "Gaze" (The Scan) - Hover over the card first
    // Move the mouse to a neutral, non-clickable area of the profile card (e.g., the right-side white space).
    const gazeX = boxes.card.x + (boxes.card.w * 0.8) + (Math.random() * 20);
    const gazeY = boxes.card.y + (boxes.card.h * 0.5);
    await page.mouse.move(gazeX, gazeY, { steps: 20 });
    
    // PHASE B: The Thinking Delay
    // Pause the execution for a randomized duration (1200ms to 2800ms) using a bell-curve distribution to simulate a human reading the headline.
    await humanDelay(1200, 2800);

    // PHASE C: The Target & Hardware-Level Precision Click
    // Move from the neutral area to the center of the name link using a curved path
    const clickX = boxes.anchor.x + (boxes.anchor.w / 2) + ((Math.random() - 0.5) * 10);
    const clickY = boxes.anchor.y + (boxes.anchor.h / 2) + ((Math.random() - 0.5) * 10);
    
    sendDiscoveryLog(
      `[Discovery] Clicking on profile (with exact name: "${candidate.name}") → precision click at anchor center (${Math.round(clickX)}, ${Math.round(clickY)})`
    );

    // Move to target using high steps for a smooth, curved-like path (at least 25)
    await page.mouse.move(clickX, clickY, { steps: 30 }); 
    
    // Hardware-Level Trusted Click Sequence: MouseDown -> Delay(100, 250) -> MouseUp
    await page.mouse.down();
    await humanDelay(100, 250);
    await page.mouse.up();

    sendDiscoveryLog("[Discovery] Hardware click dispatched (isTrusted=true).");

    // Phase 4: Wait for URL to change to a profile page
    const navOk = await page
      .waitForFunction(
        () =>
          window.location.href.includes("/in/") &&
          !window.location.href.includes("/search/"),
        { timeout: 18000 }
      )
      .then(() => true)
      .catch(() => {
        // Accept if we're on any /in/ URL (LinkedIn may canonicalize vanity)
        return (
          page.url().includes("/in/") &&
          !page.url().includes("/search/")
        );
      });

    if (!navOk) {
      console.warn(
        `[Discovery] Navigation timeout. Still at: ${page.url()}. Skipping.`
      );
      return null;
    }

    // Phase 4: Wait for network idle (1s) — ensures profile XHR data is loaded
    await page
      .waitForNetworkIdle({ idleTime: 1000, timeout: 12000 })
      .catch(() =>
        console.warn("[Discovery] Network idle timeout — continuing.")
      );

    // Phase 4: Wait for profile top-card DOM to be visible
    await page
      .waitForSelector(
        ".pv-top-card, [data-member-id], .ph5, .profile-topcard, main .artdeco-card",
        { visible: true, timeout: 12000 }
      )
      .catch(() =>
        console.warn("[Discovery] Top-card not detected — continuing.")
      );

    // Extra React hydration time
    await humanDelay(1200, 2200);

    const finalUrl = this._canonicalUrl(page.url());
    sendDiscoveryLog(`[Discovery] ✅ Profile ready: ${finalUrl}`);

    return {
      profileUrl: finalUrl,
      name: candidate.name,
      headline: candidate.headline,
    };
  }

  // ─── Private — DB Duplicate Guard ────────────────────────────────────────

  private _isDbProcessed(profileUrl: string): boolean {
    try {
      const db = getDatabase();
      const row = db
        .prepare("SELECT status FROM leads WHERE linkedin_url = ?")
        .get(profileUrl) as { status: string } | undefined;
      return row ? DB_SKIP_STATUSES.has(row.status) : false;
    } catch {
      return false;
    }
  }

  // ─── Private — Utility ────────────────────────────────────────────────────

  private _canonicalUrl(raw: string): string {
    try {
      const u = new URL(raw);
      return `${u.origin}${u.pathname}`.replace(/\/$/, "");
    } catch {
      return raw.split("?")[0].replace(/\/$/, "");
    }
  }
}
