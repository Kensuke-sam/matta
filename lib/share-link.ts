/**
 * 共有リンク（/#pin=…）のURLフラグメントからPINを取り出す。
 *
 * URLSearchParamsはフラグメントをフォーム形式として解釈し「+」を空白へ
 * 変換してしまうため使わない（手入力では通るPINが共有リンクだけ失敗する）。
 *
 * リンク作成側との契約:
 * - 「+」はそのまま書いてよい（空白へ変換しない）
 * - 「&」「%」「#」をPINに含める場合はパーセントエンコードする（例: & → %26）
 */
export function parseSharedPin(hash: string): string | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment.length === 0) return null;
  for (const part of fragment.split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) !== "pin") continue;
    const raw = part.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      // 不正な%表記はそのまま返し、サーバー側のPIN検証で弾かせる
      return raw;
    }
  }
  return null;
}
