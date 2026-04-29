import type { AppSettings, LinkedInProfile } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { logActivity } from "../../storage/database";

/**
 * Generate a chatbot reply for LinkedIn DMs.
 *
 * Identity : Set by context.yourName and context.yourCompany (e.g. Veda AI Lab)
 * Services : Set by context.yourServices or defaults to AI agents, automation, chatbots.
 * Goal     : Book a 15-min discovery call within 5 messages — no exceptions.
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

  const historyText = conversationHistory.length > 0
    ? conversationHistory
        .map((m) => `${m.role === "user" ? firstName : context.yourName}: ${m.content}`)
        .join("\n")
    : "(Fresh thread — no prior messages. This is your opening message.)";

  // ---- Objective-specific instructions ----
  const objectiveInstructions: Record<string, string> = {
    build_rapport:
      `Write a crisp, specific opening message to ${firstName} at ${company}. ` +
      `Reference a REAL pain point they likely face based on their role as "${role}" — ` +
      `e.g., lead qualification bottlenecks, support ticket backlogs, operational inefficiencies, ` +
      `slow reporting, disconnected CRM/ERP data, or manual repetitive tasks. ` +
      `Subtly signal that ${context.yourCompany || 'your agency'} has solved this exact problem for similar companies. ` +
      `End with an open question that invites them to talk about their current challenges. ` +
      `DO NOT pitch yet. DO NOT mention a meeting yet. Keep it under 3 sentences.`,

    share_value:
      `${firstName} has engaged. Now demonstrate precise expertise. ` +
      `Pick ONE specific result your agency has delivered based on the system context brochure — for example: ` +
      `"reduced month-end close from 7 days to 1 day via automation", ` +
      `"deployed an AI support agent that cut ticket resolution time by 60%", ` +
      `"built an AI reporting layer that eliminated 80% of manual data entry", ` +
      `"cut IT project delivery time by 40% through custom AI solutions". ` +
      `Then ask if this type of outcome would be valuable in their current environment. ` +
      `2-3 sentences, no fluff.`,

    suggest_meeting:
      `${firstName} is interested. Now convert the interest into a booked call. ` +
      `Propose a 15-minute discovery call — frame it as a no-commitment, zero-risk conversation ` +
      `to see if there's relevant overlap between their current challenges and what our agency does. ` +
      `Offer specific time options (e.g., "Does Tuesday or Wednesday afternoon work?") ` +
      `or offer to send a Calendly link immediately. Be confident and direct — not pushy. ` +
      `2 sentences maximum.`,

    book_appointment:
      `${firstName} has expressed clear interest or readiness. This is the booking close. ` +
      `Confirm you're sending them a calendar link and ask them to pick a slot that works. ` +
      `Express genuine enthusiasm about the upcoming conversation. ` +
      `Make it feel like a done deal — the call is happening, just confirm the time. ` +
      `2 sentences maximum.`,
  };

  const urgencyNote = assistantMsgCount >= 4
    ? `\n⚠ CRITICAL: This is message ${assistantMsgCount} in this conversation. ` +
      `You have AT MOST 1 more message after this to book the meeting. ` +
      `Stop building rapport. Stop sharing value. ASK FOR THE MEETING NOW. ` +
      `Directly offer a specific time slot or Calendly link.`
    : "";

  const prompt = `You are ${context.yourName}, representing ${context.yourCompany || 'Veda AI Lab'}. You help mid-market and enterprise businesses scale by delivering:

SERVICES YOU OFFER (From System Context Brochure):
${context.yourServices || '• White-label AI Agents\n• Conversational AI Chatbots\n• Process Optimization & Workflow Automation\n• Self-Hosted LLMs & Enterprise Privacy\n• ERP Intelligence & Forecasting'}

YOUR MISSION IN THIS CONVERSATION:
Book a 15-minute discovery call with ${firstName} within 5 messages. Every single message must move quantifiably closer to that booking. Never go sideways. Never over-explain.

YOU ARE MESSAGING: ${firstName} ${profile.lastName || ""}, ${role} at ${company}.

CONVERSATION SO FAR:
${historyText}

YOUR CURRENT OBJECTIVE:
${objectiveInstructions[context.objective] || objectiveInstructions.suggest_meeting}
${urgencyNote}

KNOWLEDGE BASE GUIDANCE (from VEDA AI LAB knowledge base):
- SECTION 4 (Services): Use the service category most relevant to ${role}'s industry. Reference concrete sub-capabilities and metrics (e.g., "60% faster ticket resolution", "5x lead velocity").
- SECTION 9 (Success Stories): Pull the most matching case study to add credibility. Use industry/outcome without naming the client.
- SECTION 3 (Partnership Model): Use "rapid delivery", "no risk", "free scoping" as soft value signals when building rapport.
- SECTION 11 (Pricing): Only reference pricing if ${firstName} explicitly asks. Focus on outcomes and ROI first.
- SECTION 5 (Tech Stack): If ${firstName} asks a technical question, draw from the matching tech stack to answer briefly and pivot to the call.

STRICT RULES — NEVER VIOLATE THESE:
1. You are ${context.yourName} — a real person. Always sound like it.
2. FORBIDDEN openers: "Hope this finds you well", "I came across your profile", "Just reaching out", "I'd love to connect", "Quick question", "As a fellow professional", "I noticed".
3. FORBIDDEN behaviors: being generic, repeating what you said in a previous message, asking more than one question at a time, writing more than 3 sentences.
4. ALWAYS be specific to their role (${role}) and company (${company}) — no copy-paste feel.
5. B2B peer-to-peer tone: you are a trusted advisor talking to a potential partner, NOT a vendor pitching a buyer.
6. If they wrote a short reply like "okay", "sure", "interesting" — treat it as engagement and move to the NEXT objective immediately.
7. If they ask a technical question — answer it briefly using the knowledge base and pivot to the meeting.
8. Output ONLY the message text. Zero labels, zero preamble, zero quotes around it.

Write the exact LinkedIn DM now:`;

  const reply = await generateWithOllama(prompt, settings, {
    maxTokens: 200,
    temperature: 0.72,
    useFallbackModel: false,
  });

  // Strip AI-added wrapper tokens / common preambles
  const cleaned = reply
    .replace(/^["""'''`]+|["""'''`]+$/g, "")
    .replace(/^(message|reply|response|dm|linkedin dm|here'?s?(?: (?:the|your|my|a))?)\s*[:\-]?\s*/i, "")
    .replace(/^(Sure,|Absolutely,|Of course,|Great,|Certainly,|Happy to,)\s*/i, "")
    .replace(/^\*\*[^*]+\*\*:?\s*/, "") // remove **bold label**:
    .trim();

  logActivity("ai_chatbot_reply_generated", "ai", {
    leadName: `${profile.firstName} ${profile.lastName}`,
    objective: context.objective,
    assistantMessageCount: assistantMsgCount,
    replyLength: cleaned.length,
  });

  return cleaned;
}
