/**
 * Humanizer Module - Makes browser actions look natural/human
 *
 * This is the MOST CRITICAL safety module. Every interaction with LinkedIn
 * passes through this layer to add realistic human-like behavior patterns.
 *
 * Techniques:
 * - Gaussian random delays (not uniform — humans cluster around averages)
 * - Bézier curve mouse movements (natural trajectory)
 * - Variable typing speed with occasional corrections
 * - Natural scrolling patterns with reading pauses
 * - Random micro-interactions (hovering, idle mouse movement)
 */

import type { Page, ElementHandle } from "puppeteer-core";

// ============================================================
// Random Utilities
// ============================================================

/**
 * Gaussian (normal distribution) random number
 * More realistic than uniform random — humans cluster around averages
 */
function gaussianRandom(mean: number, stdDev: number): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(0, mean + z * stdDev);
}

/**
 * Random integer between min and max (inclusive)
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Random float between min and max
 */
function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// ============================================================
// Delay Functions
// ============================================================

/**
 * Human-like delay between actions
 * Uses Gaussian distribution centered around the mean
 */
export async function humanDelay(
  minMs: number = 1000,
  maxMs: number = 3000,
): Promise<void> {
  const mean = (minMs + maxMs) / 2;
  const stdDev = (maxMs - minMs) / 4;
  const delay = Math.max(minMs, Math.min(maxMs, gaussianRandom(mean, stdDev)));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Short micro-delay (between keystrokes, small actions)
 */
export async function microDelay(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, gaussianRandom(80, 40)));
}

/**
 * Thinking delay - simulates reading/thinking before action
 */
export async function thinkingDelay(): Promise<void> {
  await humanDelay(2000, 6000);
}

/**
 * Page load delay - wait for page to settle naturally
 */
export async function pageLoadDelay(): Promise<void> {
  await humanDelay(1500, 3500);
}

/**
 * Safe SPA navigation avoiding direct URL jumps
 * Injects an invisible link and physically clicks it using Bézier trajectories
 */
export async function inPageNavigate(page: Page, targetUrl: string): Promise<void> {
  const currentUrl = page.url();
  
  if (!currentUrl.includes("linkedin.com") || currentUrl === "about:blank") {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await pageLoadDelay();
    return;
  }
  
  // Normalize URLs to avoid redundant jumps
  const normCurrent = currentUrl.replace(/\/$/, '').split('?')[0];
  const normTarget = targetUrl.replace(/\/$/, '').split('?')[0];
  if (normCurrent.toLowerCase() === normTarget.toLowerCase()) return;

  // Generate unique ID for the injected link
  const linkId = `virtulinked-nav-${Date.now()}`;
  
  await page.evaluate((url, id) => {
    const a = document.createElement('a');
    a.href = url;
    a.id = id;
    a.style.position = 'fixed';
    a.style.top = '10px';
    a.style.left = '10px';
    a.style.opacity = '0.01'; // Almost invisible but clickable
    a.style.pointerEvents = 'auto';
    a.style.zIndex = '999999';
    a.innerText = 'nav';
    document.body.appendChild(a);
  }, targetUrl, linkId);

  // 1. Natural Delay after injection
  await humanDelay(100, 300);

  // 2. & 3. Mouse pathing and click (humanClick inherently uses Bézier curve logic)
  await humanClick(page, `#${linkId}`);

  // Cleanup: Delete the tag immediately after clicking
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, linkId);

  // Wait for the SPA router to pick up the location change
  try {
    await page.waitForFunction(
      (target) => window.location.href.includes(target) || document.location.href.includes(target),
      { timeout: 8000 },
      targetUrl.split('?')[0]
    );
  } catch (e) {
    // If SPA navigation fails, fallback safely
    if (!page.url().includes(targetUrl.split('?')[0])) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
  }
  await pageLoadDelay();
}

// ============================================================
// Mouse Movement - Bézier Curves
// ============================================================

interface Point {
  x: number;
  y: number;
}

/**
 * Generate a Bézier curve path between two points
 * Simulates natural hand movement (not straight line)
 */
