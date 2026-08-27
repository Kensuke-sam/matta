import { describe, expect, it } from "vitest";
import { parseGenerationOutput, parseTriageOutput } from "@/lib/analyze-output";
import { generationPrompts, triagePrompts } from "@/lib/prompts";
import { QUESTION_IDS } from "@/lib/questions";
import type { Retrieved } from "@/lib/retrieval";

describe("prompt contracts", () => {
  it("一次トリアージは3カテゴリと固定質問IDだけをsystemに渡し、相談内容をuserに置く", () => {
    const prompts = triagePrompts({
      message: "警察を名乗る電話が来ました",
      answers: [],
    });

    expect(prompts.system).toContain("一次トリアージ");
    expect(prompts.system).toContain("out_of_scope");
    expect(prompts.system).toContain('{"category":"consultation","missing":["q_org"]}');
    expect(prompts.system).not.toContain("incident|consultation|out_of_scope");
    for (const id of QUESTION_IDS) expect(prompts.system).toContain(id);
    expect(prompts.user).toContain("警察を名乗る電話が来ました");
    expect(prompts.system).not.toContain("警察を名乗る電話が来ました");
  });

  it("明確な対象外入力は追加質問をせずout_of_scopeにする契約を含む", () => {
    const { system } = triagePrompts({
      message: "今日の夕飯の献立を考えてください。",
      answers: [],
    });

    expect(system).toContain("MATTAの目的と明確に無関係な依頼だけ");
    expect(system).toContain('"out_of_scope" の missing は必ず空配列');
  });

  it("生成は参考資料をsystemに置き、具体的事実との対応がなければrelated:falseだけを返す契約にする", () => {
    const retrieved: Retrieved[] = [
      {
        chunk: {
          id: "police-1",
          domain: "police",
          title: "ニセ警察",
          content: "警察を名乗り口座を調べるよう求める手口です。",
          source: { name: "警察庁", url: "https://example.test", checkedAt: "2026-08-27" },
        },
        similarity: 0.9,
      },
    ];
    const prompts = generationPrompts(
      { message: "知らない人から電話がありました", answers: [] },
      retrieved,
    );

    expect(prompts.system).toContain("# 参考資料");
    expect(prompts.system).toContain("対応がない場合");
    expect(prompts.system).toContain('{"related":false}');
    expect(prompts.system).toContain("警察を名乗り口座を調べるよう求める手口です。");
    expect(prompts.user).toContain("知らない人から電話がありました");
    expect(prompts.user).not.toContain("警察を名乗り口座を調べるよう求める手口です。");
  });

  it("トリアージは既知IDが最大2件のconsultationだけを受理する", () => {
    expect(
      parseTriageOutput({
        category: "consultation",
        missing: ["q_official_route", "q_additional_request"],
      }),
    ).not.toBeNull();
    expect(parseTriageOutput({ category: "out_of_scope", missing: [] })).not.toBeNull();
    expect(parseTriageOutput({ category: "out_of_scope", missing: ["q_org"] })).toBeNull();
    expect(parseTriageOutput({ category: "consultation", missing: ["unknown"] })).toBeNull();
    expect(
      parseTriageOutput({
        category: "consultation",
        missing: ["q_org", "q_request", "q_done"],
      }),
    ).toBeNull();
  });

  it("生成は根拠付きの1〜4件出力か、他キーなしのrelated:falseだけを受理する", () => {
    const complete = {
      related: true,
      similar_cases: ["類似"],
      danger_signs: ["危険"],
      normal_response: ["通常"],
      do_not: ["しない"],
      safe_verification: ["#9110へ相談"],
    };
    expect(parseGenerationOutput(complete)).not.toBeNull();
    expect(parseGenerationOutput({ ...complete, related: undefined })).toBeNull();
    expect(
      parseGenerationOutput({ ...complete, danger_signs: ["1", "2", "3", "4", "5"] }),
    ).toBeNull();
    expect(parseGenerationOutput({ related: false })).toEqual({ unrelated: true });
    expect(parseGenerationOutput({ related: false, danger_signs: ["危険"] })).toBeNull();
  });
});
