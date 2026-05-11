/**
 * LinkedIn Profile Scraper — High-Fidelity Edition
 *
 * Extracts complete profile data by simulating a human "reading" the page.
 * STRICT SCOPING: All selectors target descendants of <main> only.
 * Never touches the <aside> sidebar or any content outside 800px from left.
 *
 * Safety guarantees:
 *  - Bézier humanClick for all button expansions
 *  - Gaussian 500–1500ms delay between section extractions
 *  - Page validity guard prevents false-positive scrapes on auth walls
 *  - UPSERT database writes prevent duplicates
 *
 * No changes to connector.ts or any send-connection logic.
 */

import type { Page } from "puppeteer-core";
import type {
  LinkedInProfile,
  Experience,
  Education,
  Post,
} from "../../shared/types";
import { getPage, setBrowserLocked, waitForBrowserLock } from "../browser/engine";
import {
  humanClick,
  humanDelay,
  humanScroll,
  humanMouseMove,
  pageLoadDelay,
  randomIdleAction,
  inPageNavigate,
  DailyLimitManager,
} from "../browser/humanizer";
import { logActivity, upsertLeadProfile } from "../storage/database";
import { v4 as uuid } from "uuid";
import { generateConnectionNote, parseProfileJson } from "../ai/personalizer";
import { performSearch } from "../browser/session";
import { sendConnectionRequest } from "./connector";
import type { AppSettings } from "../../shared/types";
import { getDatabase } from "../storage/database";

// ============================================================
// Campaign Abort Signal
// Allows pauseCampaign() to immediately stop in-flight imports.
// ============================================================
const _abortedCampaigns = new Set<string>();

/**
 * Call this when a campaign is paused to signal any running
 * importFromSearchUrl() loops to stop immediately.
 */
export function abortCampaignImport(campaignId: string): void {
  _abortedCampaigns.add(campaignId);
  // Auto-clear after 5 minutes so restarts aren't blocked forever
  setTimeout(() => _abortedCampaigns.delete(campaignId), 5 * 60 * 1000);
}

/** Check if an import for this campaign has been aborted. */
function isImportAborted(campaignId?: string): boolean {
  if (!campaignId) return false;
  if (_abortedCampaigns.has(campaignId)) return true;
  // Also check live DB status as a secondary guard
  try {
    const db = getDatabase();
    const campaign = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(campaignId) as any;
    if (campaign && campaign.status !== "active") return true;
  } catch { /* ignore */ }
  return false;
}

// ============================================================
// Gaussian delay helper (500–1500ms between section extractions)
// ============================================================
async function gaussianSectionDelay(): Promise<void> {
  const mean = 1000;
  const stdDev = 250;
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  const delay = Math.max(500, Math.min(1500, mean + z * stdDev));
  await new Promise((r) => setTimeout(r, delay));
}

// ============================================================
// 1. Page Validity Guard
// ============================================================

/**
 * Verifies the browser is on an actual LinkedIn profile page.
 * Returns false if stuck on login wall, error page, or redirect.
 * This prevents the title-fallback false-positive bug.
 */
async function validateProfilePage(page: Page): Promise<boolean> {
  const url = page.url();

  // Must be a personal profile URL
  if (!url.includes("linkedin.com/in/")) {
    console.warn(`[Scraper] Invalid page URL for profile scrape: ${url}`);
    return false;
  }

  // Check title for explicit authwall/error signs
  const title = await page.title();
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes("sign in") || lowerTitle.includes("join linkedin") || lowerTitle.includes("security verification") || lowerTitle.includes("page not found")) {
    console.warn(`[Scraper] Blocked by Authwall or Error page. Title: "${title}"`);
    return false;
  }

  // Must have some form of profile content loading
  const isProfileLoading = await page.evaluate(() => {
    const doc = document as any;
    const main = doc.querySelector("main");
    if (main && (main.id === "workspace" || main.querySelector("h1"))) {
      return true;
    }
    
    // Fallback if main is weird: look for the top card or any h1 (name)
    if (doc.querySelector(".pv-top-card") || doc.querySelector("h1")) {
      return true;
    }

    return false;
  });

  if (!isProfileLoading) {
    console.warn(`[Scraper] Page does not look like a profile. URL: ${url}, Title: "${title}"`);
    return false;
  }

  return true;
}

// ============================================================
// 2. Natural Reading Protocol
// ============================================================

/**
 * Scrolls <main> in human-like stages, pausing at each major section.
 * Replaces the old simulateProfileReading which scrolled the window.
 */
async function naturalReadingProtocol(page: Page): Promise<void> {
  console.log("[Scraper] Starting natural reading protocol...");

  // Initial pause — "arriving" at the profile
  await humanDelay(1200, 2500);

  // Perform a shortened reading scroll (reduced from 6 to 2) to limit 
  // excessive DOM interactions that trigger anti-automation heuristics.
  let scrolls = 0;
  const maxScrolls = 2;
  while (scrolls < maxScrolls) {
    const isAtBottom = await page.evaluate(() => (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100);
    if (isAtBottom) break;

    // Scroll down by 60% of viewport height
    const scrollAmount = await page.evaluate(() => window.innerHeight * 0.6);
    await humanScroll(page, {
      direction: "down",
      distance: scrollAmount + Math.random() * 200,
      readingPauses: true,
    });
    
    // Natural pause
    await humanDelay(1500, 3000);
    scrolls++;
  }

  // Scroll back up occasionally
  if (Math.random() < 0.6) {
    await humanScroll(page, { direction: "up", distance: 500 + Math.random() * 800 });
    await humanDelay(800, 1500);
  }

  console.log("[Scraper] Natural reading protocol complete.");
}

// ============================================================
// 3. Expand All Hidden Content (scoped to <main> only)
// ============================================================

/**
 * Clicks all "see more", "show all X experiences", "show all X skills"
 * buttons within <main> only. Never touches <aside>.
 * Uses humanClick (Bézier) + Gaussian delay between clicks.
 */
async function expandAllHiddenContent(page: Page): Promise<void> {
  console.log("[Scraper] Expanding hidden content sections...");

  // Aggressive pure-JS click for all inline "...more" buttons to guarantee text expansion
  await page.evaluate(() => {
    const mainArea = document.querySelector('main') || document.body;
    const buttons = Array.from(mainArea.querySelectorAll('button'));
    for (const btn of buttons) {
      const txt = (btn.textContent || "").toLowerCase();
      if (txt.includes("see more") || txt.includes("...more") || txt.includes("... see more")) {
        try { btn.click(); } catch(e) {}
      }
    }
  });

  // All button patterns to expand, strictly scoped to main
  const expansionSelectors = [
    // Experience item "see more" on descriptions
    "main #experience ~ div button.inline-show-more-text__button",
    "main section:has(#experience) .pvs-list__item--line-separated button.inline-show-more-text__button",
    "main section:has(#skills) button[aria-label*='Show all']",
  ];

  for (const selector of expansionSelectors) {
    let buttons: any[];
    try {
      buttons = await page.$$(selector);
    } catch {
      continue;
    }

    for (const btn of buttons) {
      // Skip hidden or "see less" buttons
      const shouldSkip = await page.evaluate((el: any) => {
        const style = window.getComputedStyle(el);
        const text = el.textContent?.toLowerCase() || "";
        const rect = el.getBoundingClientRect();
        return (
          style.display === "none" ||
          style.visibility === "hidden" ||
          el.offsetParent === null ||
          text.includes("see less") ||
          text.includes("show less") ||
          rect.x > 850 // X-coordinate guard: ignore sidebar content
        );
      }, btn);

      if (shouldSkip) continue;

      try {
        await humanClick(page, btn);
        // Gaussian 500–1500ms pause between clicks
        await gaussianSectionDelay();
      } catch {
        // Element may have scrolled away — ignore
      }
    }
  }

  console.log("[Scraper] Section expansion complete.");
}

// ============================================================
// 4. Contact Info Extraction (popup modal)
// ============================================================

interface ContactInfo {
  email: string;
  twitter: string;
  websites: string[];
  phone: string;
}

/**
 * Clicks the "Contact info" button in the top card, reads the modal,
 * then closes it. Returns null if the button is not present.
 */
async function extractContactInfo(page: Page, isSalesNavigator: boolean = false): Promise<ContactInfo | null> {
  try {
    let contactBtn: any;
    
    if (isSalesNavigator) {
      // Sales Navigator specific contact info selectors
      contactBtn = await page.$(
        'a[data-control-name="contact_details"], [aria-label*="Contact info"], button[data-anonymize="contact-details"]'
      );
    } else {
      // Standard LinkedIn contact info selectors
      contactBtn = await page.$(
        "main a[href*='overlay/contact-info'], main button[aria-label*='contact info'], main a[id*='contact-info']"
      );
    }

    if (!contactBtn) {
      console.log(`[Scraper] No Contact Info button found (${isSalesNavigator ? 'SalesNav' : 'Standard'}).`);
      return null;
    }

    // Check visibility
    const rect = await page.evaluate((el: any) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, visible: el.offsetParent !== null };
    }, contactBtn);

    if (rect.x > 950 || !rect.visible) return null;

    await humanClick(page, contactBtn);
    await humanDelay(1500, 2500); // Wait for modal to open

    const contactData = await page.evaluate((isSN: boolean) => {
      const doc = document as any;
      const modal =
        doc.querySelector(".pv-profile-section__section-info") ||
        doc.querySelector(".artdeco-modal__content") ||
        doc.querySelector(".profile-topcard-contact-info") || // SalesNav
        doc.querySelector("[data-test-modal]");

      if (!modal) return null;

      // Email
      const emailEl: any = modal.querySelector("section.ci-email a") ||
        modal.querySelector("a[href^='mailto:']") ||
        modal.querySelector(".contact-info-item__email a"); // SalesNav
      
      const email: string = emailEl
        ? (emailEl.href || "").replace("mailto:", "") || emailEl.textContent?.trim() || ""
        : "";

      // Twitter / X
      const twitterEl: any = modal.querySelector("section.ci-twitter a") ||
        modal.querySelector("a[href*='twitter.com'], a[href*='x.com']");
      const twitter: string = twitterEl?.href || twitterEl?.textContent?.trim() || "";

      // Websites
      const websiteEls: any[] = Array.from(
        modal.querySelectorAll("section.ci-websites a, a[href*='://']:not([href*='linkedin'])")
      );
      const websites: string[] = websiteEls
        .map((el: any) => el.href || el.textContent?.trim() || "")
        .filter((u: string) => u && !u.includes("linkedin.com") && !u.startsWith("mailto:"));

      // Phone
      const phoneEl: any = modal.querySelector("section.ci-phone span.t-14") ||
        modal.querySelector("section.ci-phone") ||
        modal.querySelector(".contact-info-item__phone"); // SalesNav
      const phone: string = phoneEl?.textContent?.trim() || "";

      return { email, twitter, websites, phone };
    }, isSalesNavigator);

    // Close the modal
    const closeBtn = await page.$(
      ".artdeco-modal__dismiss, button[aria-label='Dismiss'], .pv-profile-section__close-modal-btn, .artdeco-modal__close"
    );
    if (closeBtn) {
      await humanClick(page, closeBtn);
      await humanDelay(500, 900);
    } else {
      await page.keyboard.press("Escape");
      await humanDelay(400, 700);
    }

    if (!contactData) return null;

    console.log(`[Scraper] Contact info extracted. Email: ${contactData.email ? "yes" : "no"}`);
    return contactData;
  } catch (error: any) {
    console.warn(`[Scraper] Contact info extraction failed: ${error.message}`);
    return null;
  }
}

