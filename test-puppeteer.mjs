import { app } from "electron";
import { launchBrowser } from "./out/main/index.mjs";

app.whenReady().then(async () => {
  console.log("App ready. Attempting to launch browser...");
  try {
    const result = await launchBrowser();
    console.log("Launch result:", result);
  } catch (e) {
    console.error("FATAL ERROR launching browser:", e);
  }
  app.quit();
});
