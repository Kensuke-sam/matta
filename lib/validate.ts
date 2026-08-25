import { z } from "zod";
import { MAX_QUESTIONS } from "./questions";
import type { QaPair } from "./types";

export const MESSAGE_MAX = 2000;
export const ANSWER_MAX = 500;
export const QUESTION_TEXT_MAX = 300;

const qaPairSchema = z.object({
  question: z.string().trim().min(1).max(QUESTION_TEXT_MAX),
  answer: z.string().trim().min(1).max(ANSWER_MAX),
});

const analyzeInputSchema = z.object({
  message: z
    .string({ error: "相談内容を文字で入力してください" })
    .trim()
    .min(1, "相談内容を入力してください")
    .max(MESSAGE_MAX, `相談内容は${MESSAGE_MAX}文字以内で入力してください`),
  answers: z.array(qaPairSchema).max(MAX_QUESTIONS).optional(),
});

export type ValidatedInput = { message: string; answers: QaPair[] };

export type ValidationResult =
  | { ok: true; value: ValidatedInput }
  | { ok: false; message: string };

export function validateAnalyzeInput(body: unknown): ValidationResult {
  const parsed = analyzeInputSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: first?.message ?? "入力内容を確認してください" };
  }
  return {
    ok: true,
    value: { message: parsed.data.message, answers: parsed.data.answers ?? [] },
  };
}

const pinSchema = z.object({
  pin: z.string({ error: "PINを入力してください" }).min(1, "PINを入力してください").max(200),
});

export type PinValidationResult =
  | { ok: true; pin: string }
  | { ok: false; message: string };

export function validatePinInput(body: unknown): PinValidationResult {
  const parsed = pinSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: first?.message ?? "PINを入力してください" };
  }
  return { ok: true, pin: parsed.data.pin };
}

/** LLM出力がコードフェンス等で包まれていても最初のJSONオブジェクトを取り出す */
export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("no JSON object found in model output");
  }
}
