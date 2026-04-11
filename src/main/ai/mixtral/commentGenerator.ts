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
    yourExpertise: string;
  },
  settings: AppSettings["ai"],
): Promise<string> {
  const prompt = `Write a thoughtful LinkedIn comment on this post.

POST BY: ${authorName}
POST CONTENT: ${postContent.substring(0, 500)}

YOUR CONTEXT: You are ${context.yourName}, with expertise in ${context.yourExpertise}

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
