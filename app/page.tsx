"use client";

import { useCallback, useEffect, useState } from "react";
import ConsultForm from "@/components/ConsultForm";
import PinGate from "@/components/PinGate";
import QuestionForm from "@/components/QuestionForm";
import { IncidentView, InsufficientView, ResultView } from "@/components/ResultViews";
import { apiRequest, ApiError } from "@/lib/client-api";
import { SAFE_CONTACTS } from "@/lib/guidance";
import type {
  AnalyzeResponse,
  HealthResponse,
  QaPair,
  SessionStateResponse,
} from "@/lib/types";

type AuthPhase = "checking" | "pin" | "ready";

export default function Home() {
  const [authPhase, setAuthPhase] = useState<AuthPhase>("checking");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [message, setMessage] = useState("");
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [healthRes, sessionRes] = await Promise.allSettled([
        apiRequest<HealthResponse>("/api/health"),
        apiRequest<SessionStateResponse>("/api/session"),
      ]);
      if (cancelled) return;
      if (healthRes.status === "fulfilled") setHealth(healthRes.value);
      const authenticated =
        sessionRes.status === "fulfilled" && sessionRes.value.authenticated;
      setAuthPhase(authenticated ? "ready" : "pin");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const analyze = useCallback(
    async (answers: QaPair[]) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiRequest<AnalyzeResponse>("/api/analyze", {
          method: "POST",
          body: JSON.stringify(
            answers.length > 0 ? { message, answers } : { message },
          ),
        });
        if (res.status === "needs_more_info") {
          setQuestions(res.questions);
          setResult(null);
        } else {
          setResult(res);
          setQuestions(null);
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === "unauthorized") {
          setAuthPhase("pin");
        } else {
          setError(err instanceof ApiError ? err.message : "エラーが発生しました。");
        }
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  const reset = useCallback(() => {
    setMessage("");
    setQuestions(null);
    setResult(null);
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest<{ ok: true }>("/api/session", { method: "DELETE" });
    } catch {
      // ログアウト失敗時もPIN画面へ戻す
    }
    reset();
    setAuthPhase("pin");
  }, [reset]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-wide text-teal-900 sm:text-4xl">
            MATTA
          </h1>
          <p className="mt-1 text-base font-medium leading-relaxed text-stone-700">
            その話、ちょっと「待った」。送る・払う・応じる前に、公的な詐欺事例と照らして確認できます。
          </p>
        </div>
        {authPhase === "ready" && (
          <button
            type="button"
            onClick={logout}
            className="shrink-0 rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-100"
          >
            ログアウト
          </button>
        )}
      </header>

      <main className="mt-6 flex-1 space-y-4">
        {authPhase === "checking" && (
          <p className="text-center text-stone-500">読み込み中…</p>
        )}

        {authPhase === "pin" && (
          <PinGate health={health} onAuthenticated={() => setAuthPhase("ready")} />
        )}

        {authPhase === "ready" && (
          <>
            {health && !health.openai_configured && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                AI機能が未設定のため、相談の確認は実行できません（管理者は OPENAI_API_KEY
                を設定してください）。
              </div>
            )}

            {!result && !questions && (
              <ConsultForm
                message={message}
                onChangeMessage={setMessage}
                onSubmit={() => analyze([])}
                loading={loading}
              />
            )}

            {questions && (
              <QuestionForm
                questions={questions}
                onSubmit={(answers) => analyze(answers)}
                onBack={() => setQuestions(null)}
                loading={loading}
              />
            )}

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-4 py-3 text-base font-medium text-red-800"
              >
                {error}
              </p>
            )}

            <div aria-live="polite">
              {result?.status === "complete" && (
                <ResultView result={result.result} contacts={SAFE_CONTACTS} />
              )}
              {result?.status === "incident" && (
                <IncidentView incident={result.incident} contacts={result.contacts} />
              )}
              {result?.status === "insufficient_evidence" && (
                <InsufficientView message={result.message} contacts={result.contacts} />
              )}
            </div>

            {result && (
              <button
                type="button"
                onClick={reset}
                className="w-full rounded-xl border border-teal-800/40 bg-white px-4 py-3 text-base font-bold text-teal-900 transition hover:bg-teal-50 sm:w-auto sm:px-8"
              >
                新しい相談をはじめる
              </button>
            )}
          </>
        )}
      </main>

      <footer className="mt-10 border-t border-stone-200 pt-5 text-xs leading-relaxed text-stone-500">
        <p>
          MATTAは、警察庁・国民生活センター等の公開資料の要約をもとに、被害にあう前の「次の行動」を考えるための審査・デモ用プロトタイプです。
          真偽の断定や法的な判断は行いません。
        </p>
        <p className="mt-1.5">
          入力された相談内容はサーバーに保存されません（分析のためOpenAI APIに送信されます）。
        </p>
      </footer>
    </div>
  );
}
