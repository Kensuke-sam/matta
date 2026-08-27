/**
 * E2E専用のUpstash Vector REST APIモックサーバー。
 * アプリ側はUPSTASH_VECTOR_REST_URLでここへ向く。実サービスへは一切接続しない。
 * 全コーパスチャンクには、mock-openai.mjsと同じcorpus-meta.mjsの決定的な
 * 4次元ベクトルを割り当て、/query/{namespace} のコサイン類似検索を再現する。
 * スコアはUpstash実装と同じ (1 + cosine) / 2 の正規化で返す。
 */
import { createServer } from "node:http";
import { CORPUS_META as CORPUS, corpusVec } from "./corpus-meta.mjs";

const PORT = Number(process.env.MOCK_UPSTASH_PORT ?? 8966);
// 実アプリのcorpus_versionと一致させる（playwright.config.tsがlib/corpus.tsから渡す）
const NAMESPACE = process.env.MOCK_UPSTASH_NAMESPACE ?? "";
// 実アプリのembeddingModel()既定値と一致させる（アプリ側metadata必須検証の対象）
const EMBEDDING_MODEL = process.env.MOCK_UPSTASH_EMBEDDING_MODEL ?? "text-embedding-3-small";

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  if ((req.headers.authorization ?? "").replace(/^Bearer\s+/, "").length === 0) {
    json(res, 401, { error: "Unauthorized", status: 401 });
    return;
  }

  if (req.method === "GET" && req.url === "/info") {
    json(res, 200, {
      result: {
        vectorCount: CORPUS.length,
        pendingVectorCount: 0,
        indexSize: 1,
        dimension: 4,
        similarityFunction: "COSINE",
        namespaces: {
          [NAMESPACE]: { vectorCount: CORPUS.length, pendingVectorCount: 0 },
        },
      },
    });
    return;
  }

  const queryMatch = req.method === "POST" && req.url?.match(/^\/query\/([^/]+)$/);
  if (queryMatch) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: "bad json", status: 400 });
      return;
    }
    const namespace = decodeURIComponent(queryMatch[1]);
    if (namespace !== NAMESPACE) {
      // 未seedのnamespaceへの検索は0件（アプリ側はストア異常としてフォールバックする）
      json(res, 200, { result: [] });
      return;
    }
    const vector = Array.isArray(body.vector) ? body.vector : [];
    const topK = Number.isInteger(body.topK) ? body.topK : 10;
    const includeMetadata = body.includeMetadata === true;
    const result = CORPUS.map((item, index) => ({
      id: item.id,
      score: (1 + cosine(vector, corpusVec(index))) / 2,
      ...(includeMetadata
        ? {
            metadata: {
              chunk_id: item.id,
              domain: item.domain,
              corpus_version: NAMESPACE,
              embedding_model: EMBEDDING_MODEL,
            },
          }
        : {}),
    }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    json(res, 200, { result });
    return;
  }

  json(res, 404, { error: "not found", status: 404 });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-upstash] listening on http://127.0.0.1:${PORT}`);
});
