/**
 * LinkedIn Session Manager
 *
 * Handles login, session persistence, and login state detection.
 * Uses the anti-detect browser engine for all interactions.
 *
 * Safety: We never store passwords. Login is done manually by the user
 * in the browser window. Session cookies are persisted in userDataDir.
 */

import type { Page } from "puppeteer-core";
import { navigateTo, getPage, setLoggedIn } from "./engine";
import {
  humanDelay,
  pageLoadDelay,
  humanClick,
  humanType,
  thinkingDelay,
} from "./humanizer";
import { logActivity } from "../storage/database";
import { BrowserWindow } from "electron";

export function sendSessionLog(message: string) {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    windows[0].webContents.send(
      "autopilot-log",
      `[${new Date().toLocaleTimeString()}] ${message}`
    );
  }
  console.log(message);
}

const LINKEDIN_URL = "https://www.linkedin.com";
const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";
const LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login";
const SALES_NAV_URL = "https://www.linkedin.com/sales/";

/**
 * Check if user is already logged into LinkedIn
 * (session persisted from previous run)
 */
export async function checkLoginStatus(): Promise<{
  isLoggedIn: boolean;
  accountType: "normal" | "sales_navigator" | null;
  profileName: string | null;
}> {
  const page = getPage();
  if (!page) return { isLoggedIn: false, accountType: null, profileName: null };

  try {
    let currentUrl = page.url();

    // Force navigation ONLY if not on linkedin
    // Do NOT navigate away if they are on /login or /signup as it interrupts the user typing credentials
    if (!currentUrl.includes("linkedin.com")) {
      await navigateTo(LINKEDIN_URL);
      await pageLoadDelay();
      currentUrl = page.url();
    }

    // Evaluate DOM for global logged-in markers valid across all LinkedIn pages
    const loginState = await page.evaluate(() => {
      const isLoggedOut = 
        window.location.pathname.includes("/login") || 
        window.location.pathname.includes("/signup") ||
        !!document.querySelector(".sign-in-form");
        
      if (isLoggedOut) return null;

      const profileImg = document.querySelector(".global-nav__me-photo") || 
                         document.querySelector(".feed-identity-module__actor-meta img");
      const profileName = profileImg ? profileImg.getAttribute("alt") : null;

      const hasSalesNav = !!document.querySelector('[href*="/sales/"]');
      
      // If we are on /feed, /mynetwork, or /in/, we are definitively logged in
      const isOnSecurePage = 
        window.location.pathname.startsWith("/feed") || 
        window.location.pathname.startsWith("/mynetwork") || 
        window.location.pathname.startsWith("/in/");
        
      const hasNav = !!document.querySelector("#global-nav") || !!document.querySelector(".global-nav__me");

      // We are logged in if on a secure page OR have global nav elements
      if (isOnSecurePage || profileName || hasNav) {
        return { profileName, hasSalesNav };
      }
      return null;
    });

    if (loginState) {
      setLoggedIn(true);
      logActivity("login_check_success", "session", {
        isLoggedIn: true,
        accountType: loginState.hasSalesNav ? "sales_navigator" : "normal",
        profileName: loginState.profileName,
      });

      return {
        isLoggedIn: true,
        accountType: loginState.hasSalesNav ? "sales_navigator" : "normal",
        profileName: loginState.profileName,
      };
    }

    setLoggedIn(false);
    return { isLoggedIn: false, accountType: null, profileName: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity(
      "login_check_failed",
      "session",
      { error: message },
      "error",
      message,
    );
    return { isLoggedIn: false, accountType: null, profileName: null };
  }
}

/**
 * Open LinkedIn login page for manual login
 *
 * IMPORTANT: We do NOT automate the login process itself.
 * The user logs in manually in the browser window.
 * This is both safer (LinkedIn can't detect automated login)
 * and more secure (we never handle credentials).
 */
export async function openLoginPage(): Promise<void> {
  const page = getPage();
  if (!page) throw new Error("Browser not launched");

  await navigateTo(LINKEDIN_LOGIN_URL);
  await pageLoadDelay();

  logActivity("login_page_opened", "session");
}

/**
 * Log out from LinkedIn
 */
export async function logout(): Promise<{ success: boolean; error?: string }> {
  const page = getPage();
  if (!page) return { success: false, error: "Browser not launched" };

  try {
    await navigateTo("https://www.linkedin.com/m/logout/");
    await pageLoadDelay();
    
    // Clear cookies
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');

    setLoggedIn(false);
    logActivity("logout_success", "session");
    
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity("logout_failed", "session", { error: message }, "error", message);
    return { success: false, error: message };
  }
}

/**
 * Wait for the user to complete manual login
 * Polls for successful login state
 */
export async function waitForLogin(
  timeoutMs: number = 300000, // 5 minutes
  onProgress?: (message: string) => void,
): Promise<boolean> {
  const page = getPage();
  if (!page) return false;

  const startTime = Date.now();
  onProgress?.("Waiting for you to log in to LinkedIn...");

  while (Date.now() - startTime < timeoutMs) {
    try {
      const currentUrl = page.url();

      // Check if we've been redirected to feed (login successful)
      if (
        currentUrl.includes("/feed") ||
        currentUrl.includes("/mynetwork") ||
        currentUrl.includes("/in/")
      ) {
        setLoggedIn(true);
        onProgress?.("Login successful!");
        logActivity("login_success", "session");
        return true;
      }

      // Check for verification challenge
      if (
        currentUrl.includes("/checkpoint/") ||
        currentUrl.includes("/feed/update/")
      ) {
        onProgress?.(
          "LinkedIn security check detected. Please complete it in the browser.",
        );
      }
    } catch {
      // Page might be navigating, ignore errors
    }

    // Poll every 2 seconds
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  onProgress?.("Login timeout. Please try again.");
  logActivity("login_timeout", "session", {}, "error", "Login timed out");
  return false;
}

/**
 * Navigate to LinkedIn Feed (home) using in-page navigation
 * NEVER navigate by direct URL after initial login
 */
export async function goToFeed(page: Page): Promise<void> {
  // Click the Home icon in the nav bar instead of direct URL navigation
  const homeButton =
    (await page.$('a[href*="/feed/"]')) ||
    (await page.$(".global-nav__primary-link--active")) ||
    (await page.$('[data-control-name="feed"]'));

  if (homeButton) {
    await humanClick(page, homeButton as any);
    await pageLoadDelay();
  } else {
    // Fallback: only use direct URL if nav element not found
    await navigateTo(LINKEDIN_FEED_URL);
    await pageLoadDelay();
  }
}

/**
 * Navigate to My Network page using in-page navigation
 */
export async function goToMyNetwork(page: Page): Promise<void> {
  const networkButton =
    (await page.$('a[href*="/mynetwork/"]')) ||
    (await page.$('[data-control-name="connections"]'));

  if (networkButton) {
    await humanClick(page, networkButton as any);
    await pageLoadDelay();
  }
}

/**
 * Navigate to Sales Navigator (if available)
 */
export async function goToSalesNavigator(page: Page): Promise<void> {
  const salesNavLink = await page.$('a[href*="/sales/"]');

  if (salesNavLink) {
    await humanClick(page, salesNavLink as any);
    await pageLoadDelay();
    await thinkingDelay();
  } else {
    // Fallback
    await navigateTo(SALES_NAV_URL);
    await pageLoadDelay();
  }
}

/**
 * Navigate to Messaging page using in-page navigation
 */
export async function goToMessaging(page: Page): Promise<void> {
  const messagingButton =
    (await page.$('a[href*="/messaging/"]')) ||
    (await page.$('[data-control-name="messaging"]'));

  if (messagingButton) {
    await humanClick(page, messagingButton as any);
    await pageLoadDelay();
  }
}

/**
 * Perform a LinkedIn search using the search bar (in-page navigation)
 */
export async function performSearch(
  page: Page,
  query: string,
  filter?: "people" | "companies" | "posts",
): Promise<void> {
  
  // 1. Ensure we are on a page with the search bar
  let searchInput = await page.$('input[data-testid="typeahead-input"]') || 
                    await page.$('input[placeholder*="Search"]') ||
                    await page.$('input[aria-label="Search"]');

  if (!searchInput) {
    sendSessionLog("[Search] Search bar not found. Navigating to Feed to initiate search.");
    await goToFeed(page);
    await pageLoadDelay();
    
    searchInput = await page.$('input[data-testid="typeahead-input"]') || 
                  await page.$('input[placeholder*="Search"]') ||
                  await page.$('input[aria-label="Search"]');
                  
    if (!searchInput) throw new Error("Search input not found even after navigating to feed");
  }

  // 2. Physical human mouse click (Bézier + mechanical click)
  const box = await searchInput.boundingBox();
  if (!box) throw new Error("Search input has no bounding box");

  // Approach via Bézier curve. Click slightly off-center leftwards (natural for text inputs)
  const targetX = box.x + box.width * 0.2 + (Math.random() - 0.5) * 10;
  const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 5;

  sendSessionLog(`[Search] Approaching search bar via Bézier curve to (${Math.round(targetX)}, ${Math.round(targetY)})`);
  
  // Implicitly uses generateBezierPath from humanizer since we call humanMouseMove
  const { humanMouseMove, humanDelay } = await import("./humanizer");
  await humanMouseMove(page, targetX, targetY);
  
  // Intent Hover Pause
  await humanDelay(300, 600);

  // Mechanical Click
  await page.mouse.down({ button: 'left' });
  await humanDelay(150, 250); // Hold down
  await page.mouse.up({ button: 'left' });
  
  await humanDelay(400, 800);

  // 3. Type search query manually to avoid double-clicking via humanType
  await page.keyboard.down("Meta"); // Or Control for windows, we'll try to select all
  await page.keyboard.press("a");
  await page.keyboard.up("Meta");
  await humanDelay(50, 100);
  await page.keyboard.press("Backspace");
  await humanDelay(100, 200);

  for (let i = 0; i < query.length; i++) {
    await page.keyboard.type(query[i]);
    // Variable delay between keystrokes
    const delay = 60 + Math.random() * 80;
    await new Promise((resolve) => setTimeout(resolve, delay));
    
    // Occasional longer pause (mid-word thinking)
    if (Math.random() < 0.05) {
      await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));
    }
  }

  await humanDelay(600, 1600);

  // 4. Execute search by pressing Enter
  sendSessionLog(`[Search] Executing search for: "${query}"`);
  await page.keyboard.press("Enter");
  await pageLoadDelay();
  await humanDelay(1200, 2200);

  // Apply filter if specified
  if (filter) {
    await applySearchFilter(page, filter);
  }

  logActivity("search_performed", "session", { query, filter });
}

