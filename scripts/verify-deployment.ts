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
 *   5. 圏外入力: out_of_scopeで停止（検索・生成を開始しない）
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
import type {
  AnalyzeResponse,
  AnswerInput,
  Domain,
  HealthResponse,
} from "../lib/types.ts";

// 全HTTP往復（health・ログイン・analyze）はAbortSignal.timeout(65s)で必ず打ち切る。
// 60秒SLAとの5秒差は意図的な余裕: 60秒超過は「NG判定+実測時間の報告」で扱い、
// 65秒で接続自体を破棄する（ハングでゲートが止まらないための上限）
const CASE_TIMEOUT_MS = 65_000;
const TIME_BUDGET_MS = 60_000;

type ExpectedStatus =
  "complete" | "insufficient_evidence" | "incident" | "out_of_scope";

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
 * モデルが選んだ既知の質問IDへ、検証対象ドメインと矛盾しない内容で回答する。
 */
const ISSUE8_ANSWERS: Record<QuestionId, string> = {
  q_org: "登録している人材派遣会社からの案内です。",
  q_request: "勤務先の採用面接を受けるよう案内されています。",
  q_channel: "派遣会社で普段使っている連絡手段で届きました。",
  q_urgency: "急かしや口止めはありません。",
  q_done: "お金や個人情報は渡していません。",
  q_official_route: "派遣会社の公式サイトにも同じ案内があります。",
  q_additional_request: "面接以外の支払いや情報提供は求められていません。",
};

const FOLLOW_UP_ANSWERS: Record<Domain, Record<QuestionId, string>> = {
  police: {
    q_org: "警察の捜査担当者だと名乗っています。",
    q_request: "口座を調べるため、相手の指示に従うよう求められています。",
    q_channel: "知らない番号からの電話で、ビデオ通話へ移るよう言われています。",
    q_urgency: "今すぐ対応し、誰にも話さないよう言われています。",
    q_done: "まだ送金も個人情報の提供もしていません。",
    q_official_route: "警察の公式窓口では確認できていません。",
    q_additional_request: "口座の確認や送金も求められています。",
  },
  delivery: {
    q_org: "宅配業者だと書かれています。",
    q_request: "SMS内のリンクを開き、配送情報を確認するよう求められています。",
    q_channel:
      "携帯電話のSMSで届きました。別アプリへの移動は求められていません。",
    q_urgency: "急かす文言や口止めはありません。",
    q_done: "まだリンクを開かず、情報も入力していません。",
    q_official_route: "宅配業者の公式アプリには同じ案内がありません。",
    q_additional_request: "リンク先で個人情報を入力するよう求められています。",
  },
  yamibaito: {
    q_org: "SNSで見つけた求人の担当者だと名乗っています。",
    q_request:
      "匿名性の高いアプリへ移り、身分証の写真を送るよう求められています。",
    q_channel:
      "SNSのDMから、匿名性の高いチャットアプリへ移るよう言われています。",
    q_urgency: "高収入を強調されていますが、口止めはありません。",
    q_done: "まだ身分証や個人情報を送っていません。",
    q_official_route: "運営元の公式な求人情報では確認できません。",
    q_additional_request: "別アプリへの移動と身分証の送信を求められています。",
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
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    ".env.local",
  );
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
        fail(
          `--expect-backend は upstash か local を指定してください（指定値を確認）`,
        );
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
  return {
    url: url.replace(/\/+$/, ""),
    expectBackend,
    skipVectorCount,
    gate,
    gateRuns,
  };
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

function observe(label: string, detail: string): void {
  console.log(`[verify] 観察: ${label} — ${detail}`);
}

function generatedText(
  body: Extract<AnalyzeResponse, { status: "complete" }>,
): string {
  return [
    ...body.result.similar_cases,
    ...body.result.danger_signs,
    ...body.result.normal_response,
    ...body.result.do_not,
    ...body.result.safe_verification,
  ].join("\n");
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
    fail(
      `PINログインに失敗しました（status=${session.status}）。PINと対象URLを確認してください。`,
    );
  }
  const cookie = (session.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) {
    fail("セッションCookieを取得できませんでした。");
  }
  return cookie;
}

