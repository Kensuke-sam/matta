/**
 * LLM生成テキストの決定論的な安全フィルタ。
 * 参考資料と公式窓口（#9110 / 188 / 110）以外の電話番号らしき文字列を
 * 生成結果に含めさせない。検出した場合、呼び出し側はその出力全体を不採用にする
 * （プロンプト注入・幻覚のシグナルとみなす）。
 *
 * 割り切り: 年号・金額との誤検出を避けるため、単独の3桁数字（119等）は検査しない。
 * ハイフン付き・0始まり10〜11桁・#付き特番だけを対象にする。
 */

// 区切りはハイフン類・空白・括弧を許容し、+81の国際表記も対象にする
// （NFKCで全角数字・全角括弧・全角空白は半角へ正規化済みの前提）
const PHONE_LIKE_RE =
  /(?:\+81[-‐－ー\s]?)?0?\d{1,4}[\s]?[(]\d{1,4}[)][\s]?\d{2,4}|(?:\+81[-‐－ー\s]?\d{1,4}|0\d{0,4})[-‐－ー\s]\d{1,4}[-‐－ー\s]\d{2,4}|(?<!\d)(?:\+81|0)\d{9,10}(?!\d)|#\d{3,5}/g;

const ALLOWED = new Set(["#9110"]);

export function containsDisallowedContact(text: string): boolean {
  const normalized = text.normalize("NFKC");
  for (const match of normalized.matchAll(PHONE_LIKE_RE)) {
    if (!ALLOWED.has(match[0])) return true;
  }
  // 生成出力には連絡先を固定文言（SAFE_CONTACTS）以外で含めさせない:
  // URL・メールアドレスらしき文字列も注入・幻覚のシグナルとして拒否する。
  // （/gフラグ付きRegExpはtest()だとlastIndexが残るため、search()で判定する）
  return normalized.search(URL_RE) !== -1 || normalized.search(EMAIL_RE) !== -1;
}

export function listsContainDisallowedContact(lists: string[][]): boolean {
  return lists.some((items) => items.some((item) => containsDisallowedContact(item)));
}

/**
 * 相談入力の決定論的な個人情報除去。
 * 電話番号・URL・メールアドレスを固定プレースホルダーへ置換してから
 * 外部API（Embedding・LLM）へ渡す。判定に必要な意味情報ではないため、
 * 除去しても検索・生成の品質へ影響しない。
 * 公式窓口（#9110）は相談文の意味を保つためそのまま残す。
 * 氏名・住所など自由記述の固有情報は決定論的に判別できないため対象外とし、
 * 入力欄の注意書きと固定質問設計（連絡先を尋ねない）で扱う。
 */

// URLはASCIIのURL構成文字だけを対象にし、直後に続く日本語文を巻き込まない。
// scheme付き・www.に加え、パス付きの裸ドメイン（example.jp/abc 形式）も対象。
// パスなしの裸ドメイン（amazon.co.jp など）は事業者名の言及と区別できないため残す
const URL_RE =
  /(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#@!$&'*+,;=%]+|(?<![@\w.])[A-Za-z0-9](?:[A-Za-z0-9-]*\.)+[A-Za-z]{2,}\/[A-Za-z0-9\-._~:/?#@!$&'*+,;=%]+/gi;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactContactInfo(text: string): string {
  let result = text.normalize("NFKC");
  result = result.replace(URL_RE, "[URL]");
  result = result.replace(EMAIL_RE, "[メールアドレス]");
  result = result.replace(PHONE_LIKE_RE, (match) => (ALLOWED.has(match) ? match : "[電話番号]"));
  return result;
}
