/**
 * Upstash Vector REST APIの薄いラッパー。
 * lib/openai.tsと同じ方針でSDKを使わずfetch直叩きにし、
 * テスト時はUPSTASH_VECTOR_REST_URLでモックサーバーへ差し替えられるようにする。
 * 送信するのはクエリベクトルと非機密メタデータだけで、相談文そのものは送らない。
 * 相談内容や認証情報をログへ残さないため、エラーには固定文言だけを入れる。
 */

// 検索1回はREST 1往復のみ（通常は数百ms以内）。
// analyze全体の60秒予算を圧迫しないよう短めにする
const TIMEOUT_MS = 5_000;

export class VectorStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorStoreError";
  }
}

function restUrl(): string {
  return (process.env.UPSTASH_VECTOR_REST_URL?.trim() ?? "").replace(/\/+$/, "");
}

function restToken(): string {
  return process.env.UPSTASH_VECTOR_REST_TOKEN?.trim() ?? "";
}

/** 読み取り操作は、設定があれば権限の小さいREADONLYトークンを優先する */
function readToken(): string {
  return process.env.UPSTASH_VECTOR_REST_READONLY_TOKEN?.trim() || restToken();
}

export function vectorStoreConfigured(): boolean {
  return restUrl().length > 0 && readToken().length > 0;
}

/** seed等の書き込みに必要な設定がそろっているか（READONLYトークンでは不可） */
export function vectorStoreWritable(): boolean {
  return restUrl().length > 0 && restToken().length > 0;
}

