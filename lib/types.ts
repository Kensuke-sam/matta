export type Domain = "police" | "delivery" | "yamibaito";

export type Chunk = {
  id: string;
  domain: Domain;
  title: string;
  /** 公的資料の原文引用ではなく、確認済み内容の短い要約 */
  content: string;
  source: { name: string; url: string; checkedAt: string };
};

/** クライアントが送る追加質問への回答。質問文は送らせず、固定質問バンクのIDで受ける */
export type AnswerInput = { questionId: string; answer: string };

/** 追加質問の提示形式。textはサーバー側の固定文言 */
export type QuestionItem = { id: string; text: string };

/** プロンプト整形用の内部型（質問文はサーバー側で解決済み） */
export type QaPair = { question: string; answer: string };

/** 意味検索のバックエンド。通常はupstash、障害時・明示切替時はlocal */
export type SearchBackend = "upstash" | "local";

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
  embedding_model: string;
  search_backend: SearchBackend;
  /** Vector DB障害でローカル意味検索へ切り替えた場合にtrue */
  search_fallback: boolean;
  corpus_version: string;
};

/** 根拠不足で停止した場合の審査用検索情報（なぜ停止したかの説明に使う） */
export type SearchDebugInfo = {
  backend: SearchBackend;
  fallback: boolean;
  /** Top 1の類似度。検索結果が空の場合はnull */
  top_similarity: number | null;
  /** 停止判定に使った閾値 */
  threshold: number;
  embedding_model: string;
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
  | { status: "needs_more_info"; questions: QuestionItem[] }
  | { status: "complete"; result: CompleteResult }
  | { status: "incident"; incident: IncidentCard; contacts: SafeContact[] }
  | {
      status: "insufficient_evidence";
      message: string;
      contacts: SafeContact[];
      /** 検索を実行した上で停止した場合だけ入る（生成側related:falseの停止も含む） */
      search?: SearchDebugInfo;
    };

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
  search_backend: SearchBackend;
  vector_store: {
    configured: boolean;
    /** 実接続確認の結果。localバックエンド時・未設定時は確認せずnull */
    reachable: boolean | null;
    /** 現corpus_versionのnamespaceに登録済みのベクトル数（確認できない場合null） */
    namespace_vector_count: number | null;
  };
};

export type SessionStateResponse = { authenticated: boolean };
