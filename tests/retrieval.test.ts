import { beforeEach, describe, expect, it } from "vitest";
import { CHUNKS } from "@/lib/corpus";
import type { EmbedFn } from "@/lib/openai";
import {
  _resetCorpusCache,
  chunkEmbeddingText,
  cosineSimilarity,
  searchCorpus,
} from "@/lib/retrieval";

describe("cosineSimilarity", () => {
  it("同一ベクトルは1になる", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("直交ベクトルは0になる", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("逆向きベクトルは-1になる", () => {
    expect(cosineSimilarity([1, 0], [-2, 0])).toBeCloseTo(-1, 10);
  });

  it("長さ不一致はエラーになる", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });

  it("ゼロベクトルは0を返す", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("searchCorpus", () => {
  beforeEach(() => {
    _resetCorpusCache();
  });

  // チャンクiに [1,0,0,0.1*i] を割り当てるfake。クエリ[1,0,0,0]との類似度はi昇順で下がる
  function rankedEmbed(): { embed: EmbedFn; calls: string[][] } {
    const calls: string[][] = [];
    const embed: EmbedFn = async (texts) => {
      calls.push(texts);
      if (texts.length === CHUNKS.length) {
        return texts.map((_, i) => [1, 0, 0, 0.1 * i]);
      }
      return texts.map(() => [1, 0, 0, 0]);
    };
    return { embed, calls };
  }

  it("類似度の降順でTop 3を返す", async () => {
    const { embed } = rankedEmbed();
    const results = await searchCorpus("query", embed);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.chunk.id)).toEqual([
      CHUNKS[0].id,
      CHUNKS[1].id,
      CHUNKS[2].id,
    ]);
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    expect(results[1].similarity).toBeGreaterThan(results[2].similarity);
    expect(results[0].similarity).toBeCloseTo(1, 5);
  });

  it("kを指定するとその件数を返す", async () => {
    const { embed } = rankedEmbed();
    const results = await searchCorpus("query", embed, 5);
    expect(results).toHaveLength(5);
  });

  it("コーパスEmbeddingはキャッシュされ、2回目の検索ではクエリ分だけ呼ばれる", async () => {
    const { embed, calls } = rankedEmbed();
    await searchCorpus("query one", embed);
    await searchCorpus("query two", embed);
    const corpusCalls = calls.filter((texts) => texts.length === CHUNKS.length);
    const queryCalls = calls.filter((texts) => texts.length === 1);
    expect(corpusCalls).toHaveLength(1);
    expect(queryCalls).toHaveLength(2);
  });

  it("キャッシュリセット後はコーパスを再Embeddingする", async () => {
    const { embed, calls } = rankedEmbed();
    await searchCorpus("query", embed);
    _resetCorpusCache();
    await searchCorpus("query", embed);
    expect(calls.filter((texts) => texts.length === CHUNKS.length)).toHaveLength(2);
  });
});

describe("コーパス", () => {
  it("12チャンクで、必須フィールドがそろっている", () => {
    expect(CHUNKS).toHaveLength(12);
    for (const chunk of CHUNKS) {
      expect(chunk.id).toBeTruthy();
      expect(chunk.title).toBeTruthy();
      expect(chunk.content.length).toBeGreaterThan(50);
      expect(chunk.source.url).toMatch(/^https:\/\//);
      expect(chunk.source.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(chunkEmbeddingText(chunk)).toContain(chunk.title);
    }
    expect(new Set(CHUNKS.map((c) => c.id)).size).toBe(12);
    expect(CHUNKS.filter((c) => c.domain === "police")).toHaveLength(4);
    expect(CHUNKS.filter((c) => c.domain === "delivery")).toHaveLength(4);
    expect(CHUNKS.filter((c) => c.domain === "yamibaito")).toHaveLength(4);
  });
});
