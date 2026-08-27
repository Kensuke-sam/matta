import { describe, expect, it } from "vitest";
import { triagePrompts } from "@/lib/prompts";

describe("triagePrompts", () => {
  it("明確な圏外相談には追加質問せず意味検索へ進める規則を含む", () => {
    const { system } = triagePrompts({
      message: "今日の夕飯の献立を考えてください。",
      answers: [],
    });

    expect(system).toContain("詐欺や不審な連絡と明確に無関係な相談には追加質問をせず");
    expect(system).toContain("後段の意味検索が根拠不足として停止します");
  });
});