function generateBezierPath(
  start: Point,
  end: Point,
  steps: number = 25,
): Point[] {
  // Random control points for natural curve
  const cp1: Point = {
    x:
      start.x +
      (end.x - start.x) * randomFloat(0.2, 0.5) +
      randomFloat(-50, 50),
    y:
      start.y +
      (end.y - start.y) * randomFloat(0.1, 0.4) +
      randomFloat(-30, 30),
  };
  const cp2: Point = {
    x:
      start.x +
      (end.x - start.x) * randomFloat(0.5, 0.8) +
      randomFloat(-50, 50),
    y:
      start.y +
      (end.y - start.y) * randomFloat(0.6, 0.9) +
      randomFloat(-30, 30),
  };

  const path: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;

    path.push({
      x: mt3 * start.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * end.x,
      y: mt3 * start.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * end.y,
    });
  }
  return path;
}

/**
 * Move mouse along a natural Bézier curve to target element
 */
export async function humanMouseMove(
  page: Page,
  targetX: number,
  targetY: number,
): Promise<void> {
  // Get current mouse position (approximate from viewport center if unknown)
  const viewport = page.viewport();
  const startX = viewport
    ? randomInt(viewport.width * 0.3, viewport.width * 0.7)
    : 500;
  const startY = viewport
    ? randomInt(viewport.height * 0.3, viewport.height * 0.7)
    : 400;

  const path = generateBezierPath(
    { x: startX, y: startY },
    { x: targetX, y: targetY },
    randomInt(15, 35),
  );

  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    // Variable speed — slow down near target
    const distToTarget = Math.hypot(point.x - targetX, point.y - targetY);
    const delay = distToTarget < 50 ? randomInt(8, 20) : randomInt(3, 10);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * Click on an element with high-fidelity physical interaction (mouse movement, intent pause, mechanical click)
 */
export async function humanClick(
  page: Page,
  element: ElementHandle | string,
  options: { doubleClick?: boolean } = {},
): Promise<void> {
  let el: ElementHandle | null;

  if (typeof element === "string") {
    el = await page.$(element);
    if (!el) throw new Error(`Element not found: ${element}`);
  } else {
    el = element;
  }

  // Get element bounding box
  const box = await el.boundingBox();
  if (!box) {
    // Attempt scroll into view if no bounding box
    await page.evaluate((e) => (e as Element).scrollIntoView({ block: 'center', behavior: 'smooth' }), el);
    await new Promise((resolve) => setTimeout(resolve, randomInt(500, 1000)));
    const newBox = await el.boundingBox();
    if (!newBox) throw new Error("Element has no bounding box after scroll");
    Object.assign(box || {}, newBox);
  }

  // Click slightly off-center (humans don't click dead center, +/- 10% jitter)
  const targetX = box!.x + box!.width / 2 + (Math.random() - 0.5) * box!.width * 0.2;
  const targetY = box!.y + box!.height / 2 + (Math.random() - 0.5) * box!.height * 0.2;

  // Move mouse naturally to the element via Bézier curve path
  await humanMouseMove(page, targetX, targetY);

  // Intent Hover Pause: Simulate a human deciding to execute the click and pausing to read the button
  await new Promise((resolve) => setTimeout(resolve, randomInt(300, 700)));

  if (options.doubleClick) {
    await page.mouse.click(targetX, targetY, { clickCount: 2 });
  } else {
    // Mechanical click flow: explicit MouseDown -> 150-250ms hold -> MouseUp
    await page.mouse.down({ button: 'left' });
    await new Promise((resolve) => setTimeout(resolve, randomInt(150, 250)));
    await page.mouse.up({ button: 'left' });
  }

  // Small pause after clicking before next action
  await new Promise((resolve) => setTimeout(resolve, randomInt(400, 800)));
}

// ============================================================
// Typing - Variable Speed with Occasional Corrections
// ============================================================

/**
 * Type text with human-like variable speed
 * Includes occasional "typos" that get corrected
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  options: {
    clearFirst?: boolean;
    minKeystrokeMs?: number;
    maxKeystrokeMs?: number;
    typoRate?: number; // 0-1, chance of a typo per character
  } = {},
): Promise<void> {
  const {
    clearFirst = true,
    minKeystrokeMs = 50,
    maxKeystrokeMs = 150,
    typoRate = 0.03, // 3% typo rate for realism
  } = options;

  // Click the input first
  await humanClick(page, selector);
  await microDelay();

  // Clear existing content if needed
  if (clearFirst) {
    // Select all and delete (platform-aware)
    await page.keyboard.down("Meta"); // Cmd on Mac
    await page.keyboard.press("a");
    await page.keyboard.up("Meta");
    await microDelay();
    await page.keyboard.press("Backspace");
    await microDelay();
  }

  // Adjacent keys map for realistic typos
  const adjacentKeys: Record<string, string[]> = {
    a: ["s", "q", "w"],
    b: ["v", "n", "g"],
    c: ["x", "v", "d"],
    d: ["s", "f", "e"],
    e: ["w", "r", "d"],
    f: ["d", "g", "r"],
    g: ["f", "h", "t"],
    h: ["g", "j", "y"],
    i: ["u", "o", "k"],
    j: ["h", "k", "u"],
    k: ["j", "l", "i"],
    l: ["k", "o", "p"],
    m: ["n", "j", "k"],
    n: ["b", "m", "h"],
    o: ["i", "p", "l"],
    p: ["o", "l"],
    q: ["w", "a"],
    r: ["e", "t", "f"],
    s: ["a", "d", "w"],
    t: ["r", "y", "g"],
    u: ["y", "i", "j"],
    v: ["c", "b", "f"],
    w: ["q", "e", "s"],
    x: ["z", "c", "s"],
    y: ["t", "u", "h"],
    z: ["x", "a"],
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Occasionally make a typo and correct it
    if (
      typoRate > 0 &&
      Math.random() < typoRate &&
      adjacentKeys[char.toLowerCase()]
    ) {
      const wrongKeys = adjacentKeys[char.toLowerCase()];
      const wrongChar = wrongKeys[randomInt(0, wrongKeys.length - 1)];

      // Type wrong character
      await page.keyboard.type(wrongChar);
      await new Promise(
        (resolve) => setTimeout(resolve, gaussianRandom(200, 80)), // Pause — "notice" the typo
      );

      // Delete wrong character
      await page.keyboard.press("Backspace");
      await new Promise((resolve) =>
        setTimeout(resolve, gaussianRandom(120, 40)),
      );
    }

    // Type the correct character
    await page.keyboard.type(char);

    // Variable delay between keystrokes
    const delay = gaussianRandom(
      (minKeystrokeMs + maxKeystrokeMs) / 2,
      (maxKeystrokeMs - minKeystrokeMs) / 4,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(minKeystrokeMs, delay)),
    );

    // Occasional longer pause (mid-word thinking)
    if (Math.random() < 0.05) {
      await new Promise((resolve) => setTimeout(resolve, randomInt(200, 500)));
    }
  }
}

/**
 * Slow human-like typing for composing messages/connection notes.
 *
 * Unlike humanType (which mimics fast, familiar typing), this function
 * mimics someone *composing* a thoughtful, personalized message from scratch.
 *
 * Key differences from humanType:
 * - Much slower base cadence (120–350ms per key)
 * - Longer "thinking" pauses at sentence boundaries (. ! ?)
 * - Mid-word pauses simulating composing rather than recalling
 * - Higher typo rate matching composing behaviour (5%)
 * - Never bulk-sets .value — always uses keyboard events
 */
export async function humanTypeSlowly(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  // Click and focus the textarea
  const el = await page.$(selector);
  if (!el) throw new Error(`humanTypeSlowly: element not found: ${selector}`);

  const box = await el.boundingBox();
  if (box) {
    const targetX = box.x + box.width * randomFloat(0.3, 0.7);
    const targetY = box.y + box.height * randomFloat(0.3, 0.7);
    await humanMouseMove(page, targetX, targetY);
    await new Promise((r) => setTimeout(r, randomInt(80, 200)));
    await page.mouse.click(targetX, targetY);
  } else {
    await page.focus(selector);
  }

  await new Promise((r) => setTimeout(r, randomInt(300, 700)));

  // Adjacent keys for typos (composing-mode typos are more common)
  const adjacentKeys: Record<string, string[]> = {
    a: ['s', 'q', 'w'], b: ['v', 'n', 'g'], c: ['x', 'v', 'd'],
    d: ['s', 'f', 'e'], e: ['w', 'r', 'd'], f: ['d', 'g', 'r'],
    g: ['f', 'h', 't'], h: ['g', 'j', 'y'], i: ['u', 'o', 'k'],
    j: ['h', 'k', 'u'], k: ['j', 'l', 'i'], l: ['k', 'o', 'p'],
    m: ['n', 'j', 'k'], n: ['b', 'm', 'h'], o: ['i', 'p', 'l'],
    p: ['o', 'l'],       q: ['w', 'a'],      r: ['e', 't', 'f'],
    s: ['a', 'd', 'w'], t: ['r', 'y', 'g'], u: ['y', 'i', 'j'],
    v: ['c', 'b', 'f'], w: ['q', 'e', 's'], x: ['z', 'c', 's'],
    y: ['t', 'u', 'h'], z: ['x', 'a'],
  };

  const TYPO_RATE = 0.05; // 5% composing typo rate

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Thinking pause at sentence boundaries (. ! ?)
    if (['.', '!', '?'].includes(char)) {
      await page.keyboard.type(char);
      // Long pause after punctuation — "reading what I wrote, deciding what to say next"
      await new Promise((r) => setTimeout(r, gaussianRandom(1400, 450)));
      continue;
    }

    // Shorter pause after comma
    if (char === ',') {
      await page.keyboard.type(char);
      await new Promise((r) => setTimeout(r, gaussianRandom(500, 150)));
      continue;
    }

    // Pause at word boundaries (space) — brain queues next word
    if (char === ' ') {
      await page.keyboard.type(char);
      await new Promise((r) => setTimeout(r, gaussianRandom(180, 60)));
      // Occasional longer word-search pause (~10% of spaces)
      if (Math.random() < 0.10) {
        await new Promise((r) => setTimeout(r, gaussianRandom(800, 250)));
      }
      continue;
    }

    // Occasional typo and correction
    if (TYPO_RATE > 0 && Math.random() < TYPO_RATE && adjacentKeys[char.toLowerCase()]) {
      const wrongKeys = adjacentKeys[char.toLowerCase()];
      const wrongChar = wrongKeys[randomInt(0, wrongKeys.length - 1)];
      await page.keyboard.type(wrongChar);
      // Pause ("wait, that's wrong...")
      await new Promise((r) => setTimeout(r, gaussianRandom(280, 90)));
      await page.keyboard.press('Backspace');
      await new Promise((r) => setTimeout(r, gaussianRandom(150, 50)));
    }

    // Type the character
    await page.keyboard.type(char);

    // Base inter-keystroke delay — composing is slower than copying
    const baseDelay = gaussianRandom(200, 60);
    await new Promise((r) => setTimeout(r, Math.max(120, Math.min(400, baseDelay))));

    // Occasional mid-word "thinking" stutter (~4% of chars, not after punctuation)
    if (Math.random() < 0.04) {
      await new Promise((r) => setTimeout(r, gaussianRandom(700, 200)));
    }
  }

  // Final pause — "review before submitting"
  await new Promise((r) => setTimeout(r, gaussianRandom(800, 250)));
}

