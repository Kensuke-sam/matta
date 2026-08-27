/**
 * デプロイ済みMATTA（Preview / Production）に対する受け入れ検証スクリプト。
 *
 *   MATTA_VERIFY_PIN=<PIN> npm run verify:deploy -- --url https://<デプロイ先>
 *
 * オプション:
 *   --expect-backend upstash|local  検索バックエンドの期待値（既定: upstash）
 *   --skip-vector-count             healthのseed 12件チェックを省略（localバックエンド検証時）
 *   --gate                          本番デモ完走ゲート: ニセ警察デモだけをN回連続実行し、
 *                                   各回 complete・根拠Top 3（police）・5項目非空・60秒以内を判定する。
 *                                   Vector導入前の旧デプロイにも使えるよう、バックエンド項目は検査しない
 *   --gate-runs <N>                 ゲートの連続実行回数（既定: 3）
 *
 * 検証内容（実API・実Vector DBを使用）:
 *   1. /api/health: ok・OpenAI/PIN設定・コーパス12件・検索バックエンド・Vector DB接続とseed件数
 *   2. PINログイン（Cookie取得）
 *   3. 3デモ入力: 必要なら固定質問へ回答した後、complete・期待ドメインの根拠Top 3・バックエンド・フォールバックなし
 *   4. 各デモの言い換え: 同上（Embedding意味検索の言い換え耐性）
 *   5. 圏外入力: insufficient_evidenceで停止（フォールバックしない）
 *   6. 既遂入力: incidentカードへ分岐
 *   7. 各ケース60秒以内
 *
 * PINは環境変数MATTA_VERIFY_PIN、無ければ`matta/.env.local`のMATTA_VERIFY_PIN行から読む。
 * いずれも値は画面・ログへ出さない。
 * 送信する相談文はすべて架空の固定フィクスチャで、実在の連絡先・個人情報を含まない。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHUNKS, CORPUS_VERSION } from "../lib/corpus.ts";
import { DEMOS } from "../lib/demos.ts";
import { isQuestionId } from "../lib/questions.ts";
import type { QuestionId } from "../lib/questions.ts";
import type { AnalyzeResponse, AnswerInput, Domain, HealthResponse } from "../lib/types.ts";

// 全HTTP往復（health・ログイン・analyze）はAbortSignal.timeout(65s)で必ず打ち切る。
// 60秒SLAとの5秒差は意図的な余裕: 60秒超過は「NG判定+実測時間の報告」で扱い、
// 65秒で接続自体を破棄する（ハングでゲートが止まらないための上限）
const CASE_TIMEOUT_MS = 65_000;
const TIME_BUDGET_MS = 60_000;

type ExpectedStatus = "complete" | "insufficient_evidence" | "incident";

type VerifyCase = {
  label: string;
  text: string;
  expect: ExpectedStatus;
  /** completeの場合に根拠Top 3へ期待するドメイン */
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

/**
 * 実APIが追加質問を選んだ場合に使う、架空ケース用の固定回答。
 * 質問文・回答文をモデルへ自由生成させず、検証対象ドメインと矛盾しない内容だけを使う。
 */
const FOLLOW_UP_ANSWERS: Record<Domain, Record<QuestionId, string>> = {
  police: {
    q_org: "警察の捜査担当者だと名乗っています。",
    q_request: "ビデオ通話へ移り、口座を調べるための指示に従うよう求められています。",
    q_channel: "知らない番号からの電話で、このあとビデオ通話へ移るよう言われています。",
    q_urgency: "今すぐ対応し、誰にも話さないよう言われています。",
    q_done: "いいえ、まだ送金も個人情報の提供もしていません。",
  },
  delivery: {
    q_org: "宅配業者だと書かれています。",
    q_request: "SMS内のリンクを開き、配送情報を確認するよう求められています。",
    q_channel: "携帯電話のSMSで届きました。別アプリへの移動は求められていません。",
    q_urgency: "急かす文言や口止めはありません。",
    q_done: "いいえ、まだリンクを開かず、情報も入力していません。",
  },
  yamibaito: {
    q_org: "SNSで見つけた求人の担当者だと名乗っています。",
    q_request: "匿名性の高いアプリへ移り、身分証の写真を送るよう求められています。",
    q_channel: "SNSのDMから、匿名性の高いチャットアプリへ移るよう言われています。",
    q_urgency: "今すぐとは言われていませんが、高収入を強調されています。",
    q_done: "いいえ、まだ身分証や個人情報を送っていません。",
  },
};

