import type { AppSettings } from "../../../shared/types";
import { logActivity } from "../../storage/database";
import { VEDA_CONTEXT } from "./brochureContext";

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
    skipBrochureContext?: boolean; // Skip for internal parsing tasks
  } = {},
): Promise<string> {
  const model = options.useFallbackModel
    ? settings.fallbackModel
    : settings.primaryModel;

  const baseUrl = settings.ollamaBaseUrl;
  // Always use standard API port (11434) rather than the generate port (8080) which fails natively.
  const port = settings.ollamaApiPort;
  const url = `${baseUrl}:${port}/api/generate`;

  let finalPrompt = prompt;
  if (!options.skipBrochureContext) {
    finalPrompt = [
      `=== Veda AI Lab LLC — COMPLETE COMPANY KNOWLEDGE BASE ===`,
      ``,
      VEDA_CONTEXT,
      ``,
      `=== END OF KNOWLEDGE BASE ===`,
      ``,
      `CRITICAL INSTRUCTIONS FOR THIS TASK:`,
      `1. You represent Veda AI Lab LLC. Your MAIN INTENTION is to build a genuine community, make connections, and offer mutual help—NOT just to sell.`,
      `2. Balance the approach: Focus heavily on networking, contribution, and being in contact. Introduce product/service capabilities ONLY if the user shows explicit interest or if it naturally helps them.`,
      `3. ALL outreach and responses MUST align precisely with the knowledge base above, but use it to offer value and advice, not a hard pitch.`,
      `4. Match the professional, confident, peer-level tone — act as an advisor and community member, not a vendor.`,
      `5. NEVER invent, guess, or extrapolate services, pricing, or capabilities not explicitly stated in the knowledge base.`,
      `6. Adapt the sections you draw from based on the lead's industry, role, and company — use the most relevant service category and success story only if relevant.`,
      `7. Pricing should ONLY be mentioned if the lead explicitly asks. Otherwise, focus on outcomes, mutual growth, and value.`,
      `8. SHOW, DON'T TELL: NEVER explicitly state your intentions. Do NOT use phrases like "I'm not looking to push", "I'm not here to sell", "I'd like to start a conversation", or "I want to build a community". Just act naturally.`,
      `9. NO CLICHES: Never use openers like "I hope this finds you well" or "I came across your profile". Get straight to the point.`,
      ``,
      `---`,
      ``,
      prompt,
    ].join("\n");
  }

  console.log("=== [AI CLIENT] FINAL PROMPT SENT TO MODEL ===");
  console.log(finalPrompt);
  console.log("==============================================");

  try {
    if (settings.provider === "nvidia") {
      const apiKeyToUse = options.useFallbackModel && settings.fallbackApiKey ? settings.fallbackApiKey : settings.nvidiaApiKey;
      if (!apiKeyToUse) {
        throw new Error("NVIDIA API Key is missing. Please configure it in Settings.");
      }

      const nvidiaUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
      const messages = [{ role: "user", content: finalPrompt }];
      
      const nvidiaBody: any = {
        model,
        messages,
        temperature: options.temperature ?? settings.temperature,
        max_tokens: options.maxTokens ?? settings.maxTokens,
        top_p: 0.9,
      };

      if (options.format === "json") {
         // Optionally you can inject JSON instructions or use response_format if the model supports it.
         // Some models error if you pass response_format without "json" in the prompt, so we skip response_format here
         // and rely on the prompt instructing it to output JSON.
      }

      const response = await fetch(nvidiaUrl, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKeyToUse}`,
        },
        body: JSON.stringify(nvidiaBody),
      });

      if (!response.ok) {
        let errorText = response.statusText;
        try {
          const errData = await response.json();
          if (errData.error?.message) errorText = errData.error.message;
        } catch(e) {}
        throw new Error(`NVIDIA API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      if (data && data.choices && data.choices.length > 0) {
        return data.choices[0].message.content.trim();
      }
      throw new Error("Invalid response missing key 'choices'.");

    } else {
      // --- OLLAMA LOGIC ---
      const body: OllamaGenerateRequest = {
        model,
        prompt: finalPrompt,
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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logActivity(
      "ai_generate_failed",
      "ai",
      { model, provider: settings.provider, error: message },
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