async function answerFollowUpOnce(
  url: string,
  cookie: string,
  message: string,
  body: AnalyzeResponse,
  answersById: Record<QuestionId, string>,
  label: string,
): Promise<AnalyzeResponse | null> {
  if (body.status !== "needs_more_info") return body;

  const ids = body.questions.map((question) => question.id);
  const knownIds = ids.filter(isQuestionId);
  const validQuestions =
    ids.length >= 1 &&
    ids.length <= 2 &&
    knownIds.length === ids.length &&
    new Set(ids).size === ids.length;
  check(
    validQuestions,
    `${label}: 追加質問は既知IDで最大2件`,
    `ids=${ids.join(",")}`,
  );
  observe(`${label}でモデルが選んだ質問`, ids.join(",") || "なし");
  if (!validQuestions) return null;

  const answers: AnswerInput[] = knownIds.map((questionId) => ({
    questionId,
    answer: answersById[questionId],
  }));
  const response = await requestJson(`${url}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ message, answers }),
  });
  check(
    response.status === 200,
    `${label}: 追加質問回答後`,
    `status=${response.status}`,
  );
  return response.status === 200 ? (response.body as AnalyzeResponse) : null;
}

/**
 * 本番デモ完走ゲート（落単回避の完成条件1・2）。
 * ニセ警察デモをruns回連続で実行し、各回 complete・根拠Top 3（police）・
 * 5項目非空・60秒以内を判定する。Vector導入前の旧デプロイにも使えるよう、
 * search_backend等のVector項目は検査しない。
 */
async function runIssue8Fixture(url: string, cookie: string): Promise<void> {
  const text =
    "登録している人材派遣会社から求人の案内が届き、勤務先の面接を受けるよう求められました。ほかの情報はありません。";
  const firstStartedAt = Date.now();
  const first = await requestJson(`${url}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ message: text }),
  });
  const firstElapsedMs = Date.now() - firstStartedAt;
  check(
    first.status === 200,
    "Issue #8: 初回応答が200",
    `status=${first.status}`,
  );
  check(
    firstElapsedMs <= TIME_BUDGET_MS,
    "Issue #8: 初回応答が60秒以内",
    `${(firstElapsedMs / 1000).toFixed(1)}s`,
  );
  if (first.status !== 200) return;
  const firstBody = first.body as AnalyzeResponse;

  const acceptedFirstStatus =
    firstBody.status === "needs_more_info" ||
    firstBody.status === "complete" ||
    firstBody.status === "insufficient_evidence";
  check(
    acceptedFirstStatus,
    "Issue #8: 対象外・既遂へ誤分類しない",
    `実際=${firstBody.status}`,
  );
  if (!acceptedFirstStatus) return;

  let finalBody: AnalyzeResponse = firstBody;
  if (firstBody.status === "needs_more_info") {
    const ids = firstBody.questions.map((question) => question.id);
    const knownIds = ids.filter(isQuestionId);
    const validQuestions =
      ids.length >= 1 &&
      ids.length <= 2 &&
      knownIds.length === ids.length &&
      new Set(ids).size === ids.length;
    check(
      validQuestions,
      "Issue #8: 追加質問は既知IDで最大2件",
      `ids=${ids.join(",") || "なし"}`,
    );
    observe("Issue #8でモデルが選んだ質問", ids.join(",") || "なし");
    if (!validQuestions) return;

    const answers: AnswerInput[] = knownIds.map((questionId) => ({
      questionId,
      answer: ISSUE8_ANSWERS[questionId],
    }));
    const secondStartedAt = Date.now();
    const second = await requestJson(`${url}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ message: text, answers }),
    });
    const secondElapsedMs = Date.now() - secondStartedAt;
    check(
      second.status === 200,
      "Issue #8: 回答後の応答が200",
      `status=${second.status}`,
    );
    check(
      secondElapsedMs <= TIME_BUDGET_MS,
      "Issue #8: 回答後の応答が60秒以内",
      `${(secondElapsedMs / 1000).toFixed(1)}s`,
    );
    if (second.status !== 200) return;
    finalBody = second.body as AnalyzeResponse;
  }

  const acceptedFinalStatus =
    finalBody.status === "complete" ||
    finalBody.status === "insufficient_evidence";
  check(
    acceptedFinalStatus,
    "Issue #8: モデルの質問選択後に完了または根拠不足で停止する",
    `実際=${finalBody.status}`,
  );
  if (finalBody.status === "complete") {
    const output = generatedText(finalBody);
    check(
      !/(詐欺(?:です|だ|に間違い)|危険(?:です|だ|と断定)|安全(?:です|だ|と断定)|詐欺では(?:ない|ありません))/.test(
        output,
      ),
      "Issue #8: 危険・安全を断定しない",
    );
  }
}

async function runDemoGate(
  url: string,
  pin: string,
  runs: number,
): Promise<void> {
  console.log(
    `[verify] 本番デモ完走ゲート: ニセ警察デモを${runs}回連続実行します`,
  );

  const health = await requestJson(`${url}/api/health`, { method: "GET" });
  check(health.status === 200, "healthが200を返す", `status=${health.status}`);
  const h = health.body as HealthResponse;
  check(
    h?.ok === true &&
      h?.openai_configured === true &&
      h?.pin_configured === true,
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
    if (res.status !== 200) {
      const elapsed = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
      check(false, label, `status=${res.status} (${elapsed})`);
      continue;
    }
    const body = await answerFollowUpOnce(
      url,
      cookie,
      police.text,
      res.body as AnalyzeResponse,
      FOLLOW_UP_ANSWERS.police,
      label,
    );
    const elapsedMs = Date.now() - startedAt;
    const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;
    times.push(elapsed);
    if (body === null) continue;
    check(
      body.status === "complete",
      `${label}: complete`,
      `実際=${body.status} (${elapsed})`,
    );
    check(elapsedMs <= TIME_BUDGET_MS, `${label}: 60秒以内`, elapsed);
    if (body.status === "complete") {
      const r = body.result;
      const topIds = r.evidence
        .map((e) => `${e.id}:${e.similarity.toFixed(3)}`)
        .join(", ");
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
            list.every(
              (item) => typeof item === "string" && item.trim().length > 0,
            ),
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
      label: "対象外入力",
      text: "今日の夕飯の献立を考えてください。",
      expect: "out_of_scope",
    },
    {
      label: "Issue #9（警察なりすまし）",
      text: "警察を名乗る人がビデオ通話で警察手帳を見せ、誰にも話すなと言っています。運動していますかとも聞かれました。",
      expect: "complete",
      domain: "police",
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
    if (res.status !== 200) {
      const elapsed = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
      check(false, testCase.label, `status=${res.status} (${elapsed})`);
      continue;
    }
    let body = res.body as AnalyzeResponse;

    // completeを期待する相談では、モデルが選んだ既知の質問へ架空回答を1回だけ送る。
    if (testCase.expect === "complete" && testCase.domain !== undefined) {
      const resolved = await answerFollowUpOnce(
        url,
        cookie,
        testCase.text,
        body,
        FOLLOW_UP_ANSWERS[testCase.domain],
        testCase.label,
      );
      if (resolved === null) continue;
      body = resolved;
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
      const topIds = r.evidence
        .map((e) => `${e.id}:${e.similarity.toFixed(3)}`)
        .join(", ");
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
      const output = generatedText(body);
      check(
        !/(安全(?:です|だ|と断定)|詐欺では(?:ない|ありません))/.test(output),
        `${testCase.label}: 安全と断定しない`,
      );
      if (testCase.label === "Issue #9（警察なりすまし）") {
        const groundedFacts = [
          /警察(?:官)?を(?:名乗|かた|装)/,
          /ビデオ通話/,
          /警察手帳|手帳/,
          /誰にも話|口止め|捜査の秘密/,
        ];
        const groundedCount = groundedFacts.filter((pattern) =>
          pattern.test(output),
        ).length;
        const unrelatedExercise = /運動/.test(output) ? "あり" : "なし";
        observe(
          "Issue #9の根拠対応語",
          `${groundedCount}/4、無関係な運動語=${unrelatedExercise}`,
        );
      }
    }
    if (body.status === "out_of_scope" && testCase.expect === "out_of_scope") {
      check(!("contacts" in body), `${testCase.label}: 相談窓口を返さない`);
      check(!("search" in body), `${testCase.label}: 検索情報を返さない`);
    }
    if (
      body.status === "insufficient_evidence" &&
      testCase.expect === "insufficient_evidence"
    ) {
      check(
        body.search?.backend === expectBackend,
        `${testCase.label}: ${expectBackend}で検索した上で停止`,
        `top_similarity=${body.search?.top_similarity ?? "なし"} < ${body.search?.threshold}`,
      );
      check(
        body.search?.fallback === false,
        `${testCase.label}: フォールバックなし`,
      );
      check(
        body.search?.corpus_version === CORPUS_VERSION,
        `${testCase.label}: corpus_version一致`,
        `デプロイ側=${body.search?.corpus_version}`,
      );
    }
  }

  await runIssue8Fixture(url, cookie);
  printSummaryAndExit();
}

try {
  await main();
} catch (err) {
  // 接続不能・タイムアウト等。PINは含まれない情報だけを表示する
  const message =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(
    `[verify] NG: 実行中にエラーが発生しました（${message}）。URLとネットワークを確認してください。`,
  );
  process.exit(1);
}
