/**
 * LinkedIn Connection Request Manager
 *
 * Sends connection requests with AI-personalized notes via Mixtral 8x7B.
 * Full flow: find connect button → click connect → click "Add a note" → type AI note → send.
 *
 * Safety features:
 * - Respects daily limits
 * - Natural delays between requests
 * - Profile is "read" before any interaction
 * - AI note generation happens BEFORE opening the modal (no latency inside UI)
 * - Graceful fallback to "Send without a note" if note modal unavailable
 * - Handles LinkedIn's "How do you know X?" dialog
 */

import type { Page } from "puppeteer-core";
import type { LinkedInProfile, AppSettings } from "../../shared/types";
import { getPage } from "../browser/engine";
import {
  humanClick,
  humanType,
  humanTypeSlowly,
  humanDelay,
  thinkingDelay,
  pageLoadDelay,
  randomIdleAction,
  DailyLimitManager,
  inPageNavigate,
} from "../browser/humanizer";
import { generateConnectionNote } from "../ai/personalizer";
import { logActivity, updateLeadStatus } from "../storage/database";

/**
 * Send a connection request to a profile
 */
export async function sendConnectionRequest(
  profile: any,
  context: {
    yourName: string;
    yourCompany: string;
    yourServices: string;
  },
  settings: any,
  limitManager: DailyLimitManager,
): Promise<{
  success: boolean;
  noteSent: boolean;
  note: string | null;
  error?: string;
}> {
  const page = getPage();
  if (!page) throw new Error("Browser not launched");

  // Check daily limit
  if (!limitManager.canPerform("connectionRequests")) {
    return {
      success: false,
      noteSent: false,
      note: null,
      error: "Daily connection request limit reached",
    };
  }

  // ── STEP 0: Generate AI note BEFORE browser interactions ──────────
  // We generate the note before any UI interaction so that:
  // 1. There's zero latency between opening the note textarea and typing.
  // 2. If AI generation fails, we can gracefully fall back to no-note without
  //    having already opened the modal (cleaner state machine).
  let aiNote: string | null = null;
  try {
    console.log(`[Connector] Generating AI connection note for ${profile.firstName} ${profile.lastName}…`);
    aiNote = await generateConnectionNote(profile, context, settings.ai);
    console.log(`[Connector] AI note generated (${aiNote.length} chars): "${aiNote.substring(0, 60)}…"`);
  } catch (aiError) {
    const aiMsg = aiError instanceof Error ? aiError.message : "Unknown AI error";
    console.warn(`[Connector] AI note generation failed — will send without note. Reason: ${aiMsg}`);
    logActivity("ai_note_generation_failed", "ai", {
      name: `${profile.firstName} ${profile.lastName}`,
      error: aiMsg,
    }, "error", aiMsg);
  }

  try {
    // ── ALWAYS navigate to the target profile ─────────────────────────────
    // We navigate unconditionally (not just-if-needed) because a concurrent
    // job (e.g. CHECK_ACCEPTANCE) may have moved the browser to a different
    // lead's page between SCRAPE_PROFILE finishing and this job starting.
    // An optimistic "are we already there?" check is unsafe — even if the URL
    // matches, the page may still be mid-navigation from a prior job.
    console.log(`[Connector] Navigating to profile: ${profile.linkedinUrl}`);
    const currentUrl = page.url();
    const normCurrent = currentUrl.replace(/\/$/, '').split('?')[0].toLowerCase();
    const normTarget = profile.linkedinUrl.replace(/\/$/, '').split('?')[0].toLowerCase();

    if (normCurrent !== normTarget) {
      // We are on a different page — use inPageNavigate if we're within LinkedIn
      // (SPA navigation), otherwise fall back to a full goto.
      try {
        await inPageNavigate(page, profile.linkedinUrl);
      } catch (navErr) {
        // inPageNavigate can fail if the current page is in a bad/transitional state.
        // Fall back to a hard goto which is always reliable.
        console.warn(`[Connector] inPageNavigate failed (${navErr instanceof Error ? navErr.message : navErr}) — falling back to page.goto()`);
        await page.goto(profile.linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
    } else {
      // Same URL — but still reload to get a clean DOM state,
      // in case the page is stuck mid-navigation from a previous job.
      console.log(`[Connector] Already on target URL — reloading for a clean state...`);
      await page.goto(profile.linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // Wait for the profile card to fully mount before any DOM interaction
    await page
      .waitForSelector('.pv-top-card, .ph5.pb5, main, .core-rail', { timeout: 15000 })
      .catch(() => null);
    await pageLoadDelay();

    // Find the Connect button
    const connectButton = await findConnectButton(page);

    if (connectButton === "ALREADY_CONNECTED") {
      console.log("[Connector] Found 'Pending' or 'Remove Connection'. Marking job as COMPLETED_SKIPPED.");
      return { success: false, noteSent: false, note: null, error: "COMPLETED_SKIPPED" };
    }

    if (connectButton === "EMAIL_NEEDED") {
      console.log("[Connector] Found Message button but 'Connect' is missing. Triggering Module C placeholder.");
      return { success: false, noteSent: false, note: null, error: "EMAIL_NEEDED" };
    }

    if (!connectButton) {
      return {
        success: false,
        noteSent: false,
        note: null,
        error: "Connect button not found — may already be connected or pending",
      };
    }

    // Natural pause before clicking (reads profile)
    await thinkingDelay();

    // Click Connect
    // NOTE: We use ONLY the physical humanClick (Bézier curve + mouse coords).
    // We do NOT fire a secondary JS .click() — that produces a synthetic event
    // with zero coordinates and is a detectable automation fingerprint.
    console.log("[Connector] Clicking Connect button…");
    try {
      await humanClick(page, connectButton as any);
    } catch (clickErr) {
      // If humanClick fails (e.g., element went stale), scroll into view and retry once
      console.log("[Connector] humanClick failed — scrolling into view and retrying...");
      try {
        await page.evaluate((el: Element) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), connectButton as any);
        await humanDelay(600, 1000);
        await humanClick(page, connectButton as any);
      } catch {
        console.log("[Connector] Connect click failed after scroll retry. Aborting.");
        return { success: false, noteSent: false, note: null, error: "Connect button click failed" };
      }
    }

    await humanDelay(1500, 2500);

    // ── HANDLE "HOW DO YOU KNOW X?" EARLY ──────────────────────────
    // This dialog can appear immediately after clicking Connect.
    // Dismiss it before we try to find the note modal.
    await dismissHowDoYouKnowDialog(page);
    await humanDelay(500, 1000);

    // ── ROUTE A: "Add a note" flow (primary path) ──────────────────
    // We always try to add a note first (even if AI failed, we check availability).
    // If the modal doesn't offer the note option, we fall through to Route B.
    if (aiNote) {
      const noteFlowResult = await tryAddNoteFlow(page, aiNote);

      // ── LINKEDIN MONTHLY CUSTOM NOTE LIMIT: popup dismissed, retry connect ──
      // The Premium upsell popup was detected and dismissed. The original Connect
      // modal is now gone. Re-find and re-click the Connect button, then fall into
      // Route B to send without a note — completing the request successfully.
      if (noteFlowResult === "LIMIT_DISMISSED_RETRY") {
        console.log("[Connector] Premium popup dismissed — re-clicking Connect to send without a note...");
        await humanDelay(1200, 2000);

        const retryConnectBtn = await findConnectButton(page);
        if (retryConnectBtn && retryConnectBtn !== "ALREADY_CONNECTED" && retryConnectBtn !== "EMAIL_NEEDED") {
          try {
            await humanClick(page, retryConnectBtn as any);
          } catch {
            const box2 = await (retryConnectBtn as any).boundingBox();
            if (box2) {
              await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 15 });
              await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
            }
          }
          await humanDelay(1500, 2500);
          await dismissHowDoYouKnowDialog(page);
          await humanDelay(500, 1000);
          // Route B will run below — fall through by not returning here
          console.log("[Connector] Connect re-clicked after limit popup — falling through to 'Send without a note'.");
        } else {
          // If the Connect button is gone (already connected from the retry), treat as success
          console.log("[Connector] Connect button gone after popup dismiss — likely already sent.");
          logActivity("linkedin_invite_limit_reached", "linkedin", {
            name: `${profile.firstName} ${profile.lastName}`,
          }, "error");
          return { success: false, noteSent: false, note: null, error: "LINKEDIN_LIMIT_REACHED" };
        }
      } else if (noteFlowResult === "LIMIT_REACHED") {
        // Legacy sentinel — treat same as LIMIT_REACHED
        console.log("[Connector] LinkedIn invitation limit confirmed. Returning LINKEDIN_LIMIT_REACHED.");
        logActivity("linkedin_invite_limit_reached", "linkedin", {
          name: `${profile.firstName} ${profile.lastName}`,
        }, "error");
        return { success: false, noteSent: false, note: null, error: "LINKEDIN_LIMIT_REACHED" };
      }

      if (noteFlowResult === true) {
        // ── POST-SEND VERIFICATION ──────────────────────────────────
        await humanDelay(1500, 2500);
        const verified = await verifyConnectionSent(page);

        if (verified) {
          console.log(`[Connector] Connection request with note VERIFIED via: ${verified}`);
          limitManager.record("connectionRequests");
          logActivity("connection_request_sent", "linkedin", {
            name: `${profile.firstName} ${profile.lastName}`,
            company: profile.company,
            noteSent: true,
            noteLength: aiNote.length,
            note: aiNote,
            verified,
          });
          updateLeadStatus(profile.id, "connection_requested");
          await randomIdleAction(page);
          return { success: true, noteSent: true, note: aiNote };
        }

        console.log("[Connector] Post-send verification FAILED after note flow.");
        return {
          success: false,
          noteSent: false,
          note: null,
          error: "Connection send could not be verified after note flow",
        };
      }
      // noteFlowResult === false: "Add a note" button not found.
      // Fall through to Route B (Send without a note).
      console.log("[Connector] 'Add a note' path unavailable — falling back to 'Send without a note'.");
    } else {
      console.log("[Connector] No AI note available — going directly to 'Send without a note'.");
    }

    // ── ROUTE B: "Send without a note" fallback ────────────────────
    // Either AI failed or the LinkedIn UI didn't show the "Add a note" button.
    console.log("[Connector] Polling DOM for 'Send without a note' button (up to 15s)...");

    // Attempt 1: Puppeteer native text selector
    let sendBtnHandle: any = await page.waitForSelector('::-p-text(Send without a note)', { timeout: 15000 }).catch(() => null);

    // Attempt 2: ARIA selector
    if (!sendBtnHandle) {
      console.log("[Connector] Text selector failed. Falling back to ARIA selector...");
      sendBtnHandle = await page.waitForSelector('aria/Send without a note', { timeout: 3000 }).catch(() => null);
    }

    // Attempt 3: CSS structural selector + strict visibility
    if (!sendBtnHandle) {
      console.log("[Connector] ARIA selector failed. Falling back to structural CSS...");
      sendBtnHandle = await page.waitForSelector('div.artdeco-modal button.artdeco-button--primary:not([disabled])', { visible: true, timeout: 3000 }).catch(() => null);
    }

    // Attempt 4: JS bounding-box polling (bypasses position:fixed bug)
    if (!sendBtnHandle) {
      console.log("[Connector] Structural CSS failed. Falling back to active JS polling via bounding box...");
      sendBtnHandle = await page.waitForFunction(() => {
        const allBtns = document.querySelectorAll('button');
        for (const b of Array.from(allBtns)) {
          const rect = b.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(b).visibility === 'hidden') continue;
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const text = (b.textContent || '').toLowerCase();
          if (aria.includes('send without a note') || text.includes('send without a note') || aria.includes('send now') || text.includes('send now')) {
            return b;
          }
        }
        return null;
      }, { timeout: 5000 }).catch(() => null);
    }

    const sendBtn = sendBtnHandle ? (sendBtnHandle.asElement() as any) : null;

    if (!sendBtn) {
      console.log("[Connector] 'Send without a note' button NOT FOUND. Did the modal open?");
      const screenshotPath = 'modal_error_diagnostic.png';
      try {
        await page.screenshot({ path: screenshotPath });
        console.log(`[Connector] Captured diagnostic screenshot: ${screenshotPath} (Check project root!)`);
      } catch (e) {
        console.log("[Connector] Failed to capture diagnostic screenshot.");
      }
      return { success: false, noteSent: false, note: null, error: "MODAL_NOT_FOUND" };
    }

    const foundLabel = await page.evaluate(
      (el: Element) => el.getAttribute('aria-label') || el.textContent?.trim() || 'unknown',
      sendBtn
    );
    console.log(`[Connector] Fallback button confirmed: "${foundLabel}"`);

    // ── STABILITY GUARD ────────────────────────────────────────────
    await page.waitForFunction(
      (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 &&
               window.getComputedStyle(el).opacity !== '0' &&
               !(el as HTMLButtonElement).disabled;
      },
      { timeout: 5000 },
      sendBtn
    ).catch(() => null);

    // ── HYBRID CLICK ───────────────────────────────────────────────
    const box = await sendBtn.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      console.log(`[Connector] Box OK: x=${Math.round(box.x)}, y=${Math.round(box.y)}, w=${Math.round(box.width)}, h=${Math.round(box.height)}`);
      await humanDelay(1200, 2500);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy, { steps: 20 });
      await humanDelay(80, 180);
      await page.mouse.click(cx, cy);
      console.log("[Connector] Coordinate click fired on 'Send without a note'.");
    } else {
      // No Puppeteer bounding box — inject getBoundingClientRect into the page
      // to get live coordinates and use the physical mouse (never JS click)
      console.log("[Connector] No bounding box — re-scrolling and using in-page coordinates...");
      const rect = await page.evaluate((el: Element) => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
      }, sendBtn);
      if (rect && rect.width > 0) {
        await humanDelay(400, 700);
        await page.mouse.move(rect.x, rect.y, { steps: 15 });
        await humanDelay(80, 150);
        await page.mouse.click(rect.x, rect.y);
        console.log("[Connector] In-page coordinate click fired on 'Send without a note'.");
      } else {
        console.log("[Connector] Element not visible — skipping Send without a note click.");
      }
    }

    // Post-click: wait for the button itself to detach from DOM (modal closed)
    await page.waitForFunction(
      (btn: Element) => !document.body.contains(btn),
      { timeout: 4000 },
      sendBtn
    ).catch(() => null);

    // ── POST-SEND VERIFICATION ──────────────────────────────────────
    await humanDelay(1500, 2500);
    const verified = await verifyConnectionSent(page);

    if (verified) {
      console.log(`[Connector] Connection request (no note) VERIFIED via: ${verified}`);
      limitManager.record("connectionRequests");
      logActivity("connection_request_sent", "linkedin", {
        name: `${profile.firstName} ${profile.lastName}`,
        company: profile.company,
        noteSent: false,
        noteLength: 0,
        verified,
      });
      updateLeadStatus(profile.id, "connection_requested");
      await randomIdleAction(page);
      return { success: true, noteSent: false, note: null };
    }

    console.log("[Connector] Post-send verification FAILED — connection may not have been sent.");
    return {
      success: false,
      noteSent: false,
      note: null,
      error: "Connection send could not be verified — modal may still be open or no success indicator found",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity(
      "connection_request_failed",
      "linkedin",
      { name: `${profile.firstName} ${profile.lastName}`, error: message },
      "error",
      message,
    );
    return {
      success: false,
      noteSent: false,
      note: null,
      error: message,
    };
  }
}


