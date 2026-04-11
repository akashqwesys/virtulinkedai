// SQLite Database Setup & Models
import { createRequire } from "module";
import type BetterSqlite3 from "better-sqlite3";
import path from "path";
import { app } from "electron";

const _require = createRequire(import.meta.url);
const Database = _require("better-sqlite3");

let db: any = null;

export function getDatabase(): any {
  if (db) return db;

  const dbPath = path.join(app.getPath("userData"), "virtulinked.db");
  db = new Database(dbPath);

  // Enable WAL mode for better performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initializeSchema(db);
  return db;
}

export function wipeDatabase(): void {
  const db = getDatabase();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();

  db.transaction(() => {
    // 1. Disable constraints
    db.pragma("foreign_keys = OFF");

    // 2. Clear all tables except sqlite internals
    for (const table of tables) {
      if (table.name === "sqlite_sequence") continue;
      db.prepare(`DELETE FROM ${table.name}`).run();
    }

    // 3. Re-enable constraints
    db.pragma("foreign_keys = ON");
  })();

  logActivity("database_wiped", "system", { tablesCleared: (tables as any[]).filter((t: any) => t.name !== 'sqlite_sequence').map((t: any) => t.name) });
}

function initializeSchema(db: any): void {
  // 1. Create tables in correct dependency order (campaigns first for foreign keys)
  const tables = [
    {
      name: "campaigns",
      sql: `CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT DEFAULT 'draft',
        steps_json TEXT DEFAULT '[]',
        stats_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
    },
    {
      name: "leads",
      sql: `CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        linkedin_url TEXT UNIQUE NOT NULL,
        first_name TEXT DEFAULT '',
        last_name TEXT DEFAULT '',
        headline TEXT DEFAULT '',
        company TEXT DEFAULT '',
        role TEXT DEFAULT '',
        location TEXT DEFAULT '',
        about TEXT DEFAULT '',
        experience_json TEXT DEFAULT '[]',
        education_json TEXT DEFAULT '[]',
        skills_json TEXT DEFAULT '[]',
        recent_posts_json TEXT DEFAULT '[]',
        mutual_connections_json TEXT DEFAULT '[]',
        profile_image_url TEXT DEFAULT '',
        connection_degree TEXT DEFAULT '3rd',
        is_sales_navigator INTEGER DEFAULT 0,
        status TEXT DEFAULT 'new',
        campaign_id TEXT,
        connection_note TEXT,
        connection_requested_at TEXT,
        connection_accepted_at TEXT,
        score INTEGER DEFAULT 0,
        tags_json TEXT DEFAULT '[]',
        notes TEXT DEFAULT '',
        raw_data_json TEXT DEFAULT '{}',
        scraped_at TEXT,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      )`,
    },
    {
      name: "emails",
      sql: `CREATE TABLE IF NOT EXISTS emails (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        type TEXT DEFAULT 'intro',
        sent_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        opened_at TEXT,
        clicked_at TEXT,
        replied_at TEXT,
        FOREIGN KEY (lead_id) REFERENCES leads(id)
      )`,
    },
    {
      name: "conversations",
      sql: `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        content TEXT NOT NULL,
        platform TEXT DEFAULT 'linkedin',
        is_automated INTEGER DEFAULT 0,
        chatbot_state TEXT DEFAULT 'idle',
        sent_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        FOREIGN KEY (lead_id) REFERENCES leads(id)
      )`,
    },
    {
      name: "scheduled_posts",
      sql: `CREATE TABLE IF NOT EXISTS scheduled_posts (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        media_urls_json TEXT DEFAULT '[]',
        post_type TEXT DEFAULT 'text',
        hashtags TEXT DEFAULT '[]',
        scheduled_at TEXT NOT NULL,
        published_at TEXT,
        status TEXT DEFAULT 'draft',
        engagement_json TEXT,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
    },
    {
      name: "engagement_actions",
      sql: `CREATE TABLE IF NOT EXISTS engagement_actions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        target_post_url TEXT DEFAULT '',
        content TEXT,
        performed_at TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
    },
    {
      name: "activity_log",
      sql: `CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        module TEXT NOT NULL,
        details_json TEXT DEFAULT '{}',
        status TEXT DEFAULT 'success',
        error_message TEXT,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
    },
    {
      name: "email_templates",
      sql: `CREATE TABLE IF NOT EXISTS email_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        variables_json TEXT DEFAULT '[]',
        type TEXT DEFAULT 'intro',
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
    },
    {
      name: "connection_checks",
      sql: `CREATE TABLE IF NOT EXISTS connection_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id TEXT NOT NULL,
        linkedin_url TEXT NOT NULL,
        previous_status TEXT,
        current_status TEXT NOT NULL,
        checked_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        FOREIGN KEY (lead_id) REFERENCES leads(id)
      )`,
    },
    {
      name: "job_queue",
      sql: `CREATE TABLE IF NOT EXISTS job_queue (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        run_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
    },
    {
      name: "migration_meta",
      sql: `CREATE TABLE IF NOT EXISTS migration_meta (
        key TEXT PRIMARY KEY,
        applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
    },
  ];

  // Execute table creations individually for reliability
  for (const table of tables) {
    db.exec(table.sql);
  }

  // 2. Migration: Ensure important columns exist (auto-healing for existing DBs)
  ensureColumnExists(db, "leads", "status", "TEXT DEFAULT 'new'");
  ensureColumnExists(db, "campaigns", "status", "TEXT DEFAULT 'draft'");
  ensureColumnExists(db, "scheduled_posts", "status", "TEXT DEFAULT 'draft'");
  ensureColumnExists(
    db,
    "engagement_actions",
    "status",
    "TEXT DEFAULT 'pending'",
  );
  ensureColumnExists(db, "activity_log", "status", "TEXT DEFAULT 'success'");

  // 3. Create indexes
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)",
    "CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id)",
    "CREATE INDEX IF NOT EXISTS idx_leads_url ON leads(linkedin_url)",
    "CREATE INDEX IF NOT EXISTS idx_emails_lead ON emails(lead_id)",
    "CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id)",
    "CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status)",
    "CREATE INDEX IF NOT EXISTS idx_activity_log_module ON activity_log(module)",
    "CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_connection_checks_lead ON connection_checks(lead_id)",
    "CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status, run_at)",
    "CREATE INDEX IF NOT EXISTS idx_job_queue_type ON job_queue(type, status)",
  ];

  for (const idx of indexes) {
    try {
      db.exec(idx);
    } catch (err) {
      console.warn(`Could not create index: ${idx}`, err);
    }
  }

  // 4. Timezone Migration: Shift UTC to IST (5.5h) for existing records
  try {
    const migrationKey = "utc_to_ist_shift_v1";
    const migrationDone = db
      .prepare("SELECT key FROM migration_meta WHERE key = ?")
      .get(migrationKey);

    if (!migrationDone) {
      console.log("Applying one-time UTC to IST migration (v1)...");
      
      // Shift activity_log
      db.exec(`
        UPDATE activity_log 
        SET created_at = datetime(created_at, '+5 hours', '+30 minutes')
        WHERE created_at NOT LIKE '%Z' AND created_at != ''
      `);

      // Shift other status-relevant timestamps if needed
      db.exec(`
        UPDATE leads SET 
          connection_requested_at = datetime(connection_requested_at, '+5 hours', '+30 minutes'),
          connection_accepted_at = datetime(connection_accepted_at, '+5 hours', '+30 minutes'),
          updated_at = datetime(updated_at, '+5 hours', '+30 minutes'),
          created_at = datetime(created_at, '+5 hours', '+30 minutes')
        WHERE created_at NOT LIKE '%Z'
      `);

      db.prepare("INSERT INTO migration_meta (key) VALUES (?)").run(migrationKey);
      logActivity("migration_applied", "storage", { key: migrationKey });
    }

    // 5. ISO Standardization Migration (v2): Append 'Z' to all timestamps missing it.
    // This ensures that the frontend correctly interprets all strings as UTC and converts to IST.
    const migrationKeyV2 = "iso_standardization_v2";
    const migrationDoneV2 = db
      .prepare("SELECT key FROM migration_meta WHERE key = ?")
      .get(migrationKeyV2);

    if (!migrationDoneV2) {
      console.log("Applying ISO Standardization (v2)...");

      const tablesToUpdate = [
        "activity_log",
        "leads",
        "emails",
        "conversations",
        "scheduled_posts",
        "job_queue",
        "email_templates",
      ];

      for (const table of tablesToUpdate) {
        let columns: string[] = [];
        if (table === "activity_log") columns = ["created_at"];
        else if (table === "leads")
          columns = [
            "created_at",
            "updated_at",
            "connection_requested_at",
            "connection_accepted_at",
            "scraped_at",
          ];
        else if (table === "emails")
          columns = ["sent_at", "opened_at", "clicked_at", "replied_at"];
        else if (table === "conversations") columns = ["sent_at"];
        else if (table === "scheduled_posts")
          columns = ["created_at", "scheduled_at", "published_at"];
        else if (table === "job_queue")
          columns = ["created_at", "run_at", "started_at", "completed_at"];
        else if (table === "email_templates")
          columns = ["created_at", "updated_at"];

        for (const col of columns) {
          try {
            // Append 'Z' but only if it's not already there and the column is not empty
            // We use REPLACE(T, ' ', 'T') to normalize the space to 'T' for ISO compliance
            db.exec(`
              UPDATE ${table}
              SET ${col} = REPLACE(${col}, ' ', 'T') || 'Z'
              WHERE ${col} NOT LIKE '%Z' AND ${col} IS NOT NULL AND ${col} != ''
            `);
          } catch (e) {
            /* skip missing columns */
          }
        }
      }

      db.prepare("INSERT INTO migration_meta (key) VALUES (?)").run(
        migrationKeyV2,
      );
      logActivity("migration_applied", "storage", { key: migrationKeyV2 });
    }
  } catch (err) {
    console.warn("Migration failed:", err);
  }

  // 5. Seed default data
  seedEmailTemplates(db);

  logActivity("db_schema_initialized", "storage", {
    timestamp: new Date().toISOString(),
  });
}

/**
 * Migration helper to add columns if they're missing
 */
function ensureColumnExists(
  db: any,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const columnExists = tableInfo.some((col: any) => col.name === columnName);

  if (!columnExists) {
    console.log(`Adding missing column ${columnName} to table ${tableName}...`);
    try {
      db.exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
      );
    } catch (err) {
      console.error(`Failed to add column ${columnName} to ${tableName}:`, err);
    }
  }
}

function seedEmailTemplates(db: any): void {
  const count = db
    .prepare("SELECT COUNT(*) as c FROM email_templates")
    .get() as any;
  if (count.c > 0) return;

  const templates = [
    {
      id: "tpl_intro",
      name: "Introduction Email",
      subject: "Connecting on an idea for {company}",
      body: `Hi {firstName},\n\nI came across your profile and was impressed by your work as {role} at {company}.\n\n{industryInsight}\n\nI'd love to connect and share how {yourCompany} helps companies like yours with {yourServices}.\n\nWould you be open to a quick 15-minute chat?\n\nBest regards,\n{yourName}`,
      variables: [
        "firstName",
        "company",
        "role",
        "industryInsight",
        "yourCompany",
        "yourServices",
        "yourName",
      ],
      type: "intro",
    },
    {
      id: "tpl_welcome",
      name: "Welcome Email (Post-Accept)",
      subject: "Great connecting with you, {firstName}!",
      body: `Hi {firstName},\n\nThanks for accepting my connection request! It's great to be connected.\n\nI noticed {recentPost} — really insightful.\n\nAt {yourCompany}, we specialize in {yourServices}. I think there could be some synergy.\n\nWould you be open to a brief call this week?\n\nCheers,\n{yourName}`,
      variables: [
        "firstName",
        "recentPost",
        "yourCompany",
        "yourServices",
        "yourName",
      ],
      type: "welcome",
    },
    {
      id: "tpl_followup",
      name: "Follow-Up (3 Days)",
      subject: "Quick follow-up, {firstName}",
      body: `Hi {firstName},\n\nI reached out a few days ago — just wanted to circle back.\n\nI've been working with companies like {company} on {yourServices}, and I thought you might find it relevant given your focus on {skillMatch}.\n\nNo pressure at all — happy to share a case study if you're interested.\n\nBest,\n{yourName}`,
      variables: [
        "firstName",
        "company",
        "yourServices",
        "skillMatch",
        "yourName",
      ],
      type: "follow_up",
    },
    {
      id: "tpl_meeting",
      name: "Meeting Confirmation",
      subject: "Meeting Confirmed: {yourName} × {firstName}",
      body: `Hi {firstName},\n\nGreat news! Our meeting is confirmed.\n\n📅 {meetingDate}\n🔗 {meetingLink}\n\nLooking forward to discussing how {yourServices} can help {company}.\n\nSee you there!\n{yourName}`,
      variables: [
        "firstName",
        "meetingDate",
        "meetingLink",
        "yourServices",
        "company",
        "yourName",
      ],
      type: "meeting_confirm",
    },
  ];

  const stmt = db.prepare(`
        INSERT INTO email_templates (id, name, subject, body, variables_json, type)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

  for (const t of templates) {
    stmt.run(
      t.id,
      t.name,
      t.subject,
      t.body,
      JSON.stringify(t.variables),
      t.type,
    );
  }
}

// ------ Helper functions ------

export function logActivity(
  action: string,
  module: string,
  details: Record<string, unknown> = {},
  status: "success" | "error" = "success",
  errorMessage?: string,
): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO activity_log (action, module, details_json, status, error_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(action, module, JSON.stringify(details), status, errorMessage || null, new Date().toISOString());
}

export function getEmailTemplates(): any[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM email_templates ORDER BY type, name").all();
}

export function saveEmailTemplate(template: {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  type: string;
}): void {
  const db = getDatabase();
  db.prepare(
    `
        INSERT OR REPLACE INTO email_templates (id, name, subject, body, variables_json, type, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    template.id,
    template.name,
    template.subject,
    template.body,
    JSON.stringify(template.variables),
    template.type,
    new Date().toISOString()
  );
}

