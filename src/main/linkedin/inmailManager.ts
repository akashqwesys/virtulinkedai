import type { Page } from "puppeteer-core";
import { createInboxTab } from "../browser/inbox-engine";
import { setBrowserLocked, waitForBrowserLock } from "../browser/engine";
import {
  humanClick,
  humanDelay,
  inPageNavigate,
  pageLoadDelay,
  thinkingDelay,
} from "../browser/humanizer";
import { generateInMail } from "../ai/personalizer";
import { getDatabase, logActivity } from "../storage/database";
import type { AppSettings } from "../../shared/types";
import { v4 as uuid } from "uuid";

// Lazy BrowserWindow reference — always available in main process
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BrowserWindow } = require("electron") as typeof import("electron");

// ─── Real-time log push to renderer ────────────────────────────────────────
function pushLog(message: string): void {
  try {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      wins[0].webContents.send("inmail:log", message);
    }
  } catch (_) {}
  console.log(`[InMailManager] ${message}`);
}

// ─── Button state detection ─────────────────────────────────────────────────
type ButtonState = "message_direct" | "inmail_direct" | "in_more" | "none";

async function detectButtonState(page: Page): Promise<ButtonState> {
  return page.evaluate(() => {
    // Helper to scan a given container for buttons
    const scanForButton = (container: Element | Document): ButtonState => {
      const buttons = Array.from(container.querySelectorAll("button, a"));
      for (const btn of buttons) {
        const isButtonLike = btn.tagName === "BUTTON" || btn.getAttribute("role") === "button" || btn.className.includes("btn") || btn.className.includes("button");
        const href = btn.getAttribute("href") || "";
        
        if (btn.tagName === "A" && !isButtonLike && !href.includes("messaging")) {
           continue;
        }

        const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
        const text = (btn.textContent || "").trim().toLowerCase();
        const combined = ariaLabel + " " + text;

        if (combined.includes("inmail") && !combined.includes("more")) return "inmail_direct";
        if (
          (combined.includes("message") || text.includes("message") || href.includes("/messaging/compose")) &&
          !combined.includes("inmail") &&
          !combined.includes("connect") &&
          !combined.includes("more") &&
          !combined.includes("view my services")
        ) return "message_direct";
      }

      const moreBtn = container.querySelector(
        "button[aria-label*='More'], button[aria-label*='more'], button[aria-label*='actions'], button.artdeco-dropdown__trigger"
      );
      if (moreBtn) return "in_more";

      return "none";
    };

    // 1. Direct explicit link check
    const explicitMsgLink = document.querySelector("a[href*='/messaging/compose/']");
    if (explicitMsgLink) return "message_direct";

    // 2. Standard class-based check
    const actionContainerSelectors = [
      ".pvs-profile-actions",
      ".pv-top-card-v2-ctas",
      ".pv-s-profile-actions",
      ".pv-top-card__ctas",
      ".ph5.pb5 .mt2",
      ".ph5.pb5",
      ".artdeco-card .pv-top-card-v2-ctas",
    ];

    for (const sel of actionContainerSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const result = scanForButton(el);
        if (result !== "none") return result;
      }
    }

    // 3. Robust Relative Traversal (Bypasses Obfuscated Classes)
    // Find the profile name (h1), go up a few levels to the top-card container, and scan.
    const h1 = document.querySelector("h1");
    if (h1) {
      let ancestor = h1.parentElement;
      // Go up up to 6 levels to find the container holding both name and buttons
      for (let i = 0; i < 6; i++) {
        if (!ancestor) break;
        const result = scanForButton(ancestor);
        if (result !== "none") return result;
        ancestor = ancestor.parentElement;
      }
    }

    // 4. Ultimate fallback: First few sections of main/body
    const topSection = document.querySelector(".scaffold-layout__main") || document.querySelector("main") || document.body;
    if (topSection) {
      const firstChildren = Array.from(topSection.children).slice(0, 3);
      for (const child of firstChildren) {
        const result = scanForButton(child);
        if (result !== "none") return result;
      }
    }

    return "none";
  });
}

