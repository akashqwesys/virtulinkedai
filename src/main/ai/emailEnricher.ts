/**
 * Email Enrichment Service
 *
 * Attempts to find a business email for a lead given their name and company.
 * Supports Hunter.io and Apollo.io as providers.
 *
 * Falls back gracefully if no provider is configured or if the API returns
 * no result — callers should always handle a null return value.
 */

import type { AppSettings } from "../../shared/types";
import { logActivity } from "../storage/database";

/**
 * Attempt to find a business email for a lead.
 * Returns a verified email string or null if not found / not configured.
 */
export async function enrichLeadEmail(
  firstName: string,
  lastName: string,
  company: string,
  settings: AppSettings["enrichment"],
): Promise<string | null> {
  if (!settings || settings.provider === "none" || !settings.apiKey) {
    return null;
  }

  try {
    switch (settings.provider) {
      case "hunter":
        return await findEmailWithHunter(firstName, lastName, company, settings.apiKey);
      case "apollo":
        return await findEmailWithApollo(firstName, lastName, company, settings.apiKey);
      default:
        return null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity("email_enrichment_failed", "enrichment", {
      firstName,
      lastName,
      company,
      provider: settings.provider,
      error: message,
    }, "error", message);
    return null;
  }
}

// ============================================================
// Hunter.io — Email Finder
// ============================================================

async function findEmailWithHunter(
  firstName: string,
  lastName: string,
  company: string,
  apiKey: string,
): Promise<string | null> {
  // Hunter needs a domain, not a company name. We do a two-step approach:
  // 1. Use the Domain Search endpoint to find the company domain by name
  // 2. Use the Email Finder endpoint with the domain + name

  // Step 1: Find domain for company name
  const domainUrl = new URL("https://api.hunter.io/v2/domain-search");
  domainUrl.searchParams.set("company", company);
  domainUrl.searchParams.set("api_key", apiKey);
  domainUrl.searchParams.set("limit", "1");

  const domainRes = await fetch(domainUrl.toString());
  if (!domainRes.ok) {
    throw new Error(`Hunter domain search failed: HTTP ${domainRes.status}`);
  }
  const domainData = await domainRes.json() as any;
  const domain: string = domainData?.data?.domain || "";

  if (!domain) {
    logActivity("hunter_no_domain_found", "enrichment", { company });
    return null;
  }

  // Step 2: Find email with domain + name
  const emailUrl = new URL("https://api.hunter.io/v2/email-finder");
  emailUrl.searchParams.set("domain", domain);
  emailUrl.searchParams.set("first_name", firstName);
  emailUrl.searchParams.set("last_name", lastName);
  emailUrl.searchParams.set("api_key", apiKey);

  const emailRes = await fetch(emailUrl.toString());
  if (!emailRes.ok) {
    throw new Error(`Hunter email finder failed: HTTP ${emailRes.status}`);
  }
  const emailData = await emailRes.json() as any;
  const email: string = emailData?.data?.email || "";
  const confidence: number = emailData?.data?.score || 0;

  if (!email || confidence < 50) {
    logActivity("hunter_low_confidence_email", "enrichment", {
      company,
      firstName,
      domain,
      confidence,
    });
    return null;
  }

  logActivity("hunter_email_found", "enrichment", {
    firstName,
    lastName,
    company,
    domain,
    confidence,
  });

  return email;
}

// ============================================================
// Apollo.io — People Match
// ============================================================

async function findEmailWithApollo(
  firstName: string,
  lastName: string,
  company: string,
  apiKey: string,
): Promise<string | null> {
  const res = await fetch("https://api.apollo.io/v1/people/match", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      organization_name: company,
      reveal_personal_emails: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Apollo people match failed: HTTP ${res.status}`);
  }

  const data = await res.json() as any;
  const person = data?.person;
  const email: string = person?.email || "";

  if (!email) {
    logActivity("apollo_no_email_found", "enrichment", {
      firstName,
      lastName,
      company,
    });
    return null;
  }

  logActivity("apollo_email_found", "enrichment", {
    firstName,
    lastName,
    company,
  });

  return email;
}
