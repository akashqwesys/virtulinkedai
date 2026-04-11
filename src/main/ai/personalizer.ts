/**
 * AI Personalization Engine
 *
 * Re-exports the task-specific AI modules operating against
 * the remote Mixtral 8x7B endpoint.
 */

import type { AppSettings } from "../../shared/types";

// Re-export isolated module functions
export { generateConnectionNote } from "./mixtral/noteGenerator";
export { generatePersonalizedEmail } from "./mixtral/emailGenerator";
export { generateChatbotReply } from "./mixtral/chatbotGenerator";
export { generatePostComment } from "./mixtral/commentGenerator";
export { analyzeSentiment } from "./mixtral/sentimentAnalyzer";
export { parseProfileJson } from "./mixtral/jsonParser";

/**
 * Check Ollama server health and available models
 */
export async function checkAIStatus(settings: AppSettings["ai"]): Promise<{
  online: boolean;
  models: string[];
  error?: string;
}> {
  try {
    const response = await fetch(
      `${settings.ollamaBaseUrl}:${settings.ollamaApiPort}/api/tags`,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as { models: Array<{ name: string }> };
    return {
      online: true,
      models: data.models.map((m) => m.name),
    };
  } catch (error) {
    return {
      online: false,
      models: [],
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