// ─── Open compose modal ──────────────────────────────────────────────────────
async function openComposeModal(page: Page, state: ButtonState): Promise<void> {
  if (state === "message_direct" || state === "inmail_direct") {
    const clicked = await page.evaluate(() => {
      const isVisible = (el: Element) => {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const scanAndClick = (container: Element | Document): boolean => {
        const buttons = Array.from(container.querySelectorAll("button, a")).filter(isVisible);
        for (const btn of buttons) {
          const href = btn.getAttribute("href") || "";
          const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
          const text = (btn.textContent || "").trim().toLowerCase();
          const combined = ariaLabel + " " + text;
          if (
            (combined.includes("message") || combined.includes("inmail") || href.includes("/messaging/compose")) &&
            !combined.includes("connect") &&
            !combined.includes("more") &&
            !combined.includes("view my services")
          ) {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      };

      const explicitMsgLinks = Array.from(document.querySelectorAll("a[href*='/messaging/compose/']")).filter(isVisible);
      if (explicitMsgLinks.length > 0) {
        (explicitMsgLinks[0] as HTMLElement).click();
        return true;
      }

      const actionContainerSelectors = [
        ".pvs-profile-actions",
        ".pv-top-card-v2-ctas",
        ".pv-s-profile-actions",
        ".pv-top-card__ctas",
        ".ph5.pb5 .mt2",
        ".ph5.pb5",
      ];

      for (const sel of actionContainerSelectors) {
        const el = document.querySelector(sel);
        if (el && scanAndClick(el)) return true;
      }

      const h1 = document.querySelector("h1");
      if (h1) {
        let ancestor = h1.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!ancestor) break;
          if (scanAndClick(ancestor)) return true;
          ancestor = ancestor.parentElement;
        }
      }

      const topCard = document.querySelector(".pv-top-card") || document.querySelector("main") || document.body;
      if (topCard && scanAndClick(topCard)) return true;

      return false;
    });

    if (!clicked) throw new Error("Direct Message/InMail button not found or not clickable on this profile.");
    return;
  }

  const clicked = await page.evaluate(() => {
    const isVisible = (el: Element) => {
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };

    const scanAndClickMore = (container: Element | Document): boolean => {
      const moreBtns = Array.from(container.querySelectorAll(
        "button[aria-label*='More'], button[aria-label*='more'], button[aria-label*='actions'], button.artdeco-dropdown__trigger"
      )).filter(isVisible);
      if (moreBtns.length === 0) return false;
      (moreBtns[0] as HTMLElement).click();
      return true;
    };

    const actionContainerSelectors = [
      ".pvs-profile-actions",
      ".pv-top-card-v2-ctas",
      ".pv-s-profile-actions",
      ".pv-top-card__ctas",
      ".ph5.pb5",
    ];

    for (const sel of actionContainerSelectors) {
      const el = document.querySelector(sel);
      if (el && scanAndClickMore(el)) return true;
    }

    const h1 = document.querySelector("h1");
    if (h1) {
      let ancestor = h1.parentElement;
      for (let i = 0; i < 6; i++) {
        if (!ancestor) break;
        if (scanAndClickMore(ancestor)) return true;
        ancestor = ancestor.parentElement;
      }
    }

    const topCard = document.querySelector(".pv-top-card") || document.querySelector("main") || document.body;
    if (topCard && scanAndClickMore(topCard)) return true;

    return false;
  });

  if (!clicked) throw new Error("More actions button not found in profile action row.");
  await new Promise(r => setTimeout(r, 700));

  const dropdownClicked = await page.evaluate(() => {
    const isVisible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const dropdownSelectors = [
      ".artdeco-dropdown__content",
      "[role='menu']",
      ".pvs-overflow-actions-dropdown__content",
      ".artdeco-dropdown__content--is-open",
      ".pv-s-profile-actions__overflow-dropdown",
    ];
    let dropdown: Element | null = null;
    for (const sel of dropdownSelectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) { dropdown = el; break; }
    }
    
    if (!dropdown) {
      const allItems = Array.from(document.querySelectorAll("li, [role='menuitem'], .artdeco-dropdown__item")).filter(isVisible);
      for (const item of allItems) {
        const text = (item.textContent || "").toLowerCase();
        if (text.includes("message") || text.includes("inmail") || text.includes("send inmail")) {
           const clickable = (item.querySelector("button, a") || item) as HTMLElement;
           clickable.click();
           return true;
        }
      }
      return false;
    }

    const items = Array.from(dropdown.querySelectorAll("li, button, a, [role='menuitem'], .artdeco-dropdown__item")).filter(isVisible);
    for (const item of items) {
      const text = (item.textContent || "").toLowerCase();
      const label = (item.getAttribute("aria-label") || "").toLowerCase();
      if (text.includes("message") || text.includes("inmail") || label.includes("message") || label.includes("inmail")) {
        const clickable = (item.querySelector("button, a") || item) as HTMLElement;
        clickable.click();
        return true;
      }
    }
    return false;
  });

  if (!dropdownClicked) {
    throw new Error("No Message/InMail option found in the More dropdown. This profile may require LinkedIn Premium.");
  }
}

