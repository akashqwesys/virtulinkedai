/**
 * Sales Navigator Module
 *
 * Handles Sales Navigator specific functionality:
 * - Advanced lead search with filters
 * - Lead list management
 * - InMail handling (Sales Navigator allows InMail)
 * - Sales Navigator specific scraping (more detailed profiles)
 *
 * The key difference: Sales Navigator uses a different URL structure
 * (/sales/...) and has richer profile data + advanced search filters.
 */

import type { Page } from "puppeteer-core";
import type { LinkedInProfile, AppSettings } from "../../shared/types";
import { getPage } from "../browser/engine";
import {
  humanClick,
  humanType,
  humanDelay,
  humanScroll,
  pageLoadDelay,
  randomIdleAction,
} from "../browser/humanizer";
import { logActivity } from "../storage/database";

// ============================================================
// Sales Navigator Detection
// ============================================================

/**
 * Check if the current account has Sales Navigator access
 */
export async function detectSalesNavigator(): Promise<{
  hasSalesNav: boolean;
  planType: "core" | "advanced" | "advanced_plus" | "none";
}> {
  const page = getPage();
  if (!page) return { hasSalesNav: false, planType: "none" };

  try {
    // Try navigating to Sales Navigator
    await page.goto("https://www.linkedin.com/sales/home", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await humanDelay(2000, 4000);

    const url = page.url();

    if (url.includes("/sales/")) {
      // Check plan type from the UI
      const planIndicator = await page.$(".global-nav__sales-nav-badge");
      const planText = planIndicator
        ? await page.evaluate((el) => el.textContent?.trim(), planIndicator)
        : "";

      let planType: "core" | "advanced" | "advanced_plus" | "none" = "core";
      if (planText?.toLowerCase().includes("advanced plus"))
        planType = "advanced_plus";
      else if (planText?.toLowerCase().includes("advanced"))
        planType = "advanced";

      logActivity("sales_nav_detected", "linkedin", { planType });
      return { hasSalesNav: true, planType };
    }

    return { hasSalesNav: false, planType: "none" };
  } catch {
    return { hasSalesNav: false, planType: "none" };
  }
}

// ============================================================
// Sales Navigator Lead Search
// ============================================================

export interface SalesNavSearchFilters {
  keywords?: string;
  titleKeywords?: string;
  companyKeywords?: string;
  geography?: string[];
  industry?: string[];
  companySize?: string[];
  seniorityLevel?: string[];
  functionArea?: string[];
  yearsInCurrentRole?: string;
  yearsInCurrentCompany?: string;
  changedJobsRecently?: boolean;
  postedOnLinkedIn?: boolean;
  mentionedInNews?: boolean;
  connectionLevel?: ("1st" | "2nd" | "3rd+")[];
}

export interface SalesNavSearchResult {
  name: string;
  title: string;
  company: string;
  location: string;
  profileUrl: string;
  salesNavUrl: string;
  connectionDegree: string;
  sharedConnections: number;
  isOpenProfile: boolean;
}

/**
 * Perform a Sales Navigator lead search
 */
export async function searchSalesNavLeads(
  filters: SalesNavSearchFilters,
  maxResults: number = 25,
): Promise<SalesNavSearchResult[]> {
  const page = getPage();
  if (!page) return [];

  const results: SalesNavSearchResult[] = [];

  try {
    // Navigate to Sales Nav search
    await page.goto("https://www.linkedin.com/sales/search/people", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await pageLoadDelay();

    // Apply keyword filter
    if (filters.keywords) {
      const searchInput =
        (await page.$('input[placeholder*="Search"]')) ||
        (await page.$(".search-field__input"));
      if (searchInput) {
        await humanClick(page, searchInput as any);
        for (const ch of filters.keywords) {
          await page.keyboard.type(ch);
          await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
        }
        await page.keyboard.press("Enter");
        await pageLoadDelay();
      }
    }

    // Apply title filter
    if (filters.titleKeywords) {
      await applySalesNavFilter(
        page,
        "Current job title",
        filters.titleKeywords,
      );
    }

    // Apply company filter
    if (filters.companyKeywords) {
      await applySalesNavFilter(
        page,
        "Current company",
        filters.companyKeywords,
      );
    }

    // Apply geography filter
    if (filters.geography?.length) {
      for (const geo of filters.geography) {
        await applySalesNavFilter(page, "Geography", geo);
      }
    }

    // Apply seniority filter
    if (filters.seniorityLevel?.length) {
      await clickSalesNavFilterCheckbox(
        page,
        "Seniority level",
        filters.seniorityLevel,
      );
    }

    // Wait for results to load
    await humanDelay(2000, 4000);

    // Scrape result cards
    let page_num = 1;
    while (results.length < maxResults) {
      const cards = await page.$$(
        '.artdeco-list__item, .search-results__result-item, [data-anonymize="person-name"]',
      );

      for (const card of cards) {
        if (results.length >= maxResults) break;

        try {
          const data = await page.evaluate((el) => {
            const nameEl =
              el.querySelector('[data-anonymize="person-name"]') ||
              el.querySelector(".result-lockup__name a");
            const titleEl =
              el.querySelector('[data-anonymize="title"]') ||
              el.querySelector(".result-lockup__highlight-keyword");
            const companyEl =
              el.querySelector('[data-anonymize="company-name"]') ||
              el.querySelector(".result-lockup__position-company");
            const locationEl = el.querySelector(".result-lockup__misc-item");
            const linkEl =
              el.querySelector('a[href*="/sales/lead/"]') ||
              el.querySelector('a[href*="/sales/people/"]');
            const degreeEl = el.querySelector(".result-lockup__badge");
            const sharedEl = el.querySelector('[data-anonymize="count"]');

            return {
              name: nameEl?.textContent?.trim() || "",
              title: titleEl?.textContent?.trim() || "",
              company: companyEl?.textContent?.trim() || "",
              location: locationEl?.textContent?.trim() || "",
              salesNavUrl: linkEl?.getAttribute("href") || "",
              degree: degreeEl?.textContent?.trim() || "",
              shared: parseInt(sharedEl?.textContent?.trim() || "0") || 0,
              isOpen: !!el.querySelector(".open-profile-badge"),
            };
          }, card);

          if (data.name) {
            results.push({
              name: data.name,
              title: data.title,
              company: data.company,
              location: data.location,
              profileUrl: convertSalesNavToRegularUrl(data.salesNavUrl),
              salesNavUrl: data.salesNavUrl.startsWith("http")
                ? data.salesNavUrl
                : `https://www.linkedin.com${data.salesNavUrl}`,
              connectionDegree: data.degree,
              sharedConnections: data.shared,
              isOpenProfile: data.isOpen,
            });
          }
        } catch {
          /* skip individual card errors */
        }

        await humanDelay(300, 800);
      }

      // Check for next page
      if (results.length >= maxResults) break;
      const nextButton =
        (await page.$('button[aria-label="Next"]')) ||
        (await page.$(".search-results__pagination-next-button"));
      if (!nextButton) break;

      page_num++;
      if (page_num > 10) break; // Safety: max 10 pages

      await humanClick(page, nextButton as any);
      await pageLoadDelay();
      await humanDelay(2000, 4000);

      // Random idle action between pages
      if (Math.random() < 0.3) {
        await randomIdleAction(page);
      }
    }

    logActivity("sales_nav_search", "linkedin", {
      filters: Object.keys(filters),
      resultsFound: results.length,
      pagesScanned: page_num,
    });
  } catch (error) {
    logActivity(
      "sales_nav_search_error",
      "linkedin",
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "error",
    );
  }

  return results;
}

// ============================================================
// Sales Navigator Profile Scraping (Enhanced)
// ============================================================

/**
 * Scrape a profile via Sales Navigator (richer data)
 */
export async function scrapeSalesNavProfile(
  salesNavUrl: string,
): Promise<LinkedInProfile | null> {
  const page = getPage();
  if (!page) return null;

  try {
    await page.goto(salesNavUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await pageLoadDelay();
    await humanDelay(1500, 3000);

    // Scroll to load all sections
    for (let i = 0; i < 5; i++) {
      await humanScroll(page, {
        direction: "down",
        distance: 300 + Math.random() * 200,
      });
      await humanDelay(800, 1500);
    }

    const profileData = await page.evaluate(() => {
      const getText = (sel: string) =>
        document.querySelector(sel)?.textContent?.trim() || "";

      // Basic info
      const name =
        getText('[data-anonymize="person-name"]') ||
        getText(".profile-topcard-person-entity__name");
      const nameParts = name.split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";
      const headline =
        getText('[data-anonymize="headline"]') ||
        getText(".profile-topcard__summary-position");
      const location =
        getText('[data-anonymize="location"]') ||
        getText(".profile-topcard__location-data");
      const about =
        getText(".profile-topcard__summary-content") ||
        getText(".profile-topcard__about-content");

      // Current role
      const currentRoleEl = document.querySelector(
        ".profile-topcard__summary-position",
      );
      const company = getText('[data-anonymize="company-name"]') || "";
      const role = getText('[data-anonymize="title"]') || "";

      // Experience - Sales Nav shows more detail
      const experienceItems: Array<{
        title: string;
        company: string;
        duration: string;
        description: string;
        isCurrent: boolean;
      }> = [];
      document
        .querySelectorAll(
          ".profile-topcard__previous-position, .profile-position",
        )
        .forEach((el, i) => {
          experienceItems.push({
            title:
              (
                el.querySelector('[data-anonymize="title"]') ||
                el.querySelector(".profile-position__title")
              )?.textContent?.trim() || "",
            company:
              (
                el.querySelector('[data-anonymize="company-name"]') ||
                el.querySelector(".profile-position__company-name")
              )?.textContent?.trim() || "",
            duration:
              (
                el.querySelector(".profile-position__duration") ||
                el.querySelector(".profile-topcard__time-period")
              )?.textContent?.trim() || "",
            description:
              el
                .querySelector(".profile-position__description")
                ?.textContent?.trim() || "",
            isCurrent: i === 0,
          });
        });

      // Skills from Sales Nav
      const skills: string[] = [];
      document
        .querySelectorAll(
          '.profile-skills__skill-name, [data-anonymize="skill-name"]',
        )
        .forEach((el) => {
          const skill = el.textContent?.trim();
          if (skill) skills.push(skill);
        });

      // Tags, notes, and connection info from Sales Nav
      const connectionDegree = getText(".artdeco-badge") || "3rd";
      const sharedConnections =
        parseInt(getText('[data-anonymize="count"]') || "0") || 0;

      // Check for contact info (Sales Nav often shows email)
      const emailEl = document.querySelector('[data-anonymize="email"]');
      const email = emailEl?.textContent?.trim() || "";

      return {
        firstName,
        lastName,
        headline,
        company,
        role,
        location,
        about,
        experience: experienceItems,
        skills,
        connectionDegree,
        sharedConnections,
        email,
      };
    });

    const profile: LinkedInProfile = {
      id: `sales_nav_${Date.now()}`,
      linkedinUrl: convertSalesNavToRegularUrl(salesNavUrl),
      firstName: profileData.firstName,
      lastName: profileData.lastName,
      headline: profileData.headline,
      company: profileData.company,
      role: profileData.role,
      location: profileData.location,
      about: profileData.about,
      experience: profileData.experience,
      education: [],
      skills: profileData.skills,
      recentPosts: [],
      mutualConnections: [],
      profileImageUrl: "",
      connectionDegree: (profileData.connectionDegree.includes("1")
        ? "1st"
        : profileData.connectionDegree.includes("2")
          ? "2nd"
          : "3rd") as any,
      isSalesNavigator: true,
      scrapedAt: new Date().toISOString(),
      rawData: {
        salesNavUrl,
        sharedConnections: profileData.sharedConnections,
      },
    };

    logActivity("sales_nav_profile_scraped", "linkedin", {
      name: `${profileData.firstName} ${profileData.lastName}`,
      company: profileData.company,
    });

    return profile;
  } catch (error) {
    logActivity(
      "sales_nav_scrape_error",
      "linkedin",
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "error",
    );
    return null;
  }
}

// ============================================================
// Sales Navigator InMail
// ============================================================

/**
 * Send an InMail via Sales Navigator (bypasses connection requirement)
 */
export async function sendInMail(
  salesNavUrl: string,
  subject: string,
  body: string,
): Promise<{ success: boolean; error?: string }> {
  const page = getPage();
  if (!page) return { success: false, error: "Browser not launched" };

  try {
    await page.goto(salesNavUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await pageLoadDelay();

    // Click the "Message" or "InMail" button
    const messageButton =
      (await page.$('button[data-control-name="message"]')) ||
      (await page.$("button::-p-text(Message)")) ||
      (await page.$(".profile-topcard__message-button"));

    if (!messageButton) {
      return {
        success: false,
        error: "Message button not found on Sales Nav profile",
      };
    }

    await humanClick(page, messageButton as any);
    await humanDelay(1500, 3000);

    // Fill in subject
    const subjectInput = await page.waitForSelector(
      'input[name="subject"], input[placeholder*="Subject"]',
      { timeout: 8000 },
    );
    if (subjectInput) {
      await humanClick(page, subjectInput as any);
      for (const ch of subject) {
        await page.keyboard.type(ch);
        await new Promise((r) => setTimeout(r, 40 + Math.random() * 80));
      }
      await humanDelay(500, 1000);
    }

    // Fill in body
    const bodyInput = await page.waitForSelector(
      '.compose-form__message-field, textarea[name="body"], .msg-form__contenteditable',
      { timeout: 8000 },
    );
    if (!bodyInput)
      return { success: false, error: "Message body field not found" };

    await humanClick(page, bodyInput as any);
    await humanDelay(300, 600);

    // Type body naturally
    for (const char of body) {
      if (char === "\n") {
        await page.keyboard.press("Enter");
      } else {
        await page.keyboard.type(char);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, 40 + Math.random() * 80),
      );
      if (Math.random() < 0.03) {
        await humanDelay(200, 500);
      }
    }

    await humanDelay(1000, 2000);

    // Send
    const sendButton =
      (await page.$('button[data-control-name="send"]')) ||
      (await page.$("button::-p-text(Send)"));
    if (!sendButton) return { success: false, error: "Send button not found" };

    await humanClick(page, sendButton as any);
    await humanDelay(1500, 3000);

    logActivity("inmail_sent", "linkedin", {
      salesNavUrl,
      subjectLength: subject.length,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================
// Save Leads to Sales Nav List
// ============================================================

/**
 * Save a lead to a Sales Navigator lead list
 */
export async function saveToSalesNavList(
  salesNavUrl: string,
  listName: string,
): Promise<{ success: boolean; error?: string }> {
  const page = getPage();
  if (!page) return { success: false, error: "Browser not launched" };

  try {
    await page.goto(salesNavUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await pageLoadDelay();

    // Click "Save" button
    const saveButton =
      (await page.$('button[data-control-name="save"]')) ||
      (await page.$("button::-p-text(Save)")) ||
      (await page.$(".profile-topcard__save-button"));

    if (!saveButton) return { success: false, error: "Save button not found" };

    await humanClick(page, saveButton as any);
    await humanDelay(1000, 2000);

    // Select or create list
    const listInput = await page.$('input[placeholder*="list"]');
    if (listInput) {
      await humanClick(page, listInput as any);
      for (const ch of listName) {
        await page.keyboard.type(ch);
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
      }
      await humanDelay(500, 1000);

      // Select from dropdown or create new
      const option = await page.$(`li::-p-text(${listName})`);
      if (option) {
        await humanClick(page, option as any);
      } else {
        // Create new list
        const createButton = await page.$("button::-p-text(Create)");
        if (createButton) await humanClick(page, createButton as any);
      }
    }

    // Confirm save
    const confirmButton =
      (await page.$("button::-p-text(Save)")) ||
      (await page.$('button[data-control-name="save_confirm"]'));
    if (confirmButton) {
      await humanClick(page, confirmButton as any);
      await humanDelay(1000, 2000);
    }

    logActivity("saved_to_list", "linkedin", { salesNavUrl, listName });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================
// Helpers
// ============================================================

function convertSalesNavToRegularUrl(salesNavUrl: string): string {
  // Extract the member ID or vanity URL from Sales Nav URLs
  // Sales Nav URL: /sales/lead/ACwAAAxxxxxx,xxxxx
  // Regular URL: /in/vanity-name
  const match = salesNavUrl.match(/\/sales\/(?:lead|people)\/([^,?]+)/);
  if (match) {
    return `https://www.linkedin.com/in/${match[1]}`;
  }
  return salesNavUrl;
}

async function applySalesNavFilter(
  page: Page,
  filterLabel: string,
  value: string,
): Promise<void> {
  try {
    // Find and click the filter button
    const filterButton = await page.$(`button::-p-text(${filterLabel})`);
    if (!filterButton) return;

    await humanClick(page, filterButton as any);
    await humanDelay(500, 1000);

    // Type in the filter input
    const filterInput =
      (await page.$(".search-reusables__filter-value-input input")) ||
      (await page.$(`input[aria-label*="${filterLabel}"]`));

    if (filterInput) {
      await humanClick(page, filterInput as any);
      for (const ch of value) {
        await page.keyboard.type(ch);
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
      }
      await humanDelay(500, 1000);

      // Select first suggestion
      const suggestion = await page.waitForSelector(
        ".basic-typeahead__selectable",
        { timeout: 5000 },
      );
      if (suggestion) {
        await humanClick(page, suggestion as any);
        await humanDelay(300, 600);
      }
    }

    // Apply filter
    const applyButton =
      (await page.$("button::-p-text(Apply)")) ||
      (await page.$(".search-reusables__filter-apply-button"));
    if (applyButton) {
      await humanClick(page, applyButton as any);
      await humanDelay(500, 1000);
    }
  } catch {
    /* filter application failed, continue */
  }
}

async function clickSalesNavFilterCheckbox(
  page: Page,
  filterLabel: string,
  values: string[],
): Promise<void> {
  try {
    const filterButton = await page.$(`button::-p-text(${filterLabel})`);
    if (!filterButton) return;

    await humanClick(page, filterButton as any);
    await humanDelay(500, 1000);

    for (const value of values) {
      const checkbox = await page.$(`label::-p-text(${value})`);
      if (checkbox) {
        await humanClick(page, checkbox as any);
        await humanDelay(200, 400);
      }
    }

    const applyButton = await page.$("button::-p-text(Apply)");
    if (applyButton) {
      await humanClick(page, applyButton as any);
      await humanDelay(500, 1000);
    }
  } catch {
    /* checkbox filter failed, continue */
  }
}
