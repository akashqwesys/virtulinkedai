/**
 * Anti-Detect Browser Engine
 *
 * Core browser management using Puppeteer with stealth plugins.
 * Like LinkedHelper, this runs in a dedicated browser instance
 * that mimics real human browsing patterns.
 *
 * Key safety principles:
 * - No code injection into LinkedIn pages
 * - Consistent browser fingerprint (matches your real machine)
 * - Session persistence between launches
 * - In-page navigation only
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer-core";
import path from "path";
import { app } from "electron";
import { logActivity } from "../storage/database";

// Apply stealth plugin
puppeteer.use(StealthPlugin());

export type BrowserStatus =
  | "idle"
  | "launching"
  | "running"
  | "error"
  | "closed";

interface EngineState {
  browser: Browser | null;
  page: Page | null;
  status: BrowserStatus;
  isLoggedIn: boolean;
  lastError: string | null;
}

let browserLocked = false;
export function setBrowserLocked(locked: boolean) {
  browserLocked = locked;
}
export function isBrowserLocked() {
  return browserLocked;
}
export async function waitForBrowserLock(): Promise<void> {
  const timeoutMs = 120000; // wait up to 2 minutes
  const start = Date.now();
  if (browserLocked) {
    console.log("[Engine] Browser is locked by another task. Yielding execution sequence...");
  }
  while (browserLocked && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 1000));
  }
  if (browserLocked) {
     console.warn("[Engine] Mutex timeout reached (120s), assuming lock is stale or a task hung.");
  }
}

const state: EngineState = {
  browser: null,
  page: null,
  status: "idle",
  isLoggedIn: false,
  lastError: null,
};

// Persistent data directory for cookies/session
function getUserDataDir(): string {
  return path.join(app.getPath("userData"), "browser-data");
}

import os from "os";
import fs from "fs";

// Helper to find the host's Google Chrome executable
function getChromePath(): string {
  let possiblePaths: string[] = [];

  if (process.platform === "darwin") {
    possiblePaths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];
  } else if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.PROGRAMFILES || "";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "";
    possiblePaths = [
      path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFiles, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFilesX86, "Google\\Chrome\\Application\\chrome.exe"),
    ];
  } else if (process.platform === "linux") {
    possiblePaths = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
    ];
  }

  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) return p;
  }

  throw new Error(
    "Google Chrome is required but could not be found. Please install Google Chrome.",
  );
}

/**
 * Launch the stealth browser instance
 */
