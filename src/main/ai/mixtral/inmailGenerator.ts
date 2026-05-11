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
1. SUBJECT LINE: Must be catchy, concise (under 50 characters), and focused on networking/connecting.
2. OPENING: Express that their LinkedIn profile genuinely impressed you. Reference SPECIFIC details from their profile (role, company, achievements) to show you've paid close attention.
3. RELATIONSHIP FIRST (NO SELLING): The dominant tone must be purely for networking and mutual connection. UNDER NO CIRCUMSTANCES should you pitch a product, offer a service, or ask for a sales call.
4. AI CONTEXT: Introduce yourself as someone in the AI space (Veda AI Lab) who loves connecting with forward-thinking professionals. Use the VEDA knowledge invisibly to establish common ground, not to sell.
5. CALL TO ACTION: End with a polite request to connect and share insights. Do not ask for a meeting.
6. LENGTH: Your response MUST be concise. Use a maximum of 3-4 sentences and ensure the total length is approximately 6-7 lines. Keep it very easy to read at a glance.
7. FORMAT: 
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
