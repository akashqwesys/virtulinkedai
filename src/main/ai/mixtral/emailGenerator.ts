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
- Company: ${context.yourCompany}
- Services: ${context.yourServices}

EMAIL TYPE: ${context.emailType}
${typeInstructions[context.emailType]}

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
