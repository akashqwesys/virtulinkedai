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

  const prompt = `You are writing a LinkedIn connection request note for ${context.yourName} (${context.yourCompany}).

LEAD PROFILE:
${contextBlock}

YOUR OBJECTIVE:
Write a POWERFUL, ATTENTION-GRABBING connection request note in EXACTLY ONE SINGLE SENTENCE.

STRICT RULES (do NOT break any of these):
1. EXACTLY ONE SENTENCE: Write only one highly compelling sentence that ends with a question mark or a period.
2. MAKE THEM INTERACT: Create a very clear and concise hook that instantly sparks curiosity and compels them to reply or accept.
3. BE SPECIFIC: Subtly tie in their specific role or company to prove this isn't a mass-automated blast.
4. NO CLICHÉS: NEVER use weak phrases like "I noticed your profile", "I'd love to connect", "Hope to connect", or "As a fellow professional".
5. NO PITCHING: Do not explicitly pitch your services, but hint at mutual value or a shared compelling perspective.
6. FORMAT: Start naturally with a casual greeting in the same sentence (e.g., "Hey [Name], [your powerful hook here]").
7. Output ONLY the note text — no quotes, no explanations, no prefix labels.

Write the one-sentence connection note now:`;

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