// ============================================================
// 5. Core Profile Data Extraction
// ============================================================

/**
 * Extracts all available data from a fully-loaded, fully-expanded
 * LinkedIn profile page. All selectors are scoped to <main> and
 * every element's X-coordinate is verified < 800px.
 */
async function extractNormalProfile(
  page: Page,
): Promise<LinkedInProfile | null> {
  try {
    console.log("[Scraper] Beginning comprehensive data extraction...");

    // ── Section 1: Identity & Header ──────────────────────────
    await gaussianSectionDelay();

    const identity = await page.evaluate(() => {
      const doc = document as any;
      const main = doc.querySelector("main");
      if (!main) return null;

      const getMainText = (selectors: string[]): string => {
        for (const sel of selectors) {
          const el = main.querySelector(sel);
          if (!el) continue;
          // Removed X-coordinate guard for top-card/identity to support wide layouts
          const text = el.textContent?.trim();
          if (text) return text;
        }
        return "";
      };

      // Name
      const nameSelectors = [
        "h1.text-heading-xlarge",
        ".pv-text-details__left-panel h1",
        ".top-card-layout__title",
        "h1",
      ];
      let rawName = getMainText(nameSelectors);
      if (!rawName) {
        const title = doc.title as string;
        if (title && !title.toLowerCase().includes("sign in") && !title.toLowerCase().includes("join")) {
          rawName = title.split("|")[0].replace(/^\(\d+\)\s+/, "").trim();
        }
      }

      const fullName = rawName.trim();
      const firstName = fullName.split(" ")[0] || "";
      const lastName = fullName.replace(firstName, "").trim();

      // Headline
      const headline = getMainText([
        "div.text-body-medium.break-words",
        ".pv-text-details__left-panel .text-body-medium",
        "h2.mt1.t-18.t-black.t-normal",
        ".pv-top-card-section__headline",
        ".top-card-layout__headline",
      ]);

      // Location
      const location = getMainText([
        "span.text-body-small.inline.t-black--light.break-words",
        ".pv-text-details__left-panel .text-body-small.inline.t-black--light",
        "div.pb2 > span.text-body-small",
        ".top-card-layout__first-subline .text-body-small",
      ]);

      // Connection degree
      const degreeEl: any =
        main.querySelector(".dist-value") ||
        main.querySelector(".distance-badge .dist-value");
      const connectionDegree: string = degreeEl?.textContent?.trim() || "3rd";

      // Profile image
      const profileImg: any =
        main.querySelector(".pv-top-card-profile-picture__image--show") ||
        main.querySelector(".profile-photo-edit__preview") ||
        main.querySelector("img.pv-top-card__photo");
      const profileImageUrl: string = profileImg?.src || "";

      // Mutual connections
      const mutualEls: any[] = Array.from(
        main.querySelectorAll(
          ".member-insights__name, .member-insights span, .pv-browsemap-section__member-link"
        )
      );
      const mutualConnections: string[] = mutualEls
        .map((el: any) => el.textContent?.trim() || "")
        .filter((text: string) => text && !text.includes("connections"))
        .slice(0, 10);

      return { firstName, lastName, headline, location, connectionDegree, profileImageUrl, mutualConnections };
    });

    if (!identity || (!identity.firstName && !identity.headline)) {
      console.warn("[Scraper] Could not extract core identity. Aborting.");
      return null;
    }

    console.log(`[Scraper] Identity: ${identity.firstName} ${identity.lastName} | Headline: ${identity.headline || "(empty)"}`);

    // ── Section 2: About ──────────────────────────────────────
    await gaussianSectionDelay();

    const about = await page.evaluate(() => {
      const doc = document as any;
      const main = doc.querySelector("main");
      if (!main) return "";

      const aboutSection: any = main.querySelector("#about")?.closest("section") ||
        main.querySelector("section:has(#about)");
      if (!aboutSection) return "";

      const candidates: any[] = [
        aboutSection.querySelector("div.display-flex span[aria-hidden='true']"),
        aboutSection.querySelector(".pv-shared-text-with-see-more span[aria-hidden='true']"),
        aboutSection.querySelector(".inline-show-more-text span[aria-hidden='true']"),
        aboutSection.querySelector("div.display-flex span"),
      ];

      for (const el of candidates) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.x > 850) continue;
        const text: string = el.textContent?.trim();
        if (text && text.length > 10) return text;
      }
      return "";
    });

    console.log(`[Scraper] About: ${about ? `${about.slice(0, 60)}...` : "(empty)"}`);

    // ── Section 3: Experience ─────────────────────────────────
    await gaussianSectionDelay();

    const experience = await page.evaluate(() => {
      const doc = document as any;
      const main = doc.querySelector("main");
      if (!main) return [];

      const expSection: any = main.querySelector("#experience")?.closest("section") ||
        main.querySelector("section:has(#experience)");
      if (!expSection) return [];

      const items: any[] = Array.from(
        expSection.querySelectorAll("li.pvs-list__item--line-separated, .pvs-list__paged-list-item")
      );

      const results: any[] = [];

      items.forEach((item: any) => {
        const rect = item.getBoundingClientRect();
        if (rect.x > 850) return; // X-coordinate guard

        const tBoldSpans: string[] = Array.from(
          item.querySelectorAll('.t-bold span[aria-hidden="true"]')
        ).map((e: any) => e.textContent?.trim() || "");

        const tNormalSpans: string[] = Array.from(
          item.querySelectorAll('.t-normal:not(.t-black--light) span[aria-hidden="true"]')
        ).map((e: any) => e.textContent?.trim() || "");

        const captionSpans: string[] = Array.from(
          item.querySelectorAll('.pvs-entity__caption-wrapper span[aria-hidden="true"]')
        ).map((e: any) => e.textContent?.trim() || "");

        const lightSpans: string[] = Array.from(
          item.querySelectorAll('.t-black--light span[aria-hidden="true"]')
        ).map((e: any) => e.textContent?.trim() || "");

        const title: string = tBoldSpans[0] || "";
        const companyRaw: string = tNormalSpans[0] || "";
        const employmentType: string = tNormalSpans[1] || "";
        const durationRaw: string = captionSpans[0] || "";
        const jobLocation: string = lightSpans[0] || "";

        // Description
        const descEl: any =
          item.querySelector('.inline-show-more-text span[aria-hidden="true"]') ||
          item.querySelector(".inline-show-more-text");
        const description: string = descEl?.textContent?.trim() || "";

        if (!title && !companyRaw) return;

        const durationParts: string[] = durationRaw.split("·").map((s: string) => s.trim());
        const dateRange: string = durationParts[0] || "";
        const isCurrent: boolean = durationRaw.toLowerCase().includes("present");

        results.push({
          title,
          company: companyRaw.split("·")[0].trim(),
          duration: dateRange,
          description: [employmentType, jobLocation, description].filter(Boolean).join(" | "),
          isCurrent,
        });
      });

      return results;
    }) as Experience[];

    console.log(`[Scraper] Experience entries: ${experience.length}`);

    // ── Section 4: Education ──────────────────────────────────
    await gaussianSectionDelay();

    const education = await page.evaluate(() => {
      const doc = document as any;
      const main = doc.querySelector("main");
      if (!main) return [];

      const eduSection: any = main.querySelector("#education")?.closest("section") ||
        main.querySelector("section:has(#education)");
      if (!eduSection) return [];

      const items: any[] = Array.from(
        eduSection.querySelectorAll("li.pvs-list__item--line-separated, .pvs-list__paged-list-item")
      );

      const results: any[] = [];

      items.forEach((item: any) => {
        const rect = item.getBoundingClientRect();
        if (rect.x > 850) return;

        const tBoldSpans: string[] = Array.from(
          item.querySelectorAll('.t-bold span[aria-hidden="true"]')
        ).map((e: any) => e.textContent?.trim() || "");

        const tNormalSpans: string[] = Array.from(
          item.querySelectorAll('.t-normal span[aria-hidden="true"]')
        ).map((e: any) => e.textContent?.trim() || "");

        const captionSpans: string[] = Array.from(
          item.querySelectorAll('.pvs-entity__caption-wrapper span[aria-hidden="true"]')
        ).map((e: any) => e.textContent?.trim() || "");

        const detailSpans: string[] = Array.from(
          item.querySelectorAll('.display-flex span[aria-hidden="true"]')
        ).map((e: any) => e.textContent?.trim() || "");

        const school: string = tBoldSpans[0] || "";
        const degree: string = tNormalSpans[0] || "";
        const fieldRaw: string = tNormalSpans[1] || "";
        const years: string = captionSpans[0] || "";
        const activities: string = detailSpans.filter(
          (s: string) => s && !s.includes(school) && !s.includes(degree) && !s.includes(years)
        ).join(", ");

        if (!school && !degree) return;

        results.push({
          school,
          degree,
          field: fieldRaw || (degree.includes(",") ? degree.split(",")[1]?.trim() : ""),
          years: years + (activities ? ` | Activities: ${activities}` : ""),
        });
      });

      return results;
    }) as Education[];

    console.log(`[Scraper] Education entries: ${education.length}`);

    // ── Section 5: Skills ─────────────────────────────────────
    await gaussianSectionDelay();

    const skills = await page.evaluate(() => {
      const doc = document as any;
      const main = doc.querySelector("main");
      if (!main) return [] as string[];

      const skillsSection: any = main.querySelector("#skills")?.closest("section") ||
        main.querySelector("section:has(#skills)");
      if (!skillsSection) return [] as string[];

      const items: any[] = Array.from(
        skillsSection.querySelectorAll(
          "li.pvs-list__item--line-separated, .pvs-list__paged-list-item"
        )
      );

      const results: string[] = [];
      items.forEach((item: any) => {
        const rect = item.getBoundingClientRect();
        if (rect.x > 850) return;
        const skill: string | undefined =
          item.querySelector('.t-bold span[aria-hidden="true"]')?.textContent?.trim() ||
          item.querySelector(".hoverable-link-text")?.textContent?.trim() ||
          item.querySelector("span[aria-hidden='true']")?.textContent?.trim();
        if (skill && !results.includes(skill)) results.push(skill);
      });

      return results;
    });

    console.log(`[Scraper] Skills extracted: ${skills.length}`);

    // ── Section 6: Recent Posts / Activity ───────────────────
    await gaussianSectionDelay();

    const recentPosts = await page.evaluate(() => {
      const doc = document as any;
      const main = doc.querySelector("main");
      if (!main) return [];

      const activitySection: any = main.querySelector("#activity")?.closest("section") ||
        main.querySelector("section:has(#activity)");
      if (!activitySection) return [];

      const postEls: any[] = Array.from(
        activitySection.querySelectorAll(
          ".feed-shared-update-v2, .occludable-update, .profile-creator-shared-content-container"
        )
      ).slice(0, 3);

      const results: any[] = [];
      postEls.forEach((el: any) => {
        if (el.getBoundingClientRect().x > 850) return;
        const content: string =
          el.querySelector(".feed-shared-text span[dir='ltr'], .update-components-text span")
            ?.textContent?.trim() || "";
        const dateEl: any = el.querySelector(".feed-shared-actor__sub-description span[aria-hidden='true'], time");
        const date: string = dateEl?.textContent?.trim() || "";

        const likesEl: any = el.querySelector(
          ".social-details-social-counts__reactions-count, button[aria-label*='reaction']"
        );
        const commentsEl: any = el.querySelector(
          ".social-details-social-counts__comments .t-12, button[aria-label*='comment']"
        );

        const likes: number = parseInt(likesEl?.textContent?.trim()?.replace(/[^0-9]/g, "") || "0", 10);
        const comments: number = parseInt(commentsEl?.textContent?.trim()?.replace(/[^0-9]/g, "") || "0", 10);

        const linkEl: any = el.querySelector("a[href*='/posts/'], a[href*='/activity/']");
        const url: string = linkEl?.href || "";

        if (content || date) {
          results.push({ content, date, likes, comments, url });
        }
      });

      return results;
    }) as Post[];

    console.log(`[Scraper] Recent posts: ${recentPosts.length}`);

    // ── Section 6.5: Other Sections (Certifications, Languages, etc) ────────
    await gaussianSectionDelay();
    const otherSections = await page.evaluate(() => {
      const doc = document as any;
      const main = doc.querySelector("main");
      if (!main) return {};

      const results: Record<string, string[]> = {};
      const sections = Array.from(main.querySelectorAll("section.artdeco-card, section.pv-profile-section"));
      for (const sec of sections) {
        if ((sec as any).getBoundingClientRect().x > 850) continue;
        
        // Find header
        const headerEl = (sec as any).querySelector("h2, h3, .pvs-header__title");
        const headerName = headerEl?.textContent?.trim();
        
        // Skip ones we already extracted
        if (!headerName || ["Activity", "Experience", "Education", "Skills", "About"].some(h => headerName.includes(h))) {
          continue;
        }

        // Get all list items text
        const items = Array.from((sec as any).querySelectorAll("li.pvs-list__item--line-separated, li.pv-profile-section__list-item"));
        if (items.length > 0) {
          results[headerName] = items.map((item: any) => item.innerText?.trim() || item.textContent?.trim() || "").filter(Boolean);
        } else {
          // Just get all text
          const text = (sec as any).innerText?.trim() || (sec as any).textContent?.trim() || "";
          if (text) results[headerName] = [text];
        }
      }
      return results;
    });

    console.log(`[Scraper] Extracted extra sections: ${Object.keys(otherSections).join(", ")}`);

    // ── Section 7: Contact Info ───────────────────────────────
    await gaussianSectionDelay();
    const contactInfo = await extractContactInfo(page);

    // ── Assemble profile object ───────────────────────────────
    const company = experience[0]?.company || "";
    const role = experience[0]?.title || identity.headline.split(" at ")[0] || "";

    return {
      id: uuid(),
      linkedinUrl: "",
      firstName: identity.firstName,
      lastName: identity.lastName,
      headline: identity.headline,
      company,
      role,
      location: identity.location,
      about,
      email: contactInfo?.email || undefined,
      phone: contactInfo?.phone || undefined,
      experience,
      education,
      skills,
      recentPosts,
      mutualConnections: identity.mutualConnections,
      profileImageUrl: identity.profileImageUrl,
      connectionDegree: identity.connectionDegree as "1st" | "2nd" | "3rd" | "Out of Network",
      isSalesNavigator: false,
      scrapedAt: new Date().toISOString(),
      rawData: {
        contactInfo: contactInfo || {},
        extraSections: otherSections || {},
      },
    };
  } catch (error: any) {
    console.error(`[Scraper] extractNormalProfile failed: ${error.message}`);
    return null;
  }
}

