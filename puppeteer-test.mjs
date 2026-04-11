import puppeteer from "puppeteer-core";

(async () => {
  console.log("Connecting to Electron runtime on port 9222...");
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: "http://localhost:9222",
      defaultViewport: null,
    });

    console.log("Found pages:");
    const pages = await browser.pages();
    let targetPage = null;

    for (const page of pages) {
      const title = await page.title();
      const url = page.url();
      console.log(` - ${title} (${url})`);
      if (url.includes("localhost:") || url.includes("file://")) {
        // Focus on the React Renderer page
        targetPage = page;
        break;
      }
    }

    if (!targetPage) {
      console.error("Renderer page not found");
      process.exit(1);
    }

    console.log("Attaching dialog listener...");
    targetPage.on("dialog", async (dialog) => {
      console.log("\n!!! INTERCEPTED DIALOG ALERT !!!\n");
      console.log(dialog.message());
      await dialog.accept();
      process.exit(0);
    });

    // Click the 'Connect LinkedIn' button
    console.log("Clicking 'Connect LinkedIn' button...");
    await targetPage.waitForSelector("button", { timeout: 5000 });

    const clicked = await targetPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const connectBtn = btns.find(
        (b) => b.textContent && b.textContent.includes("Connect LinkedIn"),
      );
      if (connectBtn) {
        connectBtn.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      console.log("Connect LinkedIn button not found.");
      process.exit(1);
    }

    console.log("Button clicked. Waiting for alert...");

    // Wait up to 10 seconds for an alert
    await new Promise((resolve) => setTimeout(resolve, 10000));
    console.log("No alert triggered within 10 seconds.");
    process.exit(1);
  } catch (e) {
    console.error("Puppeteer Connection Error:", e);
    process.exit(1);
  }
})();
