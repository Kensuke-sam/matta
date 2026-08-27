"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConsultForm from "@/components/ConsultForm";
import PinGate from "@/components/PinGate";
import QuestionForm from "@/components/QuestionForm";
import { IncidentView, InsufficientView, ResultView } from "@/components/ResultViews";
import { apiRequest, ApiError } from "@/lib/client-api";
import { SAFE_CONTACTS } from "@/lib/guidance";
import { parseSharedPin } from "@/lib/share-link";
import type {
  AnalyzeResponse,
  AnswerInput,
  HealthResponse,
  QuestionItem,
  SessionStateResponse,
} from "@/lib/types";

type AuthPhase = "checking" | "pin" | "ready";

export default function Home() {
  const [authPhase, setAuthPhase] = useState<AuthPhase>("checking");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [message, setMessage] = useState("");
  const [questions, setQuestions] = useState<QuestionItem[] | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 共有リンク認証の失敗案内。PIN画面で表示し、手動ログイン成功でクリアする
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  // 進行中の解析リクエストの世代。reset/logoutで進めて、古い応答を破棄する
  const requestSeq = useRef(0);
  // 共有リンクから読み取り済みで、まだログイン試行が完了していないPIN。
  // 開発時のStrict Mode（Effectのsetup→cleanup→再setup）でURLから除去済みでも
  // 試行できるよう、URLではなくこのrefを正本として保持する
  const pendingLinkPin = useRef<string | null>(null);
  // 共有リンクPINのPOSTを同時に1本へ抑える（hashchange連打での並行POST防止）
  const linkLoginInFlight = useRef(false);
  // ログアウトのたびに進む世代。遅れて成功した共有リンクPOSTでログイン状態へ戻さない
  const authSeq = useRef(0);
  const authPhaseRef = useRef(authPhase);
  useEffect(() => {
    authPhaseRef.current = authPhase;
  }, [authPhase]);

  // 共有リンク（/#pin=…）の自動ログイン用PINをURLフラグメントから取り出す。
  // フラグメントはサーバーへ送信されず、履歴に残さないよう読み取り時に即座にURLから除去する
  const consumeLinkPin = useCallback((): string | null => {
    if (window.location.hash.length > 1) {
      const pin = parseSharedPin(window.location.hash);
      if (pin !== null) {
        pendingLinkPin.current = pin;
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    return pendingLinkPin.current;
  }, []);

  /** 共有リンクPINでのログイン試行。成否にかかわらず保持中のPINを消費する */
  const tryLinkLogin = useCallback(async (linkPin: string): Promise<boolean> => {
    if (linkLoginInFlight.current) return false;
    linkLoginInFlight.current = true;
    const seq = authSeq.current;
    try {
      await apiRequest<{ ok: true }>("/api/session", {
        method: "POST",
        body: JSON.stringify({ pin: linkPin }),
      });
      pendingLinkPin.current = null;
      setLinkNotice(null);
      // 試行中にログアウトが挟まった場合は、遅れて届いた成功でready化しない
      return seq === authSeq.current;
    } catch (err) {
      pendingLinkPin.current = null;
      // 無効PIN(401)は通常のPIN入力へ静かにフォールバックし、
      // レート制限・通信障害などはPIN画面で原因が分かるよう案内する
      if (!(err instanceof ApiError && err.status === 401)) {
        setLinkNotice("共有リンクでのログインに失敗しました。PINを直接入力してください。");
      }
      return false;
    } finally {
      linkLoginInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const linkPin = consumeLinkPin();
      const [healthRes, sessionRes] = await Promise.allSettled([
        apiRequest<HealthResponse>("/api/health"),
        apiRequest<SessionStateResponse>("/api/session"),
      ]);
      if (cancelled) return;
      if (healthRes.status === "fulfilled") setHealth(healthRes.value);
      let authenticated =
        sessionRes.status === "fulfilled" && sessionRes.value.authenticated;
      if (!authenticated && linkPin) {
        authenticated = await tryLinkLogin(linkPin);
      }
      if (cancelled) return;
      // hashchange側の自動ログインが先に完了していた場合は下げない
      setAuthPhase((prev) => (prev === "ready" ? prev : authenticated ? "ready" : "pin"));
    })();
    return () => {
      cancelled = true;
    };
  }, [consumeLinkPin, tryLinkLogin]);

  // 表示中にハッシュだけ変わる遷移（同一タブでの共有リンク再訪など）でも自動ログインする。
  // リスナーは安定させ、最新のauthPhaseはrefから参照する（張り替えの隙間を作らない）
  useEffect(() => {
    const onHashChange = () => {
      const linkPin = consumeLinkPin();
      if (!linkPin || authPhaseRef.current === "ready") return;
      void (async () => {
        if (await tryLinkLogin(linkPin)) {
          setAuthPhase("ready");
        }
      })();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [consumeLinkPin, tryLinkLogin]);

  const analyze = useCallback(
    async (answers: AnswerInput[]) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await apiRequest<AnalyzeResponse>("/api/analyze", {
          method: "POST",
          body: JSON.stringify(
            answers.length > 0 ? { message, answers } : { message },
          ),
        });
        if (seq !== requestSeq.current) return;
        if (res.status === "needs_more_info") {
          setQuestions(res.questions);
          setResult(null);
        } else {
          setResult(res);
          setQuestions(null);
        }
      } catch (err) {
        if (seq !== requestSeq.current) return;
        if (err instanceof ApiError && err.code === "unauthorized") {
          setAuthPhase("pin");
        } else {
          setError(err instanceof ApiError ? err.message : "エラーが発生しました。");
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [message],
  );

  const reset = useCallback(() => {
    requestSeq.current += 1;
    setMessage("");
    setQuestions(null);
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest<{ ok: true }>("/api/session", { method: "DELETE" });
    } catch {
      // 失敗時はCookieが残っている可能性があるため、ログアウト済みとは表示しない
      setError("ログアウトに失敗しました。通信を確認してもう一度お試しください。");
      return;
    }
    // 進行中の共有リンクログインが遅れて成功してもready化させない
    authSeq.current += 1;
    pendingLinkPin.current = null;
    reset();
    setAuthPhase("pin");
  }, [reset]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-start justify-between gap-4 border-b border-term-green/15 pb-5">
        <div>
          <p aria-hidden className="term-label text-term-muted">
            ANTI-SCAM // DECISION SUPPORT
          </p>
          <h1 className="blink-caret neon mt-2 font-display text-3xl font-bold tracking-[0.3em] text-term-green sm:text-4xl">
            MATTA
          </h1>
          <p className="mt-3 text-base font-medium leading-relaxed text-term-fg/90">
            その話、ちょっと「待った」。送る・払う・応じる前に、公的な詐欺事例と照らして確認できます。
          </p>
        </div>
        {authPhase === "ready" && (
          <button
            type="button"
            onClick={logout}
            className="shrink-0 border border-term-green/40 px-3 py-1.5 text-sm text-term-green transition hover:bg-term-green/10"
          >
            ログアウト
          </button>
        )}
      </header>

      <main className="mt-6 flex-1 space-y-4">
        {authPhase === "checking" && (
          <p className="animate-pulse text-center text-term-muted">読み込み中…</p>
        )}

        {authPhase === "pin" && (
          <>
            {linkNotice && (
              <p
                role="alert"
                className="border border-term-red/50 bg-term-red/10 px-4 py-3 text-base font-medium text-term-red"
              >
                {linkNotice}
              </p>
            )}
            <PinGate
              health={health}
              onAuthenticated={() => {
                setLinkNotice(null);
                setAuthPhase("ready");
              }}
            />
          </>
        )}

        {authPhase === "ready" && (
          <>
            {health && !health.openai_configured && (
              <div className="border border-term-amber/50 bg-term-amber/10 p-3 text-sm text-term-amber">
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
                className="border border-term-red/50 bg-term-red/10 px-4 py-3 text-base font-medium text-term-red"
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
                <InsufficientView
                  message={result.message}
                  contacts={result.contacts}
                  search={result.search}
                />
              )}
            </div>

            {result && (
              <button
                type="button"
                onClick={reset}
                className="w-full border border-term-green/50 px-4 py-3 text-base font-bold text-term-green transition hover:bg-term-green/10 sm:w-auto sm:px-8"
              >
                新しい相談をはじめる
              </button>
            )}
          </>
        )}
      </main>

      <footer className="mt-10 border-t border-term-green/15 pt-5 text-xs leading-relaxed text-term-muted">
        <p aria-hidden className="term-label mb-2 text-term-muted/70">
          Disclaimer
        </p>
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
