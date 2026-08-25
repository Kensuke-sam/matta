import { CHUNKS, CORPUS_VERSION } from "./corpus";
import type { EmbedFn } from "./openai";
import type { Chunk } from "./types";

export const TOP_K = 3;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error("vector length mismatch");
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function chunkEmbeddingText(chunk: Chunk): string {
  return `${chunk.title}\n${chunk.content}`;
}

// コーパスEmbeddingはサーバーインスタンスごとに1回だけ計算してキャッシュする
let cache: { version: string; vectors: number[][] } | null = null;
let inflight: Promise<number[][]> | null = null;

export async function getCorpusVectors(embed: EmbedFn): Promise<number[][]> {
  if (cache && cache.version === CORPUS_VERSION) return cache.vectors;
  if (!inflight) {
    inflight = embed(CHUNKS.map(chunkEmbeddingText))
      .then((vectors) => {
        cache = { version: CORPUS_VERSION, vectors };
        return vectors;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function _resetCorpusCache(): void {
  cache = null;
  inflight = null;
}

export type Retrieved = { chunk: Chunk; similarity: number };

export async function searchCorpus(
  queryText: string,
  embed: EmbedFn,
  k: number = TOP_K,
): Promise<Retrieved[]> {
  const [corpusVectors, queryVectors] = await Promise.all([
    getCorpusVectors(embed),
    embed([queryText]),
  ]);
  const queryVector = queryVectors[0];
  return CHUNKS.map((chunk, i) => ({
    chunk,
    similarity: cosineSimilarity(queryVector, corpusVectors[i]),
  }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}
