import type { AppSettings, LinkedInProfile } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { logActivity } from "../../storage/database";

/**
 * Generate a personalized connection request note (≤300 characters)
 */
export async function generateConnectionNote(
  profile: LinkedInProfile,
  context: {
    yourName: string;
    yourCompany: string;
    yourServices: string;
  },
  settings: AppSettings["ai"],
): Promise<string> {
  // Build a rich context block from whatever profile data we have
  const recentPost = profile.recentPosts?.[0]?.content?.substring(0, 150) || null;
  const topSkills = profile.skills?.slice(0, 4).join(", ") || null;
  const currentRole = profile.role || profile.headline || "their field";
  const company = profile.company || "their company";
  const aboutSnippet = profile.about?.substring(0, 200) || null;

  const contextBlock = [
    `Name: ${profile.firstName} ${profile.lastName}`,
    `Role: ${currentRole}`,
    `Company: ${company}`,
    aboutSnippet ? `About (excerpt): ${aboutSnippet}` : null,
    recentPost ? `Recent post topic: ${recentPost}` : null,
    topSkills ? `Key skills: ${topSkills}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You are crafting a LinkedIn connection request note on behalf of ${context.yourName}, representing ${context.yourCompany || 'Veda AI Lab'}. Your core offerings align with the company brochure provided in the system context (white-label AI agents, automation, ERP intelligence).

LEAD PROFILE:
${contextBlock}

SENDER IDENTITY (do NOT reveal these details directly — only use them to craft the right tone and angle):
- Name: ${context.yourName}
- Company: ${context.yourCompany || 'Veda AI Lab'}
- Services: ${context.yourServices || 'Custom AI, ERP Intelligence, Automation'}
- Hidden end goal: build a genuine connection that may eventually lead to a conversation about shared interests in digital transformation, agency scaling, or technical delivery

YOUR TASK:
Write a LinkedIn connection request note (1–2 sentences MAX) that reads like it was written by a knowledgeable peer who found something genuinely interesting in this person's work, company, or domain.

KNOWLEDGE BASE GUIDANCE:
- Draw from SECTION 1 (Company Identity) and SECTION 3 (Partnership Model) for tone and positioning.
- Match the service most relevant to this lead's role from SECTION 4 — but DO NOT name it directly. Let it inform your curiosity angle.
- If the lead's industry matches a SUCCESS STORY (SECTION 9), use that domain knowledge to signal credibility.
- NEVER mention pricing (SECTION 11). This is a cold connection note, not a pitch.

STRICT RULES — breaking ANY of these is a failure:
1. ZERO SELLING: Do not mention services, products, pricing, meetings, demos, or pitches. This must read as peer-level curiosity, not outreach.
2. LEAD-SPECIFIC HOOK: Reference something real from the lead's role, company, headline, or skills to prove this isn't automated.
3. PEER POSITIONING: ${context.yourName} should feel like someone building at the same level as the lead — a technical collaborator, not a vendor.
4. DOMAIN FIT: Only reference AI, automation, ERP, SaaS, or agency growth if it naturally fits the lead's background. Don't force it.
5. NO CLICHÉS: NEVER use "I came across your profile", "I'd love to connect", "I noticed", "fellow professional", or generic filler.
6. FORMAT: Open with "Hi [FirstName]," then immediately deliver the hook — no preamble.
7. OUTPUT: Return ONLY the note text. No quotes, no labels, no explanations.
8. LENGTH: Stay under 280 characters.

Write the connection note now:`;

  const rawNote = await generateWithOllama(prompt, settings, {
    maxTokens: 100,
    temperature: 0.85,
  });

  // Strict sanitization
  let cleaned = rawNote
    .trim()
    .replace(/^["""''`]+|["""''`]+$/g, "")                              
    .replace(/^(note|connection note|here('s| is)|linkedin note)\s*[:\-]?\s*/i, "")
    .replace(/\r?\n/g, " ")                                             
    .replace(/\s{2,}/g, " ")                                           
    .trim();

  // Hard cap at 300 characters
  if (cleaned.length > 300) {
    cleaned = cleaned.substring(0, 297).replace(/\s+\S*$/, "") + "…";
  }

  logActivity("ai_connection_note_generated", "ai", {
    leadName: `${profile.firstName} ${profile.lastName}`,
    noteLength: cleaned.length,
  });

  return cleaned;
}
