/**
 * デプロイ済みMATTA（Preview / Production）に対する受け入れ検証スクリプト。
 *
 *   MATTA_VERIFY_PIN=<PIN> npm run verify:deploy -- --url https://<デプロイ先>
 *
 * オプション:
 *   --expect-backend upstash|local  検索バックエンドの期待値（既定: upstash）
 *   --skip-vector-count             healthのseed 12件チェックを省略（localバックエンド検証時）
 *
 * 検証内容（実API・実Vector DBを使用）:
 *   1. /api/health: ok・OpenAI/PIN設定・コーパス12件・検索バックエンド・Vector DB接続とseed件数
 *   2. PINログイン（Cookie取得）
 *   3. 3デモ入力: complete・期待ドメインの根拠Top 3・バックエンド・フォールバックなし
 *   4. 各デモの言い換え: 同上（Embedding意味検索の言い換え耐性）
 *   5. 圏外入力: insufficient_evidenceで停止（フォールバックしない）
 *   6. 既遂入力: incidentカードへ分岐
 *   7. 各ケース60秒以内
 *
 * PINはMATTA_VERIFY_PIN環境変数だけから読み、画面・ログへ出さない。
 * 送信する相談文はすべて架空の固定フィクスチャで、実在の連絡先・個人情報を含まない。
 */
import { CHUNKS } from "../lib/corpus.ts";
import { DEMOS } from "../lib/demos.ts";
import type { AnalyzeResponse, Domain, HealthResponse } from "../lib/types.ts";

const CASE_TIMEOUT_MS = 65_000;
const TIME_BUDGET_MS = 60_000;

type ExpectedStatus = "complete" | "insufficient_evidence" | "incident";

type VerifyCase = {
  label: string;
  text: string;
  expect: ExpectedStatus;
  /** completeの場合に根拠Top 1へ期待するドメイン */
  domain?: Domain;
};

// 言い換えケース: デモと同じ架空の場面を、重要語を変えた自然文で表す
const PARAPHRASES: VerifyCase[] = [
  {
    label: "言い換え（ニセ警察）",
    text: "知らない番号から捜査担当を名乗る人の電話があり、口座が事件に使われているので調べる必要があると言われました。誰にも話すなとも言われ、指定の口座へお金を移すよう求められています。",
    expect: "complete",
    domain: "police",
  },
  {
    label: "言い換え（配送フィッシング）",
    text: "荷物を届けられなかったという知らせが携帯のメッセージで届き、確認のためリンクを開いて情報を入れるように書かれています。開いても大丈夫でしょうか。",
    expect: "complete",
    domain: "delivery",
  },
  {
    label: "言い換え（闇バイト）",
    text: "SNSで見つけた「簡単に稼げる仕事」に連絡したら、匿名性の高いチャットアプリへ移るよう言われ、身分証明書の画像を送るよう指示されました。辞めたいのですが不安です。",
    expect: "complete",
    domain: "yamibaito",
  },
];

const DEMO_DOMAINS: Record<string, Domain> = {
  police: "police",
  delivery: "delivery",
  sidejob: "yamibaito",
};

const CHUNK_DOMAIN = new Map(CHUNKS.map((chunk) => [chunk.id, chunk.domain]));

function parseArgs(argv: string[]): {
  url: string;
  expectBackend: "upstash" | "local";
  skipVectorCount: boolean;
} {
  let url = "";
  let expectBackend: "upstash" | "local" = "upstash";
  let skipVectorCount = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") url = argv[++i] ?? "";
    else if (argv[i] === "--expect-backend") {
      const raw = argv[++i];
      if (raw !== "upstash" && raw !== "local") {
        fail(`--expect-backend は upstash か local を指定してください（指定値を確認）`);
      }
      expectBackend = raw;
    } else if (argv[i] === "--skip-vector-count") skipVectorCount = true;
  }
  if (!url) {
    fail("--url https://<デプロイ先> を指定してください。");
  }
  return { url: url.replace(/\/+$/, ""), expectBackend, skipVectorCount };
}

function fail(message: string): never {
  console.error(`[verify] NG: ${message}`);
  process.exit(1);
}

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  const suffix = detail ? ` — ${detail}` : "";
  if (ok) {
    console.log(`[verify] OK: ${label}${suffix}`);
  } else {
    failures += 1;
    console.error(`[verify] NG: ${label}${suffix}`);
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(CASE_TIMEOUT_MS),
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 非JSONは呼び出し側でstatusから判断する
  }
  return { status: res.status, body, headers: res.headers };
}

