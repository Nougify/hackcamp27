#!/usr/bin/env node
// Gemini smoke test (§18.2 task 0.7, §17 item 1): one grounded-search call and
// one vision JSON call. Uses Vertex AI with Application Default Credentials.
// Usage: gcloud auth application-default login && GOOGLE_CLOUD_PROJECT=... node scripts/gemini-smoke.mjs
import { GoogleGenAI } from '@google/genai';

const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!project) {
  console.error('GOOGLE_CLOUD_PROJECT is required');
  process.exit(1);
}
const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'; // same fallback as src/lib/env.ts;
const model = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
const searchModel = process.env.GEMINI_SEARCH_MODEL ?? 'gemini-3.8-flash';
const ai = new GoogleGenAI({ vertexai: true, project, location });

console.log(`[smoke] models: json=${model} search=${searchModel}`);

// 1. Grounded search (no response schema).
const grounded = await ai.models.generateContent({
  model: searchModel,
  contents: [{ role: 'user', parts: [{ text: 'Find 2 real spinach pasta recipe pages. Reply one line per recipe: <title> | <url>.' }] }],
  config: { tools: [{ googleSearch: {} }] },
});
const grounding = grounded.candidates?.[0]?.groundingMetadata;
console.log(`[smoke] grounded text: ${(grounded.text ?? '').slice(0, 200)}`);
console.log(`[smoke] grounding chunks: ${grounding?.groundingChunks?.length ?? 0}`);
console.log(`[smoke] web queries: ${(grounding?.webSearchQueries ?? []).join(' | ') || '(none)'}`);
if (!grounding || (grounding.groundingChunks?.length ?? 0) === 0) {
  console.error('[smoke] FAIL: no grounding metadata — check model grounding support (§17 item 3)');
  process.exit(1);
}

// 2. Vision JSON call (1x1 red png — tests schema output, not recognition).
const redDot = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const json = await ai.models.generateContent({
  model,
  contents: [
    {
      role: 'user',
      parts: [
        { text: 'Describe this image in JSON.' },
        { inlineData: { mimeType: 'image/png', data: redDot } },
      ],
    },
  ],
  config: {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'object',
      required: ['color'],
      properties: { color: { type: 'string' } },
    },
  },
});
console.log(`[smoke] vision json: ${(json.text ?? '').slice(0, 200)}`);
JSON.parse(json.text ?? '');
console.log('[smoke] PASS: grounded search + vision JSON both work');
