import type { AppSettings, LinkedInProfile } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { getDatabase, logActivity } from "../../storage/database";
import { caseStudies } from "./caseStudies";

/**
 * Generate a chatbot reply for LinkedIn DMs.
 *
 * This uses the full narrative text of the Veda AI Lab Partnership Brochure 
 * (injected by the client via VEDA_CONTEXT) to craft hyper-relevant responses.
 */
export async function generateChatbotReply(
  profile: LinkedInProfile,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  context: {
    yourName: string;
    yourCompany: string;
    yourServices: string;
    objective: "build_rapport" | "share_value" | "suggest_meeting" | "book_appointment";
  },
  settings: AppSettings["ai"],
): Promise<string> {
  const firstName = profile.firstName || "there";
  const role = profile.role || profile.headline || "professional";
  const company = profile.company || "your company";
  const assistantMsgCount = conversationHistory.filter(m => m.role === "assistant").length + 1;
  const randomCaseStudy = caseStudies[Math.floor(Math.random() * caseStudies.length)];

  const historyText = conversationHistory.length > 0
    ? conversationHistory
        .map((m) => `${m.role === "user" ? firstName : context.yourName}: ${m.content}`)
        .join("\n")
    : "(Fresh thread — no prior messages. This is your opening message.)";

  const objectiveInstructions: Record<string, string> = {
    build_rapport:
      `OBJECTIVE: BUILD RAPPORT
1. Start by warmly appreciating them for connecting (e.g., "Great to connect with you!", "Thanks for accepting my connection!").
2. Write a crisp, conversational opening message to ${firstName} at ${company}.
3. USE THE CONTEXT: Actively analyze their LEAD PROFILE and the CONVERSATION SO FAR. Use your Veda AI Lab knowledge invisibly as a framework to form a highly intelligent, tailored question about their specific industry/role.
4. DO NOT pitch your product or mention your solutions. DO NOT say "we solve this" or "our work with similar organizations". Your intent is purely networking and learning.
5. Ask how their organization works, how they handle their specific role so effectively, or what kind of unique difficulties they face.
6. CLOSING CTA: Explicitly express your desire to learn from them with a casual phrase similar to: "I'd love to hear your thoughts so we can exchange knowledge" or "It would be great to learn from your experience." Keep the total message under 3-4 sentences.`,

    share_value:
      `OBJECTIVE: SHARE VALUE
1. ${firstName} has engaged. Now demonstrate precise expertise.
2. Search the "PROVEN SUCCESS STORIES (ANONYMIZED)" section of the brochure.
3. Pick the ONE specific result that matches their role/industry the best (e.g., 40% cost reduction in manufacturing, 120 hours per month saved in e-commerce, 65% faster contract reviews in legal).
4. Present this result in 1 sentence as a concrete proof point.
5. Ask if this type of outcome would be valuable in their current environment.
6. Keep it to 2-3 sentences, no fluff.`,

    suggest_meeting:
      `OBJECTIVE: SUGGEST MEETING
1. ${firstName} is interested. Convert interest into a booked call.
2. Propose a 15-minute discovery call using the "ENGAGEMENT PROCESS" principles: "Free Scoping" and "No Commitment".
3. Frame it as exploring if there's relevant overlap between their challenges and our delivery capabilities (prototypes in 5 to 7 days).
4. Offer specific time options or a Calendly link.
5. If they are in a highly regulated industry, briefly mention your credentials from the company overview: NDA-first, SOC 2 Type II, HIPAA compliant.
6. Be confident and direct. 2 sentences maximum.`,

    book_appointment:
      `OBJECTIVE: BOOK APPOINTMENT
1. ${firstName} has expressed clear interest. This is the booking close.
2. Confirm you're sending them a calendar link and ask them to pick a slot.
3. Express genuine enthusiasm.
4. Briefly mention that you'll discuss how a pilot can be deployed in 5 to 7 days.
5. 2 sentences maximum.`,

    follow_up_1:
      `OBJECTIVE: GENTLE REMINDER (3 DAYS LATER)
1. It has been 3 days since your last message with no reply.
2. Send a gentle, professional bump referencing your previous message.
3. To showcase expertise and build community, naturally weave in a very brief mention of this success story: "${randomCaseStudy}".
4. Do NOT copy it word-for-word. Adapt its core outcome to fit a natural conversational flow.
5. Keep it to 2 short sentences. Do NOT be pushy.`,

    follow_up_2:
      `OBJECTIVE: SECOND REMINDER (6 DAYS LATER)
1. It has been 6 days since the first reminder with no reply.
2. Provide a tiny piece of additional value to reignite interest and foster a community of shared interests.
3. Integrate a brief insight from this randomly selected case study: "${randomCaseStudy}".
4. Extract its core metric/outcome and present it seamlessly as a proof point of what's possible.
5. Ask a low-friction question. Keep it under 3 sentences.`,

    follow_up_3:
      `OBJECTIVE: FINAL REMINDER (9 DAYS LATER)
1. This is the final attempt after 9 days.
2. Gracefully close the loop. Tell them you won't bother them further but remain available if things change.
3. Leave them with one final brief thought from this case study: "${randomCaseStudy}" to showcase your expertise for the future. Keep it natural and do not copy word-for-word.
4. Keep it under 3 sentences. Sound professional and polite.`
  };

  const urgencyNote = assistantMsgCount >= 4
    ? `\n⚠ CRITICAL: This is message ${assistantMsgCount} in this conversation. ` +
      `You have AT MOST 1 more message after this to book the meeting. ` +
      `Stop building rapport. Stop sharing value. ASK FOR THE MEETING NOW. ` +
      `Directly offer a specific time slot or Calendly link.`
    : "";

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
    `- Name: ${firstName} ${profile.lastName || ""}`,
    `- Role: ${role}`,
    `- Company: ${company}`,
    profile.location ? `- Location: ${profile.location}` : null,
    profile.about ? `- About: ${profile.about}` : null,
    profile.skills?.length ? `- Key skills: ${profile.skills.join(', ')}` : null,
    profile.experience?.length ? `- Experience: ${profile.experience.map(e => `${e.title} at ${e.company}`).join(', ')}` : null,
    profile.education?.length ? `- Education: ${profile.education.map(e => `${e.degree} from ${e.school}`).join(', ')}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are ${context.yourName}, representing ${context.yourCompany || 'Veda AI Lab'}.

=== SENDER IDENTITY & CONTEXT ===
- Name: ${context.yourName}
- Company: ${context.yourCompany || 'Veda AI Lab'}
- Services: ${context.yourServices || 'White-label AI Agents, Chatbots, Workflow Automation, Self-Hosted LLMs, ERP Intelligence'}

=== LEAD PROFILE ===
${contextBlock}

=== PREVIOUS INTERACTIONS WITH THIS LEAD ===
${previousInteractions}

=== CONVERSATION SO FAR ===
${historyText}

=== FULL TASK INSTRUCTIONS ===
The system has provided you with the COMPLETE narrative text of the "Veda AI Lab — Partnership Brochure 2026" above.
Your task is to write the next message in this conversation by meticulously analyzing the brochure text and extracting EXACT facts, metrics, and details.

YOUR CURRENT OBJECTIVE:
${objectiveInstructions[context.objective] || objectiveInstructions.suggest_meeting}
${urgencyNote}

STRICT RULES — NEVER VIOLATE THESE:
1. MAIN INTENTION: Your core goal is to build a community, connect, and offer mutual help. Balance this seamlessly with introducing services. If the lead shows buying interest, lean into it; otherwise, maintain a focus on networking and contribution.
2. You are a real person acting as a trusted advisor and community member, NOT a vendor pitching a buyer.
3. FORBIDDEN openers: "Hope this finds you well", "I came across your profile", "Just reaching out".
4. NEVER ask more than one question at a time.
5. ALWAYS be specific to their role and company — no copy-paste feel.
6. If they wrote a short reply like "okay" or "interesting" — treat it as engagement and move to the NEXT objective.
7. If they ask a technical question — answer it briefly using the "VERTICAL EXPERTISE & ECOSYSTEM" or specific tech stacks from the brochure.
8. If they ask about pricing — give the EXACT relevant range from the "PRICING & FLEXIBILITY" section, then gracefully suggest a meeting.
9. NEVER invent capabilities, metrics, or pricing not explicitly stated in the provided brochure text.
10. Naturally mention what is already done with the lead from the PREVIOUS INTERACTIONS section where appropriate.
11. Output ONLY the message text. Zero labels, zero preamble, zero quotes around it.

Write the exact LinkedIn DM now:`;

  const reply = await generateWithOllama(prompt, settings, {
    maxTokens: 200,
    temperature: 0.72,
    useFallbackModel: false,
  });

  const cleaned = reply
    .replace(/^["""'''`]+|["""'''`]+$/g, "")
    .replace(/^(message|reply|response|dm|linkedin dm|here'?s?(?: (?:the|your|my|a))?)\s*[:\-]?\s*/i, "")
    .replace(/^(Sure,|Absolutely,|Of course,|Great,|Certainly,|Happy to,)\s*/i, "")
    .replace(/^\*\*[^*]+\*\*:?\s*/, "")
    .trim();

  logActivity("ai_chatbot_reply_generated", "ai", {
    leadName: `${profile.firstName} ${profile.lastName}`,
    objective: context.objective,
    assistantMessageCount: assistantMsgCount,
    replyLength: cleaned.length,
  });

  return cleaned;
}
