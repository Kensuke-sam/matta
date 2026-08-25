/**
 * OpenAI APIの薄いラッパー。SDKを使わずfetch直叩きにして、
 * テスト時はOPENAI_BASE_URLでモックサーバーへ差し替えられるようにする。
 * 相談文などのユーザー入力をログへ残さないため、エラーには固定文言だけを入れる。
 */

const DEFAULT_CHAT_MODEL = "gpt-5.6-luna";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const TIMEOUT_MS = 45_000;

export type UpstreamErrorCode =
  | "openai_not_configured"
  | "upstream_error"
  | "upstream_timeout"
  | "invalid_output";

export class UpstreamError extends Error {
  constructor(
    public readonly code: UpstreamErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

function apiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

export function openaiConfigured(): boolean {
  return apiKey().length > 0;
}

function baseUrl(): string {
  const raw = process.env.OPENAI_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : "https://api.openai.com/v1").replace(/\/+$/, "");
}

export function chatModel(): string {
  return process.env.MATTA_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

export function embeddingModel(): string {
  return process.env.MATTA_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

async function post(path: string, payload: unknown): Promise<unknown> {
  if (!openaiConfigured()) {
    throw new UpstreamError("openai_not_configured", "OPENAI_API_KEY is not set");
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new UpstreamError("upstream_timeout", "OpenAI API request timed out");
    }
    throw new UpstreamError("upstream_error", "failed to reach OpenAI API");
  }
  if (!res.ok) {
    // レスポンスボディは入力内容を含み得るため読まない
    throw new UpstreamError("upstream_error", `OpenAI API returned status ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new UpstreamError("upstream_error", "OpenAI API returned a non-JSON response");
  }
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export const embedTexts: EmbedFn = async (texts) => {
  const json = (await post("/embeddings", {
    model: embeddingModel(),
    input: texts,
  })) as { data?: { index?: number; embedding?: unknown }[] };
  const data = json?.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new UpstreamError("upstream_error", "unexpected embeddings response shape");
  }
  return [...data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => {
      if (!Array.isArray(d.embedding) || d.embedding.some((v) => typeof v !== "number")) {
        throw new UpstreamError("upstream_error", "unexpected embeddings response shape");
      }
      return d.embedding as number[];
    });
};

export type ChatJsonArgs = { system: string; user: string };
export type ChatJsonFn = (args: ChatJsonArgs) => Promise<string>;

export const chatJson: ChatJsonFn = async ({ system, user }) => {
  const json = (await post("/chat/completions", {
    model: chatModel(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  })) as { choices?: { message?: { content?: unknown } }[] };
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new UpstreamError("upstream_error", "empty chat completion");
  }
  return content;
};
