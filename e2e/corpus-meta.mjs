/**
 * E2Eモック共通のコーパスメタデータ。
 * mock-openai.mjs（コーパスEmbedding）とmock-upstash.mjs（seed済みベクトル）が
 * 同じID・domain・並び順・ノイズ式を使うため、ここに一元化する。
 * 並び順はlib/corpus.tsのCHUNKS（基本12件+corpus-team.json連結）と一致させる。
 */
import { readFileSync } from "node:fs";

const teamChunks = JSON.parse(
  readFileSync(new URL("../lib/corpus-team.json", import.meta.url), "utf8"),
);

export const CORPUS_META = [
  ...["police-1", "police-2", "police-3", "police-4"].map((id) => ({ id, domain: "police" })),
  ...["delivery-1", "delivery-2", "delivery-3", "delivery-4"].map((id) => ({
    id,
    domain: "delivery",
  })),
  ...["yami-1", "yami-2", "yami-3", "yami-4"].map((id) => ({ id, domain: "yamibaito" })),
  ...teamChunks.map(({ id, domain }) => ({ id, domain })),
];

export const DOMAIN_BASE = {
  police: [1, 0, 0],
  delivery: [0, 1, 0],
  yamibaito: [0, 0, 1],
};

/**
 * index順位付け用のノイズ（4次元目）。indexが小さいほど類似度が高くなる。
 * 合計を0.2以下に抑え、圏外クエリ[0,0,0,1]とのコサイン（最大 0.2/√1.04 ≈ 0.196）が
 * 停止閾値0.3を超えないようにする（コーパス件数へ依存しない有界式）。
 */
export function corpusNoise(index) {
  return (0.2 * (index + 1)) / CORPUS_META.length;
}

/** コーパスindexに対応する決定的な4次元ベクトル */
export function corpusVec(index) {
  return [...DOMAIN_BASE[CORPUS_META[index].domain], corpusNoise(index)];
}
