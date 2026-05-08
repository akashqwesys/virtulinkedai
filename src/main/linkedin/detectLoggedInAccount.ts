import type { Page } from 'puppeteer-core';
import { humanDelay } from '../browser/humanizer';
import { getDatabase } from '../storage/database';

export async function detectLoggedInAccount(page: Page): Promise<string> {
  console.log('[AccountDetect] Navigating to /messaging/ to detect logged-in account invisibly...');
  try {
    // Navigate to messaging instead of profile to avoid visual disruption
    await (page as any).goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch(() => null);
    
    await humanDelay(1500, 2500);
    
    const url = page.url();
    if (url.includes('/login') || url.includes('/checkpoint')) {
      console.warn('[AccountDetect] Not logged in.');
      return '';
    }

    const accountData = await page.evaluate(async () => {
      let finalUrl = '';
      try {
        // Do a background fetch to /in/me to let the browser follow the redirect invisibly
        const response = await fetch('https://www.linkedin.com/in/me', { method: 'HEAD' });
        finalUrl = response.url;
      } catch {
        finalUrl = window.location.href; // fallback
      }

      // Try to get name and image from the global nav
      const imgEl = document.querySelector('.global-nav__me-photo') as HTMLImageElement;
      let name = '';
      let imgUrl = '';
      if (imgEl) {
        imgUrl = imgEl.src;
        const alt = imgEl.getAttribute('alt') || '';
        name = alt.replace(/^Photo of\s+/i, '').replace(/^Profile picture of\s+/i, '').replace(/^Foto de\s+/i, '').trim();
      }
      
      // Fallback name extraction if nav is missing
      if (!name) {
        const badgeEl = document.querySelector('.profile-rail-card__actor-link');
        if (badgeEl) {
          name = badgeEl.textContent?.trim() || '';
        }
      }

      return { name, imgUrl, finalUrl };
    });

    // Remove any trailing slashes or query params from URL
    const cleanUrl = (accountData.finalUrl || url).split('?')[0].replace(/\/$/, '');

    console.log(`[AccountDetect] Detected: ${accountData.name} (${cleanUrl})`);

    const db = getDatabase();
    db.prepare(`
      INSERT INTO inbox_sessions (id, account_name, account_linkedin_url, account_profile_image, logged_in_at, is_active, last_sync_all_at)
      VALUES ('current', ?, ?, ?, ?, 1, '')
      ON CONFLICT(id) DO UPDATE SET
        account_name = excluded.account_name,
        account_linkedin_url = excluded.account_linkedin_url,
        account_profile_image = excluded.account_profile_image,
        logged_in_at = excluded.logged_in_at,
        is_active = 1
        -- NOTE: last_sync_all_at is intentionally NOT updated here.
        -- It is a sticky checkpoint managed exclusively by inbox:scrape-all.
        -- Omitting it from the SET clause means SQLite keeps the existing value.
    `).run(accountData.name, cleanUrl, accountData.imgUrl, new Date().toISOString());

    return cleanUrl;
  } catch (err: any) {
    console.error('[AccountDetect] Failed:', err.message);
    return '';
  }
}
