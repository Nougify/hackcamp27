import 'server-only';
import { GoogleGenAI, type Part } from '@google/genai';
import type { ZodType } from 'zod';
import { getEnv } from '../env';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  // Vertex AI via Application Default Credentials (`gcloud auth application-default login` locally).
  if (!client) {
    const env = getEnv();
    client = new GoogleGenAI({ vertexai: true, project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION });
  }
  return client;
}

export interface GeminiImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif';
  base64: string;
}

async function callWithTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * JSON-mode call, NO tools (§10.3.1). Validates with zod; strips ```json
 * fences; 1 retry if the response doesn't parse or doesn't match `zod` —
 * structured output guarantees schema-shaped JSON, not correct values
 * (https://ai.google.dev/gemini-api/docs/structured-output), so callers must
 * still sanity-check the data.
 */
export async function geminiJson<T>(opts: {
  system?: string;
  text: string; // put the text prompt BEFORE images (docs tip)
  images?: GeminiImage[];
  jsonSchema: object; // Gemini JSON-Schema subset (§10.3.6)
  zod: ZodType<T>;
  model?: string;
  timeoutMs?: number;
}): Promise<{ data: T; model: string }> {
  const env = getEnv();
  const model = opts.model ?? env.GEMINI_MODEL;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const parts: Part[] = [{ text: opts.text }];
  for (const image of opts.images ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
  }

  const attempt = async () => {
    const response = await callWithTimeout(
      (signal) =>
        getClient().models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: opts.system,
            responseMimeType: 'application/json',
            responseSchema: opts.jsonSchema,
            abortSignal: signal,
          },
        }),
      timeoutMs,
    );
    const parsed = tryParseJson(stripJsonFences(response.text ?? ''));
    return opts.zod.safeParse(parsed);
  };

  const first = await attempt();
  if (first.success) return { data: first.data, model };

  const second = await attempt();
  if (second.success) return { data: second.data, model };

  throw new Error(`geminiJson: response did not match schema after 1 retry: ${second.error.message}`);
}

/**
 * Grounded search call, NO response schema (avoids the 2025–26
 * grounding+JSON bugs documented in §9 F6). Reads `groundingMetadata` off
 * the first candidate (§17 item 1, confirmed against @google/genai 3.0.0).
 */
export async function geminiGroundedSearch(opts: {
  prompt: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{
  text: string;
  sources: Array<{ uri: string; title: string | null }>;
  webSearchQueries: string[];
  searchEntryPointHtml: string | null;
}> {
  const env = getEnv();
  const model = opts.model ?? env.GEMINI_SEARCH_MODEL;
  const timeoutMs = opts.timeoutMs ?? 45_000;

  const response = await callWithTimeout(
    (signal) =>
      getClient().models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
        config: { tools: [{ googleSearch: {} }], abortSignal: signal },
      }),
    timeoutMs,
  );

  const grounding = response.candidates?.[0]?.groundingMetadata;
  const sources = (grounding?.groundingChunks ?? [])
    .map((chunk) => chunk.web)
    .filter((web): web is { uri: string; title?: string } => Boolean(web?.uri))
    .map((web) => ({ uri: web.uri as string, title: web.title ?? null }));

  return {
    text: response.text ?? '',
    sources,
    webSearchQueries: grounding?.webSearchQueries ?? [],
    searchEntryPointHtml: grounding?.searchEntryPoint?.renderedContent ?? null,
  };
}