export function deleteEmailTemplate(id: string): void {
  const db = getDatabase();
  db.prepare("DELETE FROM email_templates WHERE id = ?").run(id);
}



export function getLeadsByStatus(status?: string, limit = 100): any[] {
  const db = getDatabase();
  if (status && status !== "all") {
    return db
      .prepare(
        "SELECT * FROM leads WHERE status = ? ORDER BY updated_at DESC LIMIT ?",
      )
      .all(status, limit);
  }
  return db
    .prepare("SELECT * FROM leads ORDER BY updated_at DESC LIMIT ?")
    .all(limit);
}

export function getLeadByUrl(url: string): any | null {
  const db = getDatabase();
  return (
    db.prepare("SELECT * FROM leads WHERE linkedin_url = ?").get(url) || null
  );
}

export function updateLeadStatus(id: string, status: string): void {
  const db = getDatabase();
  db.prepare(
    "UPDATE leads SET status = ?, updated_at = ? WHERE id = ?",
  ).run(status, new Date().toISOString(), id);
}

/**
 * UPSERT a scraped LinkedIn profile into the leads table.
 * Keyed on linkedin_url — updates existing rows, inserts new ones.
 * Never touches campaign_id, connection_note, or any connection-flow columns.
 */
export function upsertLeadProfile(profile: {
  id: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  headline: string;
  company: string;
  role: string;
  location: string;
  about: string;
  experience: unknown[];
  education: unknown[];
  skills: string[];
  recentPosts: unknown[];
  mutualConnections: string[];
  profileImageUrl: string;
  connectionDegree: string;
  isSalesNavigator: boolean;
  scrapedAt: string;
  rawData: Record<string, unknown>;
}, existingLeadId?: string): string {
  const db = getDatabase();

  // Check if a lead already exists for this URL
  const existing = db
    .prepare("SELECT id, status FROM leads WHERE linkedin_url = ?")
    .get(profile.linkedinUrl) as { id: string; status: string } | undefined;

  const leadId = existing?.id || existingLeadId || profile.id;
  const currentStatus = existing?.status || "new";
  // Advance status to profile_scraped only if still at 'new'
  const newStatus = currentStatus === "new" ? "profile_scraped" : currentStatus;

  db.prepare(`
    INSERT INTO leads (
      id, linkedin_url, first_name, last_name, headline, company, role,
      location, about, experience_json, education_json, skills_json,
      recent_posts_json, mutual_connections_json, profile_image_url,
      connection_degree, is_sales_navigator, status, scraped_at,
      raw_data_json, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?
    )
    ON CONFLICT(linkedin_url) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      headline = excluded.headline,
      company = excluded.company,
      role = excluded.role,
      location = excluded.location,
      about = excluded.about,
      experience_json = excluded.experience_json,
      education_json = excluded.education_json,
      skills_json = excluded.skills_json,
      recent_posts_json = excluded.recent_posts_json,
      mutual_connections_json = excluded.mutual_connections_json,
      profile_image_url = excluded.profile_image_url,
      connection_degree = excluded.connection_degree,
      is_sales_navigator = excluded.is_sales_navigator,
      status = CASE WHEN leads.status = 'new' THEN 'profile_scraped' ELSE leads.status END,
      scraped_at = excluded.scraped_at,
      raw_data_json = excluded.raw_data_json,
      updated_at = ?
  `).run(
    leadId,
    profile.linkedinUrl,
    profile.firstName,
    profile.lastName,
    profile.headline,
    profile.company,
    profile.role,
    profile.location,
    profile.about,
    JSON.stringify(profile.experience),
    JSON.stringify(profile.education),
    JSON.stringify(profile.skills),
    JSON.stringify(profile.recentPosts),
    JSON.stringify(profile.mutualConnections),
    profile.profileImageUrl,
    profile.connectionDegree,
    profile.isSalesNavigator ? 1 : 0,
    newStatus,
    profile.scrapedAt,
    JSON.stringify(profile.rawData),
    new Date().toISOString(), // VALUES updated_at (INSERT path)
    new Date().toISOString()  // ON CONFLICT updated_at = ? (UPDATE path)
  );

  return leadId;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