// ============================================================
// Scrolling - Natural Patterns
// ============================================================

/**
 * Scroll page naturally with variable speed and reading pauses
 */
export async function humanScroll(
  page: Page,
  options: {
    direction?: "down" | "up";
    distance?: number; // pixels
    readingPauses?: boolean;
  } = {},
): Promise<void> {
  const {
    direction = "down",
    distance = randomInt(300, 800),
    readingPauses = true,
  } = options;

  const scrollAmount = direction === "down" ? distance : -distance;
  const steps = randomInt(5, 15);
  const stepSize = scrollAmount / steps;

  for (let i = 0; i < steps; i++) {
    await page.evaluate(
      (step) => {
        window.scrollBy(0, step);
      },
      stepSize + randomInt(-20, 20),
    );

    // Variable delay between scroll steps (simulate inertia)
    await new Promise((resolve) => setTimeout(resolve, randomInt(30, 80)));

    // Occasional reading pause (stop scrolling to "read" content)
    if (readingPauses && Math.random() < 0.15) {
      await humanDelay(800, 2500); // Reading pause
    }
  }
}

/**
 * Scroll to a specific element naturally
 */
export async function scrollToElement(
  page: Page,
  selector: string,
): Promise<void> {
  const element = await page.$(selector);
  if (!element) return;

  // Get element position
  const box = await element.boundingBox();
  if (!box) return;

  // Scroll to bring it into view with some randomness
  const targetY = box.y - randomInt(100, 300);
  const currentScroll = await page.evaluate(() => window.scrollY);
  const scrollDistance = targetY - currentScroll;

  await humanScroll(page, {
    direction: scrollDistance > 0 ? "down" : "up",
    distance: Math.abs(scrollDistance),
  });

// Reading pause after reaching the element
  await thinkingDelay();
}

