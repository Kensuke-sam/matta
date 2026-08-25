import { CHUNKS, chunkEmbeddingText, CORPUS_VERSION } from "./corpus";
import { embeddingModel } from "./openai";
import type { EmbedFn } from "./openai";
import type { Chunk, SearchBackend } from "./types";
import { queryVectors, vectorStoreConfigured, VectorStoreError } from "./vector-store";
import type { VectorQueryMatch } from "./vector-store";

export { chunkEmbeddingText };

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

function rankByVector(queryVector: number[], corpusVectors: number[][], k: number): Retrieved[] {
  return CHUNKS.map((chunk, i) => ({
    chunk,
    similarity: cosineSimilarity(queryVector, corpusVectors[i]),
  }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

/** ローカル意味検索。Vector DB導入後は障害時フォールバックと明示切替時に使う */
export async function searchCorpus(
  queryText: string,
  embed: EmbedFn,
  k: number = TOP_K,
): Promise<Retrieved[]> {
  const [corpusVectors, queryVectors_] = await Promise.all([
    getCorpusVectors(embed),
    embed([queryText]),
  ]);
  return rankByVector(queryVectors_[0], corpusVectors, k);
}

async function searchCorpusByVector(
  queryVector: number[],
  embed: EmbedFn,
  k: number,
): Promise<Retrieved[]> {
  return rankByVector(queryVector, await getCorpusVectors(embed), k);
}

/**
 * 検索バックエンドの決定。
 * MATTA_SEARCH_BACKENDで明示切替でき（ロールバック手段）、
 * 未設定時はUpstashの接続設定があればupstash、なければlocalになる。
 */
export function configuredSearchBackend(): SearchBackend {
  const raw = process.env.MATTA_SEARCH_BACKEND?.trim().toLowerCase();
  if (raw === "local") return "local";
  if (raw === "upstash") return "upstash";
  return vectorStoreConfigured() ? "upstash" : "local";
}

const CHUNK_BY_ID = new Map(CHUNKS.map((chunk) => [chunk.id, chunk]));

/**
 * Vector DBのTop K結果を検証し、コーパス正本(lib/corpus.ts)のチャンクへ解決する。
 * 件数不足・重複ID・未知ID・メタデータ欠落・corpus_version不一致・
 * Embeddingモデル不一致は、seed漏れ・部分的な索引・別モデルの古いベクトル
 * といったストア異常であり、類似度不足とは別に扱う（呼び出し側でフォールバック対象）。
 */
function resolveVectorMatches(matches: VectorQueryMatch[], k: number): Retrieved[] {
  // seed済みのnamespace（12件）へのTop K検索は必ずK件返る
  if (matches.length !== Math.min(k, CHUNKS.length)) {
    throw new VectorStoreError("vector store returned an unexpected match count");
  }
  const seenIds = new Set<string>();
  return matches.map((match) => {
    const chunk = CHUNK_BY_ID.get(match.id);
    if (!chunk) {
      throw new VectorStoreError("vector store returned an unknown chunk id");
    }
    if (seenIds.has(match.id)) {
      throw new VectorStoreError("vector store returned duplicate chunk ids");
    }
    seenIds.add(match.id);
    // seed(scripts/seed-vector-db.ts)が必ず書き込むメタデータを必須とする
    const meta = match.metadata;
    if (
      meta === null ||
      meta.chunk_id !== chunk.id ||
      meta.corpus_version !== CORPUS_VERSION ||
      meta.embedding_model !== embeddingModel()
    ) {
      throw new VectorStoreError("vector store returned inconsistent metadata");
    }
    return { chunk, similarity: match.similarity };
  });
}

export type SearchOutcome = {
  results: Retrieved[];
  /** 実際に結果を返したバックエンド */
  backend: SearchBackend;
  /** Vector DB障害によりローカル意味検索へ切り替えたか */
  fallback: boolean;
};

/**
 * 意味検索の共通入口。
 * 通常はUpstash Vector（corpus_versionごとのnamespace）をTop K検索し、
 * ストア障害・異常時だけ同一Embeddingモデルのローカル意味検索へ切り替える。
 * 類似度不足はここでは扱わず、呼び出し側の閾値判定で「根拠不足」停止する
 * （フォールバックしない）。
 * beforeExternalCallは、Embedding・Vector DBの各外部呼び出しの直前に呼ばれる
 * （呼び出し側の時間予算チェック用。超過時はここでthrowさせて新しい呼び出しを始めない）。
 */
export async function retrieve(
  queryText: string,
  embed: EmbedFn,
  k: number = TOP_K,
  beforeExternalCall: () => void = () => {},
): Promise<SearchOutcome> {
  if (configuredSearchBackend() === "local") {
    beforeExternalCall();
    return { results: await searchCorpus(queryText, embed, k), backend: "local", fallback: false };
  }
  beforeExternalCall();
  const queryVector = (await embed([queryText]))[0];
  try {
    beforeExternalCall();
    const matches = await queryVectors(CORPUS_VERSION, queryVector, k);
    return { results: resolveVectorMatches(matches, k), backend: "upstash", fallback: false };
  } catch (err) {
    if (!(err instanceof VectorStoreError)) throw err;
    // 相談内容を含み得るため、固定文言だけをログへ出す
    console.error("[matta] vector store unavailable, falling back to local search");
    beforeExternalCall();
    return {
      results: await searchCorpusByVector(queryVector, embed, k),
      backend: "local",
      fallback: true,
    };
  }
}