/**
 * Verify that a connection request was successfully sent.
 * Checks 3 signals: success toast, modal closure, or "Pending" button appearing.
 * Returns the signal name (string) if verified, null if not.
 */
async function verifyConnectionSent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Check 1: LinkedIn success toast
    const toast = document.querySelector(
      '.artdeco-toast-item, .artdeco-toast-item--visible, [data-test-artdeco-toast]'
    );
    if (toast) {
      const toastText = toast.textContent?.toLowerCase() || "";
      if (toastText.includes("sent") || toastText.includes("invitation") || toastText.includes("request")) {
        return "toast";
      }
    }

    // Check 2: Modal closed AND no "How do you know" or "Email needed" remains
    // If the main connect modal is gone, it's a strong signal
    const modalStillOpen = document.querySelector(
      '.artdeco-modal--active, .artdeco-modal:not([style*="display: none"]), [role="dialog"]'
    );
    
    // Check 3: Profile button now shows "Pending" or "Withdraw"
    const buttons = document.querySelectorAll("main button, .pvs-profile-actions button");
    for (const btn of Array.from(buttons)) {
      const text = btn.textContent?.trim().toLowerCase() || "";
      if (text === "pending" || text.includes("pending") || text === "withdraw" || text.includes("withdraw")) {
        return "button_state";
      }
    }

    if (!modalStillOpen) return "modal_closed";

    return null;
  });
}

