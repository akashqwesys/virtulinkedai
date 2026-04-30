import type { AppSettings } from "../../../shared/types";
import { generateWithOllama } from "./client";
import { logActivity } from "../../storage/database";

/**
 * Generate a comment for engagement on LinkedIn posts.
 *
 * This uses the full narrative text of the Veda AI Lab Partnership Brochure 
 * (injected by the client via VEDA_CONTEXT) to craft practitioner-level comments.
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

=== TARGET POST ===
AUTHOR: ${authorName}
CONTENT: ${postContent.substring(0, 500)}

=== SENDER IDENTITY ===
- Name: ${context.yourName}
- Company: ${context.yourCompany || 'Veda AI Lab'}
- Expertise: ${context.yourExpertise || 'White-label AI R&D, Agentic Workflows, LLM Infrastructure'}

=== FULL TASK INSTRUCTIONS ===
The system has provided you with the COMPLETE narrative text of the "Veda AI Lab — Partnership Brochure 2026" above.
Your task is to write a LinkedIn comment on the Target Post by analyzing the brochure text to extract your technical expertise.

COMMENT STRATEGY & ALGORITHM:
1. Identify the core topic of the Target Post.
2. Scan the "VERTICAL EXPERTISE & ECOSYSTEM" and "THE VEDA TEAM" sections of the brochure to identify the exact technology stacks (e.g., LangChain, vLLM, ElevenLabs, n8n, Supabase) that relate to the post's topic.
3. Scan the "PROVEN SUCCESS STORIES (ANONYMIZED)" and "CORE SERVICES & METRICS" sections to find a concrete metric or practical outcome you have achieved related to the post's topic (e.g., "we recently deployed a pipeline that cut 120 hours per month").
4. Write a comment that builds on the author's point, adding your perspective as a practitioner who actually builds these systems daily.
5. IF the post is about AI/LLMs: reference RAG, agentic workflows, or fine-tuning (LoRA).
6. IF the post is about Automation: reference CRM-ERP bi-directional sync or 99% extraction accuracy pipelines.
7. IF the post is about Compliance/Security: reference SOC 2 Type II, HIPAA, or air-gapped deployments.

STRICT RULES:
1. MAIN INTENTION: Your goal is to build community, connect, and help by contributing valuable insights. Balance technical expertise with a collaborative, networking-focused approach.
2. Be genuinely insightful — add value to the conversation with a specific perspective.
3. 2-3 sentences minimum (not generic "Great post!" comments).
4. Sound like a senior engineer/architect who builds these systems daily, not a marketer promoting them.
5. ZERO promotional language — never mention your company name, services, pricing, or CTAs.
6. NEVER invent technical capabilities or metrics not explicitly stated in the provided brochure text.
7. Only output the comment text, nothing else. No emojis except 1-2 maximum.

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

  return comment.replace(/^['"]|['"]$/g, "").trim();
}
