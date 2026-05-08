import type { AppSettings, LinkedInProfile } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { logActivity } from "../../storage/database";
import { VEDA_CONTEXT } from "./brochureContext";

/**
 * Generate a personalized LinkedIn InMail
 *
 * This generates a subject and a body for a direct InMail message.
 */
export async function generateInMail(
  profile: LinkedInProfile,
  context: {
    yourName: string;
    yourCompany: string;
    yourServices: string;
    yourVision?: string;
    objective?: string;
  },
  settings: AppSettings["ai"],
): Promise<{ subject: string; body: string }> {
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

  const prompt = `You are writing a highly personalized, professional LinkedIn InMail on behalf of ${context.yourName} from ${context.yourCompany || 'Veda AI Lab LLC'}.

=== SENDER IDENTITY & CONTEXT ===
- Name: ${context.yourName}
- Company: ${context.yourCompany || 'Veda AI Lab LLC'}
- Services: ${context.yourServices || 'White-label AI Agents, Chatbots, Workflow Automation, Self-Hosted LLMs, ERP Intelligence'}
- Vision: ${context.yourVision || 'To build a strong community of innovators and empower businesses with seamless, invisible AI solutions.'}
- Specific Objective: ${context.objective || 'Networking and knowledge sharing'}

=== VEDA AI LAB LLC KNOWLEDGE BASE ===
${VEDA_CONTEXT}

=== RECIPIENT PROFILE ===
${contextBlock}

=== FULL TASK INSTRUCTIONS ===
Your task is to write a LinkedIn InMail (Subject + Body) to this lead. An InMail is used to message someone you are NOT connected with.

STRATEGY & ALGORITHM:
1. SUBJECT LINE: Must be catchy, concise (under 50 characters), and highly relevant to their specific profile or the objective.
2. OPENING: Express that their LinkedIn profile genuinely impressed you. Reference SPECIFIC details from their profile (role, company, achievements) to show you've paid close attention.
3. VALUE / CURIOSITY: The dominant tone should be curiosity or a specific value proposition related to the objective. Use the provided VEDA knowledge invisibly as a framework to formulate an intelligent, thoughtful point — but do not make it a hard sell.
4. CALL TO ACTION: End with a soft call to action (e.g., a quick chat, exchanging thoughts, or simply connecting).
5. LENGTH: Your response MUST be concise. Use a maximum of 4-5 sentences and ensure the total length is approximately 7-8 lines. Keep it very easy to read at a glance.
6. FORMAT: 
   - LinkedIn InMails should be punchy and readable. Use short paragraphs.
   - Do NOT include placeholders like [Your Name]. Use the sender identity provided.

Format output EXACTLY as:
SUBJECT: [subject line]
BODY: [email body]

Write the InMail:`;

  const response = await generateWithOllama(prompt, settings, {
    maxTokens: 1000,
    temperature: 0.7,
  });

  const subjectMatch = response.match(/SUBJECT:\s*(.+?)(?:\n|BODY:)/s);
  const bodyMatch = response.match(/BODY:\s*([\s\S]+)/s);

  const subject =
    subjectMatch?.[1]?.trim() || `Connecting with ${profile.firstName}`;
  const body = bodyMatch?.[1]?.trim() || response;

  logActivity("ai_inmail_generated", "ai", {
    leadName: `${profile.firstName} ${profile.lastName}`,
    subjectLength: subject.length,
    bodyLength: body.length,
  });

  return { subject, body };
}
