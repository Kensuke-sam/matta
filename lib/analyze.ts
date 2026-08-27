import { CORPUS_VERSION } from "./corpus";
import { INCIDENT_CARD, INSUFFICIENT_MESSAGE, SAFE_CONTACTS } from "./guidance";
import { detectCompletedIncident } from "./incident-detect";
import { chatJson, chatModel, embeddingModel, embedTexts, UpstreamError } from "./openai";
import type { ChatJsonFn, EmbedFn } from "./openai";
import {
  callValidated,
  parseGenerationOutput,
  parseTriageOutput,
} from "./analyze-output";
import { generationPrompts, triagePrompts } from "./prompts";
import type { PromptInput } from "./prompts";
import { isQuestionId, questionTextById, resolveQuestions } from "./questions";
import { retrieve, TOP_K } from "./retrieval";
import type { SearchOutcome } from "./retrieval";
import { redactContactInfo } from "./sanitize";
import type { AnalyzeResponse, QaPair, SearchDebugInfo } from "./types";
import type { ValidatedInput } from "./validate";

export type AnalyzeDeps = { embedTexts: EmbedFn; chatJson: ChatJsonFn };

const defaultDeps: AnalyzeDeps = { embedTexts, chatJson };

/** これ未満の類似度しか得られない場合は判定せず停止する（環境変数で調整可能） */
export const MIN_SIMILARITY_DEFAULT = 0.3;

/**
 * 外部呼び出し（LLM・Embedding・Vector DB）を新たに開始してよい経過時間の上限。
 * 各クライアントの個別タイムアウト（OpenAI 30秒・Vector 5秒）と合わせて、
 * リトライを含む逐次連鎖がVercel Functionの上限（analyze routeのmaxDuration=60秒）を
 * 超えて強制終了されないよう、これを超えたら新しい呼び出しを始めずに
 * upstream_timeoutとして制御された失敗にする。
 */
export const ANALYZE_TIME_BUDGET_MS = 25_000;

function assertTimeBudget(startedAt: number): void {
  if (Date.now() - startedAt > ANALYZE_TIME_BUDGET_MS) {
    throw new UpstreamError("upstream_timeout", "analyze time budget exceeded");
  }
}

export function minSimilarity(): number {
  const raw = Number(process.env.MATTA_MIN_SIMILARITY);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : MIN_SIMILARITY_DEFAULT;
}

function insufficientResponse(
  search: SearchOutcome | undefined,
  stopReason: SearchDebugInfo["stop_reason"],
): AnalyzeResponse {
  return {
    status: "insufficient_evidence",
    message: INSUFFICIENT_MESSAGE,
    contacts: SAFE_CONTACTS,
    // 検索まで到達して停止した場合は、審査用に「なぜ停止したか」を返す
    ...(search
      ? {
          search: {
            backend: search.backend,
            fallback: search.fallback,
            stop_reason: stopReason,
            top_similarity:
              search.results.length > 0
                ? Math.round(search.results[0].similarity * 1000) / 1000
                : null,
            threshold: minSimilarity(),
            embedding_model: embeddingModel(),
            corpus_version: CORPUS_VERSION,
          },
        }
      : {}),
  };
}

function incidentResponse(): AnalyzeResponse {
  return { status: "incident", incident: INCIDENT_CARD, contacts: SAFE_CONTACTS };
}

/** クライアントからの回答（questionId）を、固定文言バンクの質問文に解決する */
function toPromptInput(input: ValidatedInput): PromptInput {
  const answers: QaPair[] = input.answers.flatMap((a) =>
    isQuestionId(a.questionId)
      ? [{ question: questionTextById(a.questionId), answer: a.answer }]
      : [],
  );
  return { message: input.message, answers };
}

/**
 * 意味検索用のクエリテキスト。
 * 固定質問文には「警察、宅配業者」などの例示が含まれ、全ドメインの語で
 * クエリを汚してしまうため、質問文は含めず相談文と回答だけを使う。
 */
function buildQueryText(prompt: PromptInput): string {
  return [prompt.message, ...prompt.answers.map((qa) => qa.answer)].join("\n");
}

export async function runAnalyze(
  input: ValidatedInput,
  deps: AnalyzeDeps = defaultDeps,
): Promise<AnalyzeResponse> {
  const startedAt = Date.now();
  const checkBudget = () => assertTimeBudget(startedAt);

  // 個人情報除去: 電話番号・URL・メールアドレスを固定プレースホルダーへ置換し、
  // 以降のすべての外部呼び出し（Embedding・LLM）から除外する
  const redacted: ValidatedInput = {
    message: redactContactInfo(input.message),
    answers: input.answers.map((a) => ({ ...a, answer: redactContactInfo(a.answer) })),
  };

  // 0. 決定論的な既遂ゲート: LLMの誤分類・プロンプト注入に依存せず、
  //    明確な既遂表現とq_doneへの肯定回答は必ず固定カードへ分岐する
  if (detectCompletedIncident(redacted)) {
    return incidentResponse();
  }

  const promptInput = toPromptInput(redacted);

  // 1. トリアージ: 既遂かどうか、追加質問が必要かを判定する
  const triage = await callValidated(
    deps,
    triagePrompts(promptInput),
    parseTriageOutput,
    checkBudget,
  );

  // 被害後（既遂）: 検索を通さず固定の事故対応カードへ分岐する
  if (triage.category === "incident") {
    return incidentResponse();
  }

  // 追加質問（固定文言・最大2問）。回答済みの場合は再質問しない
  if (input.answers.length === 0 && triage.missing.length > 0) {
    const questions = resolveQuestions(triage.missing);
    if (questions.length > 0) {
      return { status: "needs_more_info", questions };
    }
  }

  // 2. 意味検索: 相談内容をEmbeddingし、公的資料チャンクからTop 3を取得する
  //    （通常はUpstash Vector、ストア障害時だけローカル意味検索へフォールバック。
  //      類似度不足は障害ではないため、フォールバックせずここで根拠不足停止する）
  const search = await retrieve(buildQueryText(promptInput), deps.embedTexts, TOP_K, checkBudget);
  const retrieved = search.results;
  if (retrieved.length === 0 || retrieved[0].similarity < minSimilarity()) {
    return insufficientResponse(search, "below_threshold");
  }

  // 3. 生成: 取得した根拠だけを使って5点出力を作る。
  //    許可外の電話番号らしき文字列を含む出力は注入・幻覚とみなして不採用にする
  const generation = await callValidated(
    deps,
    generationPrompts(promptInput, retrieved),
    parseGenerationOutput,
    checkBudget,
  );
  if (generation.unrelated) {
    // 類似度は閾値以上だったが、生成モデルが資料と相談内容が無関係と判定した停止
    return insufficientResponse(search, "model_unrelated");
  }
  const g = generation.value;

  return {
    status: "complete",
    result: {
      similar_cases: g.similar_cases,
      danger_signs: g.danger_signs,
      normal_response: g.normal_response,
      do_not: g.do_not,
      safe_verification: g.safe_verification,
      evidence: retrieved.map((r) => ({
        id: r.chunk.id,
        title: r.chunk.title,
        sourceName: r.chunk.source.name,
        sourceUrl: r.chunk.source.url,
        similarity: Math.round(r.similarity * 1000) / 1000,
      })),
      model: chatModel(),
      embedding_model: embeddingModel(),
      search_backend: search.backend,
      search_fallback: search.fallback,
      corpus_version: CORPUS_VERSION,
    },
  };
}
