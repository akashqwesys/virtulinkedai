/**
 * Inbox Browser Engine — Singleton Puppeteer Instance for Manual Messaging
 *
 * A completely separate browser from the main campaign browser (engine.ts).
 * - Uses its own Chrome profile (browser-data-inbox/) → separate cookies/login
 * - Launched ONCE on demand when user clicks a lead in the Inbox
 * - Stays alive for the entire app session — never relaunched per message
 * - Campaign automation (scraping, connecting, AI chatbot) is unaffected
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer-core";
import path from "path";
import fs from "fs";
import { app } from "electron";
import { logActivity } from "../storage/database";

puppeteer.use(StealthPlugin());

// ── Singleton state ──────────────────────────────────────────────────────────
let _inboxBrowser: Browser | null = null;
let _inboxPage: Page | null = null;
let _launchPromise: Promise<Page> | null = null; // prevents concurrent launches

export type InboxBrowserStatus = "idle" | "launching" | "running" | "closed" | "error";
let _status: InboxBrowserStatus = "idle";
let _lastError: string | null = null;

// ── Chrome path resolution (same logic as engine.ts) ────────────────────────
function getChromePath(): string {
  let possiblePaths: string[] = [];

  if (process.platform === "darwin") {
    possiblePaths = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  } else if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.PROGRAMFILES || "";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "";
    possiblePaths = [
      path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFiles, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFilesX86, "Google\\Chrome\\Application\\chrome.exe"),
    ];
  } else {
    possiblePaths = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
    ];
  }

  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) return p;
  }

  throw new Error("Google Chrome is required but could not be found. Please install Google Chrome.");
}

function getInboxUserDataDir(): string {
  // Separate profile directory — never conflicts with campaign browser
  return path.join(app.getPath("userData"), "browser-data-inbox");
}

/**
 * Apply basic stealth measures to the inbox page
 */
async function applyInboxStealth(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    for (const key in window) {
      if (key.match(/^cdc_[a-zA-Z0-9]+_/) || key === "domAutomation" || key === "domAutomationController") {
        try { delete (window as any)[key]; } catch {}
      }
    }
  });
}

/**
 * Get (or lazily launch) the inbox browser singleton.
 *
 * - First call: launches a new Chrome window pointed at LinkedIn messaging
 * - Subsequent calls: returns the existing page immediately (no relaunch)
 * - If Chrome was closed externally: detects stale reference, relaunches once
 *
 * ⚠️ Callers must NOT close this page — it is the persistent singleton.
 */
export async function getInboxPage(): Promise<Page> {
  // Fast path: if browser + page are alive, return immediately
  if (_inboxBrowser && _inboxPage) {
    try {
      const pages = await _inboxBrowser.pages(); // lightweight health check
      if (_inboxPage.isClosed()) {
        console.log("[InboxEngine] _inboxPage was closed, grabbing a new one.");
        _inboxPage = pages.length > 0 ? pages[0] : await _inboxBrowser.newPage();
      }
      return _inboxPage;
    } catch {
      // Stale reference (user closed Chrome) — fall through to relaunch
      console.log("[InboxEngine] Stale browser reference detected, relaunching...");
      _inboxBrowser = null;
      _inboxPage = null;
      _launchPromise = null;
    }
  }

  // Deduplication: if a launch is already in progress, wait for it
  if (_launchPromise) {
    return _launchPromise;
  }

  _launchPromise = _doLaunch();
  try {
    const page = await _launchPromise;
    return page;
  } finally {
    _launchPromise = null;
  }
}

async function _doLaunch(): Promise<Page> {
  _status = "launching";
  _lastError = null;

  try {
    const executablePath = getChromePath();
    const userDataDir = getInboxUserDataDir();

    console.log("[InboxEngine] Launching dedicated inbox browser window...");

    _inboxBrowser = (await puppeteer.launch({
      executablePath,
      headless: false,
      defaultViewport: null,
      userDataDir,
      timeout: 60000,
      pipe: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1280,860",
        // Position slightly offset from the campaign browser so both are visible
        "--window-position=80,60",
        "--disable-infobars",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-notifications",
        "--password-store=basic",
        "--use-mock-keychain",
        "--lang=en-US,en",
      ],
      ignoreDefaultArgs: [
        "--enable-automation",
        "--enable-blink-features=IdleDetection",
      ],
    })) as unknown as Browser;

    // Brief wait for browser UI to fully initialize
    await new Promise((r) => setTimeout(r, 2000));

    const pages = await _inboxBrowser.pages();
    _inboxPage = pages[0] || (await _inboxBrowser.newPage());

    await applyInboxStealth(_inboxPage);

    // Navigate to LinkedIn messaging to start
    await _inboxPage.goto("https://www.linkedin.com/messaging/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }).catch(() => null);

    _status = "running";

    // Clean up state if user manually closes the inbox browser window
    _inboxBrowser.on("disconnected", () => {
      console.log("[InboxEngine] Inbox browser disconnected (user closed it).");
      _inboxBrowser = null;
      _inboxPage = null;
      _status = "closed";
      logActivity("inbox_browser_disconnected", "inbox");
    });

    logActivity("inbox_browser_launched", "inbox", { userDataDir });
    console.log("[InboxEngine] Inbox browser ready at LinkedIn messaging.");

    return _inboxPage;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    _status = "error";
    _lastError = msg;
    _inboxBrowser = null;
    _inboxPage = null;
    logActivity("inbox_browser_launch_failed", "inbox", { error: msg }, "error", msg);
    console.error("[InboxEngine] Launch failed:", msg);
    throw error;
  }
}