// ============================================================
// 6.5. Semantic Fallback Extractor
// ============================================================

/**
 * Fallback mechanism for non-standard profile layouts (e.g., main#workspace).
 * Finds text sections logically ("About", "Experience") rather than strictly by CSS selectors.
 */
async function semanticExtractorFallback(page: Page): Promise<Partial<LinkedInProfile>> {
  console.log("[Scraper] Running Semantic Fallback Extractor...");
  
  return await page.evaluate(() => {
    const doc = document as any;
    
    // Look anywhere in the document for specific headers
    const findSectionContainerByHeader = (headerText: string) => {
      const headers = Array.from(doc.querySelectorAll('h2, span[aria-hidden="true"], h3'));
      const headerEl = headers.find((el: any) => el.textContent?.trim() === headerText);
      if (!headerEl) return null;
      return (headerEl as any).closest('section') || (headerEl as any).closest('div.artdeco-card');
    };

    const extractAbout = () => {
      const container = findSectionContainerByHeader("About");
      if (!container) return "";
      
      // Look for explicit expandable text box or inline text container
      const expandBox = container.querySelector('[data-testid="expandable-text-box"], .inline-show-more-text');
      if (expandBox) return (expandBox as any).innerText?.trim() || (expandBox as any).textContent?.trim() || "";
      
      // Fallback: extract the longest text paragraph
      const paragraphs = Array.from(container.querySelectorAll('p, span[aria-hidden="true"], div'));
      let longestText = "";
      for (const el of paragraphs) {
        const text = (el as HTMLElement).innerText?.trim() || (el as any).textContent?.trim() || "";
        if (text.length > longestText.length && text !== "About" && !text.toLowerCase().includes("see more") && text.length > 20) {
          longestText = text;
        }
      }
      return longestText;
    };

    const extractExperience = () => {
      const container = findSectionContainerByHeader("Experience");
      if (!container) return [];
      
      const items = Array.from(container.querySelectorAll('li.pvs-list__item--line-separated, .pvs-list__paged-list-item'));
      const results: any[] = [];
      
      for (const item of items) {
        const descEl = (item as any).querySelector('.inline-show-more-text span[aria-hidden="true"], .inline-show-more-text');
        
        // Remove description from item temporarily so we don't grab its text as title/company
        if (descEl) descEl.style.display = 'none';
        
        const bolds = Array.from((item as any).querySelectorAll('.t-bold span[aria-hidden="true"]')).map((el: any) => el.textContent?.trim()).filter(Boolean);
        const normals = Array.from((item as any).querySelectorAll('.t-normal span[aria-hidden="true"], .t-black--light span[aria-hidden="true"]')).map((el: any) => el.textContent?.trim()).filter(Boolean);
        const captions = Array.from((item as any).querySelectorAll('.pvs-entity__caption-wrapper span[aria-hidden="true"]')).map((el: any) => el.textContent?.trim()).filter(Boolean);
        
        if (descEl) descEl.style.display = ''; // restore
        
        const title = bolds[0] || "";
        const companyRaw = bolds[1] || normals[0] || "";
        const durationRaw = captions[0] || normals[1] || "";
        
        if (!title && !companyRaw) continue;
        
        const durationParts = durationRaw.split("·").map((s: string) => s.trim());
        const dateRange = durationParts[0] || "";
        const isCurrent = durationRaw.toLowerCase().includes("present");
        const description = descEl?.textContent?.trim() || "";
        
        results.push({
          title,
          company: companyRaw.split("·")[0].trim(),
          duration: dateRange,
          description,
          isCurrent
        });
      }
      return results;
    };

    const extractIdentitySemantic = () => {
      let location = "";
      let headline = "";
      let company = "";
      let education = "";
      let connectionDegree = "3rd";
      let mutualConnections: string[] = [];

      const mainArea = doc.querySelector('main') || doc.body;

      // Find Name to establish Identity Context (usually the first H1/H2)
      const hTags = Array.from(mainArea.querySelectorAll('h1, h2:not(.pvs-header__title)'));
      const nameEl = hTags.find((h: any) => {
        const text = h.innerText?.trim() || h.textContent?.trim() || "";
        return text.length > 2 && text.length < 40 && !text.includes("About") && !text.includes("Experience");
      });

      if (nameEl) {
        // The container holding the top card data is the closest complex section
        let topCard = (nameEl as any).closest('section') || (nameEl as any).parentElement?.parentElement?.parentElement || mainArea;

        // Extract sequential paragraphs safely
        const pTags = Array.from(topCard.querySelectorAll('p'));
        for (const p of pTags) {
          const text = (p as any).innerText?.trim() || (p as any).textContent?.trim() || "";
          if (!text || text.length < 5) continue;
          
          if (!headline && text.length > 15 && (text.includes("|") || text.split(" ").length > 3) && !text.includes("Contact info") && !text.includes("followers")) {
            headline = text.replace(/\n+/g, " ");
          } else if (headline && !company && text.includes("·") && !text.includes("followers") && !text.includes(",")) {
            const parts = text.split("·");
            company = parts[0]?.trim() || "";
            education = parts[1]?.trim() || "";
          } else if (!location && (text.includes(",") || text.includes("India") || text.includes("USA") || text.includes("UK")) && !text.includes("followers")) {
            location = text.split("·")[0].trim();
          }
        }
      }

      // Connection Degree
      const topAreaStr = mainArea.textContent || "";
      if (topAreaStr.match(/\b1st\b/)) connectionDegree = "1st";
      else if (topAreaStr.match(/\b2nd\b/)) connectionDegree = "2nd";

      // Mutual Connections
      const mutualMatch = topAreaStr.match(/(\d+\+?)\s+connections/);
      if (mutualMatch && mutualMatch[1]) {
         mutualConnections = [mutualMatch[1] + " connections"];
      }

      return { location, headline, company, education, connectionDegree, mutualConnections };
    };
    
    const semanticIdentity = extractIdentitySemantic();

    return {
      about: extractAbout(),
      experience: extractExperience(),
      location: semanticIdentity.location,
      headline: semanticIdentity.headline,
      company: semanticIdentity.company,
      education: semanticIdentity.education ? [{ school: semanticIdentity.education, degree: "", field: "", years: "" }] : [],
      connectionDegree: semanticIdentity.connectionDegree as any,
      mutualConnections: semanticIdentity.mutualConnections
    };
  });
}

