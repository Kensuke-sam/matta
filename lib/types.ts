export type Domain = "police" | "delivery" | "yamibaito";

export type Chunk = {
  id: string;
  domain: Domain;
  title: string;
  /** 公的資料の原文引用ではなく、確認済み内容の短い要約 */
  content: string;
  source: { name: string; url: string; checkedAt: string };
};

export type QaPair = { question: string; answer: string };

export type EvidenceItem = {
  id: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  similarity: number;
};

export type CompleteResult = {
  similar_cases: string[];
  danger_signs: string[];
  normal_response: string[];
  do_not: string[];
  safe_verification: string[];
  /** 審査用インスペクタ専用。通常画面には類似度を表示しない */
  evidence: EvidenceItem[];
  model: string;
  corpus_version: string;
};

export type SafeContact = { name: string; number: string; note: string };

export type IncidentCard = {
  title: string;
  lead: string;
  steps: { label: string; action: string }[];
  note: string;
};

export type AnalyzeResponse =
  | { status: "needs_more_info"; questions: string[] }
  | { status: "complete"; result: CompleteResult }
  | { status: "incident"; incident: IncidentCard; contacts: SafeContact[] }
  | { status: "insufficient_evidence"; message: string; contacts: SafeContact[] };

export type AnalyzeStatus = AnalyzeResponse["status"];

export type ApiErrorCode =
  | "unauthorized"
  | "invalid_pin"
  | "pin_not_configured"
  | "openai_not_configured"
  | "invalid_input"
  | "rate_limited"
  | "upstream_error"
  | "upstream_timeout"
  | "invalid_output"
  | "internal_error";

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string } };

export type HealthResponse = {
  ok: boolean;
  openai_configured: boolean;
  pin_configured: boolean;
  corpus_version: string;
  chunk_count: number;
};

export type SessionStateResponse = { authenticated: boolean };