/**
 * Attempt the "Add a note" UI flow.
 *
 * After the Connect modal opens, LinkedIn shows two buttons:
 *   [Add a note]   [Send without a note]
 *
 * This function:
 *   1. Finds and clicks "Add a note"
 *   2. Waits for the textarea to appear
 *   3. Types the AI-generated note using humanType (variable speed + typos)
 *   4. Finds and clicks the final "Send" / "Send invitation" button
 *
 * Returns true if the note was typed and the Send button was clicked
 * successfully. Returns false if the "Add a note" button was not found
 * (caller should fall back to Route B).
 */
async function tryAddNoteFlow(page: Page, note: string): Promise<boolean | "LIMIT_REACHED" | "LIMIT_DISMISSED_RETRY"> {
  // ── Step 1: Find "Add a note" button (up to 15s) ──────────────────
  console.log("[Connector] Looking for 'Add a note' button in modal…");

  // Attempt A: Puppeteer text selector constrained to buttons
  let addNoteBtn: any = await page
    .waitForSelector('button::-p-text(Add a note), button::-p-text(Personalize), button::-p-text(Add note)', { timeout: 15000 })
    .catch(() => null);

  // Attempt B: ARIA selector
  if (!addNoteBtn) {
    console.log("[Connector] Text selector failed. Falling back to ARIA selector...");
    addNoteBtn = await page
      .waitForSelector('aria/Add a note', { timeout: 3000 })
      .catch(() => page.waitForSelector('aria/Personalize', { timeout: 3000 }).catch(() => null));
  }

  // Attempt C: Structural CSS (secondary modal button)
  if (!addNoteBtn) {
    console.log("[Connector] ARIA selector failed. Falling back to structural CSS...");
    addNoteBtn = await page
      .waitForSelector('div.artdeco-modal button.artdeco-button--secondary:not([disabled])', { visible: true, timeout: 3000 })
      .catch(() => null);
  }

  // Attempt D: JS bounding-box polling — carefully checks buttons only
  if (!addNoteBtn) {
    console.log("[Connector] Structural CSS failed. Falling back to active JS polling via bounding box...");
    const handle = await page.waitForFunction(() => {
      const allBtns = document.querySelectorAll('button');
      for (const b of Array.from(allBtns)) {
        const rect = b.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(b).visibility === 'hidden') continue;
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.textContent || '').toLowerCase();
        // Exact match phrases to avoid matching random modal text
        if (aria.includes('add a note') || text === 'add a note' || text.includes('add a note') || aria.includes('personalize') || text.includes('personalize') || aria.includes('add note') || text.includes('add note') || aria.includes('custom note') || text.includes('custom note')) {
          return b;
        }
      }
      return null;
    }, { timeout: 5000 }).catch(() => null);
    addNoteBtn = handle ? (handle as any).asElement() : null;
  }

  if (!addNoteBtn) {
    console.log("[Connector] 'Add a note' button not found in modal.");
    return false;
  }

  console.log("[Connector] 'Add a note' button found — clicking…");

  // ── HYBRID CLICK (Add a note) ────────────────────────────────────
  const addNoteBox = await addNoteBtn.boundingBox();
  if (addNoteBox && addNoteBox.width > 0 && addNoteBox.height > 0) {
    console.log(`[Connector] Add Note Box OK: x=${Math.round(addNoteBox.x)}, y=${Math.round(addNoteBox.y)}, w=${Math.round(addNoteBox.width)}, h=${Math.round(addNoteBox.height)}`);
    await humanDelay(600, 1200);
    const cx = addNoteBox.x + addNoteBox.width / 2;
    const cy = addNoteBox.y + addNoteBox.height / 2;
    await page.mouse.move(cx, cy, { steps: 20 });
    await humanDelay(80, 180);
    await page.mouse.click(cx, cy);
    console.log("[Connector] Coordinate click fired on 'Add a note'.");
  } else {
    // Re-scroll and pull live coords via in-page evaluate (no JS click)
    console.log("[Connector] No bounding box — re-scrolling and using in-page coordinates...");
    const rect = await page.evaluate((el: Element) => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
    }, addNoteBtn);
    if (rect && rect.width > 0) {
      await humanDelay(400, 700);
      await page.mouse.move(rect.x, rect.y, { steps: 15 });
      await humanDelay(80, 150);
      await page.mouse.click(rect.x, rect.y);
      console.log("[Connector] In-page coordinate click fired on 'Add a note'.");
    } else {
      console.log("[Connector] 'Add a note' not visible after re-scroll — falling through.");
    }
  }

  // ── Step 2: Detect limit popup OR wait for textarea to appear ──────────
  // After clicking "Add a note", LinkedIn shows EITHER:
  //   A) A textarea (note field) — normal path, proceed
  //   B) A "Send unlimited personalized invites with Premium" popup — dismiss & retry
  //
  // IMPORTANT: The Premium upsell popup is NOT in an artdeco modal container.
  // It is a standalone div rendered directly in the page body. We must search
  // the entire document body for keyword/button matches.
  //
  // We race these two detectors with a 8s timeout. Whichever resolves first wins.
  const LIMIT_KEYWORDS = [
    // Classic variants
    "invitation limit",
    "weekly invitation",
    "monthly limit",
    "limit for connection",
    "reached the limit",
    "too many invitations",
    "limit your invitations",
    "sending limit",
    // 2024+ / Premium upsell popup variants (from observed popup DOM)
    "monthly custom invites",
    "personalized invites with premium",
    "used all your monthly",
    "unlimited personalized invites",
    "send unlimited",
  ];

  // ── Helper: DOM-wide limit popup detector ───────────────────────────
  // Searches the ENTIRE page body — not just artdeco containers — because
  // LinkedIn's Premium upsell card is a standalone div with no recognized role.
  const detectLimitPopupOnPage = async (): Promise<{ found: boolean; closeCoords: { x: number; y: number } | null }> => {
    return page.evaluate((keywords: string[]) => {
      const bodyStr = document.body.innerText || document.body.textContent || "";
      const bodyText = bodyStr.toLowerCase().replace(/\s+/g, ' ');
      const hasKeyword = keywords.some((k) => bodyText.includes(k));

      if (!hasKeyword) return { found: false, closeCoords: null };

      // Find the close/× button. Strategy:
      //   1. Explicit aria-label selectors (works for artdeco modals)
      //   2. Any button in the top-right corner of a visible positioned container
      //   3. SVG × icon buttons
      const closeSelectors = [
        '[role="dialog"] button[aria-label="Dismiss"]',
        '[role="dialog"] button[aria-label="Close"]',
        '.artdeco-modal button[aria-label="Dismiss"]',
        '.artdeco-modal button[aria-label="Close"]',
        '.artdeco-modal__dismiss',
        '[data-test-modal-close-btn]',
        'button[aria-label="Dismiss"]',
        'button[aria-label="Close"]',
        'button[aria-label="close"]',
      ];
      for (const sel of closeSelectors) {
        const btn = document.querySelector(sel) as HTMLElement | null;
        if (btn) {
          const r = btn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { found: true, closeCoords: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
        }
      }

      // Fallback: find any visible button in the viewport that is positioned
      // in the top-right corner of a card/popup (x > 60% viewport, y < 400px)
      const vpW = window.innerWidth;
      const allBtns = Array.from(document.querySelectorAll('button')) as HTMLElement[];
      for (const btn of allBtns) {
        const r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.width < 60 && r.height < 60) {
          // Must be in the top-right region of the viewport
          if (r.left > vpW * 0.5 && r.top > 0 && r.top < 400) {
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            const txt = (btn.textContent || '').trim();
            // Prefer close-like buttons; skip CTA buttons
            if (aria.includes('dismiss') || aria.includes('close') || txt === '×' || txt === '' ||
                btn.querySelector('svg') !== null) {
              return { found: true, closeCoords: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
            }
          }
        }
      }

      // Popup found but no close button identified
      return { found: true, closeCoords: null };
    }, LIMIT_KEYWORDS);
  };

  // ── PRE-RACE: Check for the Premium upsell popup AFTER a short delay ─────
  // LinkedIn renders this popup asynchronously — wait briefly to let it mount
  // before we check, then also check right before the textarea race.
  await humanDelay(1000, 1500); // Let the popup mount if it's going to appear
  const preRaceCheck = await detectLimitPopupOnPage().catch(() => ({ found: false, closeCoords: null }));

  if (preRaceCheck.found) {
    console.log("[Connector] ❌ LinkedIn invitation limit popup detected (pre-race check).");
    if (preRaceCheck.closeCoords) {
      const { x, y } = preRaceCheck.closeCoords;
      console.log(`[Connector] Dismissing limit popup via × at (${Math.round(x)}, ${Math.round(y)})…`);
      await page.mouse.move(x, y, { steps: 12 });
      await humanDelay(200, 400);
      await page.mouse.click(x, y);
      await humanDelay(500, 900);
    } else {
      console.log("[Connector] Close button not found — pressing Escape.");
      await page.keyboard.press("Escape");
      await humanDelay(400, 700);
    }
    // Signal to the caller: limit popup was dismissed, retry Connect with no note
    return "LIMIT_DISMISSED_RETRY";
  }

  console.log("[Connector] Waiting 4-5 seconds to let the modal or limit popup render...");
  await humanDelay(4000, 5000);

  // After the delay, check if the limit popup appeared instead of the normal note modal
  const postWaitCheck = await detectLimitPopupOnPage().catch(() => ({ found: false, closeCoords: null }));

  if (postWaitCheck.found) {
    console.log("[Connector] ❌ LinkedIn invitation limit popup detected after wait.");
    if (postWaitCheck.closeCoords) {
      const { x, y } = postWaitCheck.closeCoords;
      console.log(`[Connector] Dismissing limit popup via × at (${Math.round(x)}, ${Math.round(y)})…`);
      await page.mouse.move(x, y, { steps: 12 });
      await humanDelay(200, 400);
      await page.mouse.click(x, y);
      await humanDelay(500, 900);
    } else {
      console.log("[Connector] Close button not found — pressing Escape to dismiss popup.");
      await page.keyboard.press("Escape");
      await humanDelay(400, 700);
    }
    return "LIMIT_DISMISSED_RETRY";
  }

  // If we made it here, no limit popup was found. We assume the textarea is present
  // and currently focused by default by LinkedIn.
  console.log(`[Connector] No limit popup detected. Assuming textarea is active.`);

  // Explicitly focus the textarea JUST IN CASE it lost focus, but if the selector fails,
  // we don't abort—we just blindly type as requested.
  await page.evaluate(() => {
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    if (ta) ta.focus();
  }).catch(() => null);

  // ── Step 3: Type the AI note character by character via page.keyboard ────
  console.log(`[Connector] Composing AI note directly via keyboard (${note.length} chars)…`);

  // Build adjacent-key typo map for human-like errors
  const adjacentKeys: Record<string, string[]> = {
    a: ['s', 'q'], b: ['v', 'n'], c: ['x', 'v'], d: ['s', 'f'],
    e: ['w', 'r'], f: ['d', 'g'], g: ['f', 'h'], h: ['g', 'j'],
    i: ['u', 'o'], j: ['h', 'k'], k: ['j', 'l'], l: ['k', 'o'],
    m: ['n', 'j'], n: ['b', 'm'], o: ['i', 'p'], p: ['o', 'l'],
    r: ['e', 't'], s: ['a', 'd'], t: ['r', 'y'], u: ['y', 'i'],
    v: ['c', 'b'], w: ['q', 'e'], x: ['z', 'c'], y: ['t', 'u'],
    z: ['x', 'a'],
  };
  const TYPO_RATE = 0.04;

  for (let i = 0; i < note.length; i++) {
    const ch = note[i];
    const lower = ch.toLowerCase();
    const delay = 60 + Math.random() * 100;

    if (Math.random() < TYPO_RATE && adjacentKeys[lower]) {
      // Type a wrong key then backspace
      const wrongKey = adjacentKeys[lower][Math.floor(Math.random() * adjacentKeys[lower].length)];
      await page.keyboard.type(wrongKey, { delay });
      await humanDelay(80, 200);
      await page.keyboard.press("Backspace");
      await humanDelay(60, 150);
    }

    await page.keyboard.type(ch, { delay });

    // Occasional mid-word pause (simulates thinking)
    if (Math.random() < 0.03) {
      await humanDelay(400, 900);
    }
  }

  await humanDelay(500, 1200);

  // ── Step 5: Find and click the final Send button ───────────────────
  console.log("[Connector] Looking for 'Send' / 'Send invitation' button…");

  // Attempt A: Text selector strictly constrained to buttons
  let sendBtn: any = await page
    .waitForSelector('button::-p-text(Send invitation)', { timeout: 5000 })
    .catch(() => null);

  if (!sendBtn) {
    console.log("[Connector] Send text selector failed. Trying 'Send' button...");
    sendBtn = await page
      .waitForSelector('button::-p-text(Send)', { timeout: 3000 })
      .catch(() => null);
  }

  // Attempt B: ARIA selectors
  if (!sendBtn) {
    console.log("[Connector] Text selectors failed. Falling back to ARIA...");
    sendBtn = await page
      .waitForSelector('aria/Send invitation', { timeout: 3000 })
      .catch(() => null);
  }
  if (!sendBtn) {
    sendBtn = await page
      .waitForSelector('aria/Send now', { timeout: 3000 })
      .catch(() => null);
  }

  // Attempt C: JS bounding-box polling — thoroughly checks all buttons
  if (!sendBtn) {
    console.log("[Connector] Structural CSS failed. Falling back to active JS polling via bounding box...");
    const handle = await page.waitForFunction(() => {
      const allBtns = document.querySelectorAll('button');
      for (const b of Array.from(allBtns)) {
        const rect = b.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(b).visibility === 'hidden') continue;
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.textContent || '').toLowerCase().trim();
        if (
          aria.includes('send invitation') ||
          aria.includes('send now') ||
          text === 'send' ||
          text === 'send invitation' ||
          text === 'send now'
        ) {
          return b;
        }
      }
      return null;
    }, { timeout: 5000 }).catch(() => null);
    sendBtn = handle ? (handle as any).asElement() : null;
  }

  if (!sendBtn) {
    console.log("[Connector] Final 'Send' button not found after typing note.");
    return false;
  }

  // Stability guard: ensure button is enabled and visible
  await page.waitForFunction(
    (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 &&
             window.getComputedStyle(el).opacity !== '0' &&
             !(el as HTMLButtonElement).disabled;
    },
    { timeout: 5000 },
    sendBtn
  ).catch(() => null);

  // Human-like thinking pause before sending
  await humanDelay(800, 1800);

  await page.evaluate((el: Element) =>
    el.scrollIntoView({ block: 'center', behavior: 'smooth' }), sendBtn);
  await humanDelay(300, 600);

  // Hybrid click (Send invitation / Send)
  const box = await sendBtn.boundingBox();
  if (box && box.width > 0 && box.height > 0) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy, { steps: 20 });
    await humanDelay(80, 180);
    await page.mouse.click(cx, cy);
    console.log("[Connector] 'Send invitation' coordinate click fired.");
  } else {
    // Re-scroll and get live in-page coordinates (never synthetic JS click)
    console.log("[Connector] No bounding box — re-scrolling and using in-page coordinates...");
    const rect = await page.evaluate((el: Element) => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
    }, sendBtn);
    if (rect && rect.width > 0) {
      await humanDelay(400, 700);
      await page.mouse.move(rect.x, rect.y, { steps: 15 });
      await humanDelay(80, 150);
      await page.mouse.click(rect.x, rect.y);
      console.log("[Connector] 'Send invitation' in-page coordinate click fired.");
    } else {
      console.log("[Connector] 'Send invitation' not visible after re-scroll.");
    }
  }

  // Wait for modal to close
  await page.waitForFunction(
    (btn: Element) => !document.body.contains(btn),
    { timeout: 5000 },
    sendBtn
  ).catch(() => null);

  console.log("[Connector] Note flow complete — modal dismissed.");
  return true;
}

