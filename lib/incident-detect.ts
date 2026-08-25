import type { ValidatedInput } from "./validate";

/**
 * 既遂（すでに渡した・入力した等）の決定論的な検出。
 * LLMトリアージの誤分類やプロンプト注入で既遂入力が通常RAGへ流れないよう、
 * LLM呼び出しの前に必ず評価する第一防衛線。ここで拾えない表現はLLM側が判定する。
 */

// 「振り込んでしまいました」「渡してしまった」など完了+後悔の定型。
// 「〜してしまいそう」(未遂)は除外する
const COMPLETED_RE =
  /(振り込ん|振込ん|送金し|渡し|払っ|支払っ|入金し|入力し|教え|伝え|送っ|提出し|登録し|インストールし|入れ)(て|で)しま(い(?!そう)|っ)/;

// 「すでに振り込みました」「もう払いました」など明示的な完了表現。
// 直後が「か／よね／?」の場合は、相手の発言の引用（「もう振り込みましたか」と
// 言われた等）である可能性が高いため対象外にする。
// 注: 「振り込みました」単独（すでに・もう無し）は意図的に拾わない。
// このゲートは誤発火が既遂カードへ不可逆に分岐する第一防衛線のため精度を優先し、
// ここで拾えない完了表現はLLMトリアージ側が判定する
const EXPLICIT_DONE_RE =
  /(すでに|もう)[^。、]{0,6}(振り込みました|振り込んだ|送金しました|送金した|支払いました|支払った|払いました|払った|渡しました|渡した|教えました|教えた|送りました|送った|入力しました|入力した)(?!(?:か|よね|\?|？))/;

// q_done（すでに渡したか）への肯定回答
const AFFIRMATIVE_RE = /^(はい|うん|そうです)/;

// 「はい、まだ渡していません」のような肯定語+否定内容を既遂と誤検出しないための否定表現
const NEGATIVE_RE = /まだ|いいえ|いません|ていない|でいない|ておらず|でおらず|ないです/;

export function detectCompletedIncident(input: ValidatedInput): boolean {
  const texts = [input.message, ...input.answers.map((a) => a.answer)].map((t) =>
    t.normalize("NFKC"),
  );
  const joined = texts.join("\n");
  if (COMPLETED_RE.test(joined) || EXPLICIT_DONE_RE.test(joined)) return true;

  const doneAnswer = input.answers.find((a) => a.questionId === "q_done");
  if (doneAnswer) {
    const answer = doneAnswer.answer.normalize("NFKC").trim();
    if (AFFIRMATIVE_RE.test(answer) && !NEGATIVE_RE.test(answer)) {
      return true;
    }
  }
  return false;
}
