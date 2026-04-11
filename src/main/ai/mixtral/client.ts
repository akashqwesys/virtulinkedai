import type { AppSettings } from "../../../shared/types";
import { logActivity } from "../../storage/database";

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_p?: number;
    top_k?: number;
  };
  format?: string;
}

/**
 * Generate text using Ollama API - Centralized Client
 * Always hitting the API port configured in settings (default 11434).
 */
export async function generateWithOllama(
  prompt: string,
  settings: AppSettings["ai"],
  options: {
    useFallbackModel?: boolean;
    maxTokens?: number;
    temperature?: number;
    format?: string; // Optional JSON toggle
  } = {},
): Promise<string> {
  const model = options.useFallbackModel
    ? settings.fallbackModel
    : settings.primaryModel;

  const baseUrl = settings.ollamaBaseUrl;
  // Always use standard API port (11434) rather than the generate port (8080) which fails natively.
  const port = settings.ollamaApiPort;
  const url = `${baseUrl}:${port}/api/generate`;

  const body: OllamaGenerateRequest = {
    model,
    prompt,
    stream: false,
    options: {
      temperature: options.temperature ?? settings.temperature,
      num_predict: options.maxTokens ?? settings.maxTokens,
      top_p: 0.9,
      top_k: 40,
    },
  };
  
  if (options.format) {
    body.format = options.format;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as OllamaResponse;
    if (data && data.response) {
      return data.response.trim();
    }
    throw new Error("Invalid response missing key 'response'.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity(
      "ai_generate_failed",
      "ai",
      { model, error: message },
      "error",
      message,
    );

    // If primary model failed, try fallback
    if (!options.useFallbackModel) {
      logActivity("ai_trying_fallback", "ai", {
        fallbackModel: settings.fallbackModel,
      });
      return generateWithOllama(prompt, settings, {
        ...options,
        useFallbackModel: true,
      });
    }

    throw error;
  }
}