/**
 * Incremental smooth scroll to prevent virtual list "snapping" glitches.
 * This triggers LinkedIn's IntersectionObserver slowly so the 'LazyColumn' (virtualized list) hydrates the profile data correctly.
 */
export async function smoothScrollToEntity(page: Page, index: number) {
  await page.evaluate(async (idx: number) => {
    const items = document.querySelectorAll('ul[role="list"] > li, .reusable-search__entity-result-list > li, [role="listitem"]');
    const target = items[idx] as HTMLElement;
    if (!target) return;

    let targetPosition = target.getBoundingClientRect().top + window.pageYOffset - (window.innerHeight / 2);
    
    // Instead of using element.scrollIntoView(), use a while loop with window.scrollBy(0, step)
    while (Math.abs(window.pageYOffset - targetPosition) > 40) {
      // Logic: Move in randomized steps of 15–40 pixels
      const stepSize = Math.floor(Math.random() * 26) + 15;
      const step = (targetPosition > window.pageYOffset ? 1 : -1) * stepSize;
      
      window.scrollBy(0, step);
      
      // Delay 10–20ms between steps
      const delayMs = Math.floor(Math.random() * 11) + 10;
      await new Promise(r => setTimeout(r, delayMs));
      
      if (document.contains(target)) {
        targetPosition = target.getBoundingClientRect().top + window.pageYOffset - (window.innerHeight / 2);
      }
    }
  }, index);
}

