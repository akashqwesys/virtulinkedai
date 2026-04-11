import { BrowserWindow } from "electron";
import { getPage } from "../browser/engine";
import { humanDelay, isWithinWorkingHours } from "../browser/humanizer";
import { scrapeProfile } from "./scraper";
import { sendConnectionRequest } from "./connector";
import { generateConnectionNote } from "../ai/personalizer";
import { ProfileDiscoveryEngine } from "./profileDiscovery";

let autoPilotRunning = false;

export function isAutoPilotRunning() {
  return autoPilotRunning;
}

export function stopAutoPilot() {
  autoPilotRunning = false;
}

function sendLog(message: string) {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    windows[0].webContents.send(
      "autopilot-log",
      `[${new Date().toLocaleTimeString()}] ${message}`
    );
  }
  console.log(`[AutoPilot] ${message}`);
}

export async function runPhysicalAutoPilot(
  searchUrl: string,
  maxLeads: number,
  settings: any,
  limitManager: any
) {
  autoPilotRunning = true;
  const page = getPage();
  if (!page) {
    sendLog("❌ Browser not launched. Aborting.");
    autoPilotRunning = false;
    return;
  }

  const discovery = new ProfileDiscoveryEngine(page, searchUrl);

  try {
    sendLog(`🔎 Initializing entity-first state machine for: ${searchUrl}`);
    await discovery.init();
    sendLog(
      `✅ Container locked. ${discovery.getState().poolSize} candidates in pool.`
    );

    let processedCount = 0;
    const sessionVisited = new Set<string>(); // Local session guard

    // ── Anti-detection Rest Cycles ────────────────────────────────────────
    // Rest 2–4 min after every 2 successfully processed profiles (was 45-90s every 3)
    // + Occasional long break of 8-15 min every 5 profiles (natural distraction)
    let profilesThisBatch = 0;
    const REST_EVERY_N = 2;            // rest every N profiles
    const REST_MIN_MS  = 2 * 60_000;  // 2 min  (was 45s)
    const REST_MAX_MS  = 4 * 60_000;  // 4 min  (was 90s)
    const LONG_BREAK_EVERY_N = 5;     // long break every N profiles
    const LONG_BREAK_MIN_MS  = 8  * 60_000;  // 8 min
    const LONG_BREAK_MAX_MS  = 15 * 60_000;  // 15 min

    // ── Consecutive-empty-pool guard ──────────────────────────────────────
    let emptyPageStreak = 0;

    // ── Main Loop ─────────────────────────────────────────────────────────
    while (autoPilotRunning && processedCount < maxLeads) {

      // ── Step 1: Get next profile from entity pool ──────────────────────
      const discovered = await discovery.discoverNextProfile();

      // Pool empty → try next pagination page
      if (!discovered) {
        emptyPageStreak++;
        sendLog(
          `📄 Pool empty (streak: ${emptyPageStreak}). Advancing to next page...`
        );

        if (emptyPageStreak >= 3) {
          sendLog(`🏁 3 consecutive empty pages. All leads exhausted. Stopping.`);
          break;
        }

        const hasNext = await discovery.goToNextPage();
        if (!hasNext) {
          sendLog(
            `🏁 No more pages after ${processedCount} leads. Stopping.`
          );
          break;
        }

        sendLog(
          `➡️ Page ${discovery.getState().pageNum}: ${discovery.getState().poolSize} fresh candidates.`
        );
        continue;
      }

      emptyPageStreak = 0; // Reset streak on successful discovery

      // ── Working Hours Guard (in-loop) ─────────────────────────────────
      // Stop mid-session if working hours window has closed
      if (settings?.workingHours) {
        if (!isWithinWorkingHours(settings.workingHours)) {
          sendLog(`🕐 Working hours ended. Pausing Auto-Pilot until next window.`);
          autoPilotRunning = false;
          break;
        }
      }

      // ── Session-level duplicate guard ──────────────────────────────────
      if (sessionVisited.has(discovered.profileUrl)) {
        sendLog(`⚠️ Already visited "${discovered.name}" this session. Skipping.`);
        continue; // Pool already removed this candidate; loop to next
      }
      sessionVisited.add(discovered.profileUrl);

      sendLog(
        `✅ Entity acquired: "${discovered.name}" → ${discovered.profileUrl}`
      );

      await humanDelay(1200, 2200);

      // ── Step 2: Scrape profile ─────────────────────────────────────────
      sendLog(`🔍 Scraping profile...`);
      const profile = await scrapeProfile(discovered.profileUrl, {
        skipNavigation: true,
      });

      if (!profile) {
        sendLog(`❌ Scrape failed for "${discovered.name}". Rewinding...`);
        await discovery.rewindToSearch();
        continue;
      }

      sendLog(
        `📋 Scraped: ${profile.firstName} ${profile.lastName} @ ${profile.company}`
      );

      // ── Step 3: Generate AI connection note ────────────────────────────
      let note = "";
      sendLog(`🧠 Generating AI note...`);
      try {
        note = await generateConnectionNote(
          profile,
          settings?.personalization || {
            yourName: "",
            yourCompany: "",
            yourServices: "",
          },
          settings?.ai || ({} as any)
        );
        sendLog(`💡 Note ready (${note.length} chars).`);
      } catch {
        sendLog(`⚠️ AI note failed. Connecting without note.`);
      }

      // ── Step 4: Send Connection Request ───────────────────────────────
      sendLog(`📨 Sending connection to ${profile.firstName}...`);
      const result = await sendConnectionRequest(
        profile,
        settings?.personalization || {
          yourName: "",
          yourCompany: "",
          yourServices: "",
        },
        settings,
        limitManager
      );

      if (result.success) {
        sendLog(
          `✅ Connected: ${profile.firstName} ${profile.lastName}` +
            ` (note: ${result.noteSent ? "yes" : "no"})`
        );
      } else if (result.error === "COMPLETED_SKIPPED") {
        sendLog(`⏭️ Already connected/pending: ${profile.firstName}.`);
      } else if (result.error === "Daily connection request limit reached") {
        sendLog(`🛑 Daily limit hit. Stopping.`);
        autoPilotRunning = false;
        break;
      } else {
        sendLog(`❌ Connection failed: ${result.error}`);
      }

      processedCount++;
      profilesThisBatch++;
      sendLog(`📊 Progress: ${processedCount}/${maxLeads}`);

      // ── Long Break every LONG_BREAK_EVERY_N profiles ──────────────────
      if (processedCount % LONG_BREAK_EVERY_N === 0 && processedCount < maxLeads) {
        const longRestMs = LONG_BREAK_MIN_MS + Math.random() * (LONG_BREAK_MAX_MS - LONG_BREAK_MIN_MS);
        sendLog(`☕ Long break: ${Math.round(longRestMs / 60_000)}min (natural activity gap)...`);
        await humanDelay(longRestMs, longRestMs);
        profilesThisBatch = 0;
        sendLog(`▶️ Resuming...`);
        continue;
      }

      // ── Regular Rest Cycle every REST_EVERY_N profiles ────────────────
      if (profilesThisBatch >= REST_EVERY_N && processedCount < maxLeads) {
        const restMs = REST_MIN_MS + Math.random() * (REST_MAX_MS - REST_MIN_MS);
        sendLog(`😴 Rest: ${Math.round(restMs / 1000)}s (anti-detection pause)...`);
        await humanDelay(restMs, restMs);
        profilesThisBatch = 0;
        sendLog(`▶️ Resuming...`);
      }

      // ── Step 5: Phase 4 Return — history.back() ───────────────────────
      sendLog(`🔙 history.back() — restoring search context...`);
      await discovery.rewindToSearch();

      // Inter-profile human delay
      await humanDelay(2000, 4500);
    }

    if (processedCount >= maxLeads) {
      sendLog(`🎉 Complete! Processed ${processedCount}/${maxLeads} leads.`);
    } else {
      sendLog(`🛑 Stopped at ${processedCount} leads.`);
    }
  } catch (error: any) {
    sendLog(`❌ Fatal: ${error.message}`);
    console.error("[AutoPilot] Stack:", error.stack);
  } finally {
    autoPilotRunning = false;
    sendLog(`🔒 Auto-Pilot shut down.`);
  }
}
