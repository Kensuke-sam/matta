import { beforeEach, describe, expect, it } from "vitest";
import { minSimilarity, runAnalyze } from "@/lib/analyze";
import type { AnalyzeDeps } from "@/lib/analyze";
import { CHUNKS } from "@/lib/corpus";
import { UpstreamError } from "@/lib/openai";
import { QUESTION_BANK } from "@/lib/questions";
import { _resetCorpusCache } from "@/lib/retrieval";
import { extractJson } from "@/lib/validate";
import type { ValidatedInput } from "@/lib/validate";

/**
 * ドメインキーワードで4次元ベクトルを割り当てる決定的fake Embedding。
 * コーパス側だけに小さなノイズを足し、クエリとの完全一致（cos=1.0）を避けつつ
 * コーパス内の順位を一意にする。
 */
function domainVector(text: string, index: number, isCorpus: boolean): number[] {
  const noise = isCorpus ? 0.005 * (index + 1) : 0;
  if (/(闇バイト|副業|身分証|即日即金|高収入)/.test(text)) return [0, 0, 1, noise];
  if (/(不在|宅配|フィッシング|偽サイト|SMS)/.test(text)) return [0, 1, 0, noise];
  if (/(警察|逮捕|取り調べ)/.test(text)) return [1, 0, 0, noise];
  return [0, 0, 0, 1];
}

type DepsOptions = {
  triage?: string | (() => string);
  generation?: string | (() => string);
};

function makeDeps(options: DepsOptions = {}) {
  const embedCalls: string[][] = [];
  const chatCalls: { kind: "triage" | "generation"; system: string; user: string }[] = [];
  const triage =
    options.triage ?? JSON.stringify({ category: "consultation", missing: [] });
  const generation =
    options.generation ??
    JSON.stringify({
      related: true,
      similar_cases: ["類似1", "類似2"],
      danger_signs: ["サイン1", "サイン2"],
      normal_response: ["通常1", "通常2"],
      do_not: ["禁止1", "禁止2"],
      safe_verification: ["#9110に相談する", "188に相談する"],
    });
  const deps: AnalyzeDeps = {
    embedTexts: async (texts) => {
      embedCalls.push(texts);
      const isCorpus = texts.length === CHUNKS.length;
      return texts.map((t, i) => domainVector(t, i, isCorpus));
    },
    chatJson: async ({ system, user }) => {
      const kind = system.includes("トリアージ") ? "triage" : "generation";
      chatCalls.push({ kind, system, user });
      const source = kind === "triage" ? triage : generation;
      return typeof source === "function" ? source() : source;
    },
  };
  return { deps, embedCalls, chatCalls };
}

function input(message: string, answers: ValidatedInput["answers"] = []): ValidatedInput {
  return { message, answers };
}

beforeEach(() => {
  _resetCorpusCache();
  delete process.env.MATTA_MIN_SIMILARITY;
});

describe("minSimilarity", () => {
  it("既定値は0.3で、環境変数で上書きできる", () => {
    expect(minSimilarity()).toBe(0.3);
    process.env.MATTA_MIN_SIMILARITY = "0.55";
    expect(minSimilarity()).toBe(0.55);
    process.env.MATTA_MIN_SIMILARITY = "abc";
    expect(minSimilarity()).toBe(0.3);
    process.env.MATTA_MIN_SIMILARITY = "1.5";
    expect(minSimilarity()).toBe(0.3);
  });
});

