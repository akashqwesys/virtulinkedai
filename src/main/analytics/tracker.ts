import express from "express";
import cors from "cors";
import { getDatabase, logActivity } from "../storage/database";

let server: any = null;

// 1x1 transparent GIF base64 encoded
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

/**
 * Start the local express analytics server
 * Connects to port 3333 to intercept open/click webhooks
 */
export function startTrackingServer(port: number = 3333): void {
  if (server) return; // Already running

  const app = express();

  // Basic CORS just in case
  app.use(cors());

  // Middleware to avoid caching pixels (Critical for open tracking)
  app.use((req, res, next) => {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
  });

  // ==========================================
  // Track Open (Pixel)
  // ==========================================
  app.get("/track/open", (req, res) => {
    const emailId = req.query.eid as string;

    if (emailId) {
      try {
        const db = getDatabase();
        // Check if already opened (only record the first open time for simplicity, but log activity for all)
        const existing = db
          .prepare("SELECT opened_at FROM emails WHERE id = ?")
          .get(emailId) as any;

        if (existing) {
          if (!existing.opened_at) {
            db.prepare(
              "UPDATE emails SET opened_at = ? WHERE id = ?",
            ).run(new Date().toISOString(), emailId);
            
            // Also update the lead status if it's currently just "email_sent"
            db.prepare(
              "UPDATE leads SET status = 'email_opened', updated_at = ? WHERE id = (SELECT lead_id FROM emails WHERE id = ?) AND status = 'email_sent'"
            ).run(new Date().toISOString(), emailId);
          }
          logActivity("email_opened", "email", { emailId });
        }
      } catch (err) {
        console.error("Error tracking email open:", err);
      }
    }

    // Always return the transparent GIF
    res.writeHead(200, {
      "Content-Type": "image/gif",
      "Content-Length": TRANSPARENT_GIF.length,
    });
    res.end(TRANSPARENT_GIF);
  });

  // ==========================================
  // Track Click (Redirect)
  // ==========================================
  app.get("/track/click", (req, res) => {
    const emailId = req.query.eid as string;
    const targetUrl = req.query.url as string;

    if (!targetUrl) {
      res.status(400).send("Missing target URL");
      return;
    }

    if (emailId) {
      try {
        const db = getDatabase();
        const existing = db
          .prepare("SELECT clicked_at FROM emails WHERE id = ?")
          .get(emailId) as any;

        if (existing) {
          if (!existing.clicked_at) {
            db.prepare(
              "UPDATE emails SET clicked_at = ? WHERE id = ?",
            ).run(new Date().toISOString(), emailId);
            
            // Log click activity
            logActivity("email_link_clicked", "email", { emailId, url: targetUrl });
          }
        }
      } catch (err) {
        console.error("Error tracking email click:", err);
      }
    }

    // Perform a 302 redirect to the original destination
    res.redirect(302, targetUrl);
  });

  server = app.listen(port, () => {
    console.log(`[Analytics] Tracking server running natively on port ${port}`);
  });
}

export function stopTrackingServer(): void {
  if (server) {
    server.close();
    server = null;
    console.log("[Analytics] Tracking server stopped");
  }
}