// ─── Fill & send message (handles both InMail and DM) ────────────────────────
async function fillAndSendMessage(
  page: Page,
  subject: string,
  body: string
): Promise<{ type: "inmail" | "dm"; subjectFilled: string }> {

  pushLog("Waiting 3-4 seconds for compose modal to fully render and focus...");
  await humanDelay(3000, 4000);

  // 1. Type Subject (LinkedIn auto-focuses the Subject box in InMail modals)
  pushLog("Typing subject in the auto-focused text box...");
  for (const ch of subject) {
    await page.keyboard.type(ch);
    await new Promise(r => setTimeout(r, 20 + Math.random() * 40));
  }
  
  await humanDelay(500, 1000);

  // 2. Press Tab to shift focus to the Body text area
  pushLog("Pressing 'Tab' to move cursor to the body text area...");
  await page.keyboard.press("Tab");
  
  await humanDelay(500, 1000);

  // 3. Type Body Message
  pushLog("Typing body message...");
  for (const char of body) {
    if (char === "\n") {
      // Use Shift+Enter for newlines
      await page.keyboard.down("Shift");
      await page.keyboard.press("Enter");
      await page.keyboard.up("Shift");
    } else {
      await page.keyboard.type(char);
    }
    await new Promise(r => setTimeout(r, 15 + Math.random() * 30));
    if (Math.random() < 0.02) await humanDelay(80, 200);
  }

  pushLog("✓ Finished typing. Reviewing before send...");
  await thinkingDelay();

  // 4. Press Enter to send
  pushLog("Sending message via 'Enter' key on keyboard...");
  await page.keyboard.press("Enter");
  await humanDelay(2000, 3000);

  return { type: "inmail", subjectFilled: subject };
}

