import type { AppSettings, LinkedInProfile } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { getDatabase, logActivity } from "../../storage/database";
import { caseStudies } from "./caseStudies";

/**
 * Generate a personalized outreach email
 *
 * This uses the full narrative text of the Veda AI Lab Partnership Brochure 
 * (injected by the client via VEDA_CONTEXT) to craft hyper-relevant emails.
 */
export async function generatePersonalizedEmail(
  profile: LinkedInProfile,
  context: {
    yourName: string;
    yourCompany: string;
    yourServices: string;
    yourVision?: string;
    yourLinkedinUrl?: string;
    emailType: "intro" | "follow_up" | "welcome" | "meeting_confirm" | "thank_you";
  },
  settings: AppSettings["ai"],
): Promise<{ subject: string; body: string }> {
  const randomCaseStudy = caseStudies[Math.floor(Math.random() * caseStudies.length)];

  const typeInstructions: Record<string, string> = {
    intro: `EMAIL TYPE: INITIAL OUTREACH (INTRO)
Your goal is to establish a genuine connection, build community, and spark interest.
STRATEGY & ALGORITHM:
1. Scan the full brochure for the exact Service Category in the "CORE SERVICES & METRICS" section most relevant to their role/industry.
2. Open the email by referencing something specific about their role, company, or industry challenge — prioritize building a human connection.
3. Introduce ${context.yourCompany || 'Veda AI Lab'} by positioning it as a white-label AI R&D partner that functions as an invisible AI division.
4. Describe a concrete outcome from the brochure that solves their challenge (e.g., use EXACT metrics from the text: "5x lead velocity", "60% faster ticket resolution", or "20% to 35% overstock reduction").
5. Draw from "THE INVISIBLE PARTNERSHIP MODEL" section: emphasize "free scoping", "prototypes in 5 to 7 days", and "full intellectual property transfer" to reduce perceived risk.
6. Share your vision and a brief detail about your profile at the end of the email to foster community.
7. Include your direct LinkedIn URL so they can connect with you.
8. Format: Write in a very effective, compelling manner. There are no length limits.`,

    follow_up: `EMAIL TYPE: FOLLOW-UP
Your goal is to add new value, build a strong community connection, and follow up without being pushy.
STRATEGY & ALGORITHM:
1. Do NOT re-introduce yourself or repeat the first email.
2. Lead with a VALUE-ADD: Share a specific insight or anonymized result.
3. We have randomly selected the following case study to showcase our expertise:
"${randomCaseStudy}"
4. INTEGRATE THE CASE STUDY: Do NOT copy the case study word-for-word. Instead, adapt its core metric and outcome naturally into the flow of your email. Present it as a brief proof point of what's possible, aligning perfectly with the email's intention to build a community of people with shared interests in innovation.
5. Emphasize that the goal is exploring mutual synergies and learning from each other.
6. Conclude by sharing your vision, a brief detail about your profile, and your direct LinkedIn URL to encourage them to join your network.
7. Format: Write in a very effective, compelling manner. There are no length limits.`,

    welcome: `EMAIL TYPE: POST-CONNECTION WELCOME
Your goal is to build a lasting community relationship and convert a new connection into a 15-minute discovery call.
STRATEGY & ALGORITHM:
1. Thank them warmly for connecting.
2. Reinforce credibility by referencing a capability relevant to their domain from the "CORE SERVICES & METRICS" section.
3. Reference low-risk entry points ("free scoping call", "no large upfront commitments", "prototypes in 5 to 7 days").
4. Suggest a 15-minute discovery call to explore mutual synergies.
5. IF in a compliance-sensitive industry, mention: NDA-first, SOC 2 Type II, ISO 27001, HIPAA compliant.
6. End the email by sharing your vision, a brief detail about your profile, and your direct LinkedIn URL.
7. Format: Write in a very effective, compelling manner. There are no length limits.`,

    meeting_confirm: `EMAIL TYPE: MEETING CONFIRMATION
Your goal is to set expectations, build anticipation, and solidify the community connection.
STRATEGY & ALGORITHM:
1. Confirm the meeting time, duration (15 minutes), and format.
2. Share a brief 3-point agenda based on what's most relevant to their role.
3. Agenda Point 1: Understanding their current challenges.
4. Agenda Point 2: Walking through a relevant case study (pick the closest match from "PROVEN SUCCESS STORIES").
5. Agenda Point 3: Discussing the no-risk pilot approach (prototypes in 5 to 7 days, free scoping).
6. IF relevant, reference pricing ranges from the "PRICING & FLEXIBILITY" section.
7. End the email by sharing your vision, a brief detail about your profile, and your direct LinkedIn URL.
8. Format: Write in a very effective, compelling manner. There are no length limits.`,

    thank_you: `EMAIL TYPE: THANK YOU / CLOSING
Your goal is to graciously conclude the conversation if a deal was not reached, leaving a positive, lasting impression and an open door for future collaboration.
STRATEGY & ALGORITHM:
1. Express genuine gratitude for the time spent sharing thoughts, ideas, and exploring synergies with each other.
2. Carefully reference the specific topics discussed and things communicated with the lead so far (use the PREVIOUS INTERACTIONS section to find exact topics).
3. Frame the outcome positively: even if a deal didn't happen right now, emphasize the value of the connection made.
4. Conclude by briefly sharing about your company (${context.yourCompany || 'Veda AI Lab'}) and your vision. Offer to stay connected in the future if they ever need help or want to bounce ideas around.
5. End the email by giving brief details about your profile and providing your direct LinkedIn URL to encourage a continued community connection.
6. Format: Write in a very effective, compelling, and warm manner. There are no length limits.`,
  };

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
    `- Name: ${profile.firstName} ${profile.lastName}`,
    `- Headline: ${profile.headline}`,
    `- Company: ${profile.company}`,
    `- Role: ${profile.role}`,
    profile.location ? `- Location: ${profile.location}` : null,
    profile.about ? `- About: ${profile.about}` : null,
    profile.skills?.length ? `- Key skills: ${profile.skills.join(', ')}` : null,
    profile.experience?.length ? `- Experience: ${profile.experience.map(e => `${e.title} at ${e.company}`).join(', ')}` : null,
    profile.education?.length ? `- Education: ${profile.education.map(e => `${e.degree} from ${e.school}`).join(', ')}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are writing a professional but warm email for LinkedIn outreach on behalf of ${context.yourName} from ${context.yourCompany || 'Veda AI Lab'}.

=== SENDER IDENTITY & CONTEXT ===
- Name: ${context.yourName}
- Company: ${context.yourCompany || 'Veda AI Lab'}
- Services: ${context.yourServices || 'White-label AI Agents, Chatbots, Workflow Automation, Self-Hosted LLMs, ERP Intelligence'}
- Vision: ${context.yourVision || 'To build a strong community of innovators and empower businesses with seamless, invisible AI solutions.'}
- LinkedIn URL: ${context.yourLinkedinUrl || 'https://www.linkedin.com/in/your-profile'}

=== RECIPIENT PROFILE ===
${contextBlock}

=== PREVIOUS INTERACTIONS WITH THIS LEAD ===
${previousInteractions}

=== FULL TASK INSTRUCTIONS ===
The system has provided you with the COMPLETE narrative text of the "Veda AI Lab — Partnership Brochure 2026" above.
Your task is to write an email to this lead by meticulously analyzing the brochure text, incorporating the recipient's profile, and referencing the PREVIOUS INTERACTIONS (e.g., acknowledging that a connection request was just sent or a message was exchanged).

${typeInstructions[context.emailType]}

RULES:
1. MAIN INTENTION: Your primary goal is to build a community, foster connections, and offer mutual help. Balance this networking approach with service value. If the lead has shown interest in buying, reflect that intent gracefully.
2. NO LENGTH LIMITS: Write in a very effective and compelling manner. Take as much space as needed to deliver maximum value and build a strong connection.
3. INCLUSIVE CONTEXT: Actively weave in the recipient's profile details, the Veda AI Lab brochure info, and all previously done interactions to make the email hyper-contextual.
4. Write both a subject line and body.
5. Sound genuine, human, and peer-to-peer — avoid aggressive sales templates.
6. Reference specific details about their work/company.
7. NEVER invent capabilities, metrics, or pricing not explicitly stated in the provided brochure text.
8. SIGNATURE BLOCK: End EVERY email EXACTLY like this:
   "Best regards,
   ${context.yourName}
   ${context.yourCompany}
   Connect with me here: ${context.yourLinkedinUrl}"
9. Format output EXACTLY as:
SUBJECT: [subject line]
BODY: [email body]

Write the email:`;

  const response = await generateWithOllama(prompt, settings, {
    maxTokens: 1500,
    temperature: 0.75,
  });

  const subjectMatch = response.match(/SUBJECT:\s*(.+?)(?:\n|BODY:)/s);
  const bodyMatch = response.match(/BODY:\s*([\s\S]+)/s);

  const subject =
    subjectMatch?.[1]?.trim() || `Quick note from ${context.yourName}`;
  const body = bodyMatch?.[1]?.trim() || response;

  logActivity("ai_email_generated", "ai", {
    leadName: `${profile.firstName} ${profile.lastName}`,
    emailType: context.emailType,
    subjectLength: subject.length,
    bodyLength: body.length,
  });

  return { subject, body };
}