/**
 * Open a NEW TAB inside the existing inbox browser (same Chrome window).
 * Stealth measures are applied. Caller must close the page when done.
 *
 * This lets InMail automation run in a dedicated tab without
 * navigating away from the inbox messaging tab.
 */
export async function createInboxTab(): Promise<Page> {
  // Ensure the inbox browser is running first
  await getInboxPage();

  if (!_inboxBrowser) {
    throw new Error("Inbox browser is not running. Please launch it from the Inbox tab first.");
  }

  const newPage = await _inboxBrowser.newPage();
  await applyInboxStealth(newPage);
  return newPage;
}

/**
 * Returns the inbox browser status without triggering a launch.
 */
export function getInboxBrowserStatus(): {
  status: InboxBrowserStatus;
  isOpen: boolean;
  lastError: string | null;
} {
  return {
    status: _status,
    isOpen: !!_inboxBrowser && !!_inboxPage,
    lastError: _lastError,
  };
}

/**
 * Close the inbox browser. Called on app quit.
 * Do NOT call this during normal operation — the browser must persist.
 */
export async function closeInboxBrowser(): Promise<void> {
  if (_inboxBrowser) {
    console.log("[InboxEngine] Closing inbox browser...");
    try {
      await _inboxBrowser.close();
    } catch {}
    _inboxBrowser = null;
    _inboxPage = null;
    _status = "closed";
    logActivity("inbox_browser_closed", "inbox");
  }
}

/**
 * Logout from the inbox browser by navigating to the LinkedIn logout URL,
 * clearing all cookies, and wiping session files from the Chrome profile directory.
 *
 * After this call:
 *   - The inbox browser is closed
 *   - All LinkedIn session cookies are gone from the profile
 *   - The next time the inbox browser is launched it has NO prior login state
 */
export async function inboxLogout(): Promise<{ success: boolean; error?: string }> {
  try {
    console.log("[InboxEngine] Logging out from inbox browser...");

    if (_inboxBrowser && _inboxPage) {
      try {
        // 1. Navigate to LinkedIn logout URL to invalidate the server-side session
        await _inboxPage.goto("https://www.linkedin.com/m/logout/", {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
      } catch {
        // Page may fail to load after logout — safe to continue
      }

      try {
        // 2. Clear cookies via CDP (belt-and-suspenders)
        const client = await _inboxPage.createCDPSession();
        await client.send("Network.clearBrowserCookies");
        await client.send("Network.clearBrowserCache");
      } catch {
        // CDP session may fail on some OS/Chrome combos — non-fatal
      }

      // 3. Close the browser
      await closeInboxBrowser();
    }

    // 4. Wipe session-sensitive files from the Chrome profile directory so that
    //    the NEXT launch starts with zero LinkedIn account state.
    const profileDir = getInboxUserDataDir();
    const sessionDirs = [
      "Default/Cookies",
      "Default/Login Data",
      "Default/Session Storage",
      "Default/Local Storage",
      "Default/IndexedDB",
      "Default/Extension State",
    ];

    for (const rel of sessionDirs) {
      const target = path.join(profileDir, rel);
      try {
        if (fs.existsSync(target)) {
          const stat = fs.statSync(target);
          if (stat.isDirectory()) {
            fs.rmSync(target, { recursive: true, force: true });
          } else {
            fs.unlinkSync(target);
          }
          console.log(`[InboxEngine] Cleared session artifact: ${rel}`);
        }
      } catch (e) {
        console.warn(`[InboxEngine] Could not clear ${rel}:`, e);
      }
    }

    logActivity("inbox_logout_complete", "inbox", { profileDir });
    console.log("[InboxEngine] Inbox logout complete — browser profile session data wiped.");

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[InboxEngine] Logout failed:", msg);
    return { success: false, error: msg };
  }
}

