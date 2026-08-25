import { z } from "zod";
import { CORPUS_VERSION } from "./corpus";
import { INCIDENT_CARD, INSUFFICIENT_MESSAGE, SAFE_CONTACTS } from "./guidance";
import { chatJson, chatModel, embedTexts, UpstreamError } from "./openai";
import type { ChatJsonFn, EmbedFn } from "./openai";
import { generationPrompts, triagePrompts } from "./prompts";
import { resolveQuestions } from "./questions";
import { searchCorpus, TOP_K } from "./retrieval";
import type { AnalyzeResponse } from "./types";
import { extractJson } from "./validate";
import type { ValidatedInput } from "./validate";

export type AnalyzeDeps = { embedTexts: EmbedFn; chatJson: ChatJsonFn };

const defaultDeps: AnalyzeDeps = { embedTexts, chatJson };

/** これ未満の類似度しか得られない場合は判定せず停止する（環境変数で調整可能） */
export const MIN_SIMILARITY_DEFAULT = 0.3;

export function minSimilarity(): number {
  const raw = Number(process.env.MATTA_MIN_SIMILARITY);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : MIN_SIMILARITY_DEFAULT;
}

const triageSchema = z.object({
  category: z.enum(["incident", "consultation"]),
  missing: z.array(z.string()).optional().default([]),
});

const bullets = z.array(z.string().trim().min(1).max(200)).min(1).max(6);

const generationSchema = z.object({
  related: z.boolean().optional().default(true),
  similar_cases: bullets,
  danger_signs: bullets,
  normal_response: bullets,
  do_not: bullets,
  safe_verification: bullets,
});

const unrelatedSchema = z.object({ related: z.literal(false) });

/** LLMのJSON出力を1回だけリトライして取り出す */
async function callJsonWithRetry(
  deps: AnalyzeDeps,
  prompts: { system: string; user: string },
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const content = await deps.chatJson(prompts);
      return extractJson(content);
    } catch (err) {
      if (err instanceof UpstreamError && err.code !== "invalid_output") throw err;
      lastError = err;
    }
  }
  throw lastError instanceof UpstreamError
    ? lastError
    : new UpstreamError("invalid_output", "model returned unparsable output");
}

function insufficientResponse(): AnalyzeResponse {
  return {
    status: "insufficient_evidence",
    message: INSUFFICIENT_MESSAGE,
    contacts: SAFE_CONTACTS,
  };
}

function buildQueryText(input: ValidatedInput): string {
  const parts = [input.message];
  for (const qa of input.answers) {
    parts.push(`${qa.question} ${qa.answer}`);
  }
  return parts.join("\n");
}

export async function runAnalyze(
  input: ValidatedInput,
  deps: AnalyzeDeps = defaultDeps,
): Promise<AnalyzeResponse> {
  // 1. トリアージ: 既遂かどうか、追加質問が必要かを判定する
  const triageRaw = await callJsonWithRetry(deps, triagePrompts(input));
  const triageParsed = triageSchema.safeParse(triageRaw);
  if (!triageParsed.success) {
    throw new UpstreamError("invalid_output", "triage output did not match schema");
  }
  const triage = triageParsed.data;

  // 被害後（既遂）: 検索を通さず固定の事故対応カードへ分岐する
  if (triage.category === "incident") {
    return { status: "incident", incident: INCIDENT_CARD, contacts: SAFE_CONTACTS };
  }

  // 追加質問（固定文言・最大2問）。回答済みの場合は再質問しない
  if (input.answers.length === 0 && triage.missing.length > 0) {
    const questions = resolveQuestions(triage.missing);
    if (questions.length > 0) {
      return { status: "needs_more_info", questions };
    }
  }

  // 2. 意味検索: 相談内容をEmbeddingし、公的資料チャンクからTop 3を取得する
  const retrieved = await searchCorpus(buildQueryText(input), deps.embedTexts, TOP_K);
  if (retrieved.length === 0 || retrieved[0].similarity < minSimilarity()) {
    return insufficientResponse();
  }

  // 3. 生成: 取得した根拠だけを使って5点出力を作る
  const generationRaw = await callJsonWithRetry(deps, generationPrompts(input, retrieved));
  if (unrelatedSchema.safeParse(generationRaw).success) {
    return insufficientResponse();
  }
  const generationParsed = generationSchema.safeParse(generationRaw);
  if (!generationParsed.success) {
    throw new UpstreamError("invalid_output", "generation output did not match schema");
  }
  const g = generationParsed.data;

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
      corpus_version: CORPUS_VERSION,
    },
  };
}
