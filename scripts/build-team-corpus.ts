/**
 * data/のチーム収集JSONL 3ファイルを検証・除去処理し、lib/corpus-team.jsonへ変換する。
 *
 *   npm run build:corpus
 *
 * 出力はコミット対象の生成物で、アプリはJSONを直接importする（実行時にJSONLを読まない）。
 * Node 24の型ストリップ実行を前提に、相対importは拡張子付きで書く
 * （このスクリプトはNext.jsのビルド・実行時バンドルには含まれない）。
 *
 * 採用条件: source_urlがhttpsで、除去後本文が50字を超えるエントリだけをChunk化する
 * （UIが出典リンクを表示するため出典なしのframework/meta系自作整理を除外し、
 * 「◯◯県警の啓発ページ」等の目録型スタブはコーパス品質基準
 * （tests/retrieval.test.tsのcontent>50字）に合わせて除外する。除外IDは表示する）。
 * title/textはlib/sanitize.tsのredactContactInfoで電話番号・URL・メールアドレスを
 * プレースホルダーへ置換してから収録する（偽SMS例文由来の連絡先が、そのまま生成結果へ
 * 引用されて出力フィルタcontainsDisallowedContactと衝突することを防ぐ）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { containsDisallowedContact, redactContactInfo } from "../lib/sanitize.ts";
import type { Chunk, Domain } from "../lib/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(ROOT, "lib", "corpus-team.json");

// チーム担当がSlackで納品した収集ファイルの受領日（各エントリのライブ再確認日ではない）
const RECEIVED_AT = "2026-08-25";

const SOURCES: { file: string; domain: Domain }[] = [
  { file: "nise_keisatsu_cases_rag.jsonl", domain: "police" },
  { file: "takuhai_sms_rag.jsonl", domain: "delivery" },
  { file: "yamibaito_rag.jsonl", domain: "yamibaito" },
];

function fail(message: string): never {
  console.error(`[build-team-corpus] ${message}`);
  process.exit(1);
}

function requireString(row: Record<string, unknown>, key: string, where: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${where}: フィールド "${key}" が空か文字列ではありません`);
  }
  return value.trim();
}

function main(): void {
  const chunks: Chunk[] = [];
  const seenIds = new Set<string>();
  for (const { file, domain } of SOURCES) {
    const lines = readFileSync(join(ROOT, "data", file), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    const noSource: string[] = [];
    const tooShort: string[] = [];
    let adopted = 0;
    for (const [index, line] of lines.entries()) {
      const where = `${file}:${index + 1}`;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        fail(`${where}: JSONとして解析できません`);
      }
      const id = requireString(row, "id", where);
      if (seenIds.has(id)) fail(`${where}: ID "${id}" が重複しています`);
      seenIds.add(id);

      const url = typeof row.source_url === "string" ? row.source_url.trim() : "";
      if (url.length === 0) {
        noSource.push(id);
        continue;
      }
      if (!url.startsWith("https://")) fail(`${where}: source_urlがhttpsではありません`);

      const title = redactContactInfo(requireString(row, "title", where));
      const content = redactContactInfo(requireString(row, "text", where));
      if (content.length <= 50) {
        tooShort.push(id);
        continue;
      }
      if (containsDisallowedContact(`${title}\n${content}`)) {
        fail(`${where}: 除去後も許可外の連絡先らしき文字列が残っています`);
      }
      chunks.push({
        id,
        domain,
        title,
        content,
        source: {
          name: requireString(row, "publisher", where),
          url,
          checkedAt: RECEIVED_AT,
        },
      });
      adopted++;
    }
    console.log(
      `[build-team-corpus] ${file}: 採用${adopted}件 / 出典なし除外${noSource.length}件（${noSource.join(", ") || "-"}）/ 50字以下除外${tooShort.length}件（${tooShort.join(", ") || "-"}）`,
    );
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(chunks, null, 2)}\n`);
  console.log(`[build-team-corpus] 完了: ${chunks.length}件を lib/corpus-team.json へ出力`);
}

main();