/**
 * Dismiss LinkedIn's "How do you know X?" dialog if it appears.
 * Selects "Other" and continues.
 */
async function dismissHowDoYouKnowDialog(page: Page): Promise<void> {
  try {
    // Check for the "How do you know" dialog — multiple selectors
    const dialog = await page.$(
      [
        '[aria-label*="How do you know"]',
        '.how-do-you-know-them',
        '.connect-reason',
        '[data-test-modal-id*="how-you-know"]',
        // LinkedIn sometimes wraps it as a fieldset inside the modal
        '.artdeco-modal fieldset',
      ].join(", ")
    );

    if (!dialog) return;

    console.log("[Connector] 'How do you know' dialog detected — handling.");
    await humanDelay(500, 1000);

    // Try to select "Other" option
    const otherOption = await page.$(
      [
        'input[value="OTHER"]',
        'label[for*="other"]',
        'label[for*="OTHER"]',
        '.connect-reason input[type="radio"]:last-of-type',
        // LinkedIn 2025+: radio-button labels inside the modal
        '.artdeco-modal label:last-of-type input[type="radio"]',
      ].join(", ")
    );

    if (otherOption) {
      await humanClick(page, otherOption as any);
      await humanDelay(500, 1000);
    }

    // Click the "Connect" / "Next" / "Send" button to proceed
    const nextLabels = [
      'button[aria-label="Connect"]',
      'button[aria-label="Next"]',
      'button[aria-label="Send"]',
      'button[aria-label="Send now"]',
    ];
    for (const sel of nextLabels) {
      const btn = await page.$(sel);
      if (btn) {
        await humanClick(page, btn as any);
        await humanDelay(1000, 2000);
        return;
      }
    }

    // Text fallback inside modal
    const continueBtn = await page.evaluateHandle(() => {
      const btns = document.querySelectorAll(
        "[role='dialog'] button, .artdeco-modal button"
      );
      for (const btn of btns) {
        const txt = btn.textContent?.trim().toLowerCase() || "";
        if (
          txt === "connect" ||
          txt === "next" ||
          txt === "continue" ||
          txt === "send" ||
          txt === "send now"
        ) {
          return btn;
        }
      }
      return null;
    });
    const continueEl = continueBtn.asElement();
    if (continueEl) {
      await humanClick(page, continueEl as any);
      await humanDelay(1000, 2000);
    }
  } catch {
    // Dialog not present — continue
  }
}