// ============================================================
// Profile "Reading" Behavior
// ============================================================

/**
 * Simulate naturally reading a LinkedIn profile
 * This is crucial — LinkedIn tracks if you visit a profile but don't scroll
 */
export async function simulateProfileReading(page: Page): Promise<void> {
  // Initial pause — "start reading" the header
  await humanDelay(1500, 3000);

  // Scroll through profile sections
  const sections = [
    ".pv-top-card", // Header area
    "#about", // About section
    "#experience", // Experience
    "#education", // Education
    "#skills", // Skills
    ".pv-recent-activity-section", // Recent activity
  ];

  for (const section of sections) {
    const exists = await page.$(section);
    if (exists) {
      await scrollToElement(page, section);
      // "Read" the section
      await humanDelay(2000, 5000);

      // Sometimes move mouse over content (natural behavior)
      if (Math.random() < 0.3) {
        const box = await exists.boundingBox();
        if (box) {
          await humanMouseMove(
            page,
            box.x + randomInt(10, 200),
            box.y + randomInt(10, 50),
          );
        }
      }
    }
  }

  // Scroll back up a bit sometimes (people re-read headers)
  if (Math.random() < 0.4) {
    await humanScroll(page, { direction: "up", distance: randomInt(200, 500) });
    await humanDelay(1000, 2000);
  }
}

// ============================================================
// Random Micro-Actions (Background Noise)
// ============================================================

/**
 * Random idle behaviors to make sessions look more natural
 * Call these between main actions
 */