const CHUNK_DOMAIN = new Map(CHUNKS.map((chunk) => [chunk.id, chunk.domain]));

/**
 * .env.localからMATTA_VERIFY_PINだけを読み込む（環境変数が未設定の場合のみ）。
 * このスクリプトに他の秘密値（OPENAI_API_KEY等）は不要なため、
 * 検証プロセスへ展開しない。値は画面・ログへ出さない。
 */
function loadVerifyPinFromEnvLocal(): void {
  if (process.env.MATTA_VERIFY_PIN) return;
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // .env.localが無ければ環境変数だけで動かす
  }
  for (const line of raw.split("\n")) {
    const match = line.match(/^MATTA_VERIFY_PIN=(.*)$/);
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env.MATTA_VERIFY_PIN = value;
    return;
  }
}

function parseArgs(argv: string[]): {
  url: string;
  expectBackend: "upstash" | "local";
  skipVectorCount: boolean;
  gate: boolean;
  gateRuns: number;
} {
  let url = "";
  let expectBackend: "upstash" | "local" = "upstash";
  let skipVectorCount = false;
  let gate = false;
  let gateRuns = 3;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") url = argv[++i] ?? "";
    else if (argv[i] === "--expect-backend") {
      const raw = argv[++i];
      if (raw !== "upstash" && raw !== "local") {
        fail(`--expect-backend は upstash か local を指定してください（指定値を確認）`);
      }
      expectBackend = raw;
    } else if (argv[i] === "--skip-vector-count") skipVectorCount = true;
    else if (argv[i] === "--gate") gate = true;
    else if (argv[i] === "--gate-runs") {
      const raw = Number(argv[++i]);
      if (!Number.isInteger(raw) || raw < 1 || raw > 10) {
        fail("--gate-runs は1〜10の整数を指定してください。");
      }
      gateRuns = raw;
    }
  }
  if (!url) {
    fail("--url https://<デプロイ先> を指定してください。");
  }
  // PIN・Cookieを平文送信しないよう、ローカル以外はHTTPSだけを許可する
  const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url);
  if (!url.startsWith("https://") && !isLocal) {
    fail("httpsのURLを指定してください（httpはlocalhostのみ許可）。");
  }
  return { url: url.replace(/\/+$/, ""), expectBackend, skipVectorCount, gate, gateRuns };
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
    // PIN・Cookieが別originへ転送されないよう、リダイレクトはエラー扱いにする
    redirect: "error",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 非JSONは呼び出し側でstatusから判断する
  }
  return { status: res.status, body, headers: res.headers };
}

function printSummaryAndExit(): void {
  console.log("");
  if (failures > 0) {
    console.error(`[verify] 失敗 ${failures} 件。上のNG行を確認してください。`);
    process.exit(1);
  }
  console.log("[verify] すべて成功しました。");
}

async function loginAndGetCookie(url: string, pin: string): Promise<string> {
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
  return cookie;
}

/**
 * 本番デモ完走ゲート（落単回避の完成条件1・2）。
 * ニセ警察デモをruns回連続で実行し、各回 complete・根拠Top 3（police）・
 * 5項目非空・60秒以内を判定する。Vector導入前の旧デプロイにも使えるよう、
 * search_backend等のVector項目は検査しない。
 */
