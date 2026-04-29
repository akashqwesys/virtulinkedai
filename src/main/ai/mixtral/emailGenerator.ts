import type { AppSettings, LinkedInProfile } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { logActivity } from "../../storage/database";

/**
 * Generate a personalized outreach email
 */
export async function generatePersonalizedEmail(
  profile: LinkedInProfile,
  context: {
    yourName: string;
    yourCompany: string;
    yourServices: string;
    emailType: "intro" | "follow_up" | "welcome" | "meeting_confirm";
  },
  settings: AppSettings["ai"],
): Promise<{ subject: string; body: string }> {
  const typeInstructions: Record<string, string> = {
    intro: `This is the FIRST email after sending a connection request. Introduce yourself and your services in a way that directly relates to their work. Show how you can help them specifically.`,
    follow_up: `This is a FOLLOW-UP email sent because they haven't accepted your connection request after 3 days. Be gentle, add more value (share an insight or resource), don't be pushy.`,
    welcome: `This is a WELCOME email sent after they ACCEPTED your connection request. Thank them, reinforce the value you can provide, and subtly suggest a quick call.`,
    meeting_confirm: `This is a MEETING CONFIRMATION email. Confirm the meeting details, share a brief agenda, and express excitement about the conversation.`,
  };

  const prompt = `You are writing a professional but warm email for LinkedIn outreach.

ABOUT THE RECIPIENT:
- Name: ${profile.firstName} ${profile.lastName}
- Headline: ${profile.headline}
- Company: ${profile.company}
- Role: ${profile.role}
- Industry context: ${profile.about?.substring(0, 300) || profile.headline}
- Current experience: ${profile.experience?.[0]?.title || "Unknown"} at ${profile.experience?.[0]?.company || profile.company}

ABOUT THE SENDER:
- Name: ${context.yourName}
- Company: ${context.yourCompany || 'Veda AI Lab'}
- Services: ${context.yourServices || 'White-label AI Agents, Chatbots, Workflow Automation, Self-Hosted LLMs, ERP Intelligence'} (see knowledge base for full details)

EMAIL TYPE: ${context.emailType}
${typeInstructions[context.emailType]}

KNOWLEDGE BASE GUIDANCE (from VEDA AI LAB knowledge base):
- SECTION 4 (Services): Reference the service category that best matches the recipient's company/role. Include a specific metric or outcome (e.g., "35% conversion boost", "99% extraction accuracy", "60% faster ticket resolution").
- SECTION 9 (Success Stories): Include the most industry-relevant case study as a concise proof point. Focus on the outcome only.
- SECTION 3 (Partnership Model): For intro/follow-up emails, emphasize "free scoping", "no commitment", and "rapid delivery" to reduce friction.
- SECTION 11 (Pricing): ONLY reference pricing if email type is 'meeting_confirm'. For all others, avoid pricing entirely.
- SECTION 8 (Security): For compliance-sensitive industries (healthcare, legal, finance, government), reference SOC 2 Type II, ISO 27001, and HIPAA compliance as relevant.

RULES:
1. Write both a subject line and body
2. Keep it concise (3-4 paragraphs max)
3. Sound genuine and human — not like a template
4. Reference specific details about their work/company
5. Include a clear but soft call-to-action
6. Use their first name
7. No excessive flattery or corporate jargon
8. Format output as:
SUBJECT: [subject line]
BODY: [email body]

Write the email:`;

  const response = await generateWithOllama(prompt, settings, {
    maxTokens: 500,
    temperature: 0.7,
  });

  // Parse subject and body
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