// ─── Quick identity scrape (no scroll, no popup) ────────────────────────────
async function quickScrapeIdentity(page: Page): Promise<{
  firstName: string;
  lastName: string;
  headline: string;
  company: string;
  about: string;
  profileImageUrl: string;
  isAuthWall: boolean;
} | null> {
  return page.evaluate(() => {
    const url = window.location.href;
    const title = document.title.toLowerCase();

    // Detect auth wall / login redirect
    const isAuthWall =
      url.includes("/authwall") ||
      url.includes("/login") ||
      url.includes("/checkpoint") ||
      title.includes("sign in") ||
      title.includes("join linkedin") ||
      title.includes("security verification") ||
      !!document.querySelector('.authwall-join-form, form#join-form, form#login-form, [data-id="authwall"]');

    if (isAuthWall) {
      return { firstName: "", lastName: "", headline: "", company: "", about: "", profileImageUrl: "", isAuthWall: true };
    }

    const main = document.querySelector("main") || document.body;

    const getText = (selectors: string[]): string => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent?.trim()) return el.textContent.trim();
      }
      return "";
    };

    const fullName = getText([
      "h1.text-heading-xlarge",
      ".pv-text-details__left-panel h1",
      ".top-card-layout__title",
      "h1",
    ]);
    const parts = fullName.trim().split(" ");
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ");

    const headline = getText([
      "div.text-body-medium.break-words",
      ".pv-text-details__left-panel .text-body-medium",
      ".top-card-layout__headline",
      "h2.mt1",
    ]);

    const expCompany = main.querySelector(
      '#experience ~ div .t-normal span[aria-hidden="true"]'
    )?.textContent?.trim() || "";
    const company = expCompany.split("·")[0].trim() || headline.split(" at ")[1] || "";

    const aboutEl = main.querySelector(
      "#about ~ div span[aria-hidden='true'], #about ~ div .display-flex span"
    );
    const about = aboutEl?.textContent?.trim() || "";

    const img = main.querySelector(
      ".pv-top-card-profile-picture__image--show, img.pv-top-card__photo, img.profile-photo-edit__preview, .presence-entity__image"
    ) as HTMLImageElement | null;
    const profileImageUrl = img?.src || "";

    return { firstName, lastName, headline, company, about, profileImageUrl, isAuthWall: false };
  });
}

// ─── Persist InMail to DB ───────────────────────────────────────────────────
export function saveInMailRecord(data: {
  profileUrl: string;
  firstName: string;
  lastName: string;
  headline: string;
  company: string;
  profileImageUrl: string;
  subject: string;
  body: string;
  type: "inmail" | "dm";
  objective: string;
}): string {
  const db = getDatabase();
  const id = uuid();
  db.prepare(`
    INSERT INTO inmails (
      id, profile_url, first_name, last_name, headline, company,
      profile_image_url, subject, body, type, objective, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.profileUrl,
    data.firstName,
    data.lastName,
    data.headline,
    data.company,
    data.profileImageUrl,
    data.subject,
    data.body,
    data.type,
    data.objective,
    new Date().toISOString()
  );
  return id;
}

// ─── Get InMail history ─────────────────────────────────────────────────────
export function getInMailHistory(limit = 100): any[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM inmails ORDER BY sent_at DESC LIMIT ?`
    )
    .all(limit);
}

// ─── Get InMails for a specific profile ────────────────────────────────────
export function getInMailsForProfile(profileUrl: string): any[] {
  const db = getDatabase();
  const clean = profileUrl.split("?")[0].replace(/\/$/, "");
  return db
    .prepare(
      `SELECT * FROM inmails WHERE profile_url LIKE ? ORDER BY sent_at DESC`
    )
    .all(`%${clean}%`);
}

// ─── Main exported function ─────────────────────────────────────────────────
/**
 * Process a Direct InMail manually triggered by the user.
 *
 * Fixed flow:
 * 1. Navigate to profile & quick-scrape identity (no heavy scrolling)
 * 2. Navigate BACK to clean profile page state
 * 3. Detect which action button is available (Message / InMail / More dropdown)
 * 4. Generate AI content BEFORE opening any modal
 * 5. Open compose modal via correct click path
 * 6. Detect compose type (InMail vs DM)
 * 7. Fill + send
 * 8. Persist to inmails table & log activity
 */
