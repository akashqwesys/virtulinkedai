---
description: Replicating Linked Helper's Search and Profile Navigation
---

# Linked Helper Interaction Workflow

This workflow documents the exact steps required to replicate Linked Helper's human-mimicry patterns for searching and profile navigation on LinkedIn.

## 1. Interactive Search Entry
Instead of direct URL navigation, search MUST be performed via the UI:
1.  Navigate to `https://www.linkedin.com/feed/`.
2.  Locate the Global Search Input: `input[aria-label="Search"]`.
3.  Execute a **Click-First** sequence:
    - `humanMove` to the input.
    - `humanClick` (MouseDown -> 150ms -> MouseUp).
4.  Execute **Natural Typing**:
    - `humanType(keywords)` from `humanizer.ts`.
    - `page.keyboard.press("Enter")`.
5.  Wait for the URL to change to `/search/results/people/`.
6.  If not filtered, click the "People" chip using ARIA selectors.

## 2. Adaptive List Navigation (Eliminating Blind Scrolling)
Replace fixed loops with **Target-Aware Seekers**:
1.  Identify the list container: `[role="list"]` inside `<main>`.
2.  If the next entity is off-screen, scroll in small (200-400px) increments.
3.  After each increment, wait 500ms for hydration.
4.  Stop immediately once the target entity's name anchor is visible and has a non-zero bounding box.

## 3. High-Fidelity Profile Navigation
1.  **Gaze Interaction**:
    - Center the profile card in the viewport.
    - Wait 1.5s - 3s (simulate reading).
2.  **Precision Click**:
    - Target the `<a>` tag with the profile name.
    - Apply ±10% Gaussian jitter of the element width/height to the click target.
    - Use hardware-level `mouse.down()` and `mouse.up()`.

## 4. Anti-Detection Signals
-   **No Warp Scrolling**: Never use `scrollTo({ top: scrollHeight })`. It's a huge bot signal.
-   **Modal Guard**: Always check for `artdeco-modal` or `search-results-commercial-use-limit` before starting a new search.
-   **Click Distribution**: 90% of clicks should be on the profile name; 10% on the profile image.