describe("runAnalyze: 分岐", () => {
  it("既遂（incident）は検索せず固定カードを返す", async () => {
    const { deps, embedCalls } = makeDeps({
      triage: JSON.stringify({ category: "incident", missing: [] }),
    });
    const res = await runAnalyze(input("お金を振り込んでしまいました"), deps);
    expect(res.status).toBe("incident");
    if (res.status === "incident") {
      expect(res.incident.steps.length).toBeGreaterThan(0);
      expect(res.contacts.map((c) => c.number)).toContain("#9110");
    }
    expect(embedCalls).toHaveLength(0);
  });

  it("情報不足なら固定文言の質問を最大2問返す", async () => {
    const { deps } = makeDeps({
      triage: JSON.stringify({
        category: "consultation",
        missing: ["q_org", "q_request", "q_channel"],
      }),
    });
    const res = await runAnalyze(input("怪しい連絡が来ました"), deps);
    expect(res.status).toBe("needs_more_info");
    if (res.status === "needs_more_info") {
      expect(res.questions).toHaveLength(2);
      expect(res.questions[0]).toBe(QUESTION_BANK.q_org);
      expect(res.questions[1]).toBe(QUESTION_BANK.q_request);
    }
  });

  it("未知の質問IDは無視し、有効なIDが無ければ検索へ進む", async () => {
    const { deps, embedCalls } = makeDeps({
      triage: JSON.stringify({ category: "consultation", missing: ["unknown_id"] }),
    });
    const res = await runAnalyze(input("警察を名乗る電話が来ました"), deps);
    expect(res.status).toBe("complete");
    expect(embedCalls.length).toBeGreaterThan(0);
  });

  it("回答済みならトリアージが質問を出しても再質問しない", async () => {
    const { deps } = makeDeps({
      triage: JSON.stringify({ category: "consultation", missing: ["q_org"] }),
    });
    const res = await runAnalyze(
      input("警察を名乗る電話が来ました", [
        { question: QUESTION_BANK.q_org, answer: "警察と名乗っています" },
      ]),
      deps,
    );
    expect(res.status).toBe("complete");
  });

  it("関連チャンクがあればcompleteと根拠Top 3を返す", async () => {
    const { deps } = makeDeps();
    const res = await runAnalyze(input("警察を名乗る電話で口座を調べると言われた"), deps);
    expect(res.status).toBe("complete");
    if (res.status === "complete") {
      expect(res.result.similar_cases).toEqual(["類似1", "類似2"]);
      expect(res.result.evidence).toHaveLength(3);
      const policeIds = CHUNKS.filter((c) => c.domain === "police").map((c) => c.id);
      for (const item of res.result.evidence) {
        expect(policeIds).toContain(item.id);
        expect(item.similarity).toBeGreaterThan(0.9);
        expect(item.sourceUrl).toMatch(/^https:\/\//);
      }
      const sims = res.result.evidence.map((e) => e.similarity);
      expect([...sims].sort((a, b) => b - a)).toEqual(sims);
      expect(res.result.corpus_version).toBeTruthy();
      expect(res.result.model).toBeTruthy();
    }
  });

  it("圏外入力は生成せずinsufficient_evidenceで停止する", async () => {
    const { deps, chatCalls } = makeDeps();
    const res = await runAnalyze(input("今日の夕飯のレシピを教えてください"), deps);
    expect(res.status).toBe("insufficient_evidence");
    if (res.status === "insufficient_evidence") {
      expect(res.contacts.length).toBeGreaterThan(0);
    }
    expect(chatCalls.filter((c) => c.kind === "generation")).toHaveLength(0);
  });

  it("生成側がrelated:falseを返したら停止する", async () => {
    const { deps } = makeDeps({ generation: JSON.stringify({ related: false }) });
    const res = await runAnalyze(input("警察を名乗る電話が来ました"), deps);
    expect(res.status).toBe("insufficient_evidence");
  });

  it("閾値を上げると同じ入力でも停止する", async () => {
    process.env.MATTA_MIN_SIMILARITY = "0.999999";
    const { deps } = makeDeps();
    const res = await runAnalyze(input("警察を名乗る電話が来ました"), deps);
    expect(res.status).toBe("insufficient_evidence");
  });
});

describe("runAnalyze: LLM出力の異常系", () => {
  it("コードフェンス付きJSONも解釈できる", async () => {
    const wrapped =
      "```json\n" +
      JSON.stringify({
        related: true,
        similar_cases: ["a"],
        danger_signs: ["b"],
        normal_response: ["c"],
        do_not: ["d"],
        safe_verification: ["e"],
      }) +
      "\n```";
    const { deps } = makeDeps({ generation: wrapped });
    const res = await runAnalyze(input("警察を名乗る電話が来ました"), deps);
    expect(res.status).toBe("complete");
  });

  it("生成が2回連続で壊れたJSONならinvalid_outputを投げる", async () => {
    const { deps, chatCalls } = makeDeps({ generation: "これはJSONではありません" });
    await expect(
      runAnalyze(input("警察を名乗る電話が来ました"), deps),
    ).rejects.toMatchObject({ code: "invalid_output" });
    expect(chatCalls.filter((c) => c.kind === "generation")).toHaveLength(2);
  });

  it("1回目が壊れて2回目が正常ならリトライで成功する", async () => {
    let count = 0;
    const { deps } = makeDeps({
      generation: () => {
        count += 1;
        if (count === 1) return "broken";
        return JSON.stringify({
          related: true,
          similar_cases: ["a"],
          danger_signs: ["b"],
          normal_response: ["c"],
          do_not: ["d"],
          safe_verification: ["e"],
        });
      },
    });
    const res = await runAnalyze(input("警察を名乗る電話が来ました"), deps);
    expect(res.status).toBe("complete");
  });

  it("トリアージ出力がスキーマ不一致ならinvalid_outputを投げる", async () => {
    const { deps } = makeDeps({
      triage: JSON.stringify({ category: "banana", missing: [] }),
    });
    await expect(runAnalyze(input("怪しい連絡"), deps)).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  it("生成スキーマ不一致（配列欠落）ならinvalid_outputを投げる", async () => {
    const { deps } = makeDeps({
      generation: JSON.stringify({ related: true, similar_cases: ["a"] }),
    });
    await expect(
      runAnalyze(input("警察を名乗る電話が来ました"), deps),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("UpstreamErrorはそのまま伝播する", async () => {
    const deps: AnalyzeDeps = {
      embedTexts: async () => {
        throw new UpstreamError("upstream_timeout", "timeout");
      },
      chatJson: async () =>
        JSON.stringify({ category: "consultation", missing: [] }),
    };
    await expect(runAnalyze(input("警察を名乗る電話"), deps)).rejects.toMatchObject({
      code: "upstream_timeout",
    });
  });
});

describe("extractJson", () => {
  it("素のJSON・フェンス付き・前後テキスト付きを解釈できる", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('結果: {"a":1} 以上')).toEqual({ a: 1 });
  });

  it("JSONが無ければ例外を投げる", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
