import type { AppSettings } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { logActivity } from "../../storage/database";

/**
 * Generate a comment for engagement
 */
export async function generatePostComment(
  postContent: string,
  authorName: string,
  context: {
    yourName: string;
    yourCompany?: string;
    yourExpertise: string;
  },
  settings: AppSettings["ai"],
): Promise<string> {
  const prompt = `Write a thoughtful LinkedIn comment on this post.

POST BY: ${authorName}
POST CONTENT: ${postContent.substring(0, 500)}

YOUR CONTEXT: You are ${context.yourName}, representing ${context.yourCompany || 'Veda AI Lab'} — a white-label AI R&D partner for agencies delivering AI agents, chatbots, automation, voice AI, self-hosted LLMs, and ERP intelligence.

KNOWLEDGE BASE GUIDANCE:
- Draw from SECTION 5 (Technical Ecosystem) and SECTION 4 (Services) to demonstrate genuine domain expertise relevant to the post.
- Reference specific integrations or tech stack items that match the post's topic (e.g., mention LangChain if the post is about AI, or n8n if it's about automation).
- If the post touches on ERP, automation, AI, compliance, or sales — draw from the matching service sub-capability to add a concrete insight.
- Sound like a practitioner building these systems, not a marketer promoting them. Zero promotional language.

RULES:
1. Be genuinely insightful - add value to the conversation
2. 2-3 sentences minimum (not generic "Great post!" comments)
3. Reference a specific point from the post
4. Add your perspective or a related insight
5. Sound natural and knowledgeable, not generic
6. No emojis except 1-2 maximum if natural
7. Only output the comment text, nothing else

Your comment:`;

  const comment = await generateWithOllama(prompt, settings, {
    maxTokens: 200,
    temperature: 0.8,
    useFallbackModel: true, // Use faster model for comments
  });

  logActivity("ai_comment_generated", "ai", {
    authorName,
    commentLength: comment.length,
  });

  return comment.replace(/^["']|["']$/g, "").trim();
}
