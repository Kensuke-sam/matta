import { describe, expect, it } from "vitest";
import { DEMOS } from "@/lib/demos";
import { detectCompletedIncident } from "@/lib/incident-detect";
import type { ValidatedInput } from "@/lib/validate";

function input(message: string, answers: ValidatedInput["answers"] = []): ValidatedInput {
  return { message, answers };
}

describe("detectCompletedIncident", () => {
  it("明確な既遂表現を検出する", () => {
    const positives = [
      "さっきATMでお金を振り込んでしまいました。",
      "キャッシュカードを渡してしまった。どうしよう。",
      "URLを開いてパスワードを入力してしまいました。",
      "身分証の写真を送ってしまい、怖くなっています。",
      "言われたアプリを入れてしまいました。",
      "すでに3万円振り込みました。",
      "もう払いました。",
    ];
    for (const message of positives) {
      expect(detectCompletedIncident(input(message)), message).toBe(true);
    }
  });

  it("被害前の相談を既遂と誤検出しない", () => {
    const negatives = [
      "振り込んでしまいそうです。止めてほしいです。",
      "振り込むように言われています。",
      "身分証の写真を送るように言われています。",
      "まだ何も渡していません。",
      "URLを開こうか迷っています。",
      "パスワードを教えてくださいと言われました。",
    ];
    for (const message of negatives) {
      expect(detectCompletedIncident(input(message)), message).toBe(false);
    }
  });

  it("3種類のデモ入力はいずれも既遂にならない", () => {
    for (const demo of DEMOS) {
      expect(detectCompletedIncident(input(demo.text)), demo.id).toBe(false);
    }
  });

  it("q_doneへの肯定回答を既遂として扱う", () => {
    expect(
      detectCompletedIncident(
        input("怪しい電話がありました", [
          { questionId: "q_done", answer: "はい、渡しました" },
        ]),
      ),
    ).toBe(true);
    expect(
      detectCompletedIncident(
        input("怪しい電話がありました", [
          { questionId: "q_done", answer: "いいえ、まだです" },
        ]),
      ),
    ).toBe(false);
    // q_done以外の回答の「はい」は既遂扱いにしない
    expect(
      detectCompletedIncident(
        input("怪しい電話がありました", [
          { questionId: "q_urgency", answer: "はい、急かされています" },
        ]),
      ),
    ).toBe(false);
  });

  it("回答文中の既遂表現も検出する", () => {
    expect(
      detectCompletedIncident(
        input("怪しい電話がありました", [
          { questionId: "q_request", answer: "口座番号を教えてしまいました" },
        ]),
      ),
    ).toBe(true);
  });
});
