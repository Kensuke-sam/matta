import { z } from "zod";
import { UpstreamError } from "./openai";
import type { ChatJsonFn } from "./openai";
import { listsContainDisallowedContact } from "./sanitize";
import { extractJson } from "./validate";

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

/**
 * LLM呼び出し→JSON抽出→検証を、失敗時1回だけリトライして行う。
 * parseはスキーマ検証と安全フィルタを含み、不合格ならnullを返す。
 */
export async function callValidated<T>(
  deps: { chatJson: ChatJsonFn },
  prompts: { system: string; user: string },
  parse: (raw: unknown) => T | null,
  beforeAttempt: () => void = () => {},
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    beforeAttempt();
    let raw: unknown;
    try {
      raw = extractJson(await deps.chatJson(prompts));
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      continue; // JSONとして壊れている: リトライ対象
    }
    const parsed = parse(raw);
    if (parsed !== null) return parsed;
  }
  throw new UpstreamError("invalid_output", "model output failed validation twice");
}

export function parseTriageOutput(raw: unknown) {
  const parsed = triageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseGenerationOutput(raw: unknown) {
  if (unrelatedSchema.safeParse(raw).success) return { unrelated: true as const };
  const parsed = generationSchema.safeParse(raw);
  if (!parsed.success) return null;
  const g = parsed.data;
  const lists = [
    g.similar_cases,
    g.danger_signs,
    g.normal_response,
    g.do_not,
    g.safe_verification,
  ];
  if (listsContainDisallowedContact(lists)) return null;
  return { unrelated: false as const, value: g };
}