async function request(method: "GET" | "POST", path: string, token: string, payload?: unknown): Promise<unknown> {
  if (restUrl().length === 0 || token.length === 0) {
    throw new VectorStoreError("vector store is not configured");
  }
  let res: Response;
  try {
    res = await fetch(`${restUrl()}${path}`, {
      method,
      headers: {
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${token}`,
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new VectorStoreError("vector store request timed out");
    }
    throw new VectorStoreError("failed to reach vector store");
  }
  if (!res.ok) {
    // レスポンスボディは読まない（openai.tsと同じ方針）
    throw new VectorStoreError(`vector store returned status ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new VectorStoreError("vector store returned a non-JSON response");
  }
}

/**
 * Upstashのcosineスコアは (1 + cosine) / 2 で0〜1へ正規化されている。
 * アプリ全体はローカル検索と同じ生のコサイン類似度(-1〜1)で統一するため、逆変換する。
 * https://upstash.com/docs/vector/features/similarityfunctions
 */
export function upstashScoreToCosine(score: number): number {
  return Math.min(1, Math.max(-1, 2 * score - 1));
}

export type VectorQueryMatch = {
  id: string;
  /** 生のコサイン類似度（Upstashスコアから逆変換済み） */
  similarity: number;
  metadata: Record<string, unknown> | null;
};

export async function queryVectors(
  namespace: string,
  vector: number[],
  topK: number,
): Promise<VectorQueryMatch[]> {
  const json = (await request("POST", `/query/${encodeURIComponent(namespace)}`, readToken(), {
    vector,
    topK,
    includeMetadata: true,
  })) as { result?: unknown };
  const result = json?.result;
  if (!Array.isArray(result)) {
    throw new VectorStoreError("unexpected query response shape");
  }
  return result.map((item: { id?: unknown; score?: unknown; metadata?: unknown }) => {
    const id = item?.id;
    const score = item?.score;
    if (typeof id !== "string" || id.length === 0) {
      throw new VectorStoreError("unexpected query match id");
    }
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new VectorStoreError("unexpected query match score");
    }
    const metadata =
      item.metadata !== null && typeof item.metadata === "object" && !Array.isArray(item.metadata)
        ? (item.metadata as Record<string, unknown>)
        : null;
    return { id, similarity: upstashScoreToCosine(score), metadata };
  });
}

export type VectorUpsertItem = {
  id: string;
  vector: number[];
  /** 非機密メタデータのみ（chunk_id・domain・corpus_version） */
  metadata: Record<string, string>;
};

/** 同じIDへの登録は上書きになるため、再実行しても重複しない */
export async function upsertVectors(namespace: string, items: VectorUpsertItem[]): Promise<void> {
  const json = (await request("POST", `/upsert/${encodeURIComponent(namespace)}`, restToken(), items)) as {
    result?: unknown;
  };
  if (json?.result !== "Success") {
    throw new VectorStoreError("unexpected upsert response");
  }
}

export type VectorIndexInfo = {
  dimension: number | null;
  similarityFunction: string | null;
  /** namespaceごとの登録済みベクトル数 */
  namespaces: Record<string, { vectorCount: number; pendingVectorCount: number }>;
};

export type VectorStoreHealth = {
  reachable: boolean;
  /** 対象namespaceの登録済みベクトル数（接続不能時はnull） */
  namespaceVectorCount: number | null;
};

const HEALTH_CACHE_TTL_MS = 10_000;
let healthCache: { at: number; namespace: string; health: VectorStoreHealth } | null = null;
let healthProbeInFlight: { namespace: string; promise: Promise<VectorStoreHealth> } | null = null;

/**
 * healthエンドポイント用の接続確認。
 * 未認証で連打されても外部I/Oが際限なく増えないよう、結果を短時間キャッシュし、
 * キャッシュ未設定時の同時呼び出しは進行中Promiseを共有して外部fetch 1回へ集約する
 * （single-flight。キャッシュはfetch完了後にしか入らないため、これがないと
 * 同時N件がそのままN件の認証付き/info発行になる）。
 */
export async function probeVectorStoreHealth(namespace: string): Promise<VectorStoreHealth> {
  const now = Date.now();
  if (
    healthCache &&
    healthCache.namespace === namespace &&
    now - healthCache.at < HEALTH_CACHE_TTL_MS
  ) {
    return healthCache.health;
  }
  if (healthProbeInFlight && healthProbeInFlight.namespace === namespace) {
    return healthProbeInFlight.promise;
  }
  // 内側でcatchするためこのPromiseはrejectしない（共有先へ失敗を伝播させない）
  const promise = (async () => {
    let health: VectorStoreHealth;
    try {
      const info = await fetchIndexInfo();
      health = {
        reachable: true,
        namespaceVectorCount: info.namespaces[namespace]?.vectorCount ?? 0,
      };
    } catch {
      health = { reachable: false, namespaceVectorCount: null };
    }
    healthCache = { at: Date.now(), namespace, health };
    return health;
  })();
  healthProbeInFlight = { namespace, promise };
  try {
    return await promise;
  } finally {
    if (healthProbeInFlight?.promise === promise) healthProbeInFlight = null;
  }
}

export function _resetVectorStoreHealthCache(): void {
  healthCache = null;
  healthProbeInFlight = null;
}

export async function fetchIndexInfo(): Promise<VectorIndexInfo> {
  const json = (await request("GET", "/info", readToken())) as { result?: unknown };
  const result = json?.result as
    | {
        dimension?: unknown;
        similarityFunction?: unknown;
        namespaces?: Record<string, { vectorCount?: unknown; pendingVectorCount?: unknown }>;
      }
    | undefined;
  if (result === null || typeof result !== "object") {
    throw new VectorStoreError("unexpected info response shape");
  }
  const namespaces: VectorIndexInfo["namespaces"] = {};
  if (result.namespaces !== null && typeof result.namespaces === "object") {
    for (const [name, ns] of Object.entries(result.namespaces)) {
      namespaces[name] = {
        vectorCount: typeof ns?.vectorCount === "number" ? ns.vectorCount : 0,
        pendingVectorCount: typeof ns?.pendingVectorCount === "number" ? ns.pendingVectorCount : 0,
      };
    }
  }
  return {
    dimension: typeof result.dimension === "number" ? result.dimension : null,
    similarityFunction:
      typeof result.similarityFunction === "string" ? result.similarityFunction : null,
    namespaces,
  };
}
