/**
 * 追加質問の固定文言バンク。
 * 追加質問は固定文言で最大2問とする方針（LLMは「どの質問が必要か」だけを選び、
 * 質問文そのものは生成しない）。
 */
export const QUESTION_BANK = {
  q_org: "相手は、どこの組織・会社・人物だと名乗っていますか?（例: 警察、宅配業者、求人の担当者）",
  q_request:
    "相手から今、具体的に何をするよう求められていますか?（例: 振り込み、URLを開く、身分証の写真を送る）",
  q_channel:
    "やり取りはどの手段で来ていますか? 別のアプリへ移るよう言われていますか?（例: 電話、SMS、LINE、テレグラム）",
  q_urgency: "「今すぐ」「誰にも言わないで」のような、急かしや口止めはありますか?",
  q_done:
    "お金や個人情報（口座・暗証番号・身分証など）について、すでに何か渡したり入力したりしましたか?",
  q_official_route:
    "その案内は、相手の公式サイト・公式アプリ・登録済みの窓口でも確認できますか?",
  q_additional_request:
    "最初に説明された用件以外に、お金の支払い、個人情報や身分証の送信、別のアプリへの移動を求められていますか?",
} as const;

export type QuestionId = keyof typeof QUESTION_BANK;

export const QUESTION_IDS = Object.keys(QUESTION_BANK) as QuestionId[];

export const MAX_QUESTIONS = 2;

export function isQuestionId(value: string): value is QuestionId {
  return Object.prototype.hasOwnProperty.call(QUESTION_BANK, value);
}

export function questionTextById(id: QuestionId): string {
  return QUESTION_BANK[id];
}

/** 検証済みの質問IDを重複なく固定文言に解決し、最大2問に制限する */
export function resolveQuestions(ids: string[]): { id: QuestionId; text: string }[] {
  const seen = new Set<QuestionId>();
  for (const id of ids) {
    if (isQuestionId(id)) seen.add(id);
    if (seen.size >= MAX_QUESTIONS) break;
  }
  return [...seen].map((id) => ({ id, text: QUESTION_BANK[id] }));
}
