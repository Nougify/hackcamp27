import { z } from "zod";
import type { ApiError, ApiErrorCode } from "@/contracts";
import { requireUser } from "@/lib/current-user";

export const runtime = "nodejs";

const Body = z.object({ text: z.string().trim().min(1).max(2000) });

function fail(status: number, code: ApiErrorCode, message: string) {
  return Response.json({ error: { code, message } } satisfies ApiError, { status });
}

// SPEC §10.5: proxy ElevenLabs HTTP streaming. Any error → client falls back to speechSynthesis.
// ponytail: no per-user rate limit (60/min) until Hang's src/lib/rate-limit.ts lands.
export async function POST(req: Request) {
  await requireUser();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "BAD_REQUEST", "text must be 1–2000 characters");

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail(503, "UPSTREAM_UNAVAILABLE", "Text-to-speech is not configured");

  const voice = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  const model = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";

  // Time out waiting for headers only; once audio streams, let it finish.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: parsed.data.text, model_id: model }),
        signal: ctrl.signal,
      },
    );
  } catch {
    return fail(502, "UPSTREAM_UNAVAILABLE", "Text-to-speech request failed");
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok || !upstream.body) {
    console.warn(`tts: ElevenLabs responded ${upstream.status}`);
    return fail(502, "UPSTREAM_UNAVAILABLE", "Text-to-speech provider error");
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" },
  });
}