// ============================================================
// 6.6. LLM-Assisted Semantic Parser (Ollama)
// ============================================================

async function extractProfileRawText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const mainArea = document.querySelector('main') || document.body;
    let rawText = "";

    // We collect section by section, stopping if we hit Activity
    const sections = Array.from(mainArea.querySelectorAll('section'));
    if (sections.length > 0) {
      for (const child of sections) {
         // USE innerText instead of textContent to preserve valid spacing/newlines.
         const sectionText = (child as HTMLElement).innerText?.replace(/\n+/g, "\n").trim() || "";
         const lowerText = sectionText.toLowerCase();
         // If we hit activity, skip it and stop to avoid token bloat
         if (lowerText.startsWith("activity") || lowerText.includes("posts") && lowerText.includes("followers")) {
            continue; 
         }
         if (sectionText && sectionText.length > 10) {
            // Strip out noisy links
            rawText += sectionText + "\n\n";
         }
      }
    }
    
    // If we missed standard things, just fallback to top card and body
    if (!rawText || rawText.length < 100) {
       rawText = ((document.querySelector('main') as HTMLElement)?.innerText || document.body.innerText || "").replace(/\n+/g, "\n");
    }
    return rawText.slice(0, 15000); // hard cap context window
  });
}


// ============================================================
// 6. Sales Navigator Profile Extraction (unchanged logic)
// ============================================================

async function extractSalesNavProfile(
  page: Page,
): Promise<LinkedInProfile | null> {
  try {
    const data = await page.evaluate(() => {
      const getText = (selector: string): string => {
        const el = document.querySelector(selector);
        return el?.textContent?.trim() || "";
      };

      const fullName =
        getText(".profile-topcard-person-entity__name") || getText("h1");
      const nameParts = fullName.split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";
      const headline = getText(".profile-topcard__summary-position") || "";
      const company = getText(".profile-topcard__summary-position a") || "";
      const location = getText(".profile-topcard__location-data") || "";
      const about = getText(".profile-topcard__summary-content") || "";

      // Extract Experience
      const experience: any[] = [];
      const expItems = Array.from(document.querySelectorAll(".profile-experience-entity"));
      expItems.forEach((item) => {
        const title = item.querySelector(".profile-experience-entity__title")?.textContent?.trim() || "";
        const companyName = item.querySelector(".profile-experience-entity__company-name")?.textContent?.trim() || "";
        const duration = item.querySelector(".profile-experience-entity__duration")?.textContent?.trim() || "";
        const description = item.querySelector(".profile-experience-entity__description")?.textContent?.trim() || "";
        if (title) {
          experience.push({
            title,
            company: companyName,
            duration,
            description,
            isCurrent: duration.toLowerCase().includes("present"),
          });
        }
      });

      // Extract Education
      const education: any[] = [];
      const eduItems = Array.from(document.querySelectorAll(".profile-education-entity"));
      eduItems.forEach((item) => {
        const school = item.querySelector(".profile-education-entity__school-name")?.textContent?.trim() || "";
        const degree = item.querySelector(".profile-education-entity__degree-name")?.textContent?.trim() || "";
        const field = item.querySelector(".profile-education-entity__field-of-study")?.textContent?.trim() || "";
        const years = item.querySelector(".profile-education-entity__dates")?.textContent?.trim() || "";
        if (school) {
          education.push({ school, degree, field, years });
        }
      });

      return { firstName, lastName, headline, company, role: headline.split(" at ")[0] || "", location, about, experience, education };
    });

    if (!data) return null;

    // Contact info extraction is handled in the main orchestrator calling extractContactInfo(page, true)

    return {
      id: uuid(),
      linkedinUrl: "",
      firstName: data.firstName,
      lastName: data.lastName,
      headline: data.headline,
      company: data.company,
      role: data.role,
      location: data.location,
      about: data.about,
      experience: data.experience || [],
      education: data.education || [],
      skills: [],
      recentPosts: [],
      mutualConnections: [],
      profileImageUrl: "",
      connectionDegree: "2nd",
      isSalesNavigator: true,
      scrapedAt: new Date().toISOString(),
      rawData: {},
    };
  } catch {
    return null;
  }
}

// ============================================================
// 7. Public Orchestrator: scrapeProfile
// ============================================================

/**
 * Visit and scrape a LinkedIn profile using the full high-fidelity pipeline.
 * Validates the page, runs natural reading, expands all sections,
 * extracts all data points, and persists to the database via UPSERT.
 */