async function main(): Promise<void> {
  const { url, expectBackend, skipVectorCount } = parseArgs(process.argv.slice(2));
  const pin = process.env.MATTA_VERIFY_PIN ?? "";
  if (!pin) {
    fail("環境変数 MATTA_VERIFY_PIN にデモ用PINを設定してください（ログへは出しません）。");
  }

  console.log(`[verify] 対象: ${url} / 期待バックエンド: ${expectBackend}`);

  // 1. health
  const health = await requestJson(`${url}/api/health`, { method: "GET" });
  check(health.status === 200, "healthが200を返す", `status=${health.status}`);
  const h = health.body as HealthResponse;
  check(h?.ok === true, "health.ok");
  check(h?.openai_configured === true, "OPENAI_API_KEY設定済み");
  check(h?.pin_configured === true, "PIN設定済み");
  check(h?.chunk_count === 12, "コーパス12チャンク", `chunk_count=${h?.chunk_count}`);
  check(
    h?.search_backend === expectBackend,
    `検索バックエンドが${expectBackend}`,
    `search_backend=${h?.search_backend}`,
  );
  if (expectBackend === "upstash") {
    check(h?.vector_store?.configured === true, "Vector DB設定済み");
    check(h?.vector_store?.reachable === true, "Vector DBへ接続可能");
    if (!skipVectorCount) {
      check(
        h?.vector_store?.namespace_vector_count === 12,
        `namespace "${h?.corpus_version}" にseed 12件`,
        `count=${h?.vector_store?.namespace_vector_count}`,
      );
    }
  }

  // 2. PINログイン
  const session = await requestJson(`${url}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (session.status !== 200) {
    fail(`PINログインに失敗しました（status=${session.status}）。PINと対象URLを確認してください。`);
  }
  const cookie = (session.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) {
    fail("セッションCookieを取得できませんでした。");
  }

  // 3〜6. 相談ケース
  const cases: VerifyCase[] = [
    ...DEMOS.map((demo) => ({
      label: `デモ（${demo.label}）`,
      text: demo.text,
      expect: "complete" as const,
      domain: DEMO_DOMAINS[demo.id],
    })),
    ...PARAPHRASES,
    {
      label: "圏外入力",
      text: "今日の夕飯の献立を考えてください。",
      expect: "insufficient_evidence",
    },
    {
      label: "既遂入力",
      text: "警察を名乗る人に言われるまま、さっきATMでお金を振り込んでしまいました。",
      expect: "incident",
    },
  ];

  for (const testCase of cases) {
    const startedAt = Date.now();
    const res = await requestJson(`${url}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ message: testCase.text }),
    });
    const elapsedMs = Date.now() - startedAt;
    const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;
    if (res.status !== 200) {
      check(false, testCase.label, `status=${res.status} (${elapsed})`);
      continue;
    }
    const body = res.body as AnalyzeResponse;
    check(
      body.status === testCase.expect,
      `${testCase.label}: status=${testCase.expect}`,
      `実際=${body.status} (${elapsed})`,
    );
    check(elapsedMs <= TIME_BUDGET_MS, `${testCase.label}: 60秒以内`, elapsed);

    if (body.status === "complete" && testCase.expect === "complete") {
      const r = body.result;
      const topIds = r.evidence.map((e) => `${e.id}:${e.similarity.toFixed(3)}`).join(", ");
      check(r.evidence.length === 3, `${testCase.label}: 根拠Top 3`, topIds);
      const topDomain = CHUNK_DOMAIN.get(r.evidence[0]?.id ?? "");
      check(
        topDomain === testCase.domain,
        `${testCase.label}: Top 1が期待ドメイン（${testCase.domain}）`,
        `Top 1=${r.evidence[0]?.id}`,
      );
      check(
        r.search_backend === expectBackend,
        `${testCase.label}: バックエンド=${expectBackend}`,
        `実際=${r.search_backend}`,
      );
      check(!r.search_fallback, `${testCase.label}: フォールバックなし`);
    }
    if (body.status === "insufficient_evidence" && testCase.expect === "insufficient_evidence") {
      check(
        body.search?.backend === expectBackend,
        `${testCase.label}: ${expectBackend}で検索した上で停止`,
        `top_similarity=${body.search?.top_similarity ?? "なし"} < ${body.search?.threshold}`,
      );
      check(body.search?.fallback === false, `${testCase.label}: フォールバックなし`);
    }
  }

  console.log("");
  if (failures > 0) {
    console.error(`[verify] 失敗 ${failures} 件。上のNG行を確認してください。`);
    process.exit(1);
  }
  console.log("[verify] すべて成功しました。");
}

try {
  await main();
} catch (err) {
  // 接続不能・タイムアウト等。PINは含まれない情報だけを表示する
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[verify] NG: 実行中にエラーが発生しました（${message}）。URLとネットワークを確認してください。`);
  process.exit(1);
}
