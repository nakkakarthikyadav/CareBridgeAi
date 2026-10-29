import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Active Gemini model cascade with fallback support
const ACTIVE_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview'
];

/**
 * Executes a call to the Google Gemini API with fallback models and timeout safeguards.
 * Never logs or exposes GEMINI_API_KEY or patient PII in error messages.
 */
export async function callGemini(prompt, systemInstruction = '', inlineData = null, timeoutMs = 25000) {
  if (!GEMINI_API_KEY || !GEMINI_API_KEY.trim() || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    const error = new Error('Gemini API key is not configured on the server. Please set GEMINI_API_KEY.');
    error.code = 'API_KEY_MISSING';
    throw error;
  }

  let lastError = null;

  for (const model of ACTIVE_MODELS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const contentsParts = [];
      if (inlineData && inlineData.mimeType && inlineData.base64) {
        contentsParts.push({
          inlineData: {
            mimeType: inlineData.mimeType,
            data: inlineData.base64
          }
        });
      }
      contentsParts.push({ text: prompt });

      const requestBody = {
        contents: [{ role: 'user', parts: contentsParts }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.8,
          maxOutputTokens: 2048
        }
      };

      if (systemInstruction) {
        requestBody.systemInstruction = {
          parts: [{ text: systemInstruction }]
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.map(p => p.text).join('') || '';

        if (text) {
          return {
            text,
            meta: {
              success: true,
              modelUsed: model,
              provider: 'Google Gemini',
              finishReason: candidate?.finishReason || 'STOP'
            }
          };
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        const statusMsg = errData?.error?.message || response.statusText;
        console.warn(`[Gemini API] Model ${model} returned HTTP ${response.status}: ${statusMsg.slice(0, 100)}`);
        lastError = new Error(`Model ${model} error (${response.status}): ${statusMsg}`);
        lastError.status = response.status;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.warn(`[Gemini API] Model ${model} timed out after ${timeoutMs}ms`);
        lastError = new Error(`Request to model ${model} timed out.`);
        lastError.code = 'TIMEOUT';
      } else {
        console.warn(`[Gemini API] Request failed on model ${model}:`, err.message);
        lastError = err;
      }
    }
  }

  const finalError = new Error(
    lastError ? lastError.message : 'Clinical AI service is temporarily unavailable. Please verify service availability or try again shortly.'
  );
  finalError.code = lastError?.code || 'AI_SERVICE_UNAVAILABLE';
  throw finalError;
}

/**
 * Safely parses JSON returned from Gemini, stripping any accidental markdown wrappers.
 */
export function parseGeminiJson(rawText) {
  if (!rawText) return null;
  const cleaned = rawText
    .replace(/^```json\s*/im, '')
    .replace(/^```\s*/im, '')
    .replace(/```\s*$/im, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Attempt extracting the first JSON object block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return { rawContent: rawText };
  }
}
