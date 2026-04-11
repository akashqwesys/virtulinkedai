import type { AppSettings, LinkedInProfile } from "../../../shared/types";
import { generateWithOllama } from "./client";

/**
 * Extracts profile information from raw DOM text and outputs structured JSON
 * leveraging the remote Mixtral model instance configured safely via settings.
 */
export async function parseProfileJson(
  rawText: string,
  settings: AppSettings["ai"],
): Promise<Partial<LinkedInProfile> | null> {
  // Stronger prompt: explicitly forbid any non-JSON output and show the exact template to fill
  const prompt = `INSTRUCTION: You are a JSON data extraction API. Your ONLY output must be a single valid JSON object — no explanation, no preamble, no markdown, no code fences.

Fill in the JSON template below using the LinkedIn profile text provided. Leave fields as empty strings "" or empty arrays [] if the information is not present. Do NOT invent data.

JSON TEMPLATE (output EXACTLY this structure, filled in):
{
  "firstName": "",
  "lastName": "",
  "headline": "",
  "location": "",
  "about": "",
  "company": "",
  "role": "",
  "connectionDegree": "3rd",
  "experience": [],
  "education": [],
  "skills": [],
  "mutualConnections": []
}

LINKEDIN PROFILE TEXT:
${rawText}

OUTPUT (valid JSON only):`;

  console.log(`[AI/JSON] Requesting JSON parsing from Mixtral (${settings.primaryModel}) - text size: ${rawText.length}`);
  
  // Give up to 10 tries — sparse profiles need more attempts for the LLM to stabilize.
  const maxRetries = 10;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const responseText = await generateWithOllama(prompt, settings, {
        temperature: Math.min(0.1 * attempt, 0.7), // cap temperature at 0.7 to avoid chaos
        maxTokens: 2048,
      });
      
      console.log(`[AI/JSON] Attempt ${attempt}: received LLM response length: ${responseText.length}`);
      
      // Try multiple extraction strategies in order of preference
      let jsonStr: string | null = null;

      // Strategy 1: greedy match — gets the largest {...} block
      const greedyMatch = responseText.match(/\{[\s\S]*\}/);
      if (greedyMatch) jsonStr = greedyMatch[0];

      // Strategy 2: find first '{' to last '}' (handles extra trailing text)
      if (!jsonStr) {
        const start = responseText.indexOf('{');
        const end = responseText.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          jsonStr = responseText.slice(start, end + 1);
        }
      }

      if (!jsonStr) throw new Error("No JSON structure found in output");

      // Attempt to parse and return
      const parsedData = JSON.parse(jsonStr);

      // Validate it's an object (not an array)
      if (typeof parsedData !== 'object' || Array.isArray(parsedData)) {
        throw new Error("Parsed result is not an object");
      }

      // Normalize array fields in case LLM returned them as strings or nulls
      if (!Array.isArray(parsedData.experience)) parsedData.experience = [];
      if (!Array.isArray(parsedData.education)) parsedData.education = [];
      if (!Array.isArray(parsedData.skills)) parsedData.skills = [];
      if (!Array.isArray(parsedData.mutualConnections)) parsedData.mutualConnections = [];

      console.log(`[AI/JSON] Attempt ${attempt}: ✅ Successfully parsed JSON.`);
      return parsedData;
      
    } catch (err: any) {
      console.warn(`[AI/JSON] Attempt ${attempt} failed: ${err.message}`);
      if (attempt === maxRetries) {
        console.error("[AI/JSON] Max retries (10) reached. Returning null for LLM parsing.");
      }
    }
  }

  return null;
}