export async function randomIdleAction(page: Page): Promise<void> {
  const action = randomInt(1, 5);

  switch (action) {
    case 1:
      // Random mouse movement (fidgeting)
      await humanMouseMove(page, randomInt(100, 800), randomInt(100, 600));
      break;
    case 2:
      // Small scroll
      await humanScroll(page, {
        distance: randomInt(50, 150),
        readingPauses: false,
      });
      break;
    case 3:
      // Hover over a random element
      const links = await page.$$("a");
      if (links.length > 0) {
        const randomLink = links[randomInt(0, links.length - 1)];
        const box = await randomLink.boundingBox();
        if (box) {
          await humanMouseMove(
            page,
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, randomInt(200, 600)),
          );
        }
      }
      break;
    case 4:
      // Just wait (thinking/reading)
      await humanDelay(1000, 3000);
      break;
    case 5:
      // Move mouse to viewport edge (checking tabs/menu)
      await humanMouseMove(page, randomInt(0, 100), randomInt(0, 50));
      await new Promise((resolve) => setTimeout(resolve, randomInt(300, 800)));
      break;
  }
}

// ============================================================
// Working Hours Controller
// ============================================================

/**
 * Check if current time is within configured working hours
 */
export function isWithinWorkingHours(config: {
  enabled: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
  randomizeStart: boolean;
  workDays: number[];
}): boolean {
  if (!config.enabled) return true;

  const now = new Date();
  // Convert to target timezone
  const tzTime = new Date(
    now.toLocaleString("en-US", { timeZone: config.timezone }),
  );
  const hour = tzTime.getHours();
  const day = tzTime.getDay();

  // Check workday
  if (!config.workDays.includes(day)) return false;

  // Check hours (with randomization applied)
  const startHour = config.randomizeStart
    ? config.startHour + randomFloat(-0.5, 0.5)
    : config.startHour;

  return hour >= startHour && hour < config.endHour;
}

// ============================================================
// Daily Limit Manager
// ============================================================

export class DailyLimitManager {
  private counters: Map<string, number> = new Map();
  private limits: Map<string, number> = new Map();
  private lastReset: Date = new Date();

  constructor(limits: Record<string, number>, randomizePercent: number = 15) {
    // Apply randomization to limits
    for (const [action, limit] of Object.entries(limits)) {
      const variation = limit * (randomizePercent / 100);
      const randomizedLimit = Math.round(
        limit + randomFloat(-variation, variation),
      );
      this.limits.set(action, Math.max(1, randomizedLimit));
      this.counters.set(action, 0);
    }
  }

  /**
   * Check if we can perform an action (under daily limit)
   */
  canPerform(action: string): boolean {
    this.checkReset();
    const count = this.counters.get(action) || 0;
    const limit = this.limits.get(action) || 0;
    return count < limit;
  }

  /**
   * Record that an action was performed
   */
  record(action: string): void {
    this.checkReset();
    const count = this.counters.get(action) || 0;
    this.counters.set(action, count + 1);
  }

  /**
   * Get remaining count for an action
   */
  remaining(action: string): number {
    this.checkReset();
    const count = this.counters.get(action) || 0;
    const limit = this.limits.get(action) || 0;
    return Math.max(0, limit - count);
  }

  /**
   * Reset counters at midnight (with randomization)
   */
  private checkReset(): void {
    const now = new Date();
    if (now.getDate() !== this.lastReset.getDate()) {
      // New day — reset all counters and re-randomize limits
      for (const [action] of Array.from(this.counters.entries())) {
        this.counters.set(action, 0);
      }
      this.lastReset = now;
    }
  }

  /**
   * Get all stats
   */
  getStats(): Record<
    string,
    { used: number; limit: number; remaining: number }
  > {
    this.checkReset();
    const stats: Record<
      string,
      { used: number; limit: number; remaining: number }
    > = {};
    for (const [action, limit] of Array.from(this.limits.entries())) {
      const used = this.counters.get(action) || 0;
      stats[action] = { used, limit, remaining: Math.max(0, limit - used) };
    }
    return stats;
  }
}