export async function processDirectInMail(
  profileUrl: string,
  settings: AppSettings,
  objective?: string
): Promise<{ success: boolean; type?: "dm" | "inmail"; error?: string; subject?: string; body?: string }> {
  await waitForBrowserLock();
  setBrowserLocked(true);

  let page: Page | null = null;
  try {
    // Use a NEW TAB inside the existing inbox browser — same Chrome window,
    // same LinkedIn session, but doesn't disturb the messaging tab.
    pushLog("Opening a new tab in the inbox browser...");
    try {
      page = await createInboxTab();
    } catch (e: any) {
      throw new Error(
        "Inbox browser could not be started. Please open the Inbox tab and click \"Launch Browser\" first, then try again."
      );
    }

    const cleanUrl = profileUrl.split("?")[0].replace(/\/$/, "") + "/";

    // ── STEP 1: Navigate to profile ──────────────────────────────────────
    // This is a fresh tab (about:blank) so always use goto — no SPA context yet.
    pushLog(`Navigating to profile: ${cleanUrl}`);
    await page.goto(cleanUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page
      .waitForSelector(".pv-top-card, .ph5.pb5, main, .core-rail", { timeout: 15000 })
      .catch(() => null);
    await pageLoadDelay();
    await humanDelay(1500, 2500);

    // ── STEP 2: Quick-scrape identity for AI (no heavy scrolling) ────────
    pushLog("Scraping profile identity for AI personalization...");

    // Give the profile an extra moment to fully render its main content
    await humanDelay(2000, 3000);
    const identity = await quickScrapeIdentity(page);

    // ── Auth wall check ───────────────────────────────────────────────────
    if (identity?.isAuthWall) {
      throw new Error(
        "The main browser is not logged into LinkedIn. Please go to Settings → Browser → Launch Browser, then log in to LinkedIn in the browser window that opens."
      );
    }

    // ── Name fallback from URL slug ───────────────────────────────────────
    // e.g. /in/michael-l-ab634260 → "Michael L"
    let firstName = identity?.firstName || "";
    let lastName = identity?.lastName || "";
    if (!firstName) {
      const slug = cleanUrl.split("/in/")[1]?.replace(/\/$/, "") || "";
      const nameParts = slug
        .split("-")
        .filter(p => !/^[a-z]{2}[0-9]+$/.test(p)) // Remove trailing ID segments
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .slice(0, 2);
      firstName = nameParts[0] || "Lead";
      lastName = nameParts[1] || "";
      pushLog(`⚠ Could not read name from DOM — using URL slug: ${firstName} ${lastName}`);
    }

    pushLog(`✓ Identity: ${firstName} ${lastName}${identity?.headline ? " — " + identity.headline : ""}`);

    const safeIdentity = {
      firstName,
      lastName,
      headline: identity?.headline || "",
      company: identity?.company || "",
      about: identity?.about || "",
      profileImageUrl: identity?.profileImageUrl || "",
    };

    // ── STEP 3: Detect button state BEFORE generating AI (saves time on errors) ─
    pushLog("Detecting available messaging options...");
    const buttonState = await detectButtonState(page);
    // Also dump all visible button labels for debugging
    const buttonLabels = await page.evaluate(() => {
      const containers = [".pvs-profile-actions", ".ph5.pb5", "main"];
      for (const sel of containers) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const btns = Array.from(el.querySelectorAll("button, a[role='button']")).slice(0, 8);
        const labels = btns.map(b => ((b.getAttribute("aria-label") || "") + "|" + (b.textContent || "").trim()).slice(0, 40));
        if (labels.length) return `[${sel}]: ${labels.join(" / ")}`;
      }
      return "No action containers found";
    });
    pushLog(`ℹ Buttons found: ${buttonLabels}`);
    pushLog(`✓ Button state: ${buttonState}`);

    if (buttonState === "none") {
      throw new Error(
        "No messaging option found on this profile. The profile may be private, out-of-network, or your account may need LinkedIn Premium to send InMail."
      );
    }

    // ── STEP 4: Generate AI content BEFORE opening any modal ────────────
    pushLog("Generating AI-personalized InMail with subject and body...");

    const profileForAI = {
      id: uuid(),
      linkedinUrl: cleanUrl,
      firstName: safeIdentity.firstName,
      lastName: safeIdentity.lastName,
      headline: safeIdentity.headline,
      company: safeIdentity.company,
      role: safeIdentity.headline.split(" at ")[0] || safeIdentity.headline,
      location: "",
      about: safeIdentity.about,
      experience: [],
      education: [],
      skills: [],
      recentPosts: [],
      mutualConnections: [],
      profileImageUrl: safeIdentity.profileImageUrl,
      connectionDegree: "3rd" as const,
      isSalesNavigator: false,
      scrapedAt: new Date().toISOString(),
      rawData: {},
    };

    const { subject, body } = await generateInMail(
      profileForAI,
      {
        yourName: settings.profile.name,
        yourCompany: settings.profile.company,
        yourServices: settings.profile.services,
        objective: objective || "Networking and knowledge sharing",
      },
      settings.ai
    );

    pushLog(`✓ AI generated subject: "${subject.substring(0, 50)}..."`);
    pushLog("Opening messaging interface...");

    // ── STEP 5: Open compose modal ───────────────────────────────────────
    await openComposeModal(page, buttonState);
    await humanDelay(2000, 3500);

    // ── Out of Credits / Upsell Check ────────────────────────────────────
    const isUpsell = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return (
        text.includes("out of inmail credits") ||
        text.includes("reach more people with premium") ||
        text.includes("upgrade to premium") ||
        !!document.querySelector(".premium-upsell-modal, .artdeco-modal__header--premium")
      );
    });
    if (isUpsell) {
      throw new Error("Out of InMail credits or Premium upgrade required. Cannot send message.");
    }

    // ── STEP 6 & 7: Fill and send (handles both InMail and DM types) ────
    const sendResult = await fillAndSendMessage(page, subject, body);
    const type = sendResult.type;
    const finalSubject = sendResult.subjectFilled;

    pushLog(`✓ Compose type verified: ${type === "inmail" ? "InMail (with subject)" : "Standard DM"}`);

    // ── STEP 8: Persist & log ────────────────────────────────────────────
    try {
      saveInMailRecord({
        profileUrl: cleanUrl,
        firstName: safeIdentity.firstName,
        lastName: safeIdentity.lastName,
        headline: safeIdentity.headline,
        company: safeIdentity.company,
        profileImageUrl: safeIdentity.profileImageUrl,
        subject: finalSubject,
        body,
        type,
        objective: objective || "Networking and knowledge sharing",
      });
    } catch (dbErr) {
      // Non-fatal — the message was sent, DB write is bonus
      console.warn("[InMailManager] Failed to persist InMail record:", dbErr);
    }

    logActivity("direct_inmail_sent", "linkedin", {
      profileUrl: cleanUrl,
      name: `${safeIdentity.firstName} ${safeIdentity.lastName}`,
      type,
      subjectLength: finalSubject.length,
      bodyLength: body.length,
    });

    pushLog(`✅ ${type === "inmail" ? "InMail" : "DM"} sent successfully to ${safeIdentity.firstName} ${safeIdentity.lastName}!`);

    // Close the InMail tab — inbox messaging tab is untouched
    try { await page.close(); } catch { /* non-fatal */ }
    pushLog("✓ Closed InMail tab — inbox messaging tab is untouched.");

    return { success: true, type, subject: finalSubject || undefined, body };
  } catch (error: any) {
    const msg = error.message || "Unknown error";
    pushLog(`❌ Failed: ${msg}`);
    // Close the tab on error too — don't leave stray tabs open
    if (page) { try { await page.close(); } catch { /* non-fatal */ } }
    logActivity("direct_inmail_failed", "linkedin", { profileUrl, error: msg }, "error", msg);
    return { success: false, error: msg };
  } finally {
    // Always release the browser lock
    setBrowserLocked(false);
  }
}
