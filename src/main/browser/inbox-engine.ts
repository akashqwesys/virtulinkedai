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
      await _inboxBrowser.pages(); // lightweight health check
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
    });

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