/**
 * Find the Connect button on a profile page.
 * Returns the button ElementHandle, or "ALREADY_CONNECTED" if they are out of the outreach phase,
 * or "EMAIL_NEEDED" if we should trigger Module C. 
 */
async function findConnectButton(page: Page): Promise<any | "ALREADY_CONNECTED" | "EMAIL_NEEDED" | null> {
  // 0. DOM Hydration: Hard sleep to ensure React components inject buttons (3s)
  await humanDelay(3000, 3500);

  // Scroll to top so the profile area is in view bounds natively
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await humanDelay(800, 1500);

  console.log("[Connector] Initializing Forced Priority Execution Engine...");

  // ------------------------------------------------------------------
  // STEP 1: Primary "Top Card" Scan (The Main Button)
  // ------------------------------------------------------------------
  const primaryResult = await page.evaluateHandle(() => {
    // Coordinate Guard & Visibility Helper
    const isVisibleAndValid = (el: HTMLElement) => {
        if (!el || el.offsetParent === null) return false;
        if (el.closest('aside') || el.closest('.right-rail')) return false;
        
        const rect = el.getBoundingClientRect();
        // Visual Verification: Reject if x > 800px (Sidebar territory)
        if (rect.x > 800) return false;

        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    // Fast-fail: check states first within <main>
    const anyBtns = document.querySelectorAll("main button, main a");
    let messageAvailable = false;
    for (const btn of Array.from(anyBtns)) {
      if (!isVisibleAndValid(btn as HTMLElement)) continue;
      
      const text = btn.textContent?.trim().toLowerCase() || "";
      const aria = btn.getAttribute("aria-label")?.toLowerCase() || "";
      
      if (text.includes("remove connection") || aria.includes("remove connection") || text.includes("pending") || aria.includes("pending")) {
        return "ALREADY_CONNECTED";
      }
      if (text.includes("message") || aria.includes("message")) {
          messageAvailable = true;
      }
    }

    // Step 1 Execution: Search for Primary Connect using Attribute-First Semantic Identifiers
    const primaryXpath = `//main//div[contains(@class, 'pvs-profile-actions') or contains(@class, 'pv-top-card-v2-ctas')]//*[(self::button or self::a) and (descendant::svg[@id='connect-small'] or contains(., 'Connect') or contains(@aria-label, 'Connect') or contains(@aria-label, 'connect')) and not(contains(., 'connected')) and not(ancestor::aside)]`;
    const xpResult = document.evaluate(primaryXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    
    if (xpResult.singleNodeValue && isVisibleAndValid(xpResult.singleNodeValue as HTMLElement)) {
        return { type: 'CONNECT_PRIMARY', el: xpResult.singleNodeValue, messageAvailable };
    }

    // Fallback iteration strictly looking for attribute identifiers/text inside <main>
    for (const btn of Array.from(anyBtns)) {
       if (!isVisibleAndValid(btn as HTMLElement)) continue;
       
       const text = btn.textContent?.trim().toLowerCase() || "";
       const aria = btn.getAttribute("aria-label")?.toLowerCase() || "";
       const hasConnectIcon = !!btn.querySelector('svg#connect-small');
       
       if ((hasConnectIcon || text === "connect" || aria === "connect" || aria.includes("connect") || (aria.includes("invite") && aria.includes("connect"))) 
           && (!text.includes("connected") && !aria.includes("connected"))) {
         return { type: 'CONNECT_PRIMARY', el: btn, messageAvailable };
       }
    }

    // Return safely structured object indicating failure
    return { type: 'NOT_FOUND', messageAvailable };
  });

  // Evaluate String Primitive from JSHandle
  const primaryStringVal = await page.evaluate((res: any) => typeof res === "string" ? res : null, primaryResult);
  if (primaryStringVal === "ALREADY_CONNECTED") {
    console.log("[Connector] Found 'Pending' or 'Remove Connection' state directly.");
    return "ALREADY_CONNECTED";
  }

  // Parse structured object wrapper
  const primaryObj = await page.evaluate((res: any) => res && typeof res === 'object' ? { type: res.type, messageAvailable: res.messageAvailable } : null, primaryResult);
  
  if (primaryObj && primaryObj.type === 'CONNECT_PRIMARY') {
      const elHandleRaw = await page.evaluateHandle((obj: any) => obj.el, primaryResult);
      const foundElHandle = elHandleRaw.asElement() as any;

      if (foundElHandle && !await foundElHandle.isIntersectingViewport()) {
          console.log("[Connector] Primary Connect button is off-screen. Scrolling to view...");
          await foundElHandle.evaluate((el: any) => el.scrollIntoView({behavior: "smooth", block: "center"}));
          await humanDelay(600, 1000);
      }
      
      console.log("[Connector] SUCCESS: Found Connect button in Step 1. Returning handle immediately.");
      // STOP EXECUTION: Return the primary button immediately.
      return foundElHandle;
  }

  // ------------------------------------------------------------------
  // STEP 2: The "More" Menu Fallback (Only if Step 1 is NULL)
  // ------------------------------------------------------------------
  console.log("[Connector] Step 1 returned NULL. Proceeding to Step 2: 'More' Menu Fallback.");

  const overflowResult = await page.evaluateHandle(() => {
    const isVisibleAndValid = (el: HTMLElement) => {
        if (!el || el.offsetParent === null) return false;
        if (el.closest('aside') || el.closest('.right-rail')) return false;
        const rect = el.getBoundingClientRect();
        if (rect.x > 800) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const xpathScope = `//main//div[contains(@class, 'pvs-profile-actions') or contains(@class, 'pv-top-card-v2-ctas')]//button[(contains(@aria-label, 'More actions') or contains(@aria-label, 'More') or contains(., 'More') or contains(., '…') or contains(@class, 'dropdown')) and not(contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'message')) and not(ancestor::aside)]`;
    
    const xpResult = document.evaluate(xpathScope, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (xpResult.singleNodeValue && isVisibleAndValid(xpResult.singleNodeValue as HTMLElement)) {
        return { type: 'OVERFLOW', el: xpResult.singleNodeValue };
    }

    // Direct iteration fallback exclusively for 'More actions' inside main
    const anyBtns = document.querySelectorAll("main button");
    for (const btn of Array.from(anyBtns)) {
       const text = btn.textContent?.trim().toLowerCase() || "";
       const aria = btn.getAttribute("aria-label")?.toLowerCase() || "";
       if (!isVisibleAndValid(btn as HTMLElement)) continue;
       
       if (["message", "follow", "book an appointment", "connect"].includes(text)) continue;
       if (aria.includes("more") || text.includes("more") || text === "…" || text === "⋯" || btn.classList.contains("artdeco-dropdown__trigger")) {
          return { type: 'OVERFLOW', el: btn };
       }
    }
    return null;
  });

  const overflowObj = await page.evaluate((res: any) => res && typeof res === 'object' ? { type: res.type } : null, overflowResult);
  
  if (overflowObj && overflowObj.type === 'OVERFLOW') {
      const elHandleRaw = await page.evaluateHandle((obj: any) => obj.el, overflowResult);
      const foundElHandle = elHandleRaw.asElement() as any;

      if (foundElHandle && !await foundElHandle.isIntersectingViewport()) {
          console.log("[Connector] Overflow 'More' button is off-screen. Scrolling to view...");
          await foundElHandle.evaluate((el: any) => el.scrollIntoView({behavior: "smooth", block: "center"}));
          await humanDelay(600, 1000);
      }

      console.log("[Connector] Found 3-dot overflow menu — opening via Bézier mimicry…");
      await humanClick(page, foundElHandle as any);
      
      // Processing Delay: Human-mimicry $400-900ms thinking delay
      await humanDelay(400, 900);

      // Wait for dropdown to overlay
      await page.waitForSelector(".artdeco-dropdown__content, [role='menu']", { timeout: 3000 }).catch(() => null);

      // Search ONLY the newly appeared overlay for the "Connect" text
      const connectInDropdown = await page.evaluateHandle(() => {
        const menuItems = document.querySelectorAll("[role='menuitem'], .artdeco-dropdown__item, .artdeco-dropdown__content button, .artdeco-dropdown__content a");
        for (const item of Array.from(menuItems)) {
          if ((item as HTMLElement).offsetParent === null) continue;
          
          const ariaLabel = item.getAttribute("aria-label")?.toLowerCase() || "";
          const text = item.textContent?.trim().toLowerCase() || "";
  
          if (text.includes("remove connection") || ariaLabel.includes("remove connection") || text.includes("pending") || ariaLabel.includes("pending")) {
            return "ALREADY_CONNECTED";
          }
  
          if ((text === "connect" || text.includes("connect") || ariaLabel.includes("connect")) && !text.includes("connected") && !ariaLabel.includes("connected")) {
            return item;
          }
        }
        return null;
      });

      const dropStringVal = await page.evaluate((res: any) => typeof res === "string" ? res : null, connectInDropdown);
      if (dropStringVal === "ALREADY_CONNECTED") {
        console.log("[Connector] Found 'Remove Connection' or 'Pending' inside 3-dot dropdown.");
        return "ALREADY_CONNECTED";
      }

      const dropdownConnectEl = connectInDropdown.asElement();
      if (dropdownConnectEl) {
        console.log("[Connector] SUCCESS: Found Connect inside dropdown menu.");
        return dropdownConnectEl;
      }

      console.log("[Connector] Connect not found in dropdown — closing.");
      await page.keyboard.press("Escape");
      await humanDelay(300, 600);
  }

  // If both Priority levels failed entirely, consider Module C
  if (primaryObj && primaryObj.messageAvailable) {
      console.log("[Connector] Contextual failure: Message available but Connect strictly unavailable.");
      return "EMAIL_NEEDED";
  }

  console.log("[Connector] FAILED — Connect button completely missing from scoped containers.");
  return null;
}

/**
 * Check pending connection status for a list of leads
 */
export async function checkConnectionStatuses(
  leadUrls: string[],
): Promise<Map<string, "pending" | "accepted" | "rejected">> {
  const page = getPage();
  if (!page) throw new Error("Browser not launched");

  const statuses = new Map<string, "pending" | "accepted" | "rejected">();

  for (const url of leadUrls) {
    try {
      await inPageNavigate(page, url);

      const status = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        const hasMessage = !!document.querySelector(
          'button[aria-label*="Message"], button[aria-label="Message"]'
        );
        const hasPending = !!(
          document.querySelector('button[aria-label*="Pending"]') ||
          bodyText.includes("pending")
        );
        const hasConnect = !!(
          document.querySelector('button[aria-label="Connect"]') ||
          document.querySelector('button[aria-label*="Connect with"]')
        );

        if (hasMessage) return "accepted";
        if (hasPending) return "pending";
        if (hasConnect) return "rejected";
        return "pending";
      });

      statuses.set(url, status as "pending" | "accepted" | "rejected");

      await humanDelay(5000, 15000);
      await randomIdleAction(page);
    } catch {
      statuses.set(url, "pending");
    }
  }

  logActivity("connection_status_check", "linkedin", {
    totalChecked: leadUrls.length,
    accepted: Array.from(statuses.values()).filter((s) => s === "accepted").length,
    pending: Array.from(statuses.values()).filter((s) => s === "pending").length,
    rejected: Array.from(statuses.values()).filter((s) => s === "rejected").length,
  });

  return statuses;
}