/**
 * Ensures the appropriate search tab/filter is applied to search results
 * using visual DOM text-matching and hardware Bèzier clicking.
 */
export async function applySearchFilter(
  page: Page,
  filter: "people" | "companies" | "posts"
): Promise<void> {
  const filterMap: Record<string, string> = {
    people: "People",
    companies: "Companies",
    posts: "Posts",
  };
  
  sendSessionLog(`[Search] Checking/Applying filter for: ${filterMap[filter]}`);
  await humanDelay(800, 1500);

  // Quick check if we're already on the filtered URL
  const currentUrl = page.url();
  if (filter === "people" && currentUrl.includes("/search/results/people/")) {
     sendSessionLog(`[Search] Already on People filter based on URL.`);
     return;
  }
  if (filter === "companies" && currentUrl.includes("/search/results/companies/")) {
     sendSessionLog(`[Search] Already on Companies filter based on URL.`);
     return;
  }

  // Evaluate in browser to find the element by text and get its bounding box
  const filterBox = await page.evaluate((filterText) => {
    
    // Helper to evaluate text match resiliently
    const isMatch = (elText: string | null) => {
      if (!elText) return false;
      const text = elText.trim().replace(/\\s+/g, " ");
      return text === filterText || (text.includes(filterText) && text.length <= filterText.length + 5);
    };

    // Find all buttons
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      if (isMatch(btn.textContent)) {
        const rect = btn.getBoundingClientRect();
        // Verify it is visible
        if (rect.width > 0 && rect.height > 0) {
          return {
            x: rect.x + window.scrollX,
            y: rect.y + window.scrollY,
            width: rect.width,
            height: rect.height
          };
        }
      }
    }

    // Fallback: check ANY element that looks like a button pill
    const allElements = Array.from(document.querySelectorAll('a, div, span'));
    for (const el of allElements) {
      if (isMatch(el.textContent) && (el.classList.contains('artdeco-pill') || el.closest('.search-reusables__filter-list'))) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
           return {
             x: rect.x + window.scrollX,
             y: rect.y + window.scrollY,
             width: rect.width,
             height: rect.height
           };
        }
      }
    }
    
    return null;
  }, filterMap[filter]);

  if (filterBox) {
    const targetX = filterBox.x + filterBox.width / 2 + (Math.random() * 10 - 5);
    const targetY = filterBox.y + filterBox.height / 2 + (Math.random() * 4 - 2);
    
    sendSessionLog(`[Search] Found "${filterMap[filter]}" filter at (${Math.round(targetX)}, ${Math.round(targetY)}). Moving cursor...`);
    const { humanMouseMove } = await import("./humanizer");
    await humanMouseMove(page, targetX, targetY);
    
    await humanDelay(300, 600);
    
    // Hardware click
    await page.mouse.down({ button: 'left' });
    await humanDelay(100, 250); // Mousedown hold
    await page.mouse.up({ button: 'left' });
    
    sendSessionLog(`[Search] Hardware-clicked "${filterMap[filter]}" filter.`);
    
    // Explicitly wait for LinkedIn SPA to swap the DOM
    // URL changes instantly, but the DOM takes time. We wait for /in/ links for 'people' filter.
    try {
      if (filter === "people") {
        await page.waitForSelector('a[href*="/in/"]', { timeout: 15000 });
      } else {
        await humanDelay(6000, 8000);
      }
    } catch {
      sendSessionLog(`[Search] Timeout waiting for new DOM elements. Proceeding anyway...`);
    }

    const { pageLoadDelay } = await import("./humanizer");
    await pageLoadDelay();
    await humanDelay(2500, 4500); // Extra human delay to let React fully swap the list containers
  } else {
    sendSessionLog(`[Search] Warning: Could not find "${filterMap[filter]}" filter pill.`);
  }
}

