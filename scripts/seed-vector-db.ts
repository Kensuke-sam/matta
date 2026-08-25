/**
 * lib/corpus.tsの12チャンクをUpstash Vectorへ冪等にseedする。
 *
 *   npm run seed:vector
 *
 * Node 24の型ストリップ実行を前提に、相対importは拡張子付きで書く
 * （このスクリプトはNext.jsのビルド・実行時バンドルには含まれない）。
 * corpus_versionごとのnamespaceへチャンクIDをvector IDとして上書き登録するため、
 * 何度実行しても重複しない。登録するのは公開資料由来のベクトルと非機密メタデータ
 * （chunk_id・domain・corpus_version）だけで、相談文・個人情報・秘密値は扱わない。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHUNKS, chunkEmbeddingText, CORPUS_VERSION } from "../lib/corpus.ts";
import { embeddingModel, embedTexts, openaiConfigured } from "../lib/openai.ts";
import { fetchIndexInfo, upsertVectors, vectorStoreWritable } from "../lib/vector-store.ts";

/**
 * Next.jsと違い、素のnode実行は.env.localを読まないため自前で読み込む。
 * 値はprocess.envへ入れるだけで、画面・ログへは一切出さない。
 */
function loadEnvLocal(): void {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // .env.localが無ければ環境変数だけで動かす
  }
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function fail(message: string): never {
  console.error(`[seed-vector-db] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnvLocal();
  if (!vectorStoreWritable()) {
    fail(
      "UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN が未設定です（.env.localまたは環境変数で設定してください）。",
    );
  }
  if (!openaiConfigured()) {
    fail("OPENAI_API_KEY が未設定です（Embedding生成に必要です）。");
  }

  const before = await fetchIndexInfo();
  if (before.similarityFunction !== null && before.similarityFunction.toUpperCase() !== "COSINE") {
    fail(
      `インデックスの距離関数が ${before.similarityFunction} です。cosineのインデックスを作り直してください。`,
    );
  }

  console.log(
    `[seed-vector-db] ${CHUNKS.length}チャンクをEmbedding中（model: ${embeddingModel()}）...`,
  );
  const vectors = await embedTexts(CHUNKS.map(chunkEmbeddingText));
  const dimension = vectors[0].length;
  if (before.dimension !== null && before.dimension !== dimension) {
    fail(
      `次元不一致: インデックスは${before.dimension}次元、Embeddingは${dimension}次元です。インデックス設定を確認してください。`,
    );
  }

  await upsertVectors(
    CORPUS_VERSION,
    CHUNKS.map((chunk, i) => ({
      id: chunk.id,
      vector: vectors[i],
      // 検索側(lib/retrieval.ts)はこの4キーを必須として完全一致検証する
      metadata: {
        chunk_id: chunk.id,
        domain: chunk.domain,
        corpus_version: CORPUS_VERSION,
        embedding_model: embeddingModel(),
      },
    })),
  );

  // 反映（pending解消）を待ってから件数を検証する
  for (let attempt = 0; attempt < 10; attempt++) {
    const info = await fetchIndexInfo();
    const ns = info.namespaces[CORPUS_VERSION];
    if (ns && ns.pendingVectorCount === 0 && ns.vectorCount === CHUNKS.length) {
      console.log(
        `[seed-vector-db] 完了: namespace "${CORPUS_VERSION}" に ${ns.vectorCount} 件を登録（次元${dimension}・cosine）`,
      );
      const stale = Object.keys(info.namespaces).filter(
        (name) => name !== CORPUS_VERSION && name !== "",
      );
      if (stale.length > 0) {
        console.log(
          `[seed-vector-db] 注意: 旧corpus_versionのnamespaceが残っています: ${stale.join(", ")}（不要ならUpstashダッシュボードから手動削除）`,
        );
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(
    `登録件数を確認できませんでした。Upstashダッシュボードでnamespace "${CORPUS_VERSION}" を確認してください。`,
  );
}

await main();
