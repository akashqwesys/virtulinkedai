import type { AppSettings } from "../../../shared/types";
import { generateWithOllama } from "./client";

/**
 * Analyze sentiment/intent of a received message
 */
export async function analyzeSentiment(
  message: string,
  settings: AppSettings["ai"],
): Promise<{
  sentiment: "positive" | "neutral" | "negative";
  intent:
    | "interested"
    | "curious"
    | "objection"
    | "ready_to_meet"
    | "not_interested"
    | "question";
  confidence: number;
}> {
  const prompt = `Analyze this LinkedIn DM message and return ONLY a JSON object.

MESSAGE: "${message}"

Return ONLY this JSON format, nothing else:
{"sentiment": "positive|neutral|negative", "intent": "interested|curious|objection|ready_to_meet|not_interested|question", "confidence": 0.0-1.0}`;

  const response = await generateWithOllama(prompt, settings, {
    maxTokens: 80,
    temperature: 0.2, // Low temp for analysis
    useFallbackModel: true, // Use faster model
    format: "json", // Instructs Ollama to output valid JSON token sequence
  });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        sentiment: parsed.sentiment || "neutral",
        intent: parsed.intent || "curious",
        confidence: parsed.confidence || 0.5,
      };
    }
  } catch {
    // Fallback
  }

  return { sentiment: "neutral", intent: "curious", confidence: 0.5 };
}