async function runDemoGate(url: string, pin: string, runs: number): Promise<void> {
  console.log(`[verify] 本番デモ完走ゲート: ニセ警察デモを${runs}回連続実行します`);

  const health = await requestJson(`${url}/api/health`, { method: "GET" });
  check(health.status === 200, "healthが200を返す", `status=${health.status}`);
  const h = health.body as HealthResponse;
  check(
    h?.ok === true && h?.openai_configured === true && h?.pin_configured === true,
    "health（ok・OpenAI・PIN設定済み）",
  );
  check(
    h?.chunk_count === CHUNKS.length,
    `コーパス${CHUNKS.length}チャンク`,
    `chunk_count=${h?.chunk_count}`,
  );
  if (h?.search_backend) {
    console.log(`[verify] 検索バックエンド: ${h.search_backend}`);
  }

  const cookie = await loginAndGetCookie(url, pin);
  const police = DEMOS.find((demo) => demo.id === "police");
  if (!police) {
    fail("ニセ警察デモの定義（lib/demos.ts id=police）が見つかりません。");
  }

  const times: string[] = [];
  for (let run = 1; run <= runs; run++) {
    const label = `完走 ${run}/${runs}`;
    const startedAt = Date.now();
    const res = await requestJson(`${url}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ message: police.text }),
    });
    const elapsedMs = Date.now() - startedAt;
    const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;
    times.push(elapsed);
    if (res.status !== 200) {
      check(false, label, `status=${res.status} (${elapsed})`);
      continue;
    }
    const body = res.body as AnalyzeResponse;
    check(body.status === "complete", `${label}: complete`, `実際=${body.status} (${elapsed})`);
    check(elapsedMs <= TIME_BUDGET_MS, `${label}: 60秒以内`, elapsed);
    if (body.status === "complete") {
      const r = body.result;
      const topIds = r.evidence.map((e) => `${e.id}:${e.similarity.toFixed(3)}`).join(", ");
      check(r.evidence.length === 3, `${label}: 根拠Top 3`, topIds);
      // Top 3すべてが期待ドメインで、重複がないこと（Top 1だけの判定にしない）
      check(
        r.evidence.every((e) => CHUNK_DOMAIN.get(e.id) === "police") &&
          new Set(r.evidence.map((e) => e.id)).size === r.evidence.length,
        `${label}: Top 3すべてpoliceドメイン・重複なし`,
        topIds,
      );
      const lists = [
        r.similar_cases,
        r.danger_signs,
        r.normal_response,
        r.do_not,
        r.safe_verification,
      ];
      check(
        lists.every(
          (list) =>
            Array.isArray(list) &&
            list.length > 0 &&
            list.every((item) => typeof item === "string" && item.trim().length > 0),
        ),
        `${label}: 5項目すべて実質的に非空`,
      );
    }
  }
  console.log(`[verify] 所要時間: ${times.join(" / ")}`);
}

async function main(): Promise<void> {
  loadVerifyPinFromEnvLocal();
  const { url, expectBackend, skipVectorCount, gate, gateRuns } = parseArgs(
    process.argv.slice(2),
  );
  const pin = process.env.MATTA_VERIFY_PIN ?? "";
  if (!pin) {
    fail(
      "MATTA_VERIFY_PIN が未設定です（環境変数、または matta/.env.local へ設定してください。ログへは出しません）。",
    );
  }

  if (gate) {
    await runDemoGate(url, pin, gateRuns);
    printSummaryAndExit();
    return;
  }

  console.log(`[verify] 対象: ${url} / 期待バックエンド: ${expectBackend}`);

  // 1. health
  const health = await requestJson(`${url}/api/health`, { method: "GET" });
  check(health.status === 200, "healthが200を返す", `status=${health.status}`);
  const h = health.body as HealthResponse;
  check(h?.ok === true, "health.ok");
  check(h?.openai_configured === true, "OPENAI_API_KEY設定済み");
  check(h?.pin_configured === true, "PIN設定済み");
  check(
    h?.chunk_count === CHUNKS.length,
    `コーパス${CHUNKS.length}チャンク`,
    `chunk_count=${h?.chunk_count}`,
  );
  // 古いデプロイ（旧corpus_version）を誤って合格させないための照合
  check(
    h?.corpus_version === CORPUS_VERSION,
    `corpus_versionが手元と一致（${CORPUS_VERSION}）`,
    `デプロイ側=${h?.corpus_version}`,
  );
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
        h?.vector_store?.namespace_vector_count === CHUNKS.length,
        `namespace "${h?.corpus_version}" にseed ${CHUNKS.length}件`,
        `count=${h?.vector_store?.namespace_vector_count}`,
      );
    }
  }

  // 2. PINログイン
  const cookie = await loginAndGetCookie(url, pin);

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
    let res = await requestJson(`${url}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ message: testCase.text }),
    });
    if (res.status !== 200) {
      const elapsedMs = Date.now() - startedAt;
      const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;
      check(false, testCase.label, `status=${res.status} (${elapsed})`);
      continue;
    }
    let body = res.body as AnalyzeResponse;

    // 追加質問は正常な利用経路。completeを期待するケースでは、返された固定質問へ
    // ドメイン別の架空回答を1回だけ送り、質問を含む全体時間で受け入れ判定する。
    if (testCase.expect === "complete" && body.status === "needs_more_info") {
      const questionIds = body.questions.map((q) => q.id);
      const validQuestionCount = questionIds.length >= 1 && questionIds.length <= 2;
      check(
        validQuestionCount,
        `${testCase.label}: 追加質問は1〜2件`,
        `件数=${questionIds.length}`,
      );
      const domain = testCase.domain;
      const answers: AnswerInput[] =
        domain === undefined
          ? []
          : questionIds.flatMap((id) =>
              isQuestionId(id) ? [{ questionId: id, answer: FOLLOW_UP_ANSWERS[domain][id] }] : [],
            );
      const allQuestionsKnown = validQuestionCount && answers.length === questionIds.length;
      check(
        allQuestionsKnown,
        `${testCase.label}: 追加質問IDを固定回答へ解決`,
        `question_ids=${questionIds.join(",") || "なし"}`,
      );
      if (allQuestionsKnown) {
        res = await requestJson(`${url}/api/analyze`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ message: testCase.text, answers }),
        });
        if (res.status !== 200) {
          const elapsedMs = Date.now() - startedAt;
          const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;
          check(false, `${testCase.label}: 追加質問回答後`, `status=${res.status} (${elapsed})`);
          continue;
        }
        body = res.body as AnalyzeResponse;
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;
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
      const evidenceDomains = r.evidence.map((e) => CHUNK_DOMAIN.get(e.id));
      check(
        evidenceDomains.includes(testCase.domain),
        `${testCase.label}: Top 3に期待ドメイン（${testCase.domain}）を含む`,
        topIds,
      );
      check(
        r.search_backend === expectBackend,
        `${testCase.label}: バックエンド=${expectBackend}`,
        `実際=${r.search_backend}`,
      );
      check(!r.search_fallback, `${testCase.label}: フォールバックなし`);
      check(
        r.corpus_version === CORPUS_VERSION,
        `${testCase.label}: corpus_version一致`,
        `デプロイ側=${r.corpus_version}`,
      );
    }
    if (body.status === "insufficient_evidence" && testCase.expect === "insufficient_evidence") {
      check(
        body.search?.backend === expectBackend,
        `${testCase.label}: ${expectBackend}で検索した上で停止`,
        `top_similarity=${body.search?.top_similarity ?? "なし"} < ${body.search?.threshold}`,
      );
      check(body.search?.fallback === false, `${testCase.label}: フォールバックなし`);
      check(
        body.search?.corpus_version === CORPUS_VERSION,
        `${testCase.label}: corpus_version一致`,
        `デプロイ側=${body.search?.corpus_version}`,
      );
    }
  }

  printSummaryAndExit();
}

try {
  await main();
} catch (err) {
  // 接続不能・タイムアウト等。PINは含まれない情報だけを表示する
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[verify] NG: 実行中にエラーが発生しました（${message}）。URLとネットワークを確認してください。`);
  process.exit(1);
}
