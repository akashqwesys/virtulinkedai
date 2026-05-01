import type { AppSettings, LinkedInProfile } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { getDatabase, logActivity } from "../../storage/database";

/**
 * Generate a personalized connection request note (≤300 characters)
 *
 * This uses the full narrative text of the Veda AI Lab Partnership Brochure 
 * (injected by the client via VEDA_CONTEXT) to craft hyper-relevant notes.
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
  const recentPost = profile.recentPosts?.[0]?.content?.substring(0, 150) || null;
  const topSkills = profile.skills?.slice(0, 4).join(", ") || null;
  const currentRole = profile.role || profile.headline || "their field";
  const company = profile.company || "their company";
  const aboutSnippet = profile.about?.substring(0, 200) || null;

  const db = getDatabase();
  const leadRow = db.prepare("SELECT * FROM leads WHERE linkedin_url = ?").get(profile.linkedinUrl) as any;
  
  let previousInteractions = "None";
  if (leadRow) {
    const actions: string[] = [`Current lead status: ${leadRow.status}`];
    if (leadRow.connection_requested_at) actions.push(`- Connection request sent on ${leadRow.connection_requested_at}`);
    if (leadRow.connection_accepted_at) actions.push(`- Connection accepted on ${leadRow.connection_accepted_at}`);
    
    const emails = db.prepare("SELECT type, subject, sent_at FROM emails WHERE lead_id = ? ORDER BY sent_at ASC").all(leadRow.id) as any[];
    for (const em of emails) actions.push(`- Email sent (${em.type}): "${em.subject}" on ${em.sent_at}`);
    
    const convos = db.prepare("SELECT direction, content, sent_at FROM conversations WHERE lead_id = ? ORDER BY sent_at ASC").all(leadRow.id) as any[];
    for (const cv of convos) actions.push(`- DM ${cv.direction === 'inbound' ? 'Received from lead' : 'Sent to lead'} on ${cv.sent_at}: "${cv.content}"`);
    
    if (actions.length > 1 || actions[0] !== `Current lead status: new`) {
      previousInteractions = actions.join("\n");
    }
  }

  const contextBlock = [
    `Name: ${profile.firstName} ${profile.lastName}`,
    `Role: ${currentRole}`,
    `Company: ${company}`,
    profile.location ? `Location: ${profile.location}` : null,
    profile.about ? `About: ${profile.about}` : null,
    recentPost ? `Recent post topic: ${recentPost}` : null,
    topSkills ? `Key skills: ${topSkills}` : null,
    profile.experience?.length ? `Experience: ${profile.experience.map(e => `${e.title} at ${e.company}`).join(', ')}` : null,
    profile.education?.length ? `Education: ${profile.education.map(e => `${e.degree} from ${e.school}`).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You are crafting a LinkedIn connection request note on behalf of ${context.yourName}, representing ${context.yourCompany || 'Veda AI Lab'}.

=== SENDER IDENTITY & CONTEXT ===
- Name: ${context.yourName}
- Company: ${context.yourCompany || 'Veda AI Lab'}
- Services: ${context.yourServices || 'Custom AI, ERP Intelligence, Automation'}

=== LEAD PROFILE ===
${contextBlock}

=== PREVIOUS INTERACTIONS WITH THIS LEAD ===
${previousInteractions}

=== FULL TASK INSTRUCTIONS ===
The system has provided you with the COMPLETE narrative text of the "Veda AI Lab — Partnership Brochure 2026" above.
Your task is to write a LinkedIn connection request note (2-3 short sentences MAX) to this lead.

You must meticulously analyze the brochure text and cross-reference it with the LEAD PROFILE using this algorithm:

STEP 1: INDUSTRY & ROLE MAPPING
Look at the lead's "Role" and "Company". Scan the brochure's "VERTICAL EXPERTISE & ECOSYSTEM" and "PROVEN SUCCESS STORIES" sections.
- Does the lead work in Manufacturing? Note the 40% cost reduction story.
- Does the lead work in E-Commerce? Note the 120 hrs/mo saved story.
- Are they an Agency owner? Note the "100% Invisible White Label" model.
- Are they in IT/Engineering? Note the "Self-Hosted LLMs" or "Custom API integrations".

STEP 2: IDENTIFY THE THEME
Select ONE specific concept from the brochure that aligns perfectly with the lead's profile.
Do NOT list out services. Instead, use your knowledge of the brochure to speak their language. For example, if they are an Operations Director, you know Veda builds "ERP Intelligence" and "Workflow Automation". Mentioning "scaling operations" or "process bottlenecks" signals you understand their world.

STEP 3: CRAFT THE HOOK
Write the note as a peer. ${context.yourName} is a senior expert from Veda AI Lab (which has 15+ years experience, 200+ projects). Sound like a practitioner, not a salesperson.

STRICT RULES (BREAKING THESE IS A FAILURE):
1. MAIN INTENTION: Your goal is PURELY to connect and network. DO NOT suggest discussing anything ("let's discuss", "explore how we can"). Just compliment them, share a mutual interest, or state a shared philosophy. Focus entirely on THEM and your shared professional interests.
2. ZERO HARD SELLING: Never mention pricing, never explicitly ask for a meeting on the first note, never bluntly say "we can help you", and never propose exploring solutions.
3. NO CLICHÉS: Never use "I came across your profile", "I noticed", "I'd love to connect", "As a fellow professional", "Great to see".
4. SUBTLETY: If you reference a success story, do it subtly. (e.g., "Been exploring how agencies are cutting manual work by 120hrs/mo..." rather than "We saved an agency 120hrs").
5. FORMAT: Open with "Hi [FirstName]," and deliver the hook immediately. Make sure you mention any relevant previous interactions naturally in the DM if applicable.
6. LENGTH: Absolute constraint - must be under 280 characters (NOT words).
7. OUTPUT FORMAT: Output ONLY the message text. Do NOT include any explanations, brackets, notes, or metadata.
8. INFORMAL TONE: Write extremely naturally. Use contractions (I'm, you're). Don't be stiff or overly formal. Speak like a human grabbing coffee with a peer.
9. CLOSING: ALWAYS end the note smoothly with "Would love to connect!" or a very similar casual phrase that flows in perfect synergy with your sentence.

Write the connection note now:`;

  const rawNote = await generateWithOllama(prompt, settings, {
    maxTokens: 150,
    temperature: 0.85,
  });

  let cleaned = rawNote
    .trim()
    .replace(/^["""''`]+|["""''`]+$/g, "")                              
    .replace(/^(note|connection note|here('s| is)|linkedin note)\s*[:\-]?\s*/i, "")
    .replace(/\r?\n/g, " ")                                             
    .replace(/\s{2,}/g, " ")                                           
    .trim();

  logActivity("ai_connection_note_generated", "ai", {
    leadName: `${profile.firstName} ${profile.lastName}`,
    noteLength: cleaned.length,
  });

  console.log("=== AI Generated Connection Note (Raw) ===");
  console.log(rawNote);
  console.log("=== AI Generated Connection Note (Cleaned) ===");
  console.log(cleaned);
  console.log("============================================");

  return cleaned;
}