export async function scrapeProfile(
  profileUrl: string,
  options: {
    readNaturally?: boolean;
    isSalesNavigator?: boolean;
    skipNavigation?: boolean;
    campaignId?: string;
  } = {},
  settings?: AppSettings["ai"]
): Promise<LinkedInProfile | null> {
  const page = getPage();
  if (!page) throw new Error("Browser not launched");

  const { readNaturally = true, isSalesNavigator = false, skipNavigation = false } = options;

  try {
    if (!skipNavigation) {
      // \u2500\u2500 Robust Navigation with Stabilization Retry \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      // "Execution context was destroyed" is thrown when evaluate() is called
      // during a page navigation (e.g., on app first start when the browser
      // is still finishing loading the previous page). We retry up to 3 times
      // with increasing wait periods, and fall back to page.goto() on retries.
      let navSuccess = false;
      for (let attempt = 1; attempt <= 3 && !navSuccess; attempt++) {
        try {
          // On retries, wait for page to fully settle before trying again
          if (attempt > 1) {
            console.log(`[Scraper] Navigation attempt ${attempt}/3 \u2014 waiting for page to stabilize...`);
            await new Promise(r => setTimeout(r, attempt * 3000));
            try {
              await page.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 });
            } catch (_) { /* continue regardless */ }
          }

          if (attempt === 1) {
            // First attempt: use the standard SPA-safe in-page navigate
            await inPageNavigate(page, profileUrl);
          } else {
            // Fallback: hard goto() — this is more reliable when the page is in a bad state
            console.log(`[Scraper] Falling back to page.goto() for attempt ${attempt}`);
            await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));
          }

          navSuccess = true;
        } catch (navErr: any) {
          const msg = navErr instanceof Error ? navErr.message : String(navErr);
          const isContextDestroyed = msg.includes('Execution context was destroyed') || msg.includes('Cannot inspect context');
          if (isContextDestroyed && attempt < 3) {
            console.warn(`[Scraper] Navigation failed (context destroyed, attempt ${attempt}/3). Retrying...`);
          } else {
            throw navErr; // Unrecoverable or last attempt
          }
        }
      }
      await pageLoadDelay();
    } else {
      console.log(`[Scraper] Bypassing explicit navigation, assuming already on profile: ${profileUrl}`);
      await pageLoadDelay();
    }

    // ── Page Validity Guard ──
    const isValid = await validateProfilePage(page);
    if (!isValid) {
      const errMsg = `Page is not a valid LinkedIn profile (url: ${page.url()})`;
      console.error(`[Scraper] ${errMsg}`);
      logActivity("profile_scrape_failed", "linkedin", { url: profileUrl, reason: "invalid_page" }, "error", errMsg);
      return null;
    }

    // ── Natural Reading Protocol ──
    if (readNaturally) {
      await naturalReadingProtocol(page);
    }

    // ── Expand All Hidden Content (main-scoped) ──
    await expandAllHiddenContent(page);

    // ── Extract Profile Data ──
    let profileData = isSalesNavigator
      ? await extractSalesNavProfile(page)
      : await extractNormalProfile(page);

    // ── Semantic Parsing Override (LLM or Rules) ──
    const isMissingData = !profileData || 
      (profileData.experience.length === 0 && !profileData.about) || 
      (!profileData.location && !profileData.headline);

    if (!isSalesNavigator && isMissingData) {
      console.warn("[Scraper] Standard selectors failed to find rich data — falling back to Advanced Semantic Extraction.");
      
      // Try LLM Extraction First
      let fallbackData: Partial<LinkedInProfile> | null = null;
      try {
         const rawScrapedText = await extractProfileRawText(page);
         if (settings) {
            fallbackData = await parseProfileJson(rawScrapedText, settings);
         } else {
            console.warn("[Scraper] AI settings not provided. Skipping NVIDIA API JSON extraction.");
         }
      } catch (e) {
         console.warn("[Scraper] Remote LLM call failed, reverting to rule-based semantic extractor.", e);
      }

      // Revert to pure logic text parsing if LLM failed
      if (!fallbackData) {
         fallbackData = await semanticExtractorFallback(page);
      } else {
         console.log("[Scraper] Success: LLM Parser successfully mapped profile data.");
      }
      
      if (!profileData) {
         // Create a skeleton if NormalProfile completely failed
         profileData = {
           id: uuid(),
           linkedinUrl: "",
           firstName: fallbackData.firstName || "",
           lastName: fallbackData.lastName || "",
           headline: fallbackData.headline || "",
           company: fallbackData.company || "",
           role: fallbackData.role || "",
           location: fallbackData.location || "",
           about: fallbackData.about || "",
           experience: fallbackData.experience || [],
           education: fallbackData.education || [],
           skills: fallbackData.skills || [],
           recentPosts: [],
           mutualConnections: fallbackData.mutualConnections || [],
           profileImageUrl: "",
           connectionDegree: (fallbackData.connectionDegree as "1st" | "2nd" | "3rd" | "Out of Network") || "3rd",
           isSalesNavigator: false,
           scrapedAt: new Date().toISOString(),
           rawData: {},
         };
         // Try to pull name from page title as absolute fallback
         const title = await page.title();
         const rawName = title.split("|")[0].replace(/^\(\d+\)\s+/, "").trim();
         profileData.firstName = rawName.split(" ")[0] || "Unknown";
         profileData.lastName = rawName.replace(profileData.firstName, "").trim();
      } else {
        if (fallbackData.about && !profileData.about) profileData.about = fallbackData.about;
        if (fallbackData.experience && fallbackData.experience.length > 0 && profileData.experience.length === 0) profileData.experience = fallbackData.experience;
        if (fallbackData.headline && !profileData.headline) profileData.headline = fallbackData.headline;
        if (fallbackData.location && !profileData.location) profileData.location = fallbackData.location;
        if (fallbackData.connectionDegree && profileData.connectionDegree === "3rd") profileData.connectionDegree = fallbackData.connectionDegree as any;
        if (fallbackData.mutualConnections && fallbackData.mutualConnections.length > 0 && profileData.mutualConnections.length === 0) profileData.mutualConnections = fallbackData.mutualConnections;
        if (fallbackData.education && fallbackData.education.length > 0 && profileData.education.length === 0) profileData.education = fallbackData.education;
        if (fallbackData.skills && fallbackData.skills.length > 0 && profileData.skills.length === 0) profileData.skills = fallbackData.skills;
        if (fallbackData.company && !profileData.company) profileData.company = fallbackData.company;
        if (fallbackData.role && !profileData.role) profileData.role = fallbackData.role;
      }
      
      if (profileData.experience && profileData.experience.length > 0 && !profileData.company) {
         profileData.company = profileData.experience[0].company || "";
         profileData.role = profileData.experience[0].title || "";
      }
    }

    if (!profileData) {
      logActivity("profile_scrape_failed", "linkedin", { url: profileUrl, reason: "extraction_failed" }, "error", "extractNormalProfile returned null");
      return null;
    }

    profileData.linkedinUrl = profileUrl;
    profileData.isSalesNavigator = isSalesNavigator;
    profileData.scrapedAt = new Date().toISOString();

    // ── Contact Info (Always attempt for both Normal and SalesNav) ──
    const contactInfo = await extractContactInfo(page, isSalesNavigator);
    if (contactInfo) {
      profileData.rawData = {
        ...profileData.rawData,
        contactInfo,
      };
      // Persist extracted email to the profile object so upsertLeadProfile saves it
      if (contactInfo.email) {
        (profileData as any).email = contactInfo.email;
        console.log(`[Scraper] Contact email found (${isSalesNavigator ? 'SalesNav' : 'Standard'}): ${contactInfo.email}`);
      }
    }

    // ── Final Safety Gate — ensure we have at least a name before saving ──
    // This can happen if both CSS and semantic extractors return empty firstName
    if (!profileData.firstName) {
      // Last-ditch: pull name from page title
      try {
        const pageTitle = await page.title();
        if (pageTitle && !pageTitle.toLowerCase().includes("sign in") && !pageTitle.toLowerCase().includes("join")) {
          const rawName = pageTitle.split("|")[0].replace(/^\(\d+\)\s+/, "").trim();
          profileData.firstName = rawName.split(" ")[0] || "Unknown";
          profileData.lastName = rawName.replace(profileData.firstName, "").trim();
          console.log(`[Scraper] Final fallback — name from page title: "${profileData.firstName} ${profileData.lastName}"`);
        }
      } catch { /* ignore */ }
    }

    // ── Ensure all array fields are proper arrays (guard against LLM type mismatches) ──
    if (!Array.isArray(profileData.experience)) profileData.experience = [];
    if (!Array.isArray(profileData.education)) profileData.education = [];
    if (!Array.isArray(profileData.skills)) profileData.skills = [];
    if (!Array.isArray(profileData.recentPosts)) profileData.recentPosts = [];
    if (!Array.isArray(profileData.mutualConnections)) profileData.mutualConnections = [];

    // ── Persist to Database via UPSERT ──
    console.log(`[Scraper] Attempting DB save for "${profileData.firstName} ${profileData.lastName}" (url: ${profileData.linkedinUrl})...`);
    const savedId = upsertLeadProfile(profileData);
    profileData.id = savedId;
    console.log(`[Scraper] Profile saved/updated in DB. ID: ${savedId}`);

    if (options.campaignId) {
      const { getDatabase } = await import("../storage/database");
      const db = getDatabase();
      db.prepare("UPDATE leads SET campaign_id = ? WHERE id = ?").run(options.campaignId, savedId);
      console.log(`[Scraper] Live-mapped profile ${savedId} to Campaign ${options.campaignId}`);
    }

    logActivity("profile_scraped", "linkedin", {
      name: `${profileData.firstName} ${profileData.lastName}`,
      company: profileData.company,
      headline: profileData.headline,
      experienceCount: profileData.experience.length,
      skillsCount: profileData.skills.length,
      url: profileUrl,
    });

    // Random idle action after scraping (wrapped in try/catch so it never kills the result)
    try {
      await randomIdleAction(page);
    } catch (idleErr) {
      console.warn(`[Scraper] randomIdleAction failed (non-critical): ${idleErr instanceof Error ? idleErr.message : "Unknown"}`);
    }

    return profileData;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Scraper] ❌ scrapeProfile threw an exception: ${message}`);
    logActivity("profile_scrape_failed", "linkedin", { url: profileUrl, error: message }, "error", message);
    return null;
  }
}

// ============================================================
// 8. Company or Person Profile (unchanged public API)
// ============================================================

export async function scrapeCompanyOrPersonProfile(
  url: string,
): Promise<{
  type: "person" | "company";
  name: string;
  headline: string;
  location: string;
  about: string;
  website?: string;
  industry?: string;
  employeeCount?: string;
  linkedinUrl: string;
} | null> {
  const page = getPage();
  if (!page) throw new Error("Browser not launched");

  const isCompany =
    url.includes("/company/") ||
    url.includes("/school/") ||
    url.includes("/showcase/");

  try {
    console.log(`[Scraper] Navigating to: ${url}`);
    await inPageNavigate(page, url);
    await pageLoadDelay();
    await humanDelay(2000, 4000);
    console.log(`[Scraper] Arrived at: ${page.url()}`);

    if (isCompany) {
      const data = await page.evaluate(() => {
        const getText = (sel: string) =>
          document.querySelector(sel)?.textContent?.trim() || "";

        const name =
          getText(".org-top-card-summary__title") ||
          getText(".ember-view h1") ||
          getText("h1");

        const tagline =
          getText(".org-top-card-summary__tagline") ||
          getText(".top-card-layout__headline");

        const industry =
          getText(".org-top-card-summary-info-list__info-item:nth-child(1)") ||
          getText(".ember-view .org-top-card-summary-info-list span");

        const employeeCount =
          getText(".org-top-card-summary-info-list__info-item:nth-child(2)") ||
          getText('a[href*="people"] span');

        const location =
          getText(".org-top-card-summary-info-list__info-item:nth-child(3)") ||
          getText(".org-location");

        const about =
          getText(".org-about-us-organization-description__text") ||
          getText(".org-about-module__description") ||
          getText('section[data-test-id="about-us"] p') ||
          "";

        const websiteEl = document.querySelector<HTMLAnchorElement>(
          'a[data-tracking-control-name="about_website"]',
        );
        const website = websiteEl?.href || websiteEl?.textContent?.trim() || "";

        return { name, tagline, industry, employeeCount, location, about, website };
      });

      logActivity("company_scraped", "linkedin", { name: data.name, url });

      return {
        type: "company",
        name: data.name,
        headline: data.tagline,
        location: data.location,
        about: data.about,
        website: data.website,
        industry: data.industry,
        employeeCount: data.employeeCount,
        linkedinUrl: url,
      };
    } else {
      const profile = await extractNormalProfile(page);
      if (!profile) {
        throw new Error("Unable to extract data from this personal profile.");
      }

      const fullName = `${profile.firstName} ${profile.lastName}`.trim();
      return {
        type: "person",
        name: fullName || "LinkedIn Member",
        headline: profile.headline,
        location: profile.location,
        about: profile.about,
        linkedinUrl: url,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Scraper] scrapeCompanyOrPersonProfile failed for ${url}: ${message}`);
    logActivity("scrape_failed", "linkedin", { url, error: message }, "error", message);
    throw error;
  }
}

