/**
 * LLM生成テキストの決定論的な安全フィルタ。
 * 参考資料と公式窓口（#9110 / 188 / 110）以外の電話番号らしき文字列を
 * 生成結果に含めさせない。検出した場合、呼び出し側はその出力全体を不採用にする
 * （プロンプト注入・幻覚のシグナルとみなす）。
 *
 * 割り切り: 年号・金額との誤検出を避けるため、単独の3桁数字（119等）は検査しない。
 * 0または+81始まりの電話番号らしき並びと、#付き特番だけを対象にする。
 */

// 電話番号らしさの判定は2段階:
// 1) 候補抽出: 0・+81・「(0」で始まり、数字と区切り（ハイフン類・空白・括弧）が続く並び
// 2) 桁数検証: 区切りを除いた数字が国内10〜11桁（+81系は12〜13桁）のときだけ電話番号と扱う
// これにより (03)1234-5678 / 03-12345678 / +81 (0)3 1234 5678 等の一般表記を捕捉しつつ、
// 年号・金額（2026年・5000円）や郵便番号・短い数字列を誤検出しない。
// （NFKCで全角数字・全角括弧・全角空白は半角へ正規化済みの前提）
// 既知の限界: 空白区切りの電話番号2つが句読点なしで連続する文は1候補に融合し
// 桁数検証で外れる（置換されない）。句読点・助詞があれば正しく分割される。
const PHONE_CANDIDATE_RE = /(?<![\d#+])[(]?(?:\+81|0)[\d()\-‐－ー\s]{6,16}\d|#\d{3,5}/g;

function isPhoneLike(candidate: string): boolean {
  if (candidate.startsWith("#")) return true;
  const digits = candidate.replace(/\D/g, "");
  if (candidate.includes("+81")) return digits.length >= 12 && digits.length <= 13;
  return digits.length >= 10 && digits.length <= 11;
}

const ALLOWED = new Set(["#9110"]);

export function containsDisallowedContact(text: string): boolean {
  const normalized = text.normalize("NFKC");
  for (const match of normalized.matchAll(PHONE_CANDIDATE_RE)) {
    if (isPhoneLike(match[0]) && !ALLOWED.has(match[0])) return true;
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
  result = result.replace(PHONE_CANDIDATE_RE, (match) =>
    isPhoneLike(match) && !ALLOWED.has(match) ? "[電話番号]" : match,
  );
  return result;
}