export async function launchBrowser(): Promise<{
  success: boolean;
  error?: string;
}> {
  // If we already have a browser reference, verify it's actually alive
  if (state.browser) {
    try {
      // Quick health check: can we still talk to the browser?
      const pages = await state.browser.pages();
      if (pages.length > 0 && state.page) {
        // Connection is alive and page exists
        return { success: true };
      }
      // Browser is alive but no valid page — create one
      state.page = pages[0] || (await state.browser.newPage());
      await applyStealthMeasures(state.page);
      console.log("[Engine] Recovered browser — page was null, created new page.");
      return { success: true };
    } catch (e) {
      // Browser reference is stale / WebSocket disconnected
      console.log("[Engine] Stale browser reference detected — forcing relaunch.");
      state.browser = null;
      state.page = null;
      state.status = "idle";
    }
  }

  state.status = "launching";

  try {
    const userDataDir = getUserDataDir();
    const executablePath = getChromePath();
    const activePortFile = path.join(userDataDir, "DevToolsActivePort");

    // ── RECONNECTION LOGIC ──
    // If the app was restarted (e.g. npm run dev) but Chrome was left open,
    // Chrome holds an exclusive lock on the userDataDir. Launching will fail.
    // We must read the active DevTools port from disk and reconnect to it.
    if (fs.existsSync(activePortFile)) {
      try {
        const lines = fs.readFileSync(activePortFile, "utf-8").split("\n");
        const port = lines[0].trim();
        const browserWSEndpoint = `ws://127.0.0.1:${port}${lines[1].trim()}`;
        
        console.log(`[Engine] Found running Chrome at port ${port}. Reconnecting...`);
        state.browser = (await puppeteer.connect({
          browserWSEndpoint,
          defaultViewport: null
        })) as unknown as Browser;
        
        console.log("[Engine] Successfully reconnected to existing Chrome window.");
      } catch (e) {
        // console.log("[Engine] Could not reconnect. The lock is stale. Cleaning up...");
        try { fs.unlinkSync(activePortFile); } catch (_) {}
      }
    }

    // ── LAUNCH LOGIC ──
    // If we couldn't reconnect, launch a new instance
    if (!state.browser) {
      state.browser = (await puppeteer.launch({
        executablePath,
        headless: false, // Must be visible — headless is easily detected
        defaultViewport: null, // Use full window size
        userDataDir, // Persist session/cookies between launches
        timeout: 60000,
        pipe: false,

        args: [
          "--remote-debugging-port=0",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--window-size=1366,768",
          "--start-maximized",
          // Prevent WebRTC IP leaks
          "--disable-webrtc-hw-encoding",
          "--disable-webrtc-hw-decoding",
          // Natural browser behavior
          "--enable-features=NetworkService,NetworkServiceInProcess",
          "--lang=en-US,en",
          // ── Anti-detection extras ──────────────────────────────────
          // Suppress the "Chrome is being controlled by automation" infobar
          "--disable-infobars",
          // Prevent first-run / default-browser prompts that don't appear for real users
          "--no-first-run",
          "--no-default-browser-check",
          // Suppress background network requests that spike during automation
          "--disable-background-networking",
          "--disable-background-timer-throttling",
          // Disable renderer backgrounding (tabs stay active even when unfocused)
          "--disable-renderer-backgrounding",
          // Suppress notifications prompt
          "--disable-notifications",
          // Use basic password store to avoid OS keyring popups
          "--password-store=basic",
          // Use a mock keychain to suppress macOS Keychain Access prompts
          "--use-mock-keychain",
        ],

      ignoreDefaultArgs: [
        "--enable-automation",          // Remove automation flag
        "--enable-blink-features=IdleDetection", // Remove idle detection
        "--disable-component-extensions-with-background-pages", // Allows extensions normally
      ],
    })) as unknown as Browser;

    // Wait extra time for the browser UI to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Get the first page or create one
    const pages = await state.browser.pages();
    state.page = pages[0] || (await state.browser.newPage());

    // Apply additional stealth measures
    await applyStealthMeasures(state.page);

    state.status = "running";
    state.lastError = null;

    logActivity("browser_launched", "browser", { userDataDir });

    // Monitor for unexpected closure
    state.browser.on("disconnected", () => {
      state.status = "closed";
      state.browser = null;
      state.page = null;
      state.isLoggedIn = false;
      logActivity("browser_disconnected", "browser");
    });
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    state.status = "error";
    state.lastError = message;
    logActivity(
      "browser_launch_failed",
      "browser",
      { error: message },
      "error",
      message,
    );
    return { success: false, error: message };
  }
}

/**
 * Apply additional stealth measures beyond the plugin
 */
async function applyStealthMeasures(page: Page): Promise<void> {
  // Add manual property masks to ensure complete evasion
  await page.evaluateOnNewDocument(() => {
    // 1. Hardcode webdriver to false defensively
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });

    // 2. Hide Chrome Driver specific DOM variables
    // cdc_adojhcdcvl_kind is a known chromedriver fingerprint variable
    for (const key in window) {
      if (key.match(/^cdc_[a-zA-Z0-9]+_/) || key === 'domAutomation' || key === 'domAutomationController') {
        try {
          delete (window as any)[key];
        } catch (e) {
          // Ignore
        }
      }
    }
    
    // 3. Spoof Plugins if empty (Headless usually has 0 plugins, but we run headful anyway)
    // We run the user's actual chrome, so we have plugins, but just in case:
    if (navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3], // Mock length to bypass simple 0-length checks
      });
    }
  });

  // Since we are launching the user's ACTUAL local Chrome browser (executablePath), 
  // the native User-Agent, sec-ch-ua headers, and Platform metadata are already 100% genuine.
  // Overriding them with hardcoded values (like MacOS on a Windows host) causes massive fingerprint anomalies
  // and gets the session instantly flagged.
}

/**
 * Navigate to a URL safely (only for initial load — never direct URL jumps on LinkedIn)
 */
export async function navigateTo(url: string): Promise<void> {
  if (!state.page) throw new Error("Browser not launched");

  await state.page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
}

/**
 * Get the current page instance
 */
export function getPage(): Page | null {
  return state.page;
}

/**
 * Get browser status
 */
export function getBrowserStatus(): {
  status: BrowserStatus;
  isLoggedIn: boolean;
  lastError: string | null;
} {
  return {
    status: state.status,
    isLoggedIn: state.isLoggedIn,
    lastError: state.lastError,
  };
}

/**
 * Update login status
 */
export function setLoggedIn(loggedIn: boolean): void {
  state.isLoggedIn = loggedIn;
}

/**
 * Close the browser
 */
export async function closeBrowser(): Promise<void> {
  if (state.browser) {
    await state.browser.close();
    state.browser = null;
    state.page = null;
    state.status = "closed";
    state.isLoggedIn = false;
    logActivity("browser_closed", "browser");
  }
}
