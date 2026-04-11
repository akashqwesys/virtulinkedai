import type { AppSettings, LinkedInProfile } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { logActivity } from "../../storage/database";

/**
 * Generate a chatbot reply for LinkedIn DMs
 */
export async function generateChatbotReply(
  profile: LinkedInProfile,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  context: {
    yourName: string;
    yourCompany: string;
    yourServices: string;
    objective: "build_rapport" | "share_value" | "suggest_meeting";
  },
  settings: AppSettings["ai"],
): Promise<string> {
  const historyText = conversationHistory
    .map(
      (m) => `${m.role === "user" ? profile.firstName : "You"}: ${m.content}`,
    )
    .join("\n");

  const objectiveInstructions: Record<string, string> = {
    build_rapport:
      "Build rapport and show genuine interest in their work. Ask a thoughtful question.",
    share_value:
      "Share a relevant insight about their industry or how your services could help.",
    suggest_meeting:
      "Naturally suggest a quick 15-minute call. Offer to send a calendar link.",
  };

  const prompt = `You are having a LinkedIn DM conversation. Reply naturally as a human would.

ABOUT THEM: ${profile.firstName} ${profile.lastName}, ${profile.role} at ${profile.company}
ABOUT YOU: ${context.yourName} from ${context.yourCompany} (Services: ${context.yourServices})

CONVERSATION SO FAR:
${historyText}

YOUR OBJECTIVE: ${objectiveInstructions[context.objective]}

RULES:
1. Keep reply SHORT (1-3 sentences max)
2. Sound completely natural and human
3. Don't be salesy or pitch directly
4. Match their communication style (formal/casual)
5. If they seem interested, push gently toward a meeting
6. If they seem hesitant, back off gracefully
7. Only output the reply message, nothing else

Your reply:`;

  const reply = await generateWithOllama(prompt, settings, {
    maxTokens: 150,
    temperature: 0.8,
    useFallbackModel: false,
  });

  logActivity("ai_chatbot_reply_generated", "ai", {
    leadName: `${profile.firstName} ${profile.lastName}`,
    objective: context.objective,
    replyLength: reply.length,
  });

  return reply.replace(/^["']|["']$/g, "").trim();
}
