import { CHUNKS, CORPUS_VERSION } from "@/lib/corpus";
import { jsonResponse } from "@/lib/http";
import { openaiConfigured } from "@/lib/openai";
import { configuredSearchBackend } from "@/lib/retrieval";
import { pinConfigured } from "@/lib/session";
import type { HealthResponse } from "@/lib/types";
import { fetchIndexInfo, vectorStoreConfigured } from "@/lib/vector-store";

export async function GET(): Promise<Response> {
  const searchBackend = configuredSearchBackend();
  const configured = vectorStoreConfigured();
  let reachable: boolean | null = null;
  let namespaceVectorCount: number | null = null;
  // upstashバックエンド時だけ実接続を確認し、seed済み件数を報告する
  if (searchBackend === "upstash" && configured) {
    try {
      const info = await fetchIndexInfo();
      reachable = true;
      namespaceVectorCount = info.namespaces[CORPUS_VERSION]?.vectorCount ?? 0;
    } catch {
      reachable = false;
    }
  }
  const body: HealthResponse = {
    ok: true,
    openai_configured: openaiConfigured(),
    pin_configured: pinConfigured(),
    corpus_version: CORPUS_VERSION,
    chunk_count: CHUNKS.length,
    search_backend: searchBackend,
    vector_store: {
      configured,
      reachable,
      namespace_vector_count: namespaceVectorCount,
    },
  };
  return jsonResponse(body);
}
