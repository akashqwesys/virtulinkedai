import type { AppSettings, LinkedInProfile } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { getDatabase, logActivity } from "../../storage/database";

/**
 * Generate a personalized outreach email
 *
 * This uses the full narrative text of the Veda AI Lab LLC Partnership Brochure 
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
  // Compute a specific meeting day: 2 weekdays from today, skipping weekends
  const getMeetingDay = (): string => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const date = new Date();
    let added = 0;
    while (added < 2) {
      date.setDate(date.getDate() + 1);
      const dow = date.getDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return days[date.getDay()];
  };
  const suggestedMeetingDay = getMeetingDay();

  const typeInstructions: Record<string, string> = {
    intro: `EMAIL TYPE: INITIAL OUTREACH (INTRO)
Your goal is purely networking and establishing a genuine, curiosity-driven connection. There must be NO intention of selling a product or pitching services.
STRATEGY & ALGORITHM:
1. Open the email by mentioning that you have sent them a connection request on LinkedIn. DO NOT mention any timeline or date of when the request was sent (e.g., never say "yesterday", "a few days ago", "last week", etc.). Simply state it as a fact: "I've sent you a connection request on LinkedIn."
2. Express that their LinkedIn profile genuinely impressed and inspired you. Reference SPECIFIC details from their profile (role, company, achievements, or experience) to show you've paid close attention — make it feel personal, not generic.
3. Lead with curiosity: The dominant tone of this email should be that you are excited and curious to connect with them. You want to understand how they think, learn from their journey, and exchange ideas. This is NOT a sales email — it is a "I found your profile fascinating and want to connect as peers" email.
4. Use the PREVIOUS INTERACTIONS section ONLY as invisible context to maintain continuity of tone. DO NOT quote, reference, or name the previous connection note message. DO NOT say "my previous message was..." or mention the subject/title of any prior note. Simply let the spirit of that note naturally flow into this email.
5. Use the provided VEDA brochure context invisibly as a framework to formulate one intelligent, thoughtful question or reflection about their specific industry or challenges — but DO NOT pitch your company's services in any way.
6. Close by including your LinkedIn URL and warmly encouraging them to accept the request so the conversation can continue.
7. Format: Write in a warm, human, peer-to-peer, and strictly networking-focused manner. The email should feel like it comes from someone genuinely excited to meet a new professional peer — not a salesperson. Do not include any sales metrics, prototypes, or scoping offers. There are no length limits.`,

    follow_up: `EMAIL TYPE: FOLLOW-UP (NO REPLY AFTER 3 DAYS)
Your goal is purely networking and learning. There must be NO intention of selling a product or pitching services.
STRATEGY & ALGORITHM:
1. Open the email by mentioning that you sent a connection request a few days ago and are following up.
2. State clearly that your purpose for connecting is purely for networking, building a connection, learning more about their professional journey, and understanding the difficulties they face in their industry to increase mutual knowledge.
3. Reiterate that you were genuinely impressed by their profile (reference specific details from the PREVIOUS INTERACTIONS or their profile) and that is why you want to connect and talk to them.
4. Add a paragraph discussing current AI trends: Mention that in the era of AI, everything is planned through AI without needing humans to intervene. Express that you are planning to guide your models/company in a way where your model can mimic human behavior organically, and as you came across their profile, you found out that it will be mutually beneficial for both parties to exchange valuable knowledge with each other.
5. Emphasize that you just want to exchange ideas. Use the provided VEDA brochure context invisibly to inform your perspective on AI trends, but DO NOT pitch or sell any of your company's services.
6. Conclude by including your direct LinkedIn URL and encouraging them to join your network.
7. Format: Write in a warm, human, and strictly networking-focused manner. Do not include any sales metrics. There are no length limits.`,

    welcome: `EMAIL TYPE: POST-CONNECTION THANK YOU (WELCOME)
Your goal is to build a lasting community relationship immediately after they accept your connection request.
STRATEGY & ALGORITHM:
1. Start by warmly appreciating them for connecting on LinkedIn.
2. DO NOT pitch your product or mention your solutions. DO NOT say "we solve this" or "our work with similar organizations". Your intent is purely networking and learning.
3. Actively analyze their LEAD PROFILE. Use your Veda AI Lab LLC knowledge invisibly as a framework to form a highly intelligent, tailored question about their specific industry/role.
4. Ask how their organization works, how they handle their specific role so effectively, or what kind of unique difficulties they face.
5. Explicitly express your desire to learn from them with a phrase similar to: "I'd love to hear your thoughts so we can exchange knowledge" or "It would be great to learn from your experience."
6. CALL TO ACTION (MEETING): Propose a casual meeting to discuss this further. Ask if they are available for a brief call or Teams meeting on ${suggestedMeetingDay} to exchange ideas. Use ONLY this specific day name — do NOT substitute a different day. Add a friendly, low-pressure note saying that if they are interested but ${suggestedMeetingDay} doesn't work, they can simply reply and you can connect at their convenience.`,

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

    thank_you: `EMAIL TYPE: LAST FOLLOW-UP / CLOSING
Your goal is to make a final attempt to connect with an unresponsive lead while introducing your company in a helpful, non-pushy way.
STRATEGY & ALGORITHM:
1. Open the email by mentioning that you have already tried to connect with them a few times and acknowledge that they must be very busy.
2. Reiterate that you are very curious about their work after seeing their profile, and you want to share knowledge and communicate about a few things.
3. Ask them to connect whenever they are free, either on LinkedIn (mention you already sent a request and share your direct LinkedIn URL) or by replying here on email.
4. Briefly introduce your company (${context.yourCompany || 'Veda AI Lab LLC'}) and succinctly pitch a few products/services that align perfectly with their work. Use the provided VEDA brochure context and LEAD PROFILE to select the most relevant products.
5. Emphasize that gaining knowledge from their experience would be really helpful in improving your products and growing your overall company.
6. State clearly that you would definitely like to talk, gain knowledge, and share valuable insights with each other. Look forward to a positive response.
7. Format: Write in a warm, human, and compelling manner. There are no length limits.`,
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

  const prompt = `You are writing a professional but warm email for LinkedIn outreach on behalf of ${context.yourName} from ${context.yourCompany || 'Veda AI Lab LLC'}.

=== SENDER IDENTITY & CONTEXT ===
- Name: ${context.yourName}
- Company: ${context.yourCompany || 'Veda AI Lab LLC'}
- Services: ${context.yourServices || 'White-label AI Agents, Chatbots, Workflow Automation, Self-Hosted LLMs, ERP Intelligence'}
- Vision: ${context.yourVision || 'To build a strong community of innovators and empower businesses with seamless, invisible AI solutions.'}
- LinkedIn URL: ${context.yourLinkedinUrl || 'https://www.linkedin.com/in/your-profile'}

=== RECIPIENT PROFILE ===
${contextBlock}

=== PREVIOUS INTERACTIONS WITH THIS LEAD ===
${previousInteractions}

=== FULL TASK INSTRUCTIONS ===
The system has provided you with the COMPLETE narrative text of the "Veda AI Lab LLC — Partnership Brochure 2026" above.
Your task is to write an email to this lead by meticulously analyzing the brochure text, incorporating the recipient's profile, and referencing the PREVIOUS INTERACTIONS (e.g., acknowledging that a connection request was just sent or a message was exchanged).

${typeInstructions[context.emailType]}

RULES:
1. MAIN INTENTION: Your primary goal is to build a community, foster connections, and offer mutual help. Balance this networking approach with service value. If the lead has shown interest in buying, reflect that intent gracefully.
2. NO LENGTH LIMITS: Write in a very effective and compelling manner. Take as much space as needed to deliver maximum value and build a strong connection.
3. INCLUSIVE CONTEXT: Actively weave in the recipient's profile details, the Veda AI Lab LLC brochure info, and all previously done interactions to make the email hyper-contextual.
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