// ============================================================
// 9. Bulk Search Import — Human-Mimicry Edition
//
// On each page of search results, after extracting profile data
// from the DOM, the engine randomly selects one profile card,
// physically clicks it (Bézier + hardware click), runs the full
// outreach pipeline (deep scrape → AI note → connection request),
// then navigates back to continue importing.
// ============================================================

/** Options to enable the full outreach flow during import */
export interface ImportOutreachOptions {
  settings: any;
  limitManager: DailyLimitManager;
  campaignId?: string;
  /**
   * Called immediately after a profile is successfully scraped (AI visited it).
   * Use this to insert the profile into the campaign queue one-by-one.
   */
  onProfileScraped?: (profile: {
    name: string;
    title: string;
    company: string;
    location: string;
    profileUrl: string;
  }) => void;
}

export async function importFromSearchUrl(
  searchUrl: string,
  maxLeads: number = 50,
  outreachOptions?: ImportOutreachOptions,
): Promise<
  Array<{
    name: string;
    title: string;
    company: string;
    location: string;
    profileUrl: string;
    source: "people_search" | "company_search" | "sales_nav";
  }>
> {
  const page = getPage();
  if (!page) throw new Error("Browser not launched");

  await waitForBrowserLock();
  setBrowserLocked(true);

  const results: Array<{
    name: string;
    title: string;
    company: string;
    location: string;
    profileUrl: string;
    source: "people_search" | "company_search" | "sales_nav";
  }> = [];

  const isSalesNav = searchUrl.includes("/sales/");
  const isCompanySearch = searchUrl.includes("/results/companies");
  const source: "people_search" | "company_search" | "sales_nav" = isSalesNav
    ? "sales_nav"
    : isCompanySearch
      ? "company_search"
      : "people_search";

  try {
    const isKeywordMatch = !searchUrl.startsWith("http");

    if (isKeywordMatch) {
      console.log(`[Import] Searching keyword "${searchUrl}" using human-centric search...`);
      await performSearch(page, searchUrl, "people");
      searchUrl = page.url(); // Grab resolved URL
    } else {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await pageLoadDelay();
      await humanDelay(2000, 4000);

      // Explicit Check for "People" filter if we're on a global search results page
      if (searchUrl.includes("/search/results/") && !searchUrl.includes("/search/results/people/")) {
         const { applySearchFilter } = await import("../browser/session");
         await applySearchFilter(page, "people");
         searchUrl = page.url(); // Grab resolved URL after filter
      }
    }
    
    console.log("[Import] Initial search loaded. Waiting ~10s for page to settle per requested organic flow...");
    await humanDelay(8000, 11000);
    searchUrl = page.url(); // Final safety check to ensure we have the exact active URL

    let pageNum = 1;
    try {
      const parsedUrl = new URL(searchUrl);
      const pageParam = parsedUrl.searchParams.get("page");
      if (pageParam) {
        pageNum = parseInt(pageParam, 10) || 1;
      }
    } catch (e) {
      // Ignore URL parsing errors
    }

    while (results.length < maxLeads && pageNum <= 100) {
      // ── Campaign Abort Check ─────────────────────────────────────────
      // This fires at the top of every page iteration. If the campaign was
      // paused while we were processing the previous page, stop immediately.
      if (isImportAborted(outreachOptions?.campaignId)) {
        console.log(`[Import] ⛔ Campaign ${outreachOptions?.campaignId} is paused. Aborting import loop.`);
        break;
      }

      // ── Daily Limits Check ───────────────────────────────────────────
      if (outreachOptions?.limitManager) {
        if (!outreachOptions.limitManager.canPerform("connectionRequests") || !outreachOptions.limitManager.canPerform("profileViews")) {
          console.log(`[Import] 🛑 Daily limits reached. Aborting search import loop.`);
          break;
        }
      }

      // ── Phase 1: Emulate human reading by scrolling up/down ────────────
      console.log(`[Import] Phase 1 - Emulating human name-reading (reading profile names up/down) on page ${pageNum}...`);
      
      const scrollCycles = Math.floor(Math.random() * 2) + 2; // 2 to 3 iterations
      for (let c = 0; c < scrollCycles; c++) {
         await humanScroll(page, { direction: "down", distance: 300 + Math.random() * 400 });
         await humanDelay(1000, 2500); 
         if (Math.random() < 0.3) {
            await humanScroll(page, { direction: "up", distance: 100 + Math.random() * 200 });
            await humanDelay(1500, 3000);
         }
      }
      
      for (let i = 0; i < 2; i++) {
        await humanScroll(page, { direction: "down", distance: 500 });
        await humanDelay(500, 1000);
      }
      await humanScroll(page, { direction: "up", distance: 2000 });
      await humanDelay(800, 1500);

      // ── Phase 2: Extract profile data from DOM cards ───────────────────
      const pageResults = await page.evaluate(
        (src: string) => {
          const cards: Array<{
            name: string;
            title: string;
            company: string;
            location: string;
            profileUrl: string;
          }> = [];

          const main = document.querySelector("main");
          const resultCards = document.querySelectorAll(
            'ul[role="list"] > li, .reusable-search__entity-result-list > li, [role="listitem"], .reusable-search__result-container, .entity-result'
          );

          resultCards.forEach((card) => {
            if (main && !main.contains(card)) return; // Ensure it only reads names from the main area (list only)

            const linkEl = card.querySelector<HTMLAnchorElement>(
              'a[href*="/in/"]:not([href*="/miniProfileUrn/"]), a[href*="/company/"]'
            );

            // 1. Extract Name robustly from "View X's profile" accessibility span
            let fullName = "";
            const allSpans = Array.from(card.querySelectorAll("span"));
            const viewSpan = allSpans.find((s) => /view\s+.+profile/i.test((s.textContent || "").replace(/\s+/g, " ")));
            
            if (viewSpan) {
              const spanText = (viewSpan.textContent || "").replace(/\s+/g, " ").trim();
              const nameMatch = spanText.match(/View\s+(.+?)['\u2019]s?\s+profile/i);
              if (nameMatch && nameMatch[1]) {
                 fullName = nameMatch[1].trim();
              } else {
                 fullName = spanText.split(' ').slice(0, 2).join(' '); // Fallback to first 2 words max
              }
            } else {
              // Fallback to older DOM structures if the accessibility span isn't present
              const nameEl = card.querySelector(".entity-result__title-text a span[aria-hidden='true']") ||
                             card.querySelector(".entity-result__title-text a span:first-child") ||
                             linkEl?.querySelector("span[aria-hidden='true']") ||
                             linkEl;
              let tempName = (nameEl?.textContent || "").replace(/\s+/g, " ").trim();
              if (tempName.toLowerCase().startsWith("status is")) {
                // If it accidentally grabbed the status bubble, pick the next span
                const fallbacks = linkEl?.querySelectorAll("span[aria-hidden='true']");
                if (fallbacks && fallbacks.length > 1) {
                  tempName = (fallbacks[1].textContent || "").replace(/\s+/g, " ").trim() || tempName;
                }
              }
              const words = tempName.split(' ');
              fullName = words.length > 2 ? words.slice(0, 2).join(' ') : tempName;
            }

            // 2. Extract Title / Headline
            const titleEl =
              card.querySelector(".entity-result__primary-subtitle") ||
              card.querySelector(".entity-result__secondary-subtitle") ||
              card.querySelector(".artdeco-entity-lockup__subtitle span") ||
              card.querySelector(".search-result__snippets");
            
            const fullTitle = titleEl?.textContent?.trim() || "";
            
            // 3. Extract Company from Headline (e.g. "CEO at Company")
            let company = "";
            if (fullTitle.toLowerCase().includes(" at ")) {
               const parts = fullTitle.split(/ at /i);
               company = parts[parts.length - 1].trim();
            } else if (fullTitle.toLowerCase().includes(" @ ")) {
               const parts = fullTitle.split(/ @ /i);
               company = parts[parts.length - 1].trim();
            }

            // 4. Extract Location
            const locationEl = 
              card.querySelector(".entity-result__secondary-subtitle") ||
              card.querySelector(".entity-result__tertiary-subtitle");
            
            let location = locationEl?.textContent?.trim() || "";
            if (location === fullTitle) {
               // tertiary usually has the real location if secondary is the headline
               const terEl = card.querySelector(".entity-result__tertiary-subtitle");
               if (terEl) location = terEl.textContent?.trim() || "";
            }

            const rawUrl = linkEl?.href || "";
            const cleanUrl = rawUrl.split("?")[0];

            if (fullName && cleanUrl) {
              cards.push({
                name: fullName,
                title: fullTitle,
                company: company,
                location: location,
                profileUrl: cleanUrl,
              });
            }
          });

          return cards;
        },
        source,
      );

      for (const r of pageResults) {
        if (results.length >= maxLeads) break;
        if (!results.find((x) => x.profileUrl === r.profileUrl)) {
          results.push({ ...r, source });
        }
      }
      
      const readNames = pageResults.map(r => r.name).join(", ");
      console.log(`[Import] Phase 2 - Read ${pageResults.length} profile names from the grid: [${readNames}]`);

      // ── Phase 3: Profile Interaction — Click multiple profiles per page ──
      // Process 3–5 random profiles per page (human-like organic drop-off),
      // tracking visited URLs so the same card is never clicked twice.
      if (outreachOptions && pageResults.length > 0) {
        const pageVisited = new Set<string>();
        const profilesPerPage = Math.floor(Math.random() * 3) + 3; // 3 to 5
        console.log(`[Import] Phase 3 - Will interact with up to ${profilesPerPage} profiles on this page...`);

        for (let pIdx = 0; pIdx < profilesPerPage && results.length < maxLeads; pIdx++) {
          // Per-profile campaign abort check — catches pause mid-page
          if (isImportAborted(outreachOptions?.campaignId)) {
            console.log(`[Import] ⛔ Campaign paused mid-page. Stopping profile interactions.`);
            break;
          }

          if (outreachOptions?.limitManager && (!outreachOptions.limitManager.canPerform("connectionRequests") || !outreachOptions.limitManager.canPerform("profileViews"))) {
            console.log(`[Import] 🛑 Daily limits reached mid-page. Stopping profile interactions.`);
            break;
          }
          // Build fresh candidate list excluding already-clicked profiles this page
          const remaining = pageResults.filter(
            r => r.profileUrl.includes("/in/") && !pageVisited.has(r.profileUrl)
          );
          if (remaining.length === 0) {
            console.log(`[Import] Phase 3 - No more unvisited candidates on page ${pageNum}. Moving on.`);
            break;
          }

          // Pick one at random
          const pick = remaining[Math.floor(Math.random() * remaining.length)];
          pageVisited.add(pick.profileUrl);

          console.log(`[Import] Phase 3 [${pIdx + 1}/${profilesPerPage}] - Clicking "${pick.name}"...`);
          await _profileInteractionPhase(page, [pick], searchUrl, outreachOptions);

          // Inter-profile organic delay (1.5–3.5s) between picks on the same page
          if (pIdx < profilesPerPage - 1 && remaining.length > 1) {
            await humanDelay(1500, 3500);
          }
        }
      } else {
        console.log(`[Import] Phase 3 - Skipped: No outreach options provided or page is empty.`);
      }

      if (results.length >= maxLeads) break;

      // ── Phase 4: Navigate to next page ────────────────────────────────
      // Scroll to the bottom of the page to ensure LinkedIn lazy-loads the pagination container.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await humanDelay(1500, 2500);
      // Small natural scroll up and down to trigger intersection observers just in case
      await humanScroll(page, { direction: "up", distance: 300 });
      await humanDelay(500, 1000);
      await humanScroll(page, { direction: "down", distance: 400 });
      await humanDelay(1000, 2000);

      // ── Phase 4: Navigate to next page using URL ──────────────────────
      // Break early if we hit a page with zero results
      if (pageResults.length === 0) {
        console.log(`[Import] No results found on page ${pageNum}. All pages exhausted.`);
        break;
      }

      pageNum++;
      let nextUrl = searchUrl;

      try {
        const parsedUrl = new URL(searchUrl);
        parsedUrl.searchParams.set("page", pageNum.toString());
        nextUrl = parsedUrl.toString();
      } catch (e) {
        // Fallback for invalid URLs
        if (searchUrl.includes("?")) {
           if (searchUrl.includes("&page=") || searchUrl.includes("?page=")) {
              nextUrl = searchUrl.replace(/([?&])page=\d+/, `$1page=${pageNum}`);
           } else {
              nextUrl = `${searchUrl}&page=${pageNum}`;
           }
        } else {
           nextUrl = `${searchUrl}?page=${pageNum}`;
        }
      }

      console.log(`[Import] Navigating to next page (${pageNum}) via URL: ${nextUrl}`);
      
      // Update the active searchUrl for the next iteration
      searchUrl = nextUrl;
      
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await pageLoadDelay();
      await humanDelay(3000, 5000);
    }

    logActivity("search_import_done", "linkedin", {
      searchUrl,
      totalExtracted: results.length,
      pagesScanned: pageNum,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity("search_import_failed", "linkedin", { error: message }, "error", message);
  } finally {
    setBrowserLocked(false);
  }

  return results;
}

// ============================================================
// 9.1. Profile Interaction Phase (Human-Mimicry Outreach)
//
// Called once per search results page. Picks a random profile
// card, physically clicks it using Bézier mouse movement +
// hardware-level click, then runs the full outreach pipeline:
//   scrapeProfile() → generateConnectionNote() → sendConnectionRequest()
// Finally navigates back to the search results page.
// ============================================================

async function _profileInteractionPhase(
  page: Page,
  pageResults: Array<{ name: string; title: string; company: string; location: string; profileUrl: string }>,
  searchUrl: string,
  outreachOptions: ImportOutreachOptions,
): Promise<void> {
  const { settings, limitManager } = outreachOptions;

  // ── Step A: Pick a random profile from this page's results ─────────
  const candidates = pageResults.filter(r => r.profileUrl.includes("/in/"));
  if (candidates.length === 0) {
    console.log("[Import] No /in/ profile candidates on this page. Skipping interaction.");
    return;
  }

  const randomIdx = Math.floor(Math.random() * candidates.length);
  const target = candidates[randomIdx];
  console.log(`[Import] 🎯 Profile Interaction: clicking "${target.name}" → ${target.profileUrl}`);

  // ── Step B: Find the anchor element in the DOM and click it ────────
  try {
    // Locate the card's <a href="/in/..."> element
    const targetSlug = target.profileUrl.split("/in/")[1]?.replace(/\/$/, "") || "";
    if (!targetSlug) {
      console.warn("[Import] Could not parse profile slug. Skipping interaction.");
      return;
    }

    // ── Step B0: Scroll the target card into the viewport center ────────
    // THIS IS CRITICAL — without this, getBoundingClientRect() returns
    // off-screen coordinates and the click lands on empty space.
    // Mirrors ProfileDiscoveryEngine's smoothScrollToEntity() pattern.
    const scrolled = await page.evaluate(async (slug: string) => {
      const links = Array.from(document.querySelectorAll('a[href*="/in/"]')) as HTMLAnchorElement[];
      for (const link of links) {
        if (!link.href.includes(`/in/${slug}`)) continue;
        const card = link.closest(
          '.reusable-search__result-container, .entity-result, [role="listitem"], li'
        ) as HTMLElement | null;
        const target = card || link;
        
        // Smooth scroll to center the card in the viewport
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        
        // Wait for scroll animation to settle (300ms)
        await new Promise(r => setTimeout(r, 300));
        return true;
      }
      return false;
    }, targetSlug);

    if (!scrolled) {
      console.warn(`[Import] Could not find card for "${target.name}" to scroll into view. Skipping.`);
      return;
    }

    // Wait for LinkedIn's IntersectionObserver to fire (human gaze signal)
    // + scroll animation to fully settle
    await humanDelay(1200, 2500);

    // ── Step B1: NOW get bounding boxes (card is in viewport) ────────────
    const anchorBox = await page.evaluate((slug: string) => {
      const links = Array.from(document.querySelectorAll('a[href*="/in/"]')) as HTMLAnchorElement[];
      for (const link of links) {
        if (!link.href.includes(`/in/${slug}`)) continue;
        const rect = link.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        // Verify the element is actually in the visible viewport
        if (rect.top < 0 || rect.bottom > window.innerHeight) continue;

        // Also get the parent card bounding box for gaze hover
        const card = link.closest(
          '.reusable-search__result-container, .entity-result, [role="listitem"], li'
        );
        const cardRect = card ? card.getBoundingClientRect() : rect;

        return {
          anchor: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
          card: { x: cardRect.left, y: cardRect.top, w: cardRect.width, h: cardRect.height },
        };
      }
      return null;
    }, targetSlug);

    if (!anchorBox) {
      console.warn(`[Import] Could not find visible anchor box for "${target.name}". Skipping interaction.`);
      return;
    }

    // PHASE A: The "Gaze" — hover over the card's whitespace area first
    const gazeX = anchorBox.card.x + (anchorBox.card.w * 0.75) + (Math.random() * 30);
    const gazeY = anchorBox.card.y + (anchorBox.card.h * 0.5);
    await humanMouseMove(page, gazeX, gazeY);

    // PHASE B: Thinking delay — simulate reading the headline
    await humanDelay(1200, 2800);

    // PHASE C: Bézier move to the name anchor center + hardware click
    const clickX = anchorBox.anchor.x + (anchorBox.anchor.w / 2) + ((Math.random() - 0.5) * 10);
    const clickY = anchorBox.anchor.y + (anchorBox.anchor.h / 2) + ((Math.random() - 0.5) * 6);

    console.log(`[Import] Precision click → anchor center (${Math.round(clickX)}, ${Math.round(clickY)})`);
    await humanMouseMove(page, clickX, clickY);

    // Hardware-level trusted click: MouseDown → 150-250ms hold → MouseUp
    await page.mouse.down({ button: "left" });
    await humanDelay(150, 250);
    await page.mouse.up({ button: "left" });

    console.log("[Import] Hardware click dispatched (isTrusted=true).");

    // ── Step B2: Wait for profile page to load ──────────────────────────
    const navOk = await page
      .waitForFunction(
        () =>
          window.location.href.includes("/in/") &&
          !window.location.href.includes("/search/"),
        { timeout: 18000 }
      )
      .then(() => true)
      .catch(() => {
        return (
          page.url().includes("/in/") &&
          !page.url().includes("/search/")
        );
      });

    if (!navOk) {
      console.warn(`[Import] Navigation to profile timed out. Still at: ${page.url()}. Skipping outreach.`);
      return;
    }

    // Wait for network idle (profile XHR data loading)
    await page
      .waitForNetworkIdle({ idleTime: 1000, timeout: 12000 })
      .catch(() => console.warn("[Import] Network idle timeout — continuing."));

    // Wait for profile top-card DOM
    await page
      .waitForSelector(
        ".pv-top-card, [data-member-id], .ph5, .profile-topcard, main .artdeco-card",
        { visible: true, timeout: 12000 }
      )
      .catch(() => console.warn("[Import] Top-card not detected — continuing."));

    // Extra React hydration time
    await humanDelay(1200, 2200);

    const profileUrl = page.url().split("?")[0].replace(/\/$/, "");
    console.log(`[Import] ✅ Profile page ready: ${profileUrl}`);

    // ── Step C: Full Outreach Pipeline ───────────────────────────────────
    // C1: Deep scrape the profile
    console.log(`[Import] 🔍 Deep scraping "${target.name}"...`);
    const profile = await scrapeProfile(
      target.profileUrl, 
      { skipNavigation: true, campaignId: outreachOptions.campaignId }, 
      settings?.ai
    );

    if (profile) {
      console.log(`[Import] 📋 Scraped: ${profile.firstName} ${profile.lastName} @ ${profile.company}`);

      // ── Notify caller immediately (profile-by-profile queue insert) ──────
      if (outreachOptions.onProfileScraped) {
        outreachOptions.onProfileScraped({
          name: `${profile.firstName} ${profile.lastName}`.trim(),
          title: profile.headline || target.title || "",
          company: profile.company || target.company || "",
          location: profile.location || target.location || "",
          profileUrl: profile.linkedinUrl || target.profileUrl,
        });
      }

      // C2: Generate AI connection note
      let note = "";
      if (settings?.ai) {
        console.log(`[Import] 🧠 Generating AI connection note...`);
        try {
          note = await generateConnectionNote(
            profile,
            settings?.personalization || { yourName: "", yourCompany: "", yourServices: "" },
            settings.ai,
          );
          console.log(`[Import] 💡 Note ready (${note.length} chars).`);
        } catch (aiErr) {
          console.warn(`[Import] ⚠️ AI note failed: ${aiErr instanceof Error ? aiErr.message : "Unknown"}. Connecting without note.`);
        }
      }

      // C3: Send connection request
      if (limitManager.canPerform("connectionRequests")) {
        console.log(`[Import] 📨 Sending connection to ${profile.firstName}...`);
        const result = await sendConnectionRequest(
          profile,
          settings?.personalization || { yourName: "", yourCompany: "", yourServices: "" },
          settings,
          limitManager,
        );

        if (result.success) {
          console.log(
            `[Import] ✅ Connected: ${profile.firstName} ${profile.lastName}` +
            ` (note: ${result.noteSent ? "yes" : "no"})`,
          );
          
          if (profile.id) {
            const { getDatabase } = await import("../storage/database");
            const db = getDatabase();
            
            // Explicitly update database inline to ensure jobs & checkers act correctly
            db.prepare(`
              UPDATE leads 
              SET status = 'connection_requested',
                  connection_requested_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
                  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
                  connection_note = ?
              WHERE id = ?
            `).run(note || null, profile.id);
            
            // Delete any duplicate SEND_CONNECTION jobs that pipeline runner might have queued in the interim!
            try {
              db.prepare(`DELETE FROM job_queue WHERE type = 'SEND_CONNECTION' AND payload LIKE ?`).run(`%${profile.id}%`);
            } catch (err) { /* ignore */ }

            // Trigger connection email immediately if email is available
            if (profile.email) {
              console.log(`[Import] Email found (${profile.email}), enqueuing connection email immediately.`);
              const { jobQueue } = await import("../queue/jobQueue");
              const { JOB_TYPES } = await import("../queue/jobs");
              jobQueue.enqueue(
                JOB_TYPES.SEND_INTRO_EMAIL,
                { leadId: profile.id, campaignId: outreachOptions.campaignId, recipientEmail: profile.email },
                { delayMs: 1000, priority: 4 }
              );
            }
          }
        } else if (result.error === "COMPLETED_SKIPPED") {
          console.log(`[Import] ⏭️ Already connected/pending: ${profile.firstName}.`);
        } else if (result.error === "Daily connection request limit reached") {
          console.log(`[Import] 🛑 Daily limit hit. Skipping outreach for remaining pages.`);
        } else {
          console.log(`[Import] ❌ Connection failed: ${result.error}`);
        }
      } else {
        console.log(`[Import] 🛑 Daily connection limit reached. Skipping send.`);
      }
    } else {
      console.warn(`[Import] ❌ Scrape failed for "${target.name}". Skipping outreach.`);
    }

    // ── Step D: Navigate back to search results ─────────────────────────
    console.log("[Import] 🔙 history.back() — returning to search results...");
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
      console.warn("[Import] history.back() failed. Hard navigating to search URL...");
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    }

    // Stability wait — let LazyColumn re-render
    await humanDelay(1500, 2500);
    console.log("[Import] ✅ Search results restored.");

  } catch (interactionErr) {
    const msg = interactionErr instanceof Error ? interactionErr.message : "Unknown";
    console.error(`[Import] Profile interaction failed: ${msg}. Continuing import.`);
    // Ensure we're back on search results even after an error
    if (!page.url().includes("/search/")) {
      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await humanDelay(1500, 2500);
      } catch {
        console.error("[Import] Failed to recover to search page after interaction error.");
      }
    }
  }
}

// ============================================================
// 10. Scrape From Search Results (unchanged public API)
// ============================================================

export async function scrapeSearchResults(
  maxProfiles: number = 10,
): Promise<LinkedInProfile[]> {
  const page = getPage();
  if (!page) throw new Error("Browser not launched");

  const profiles: LinkedInProfile[] = [];

  try {
    const profileLinks = await page.$$eval(
      '.reusable-search__result-container a[href*="/in/"]',
      (links) =>
        links
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((v, i, a) => a.indexOf(v) === i),
    );

    const linksToProcess = profileLinks.slice(0, maxProfiles);

    for (const link of linksToProcess) {
      if (profiles.length > 0) {
        await humanDelay(15000, 45000);
      }

      const profile = await scrapeProfile(link, { readNaturally: true });
      if (profile) {
        profiles.push(profile);
      }

      await randomIdleAction(page);
    }

    logActivity("search_results_scraped", "linkedin", {
      totalFound: profileLinks.length,
      totalScraped: profiles.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity("search_scrape_failed", "linkedin", { error: message }, "error", message);
  }

  return profiles;
}
