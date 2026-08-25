import { CHUNKS, CORPUS_VERSION } from "@/lib/corpus";
import { jsonResponse } from "@/lib/http";
import { openaiConfigured } from "@/lib/openai";
import { pinConfigured } from "@/lib/session";
import type { HealthResponse } from "@/lib/types";

export async function GET(): Promise<Response> {
  const body: HealthResponse = {
    ok: true,
    openai_configured: openaiConfigured(),
    pin_configured: pinConfigured(),
    corpus_version: CORPUS_VERSION,
    chunk_count: CHUNKS.length,
  };
  return jsonResponse(body);
}
