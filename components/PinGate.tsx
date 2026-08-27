"use client";

import { useState } from "react";
import { apiRequest, ApiError } from "@/lib/client-api";
import type { HealthResponse } from "@/lib/types";

type Props = {
  health: HealthResponse | null;
  onAuthenticated: () => void;
};

export default function PinGate({ health, onAuthenticated }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const configWarnings: string[] = [];
  if (health && !health.pin_configured) {
    configWarnings.push(
      "デモ用PINが未設定です。管理者は環境変数 MATTA_DEMO_PIN（8文字以上）を設定してください。",
    );
  }
  if (health && !health.openai_configured) {
    configWarnings.push(
      "AI機能が未設定です。管理者は環境変数 OPENAI_API_KEY を設定してください。",
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest<{ ok: true }>("/api/session", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      setPin("");
      onAuthenticated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "エラーが発生しました。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="corner-frame mx-auto w-full max-w-md border border-term-green/30 bg-term-panel/80 p-6 shadow-[0_0_50px_rgba(138,246,90,0.07)] sm:p-8">
      <p aria-hidden className="term-label text-term-muted">
        Access Control
      </p>
      <h2 className="neon-soft mt-2 text-lg font-bold text-term-green">デモ用PINの入力</h2>
      <p className="mt-2 text-sm leading-relaxed text-term-fg/70">
        このアプリは審査・デモ用の限定公開です。共有されたPINを入力してください。
      </p>
      {configWarnings.length > 0 && (
        <div className="mt-4 border border-term-amber/50 bg-term-amber/10 p-3 text-sm text-term-amber">
          <p className="font-bold">設定が未完了です</p>
          <ul className="mt-1 list-disc pl-5 marker:text-term-amber/70">
            {configWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={submit} className="mt-5">
        <label
          htmlFor="pin-input"
          className="block font-display text-sm font-bold tracking-[0.2em] text-term-fg"
        >
          PIN
        </label>
        <input
          id="pin-input"
          type="password"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="mt-1 w-full border border-term-green/35 bg-term-bg px-3 py-2.5 font-display text-base tracking-widest text-term-fg caret-term-green placeholder:font-body placeholder:text-sm placeholder:tracking-normal placeholder:text-term-muted/60 focus:border-term-green focus:outline-none focus:ring-2 focus:ring-term-green/25"
          placeholder="共有されたPIN"
        />
        {error && (
          <p
            role="alert"
            className="mt-3 border border-term-red/50 bg-term-red/10 px-3 py-2 text-sm font-medium text-term-red"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || pin.length === 0}
          className="mt-4 w-full bg-term-green px-4 py-3 text-base font-bold text-term-bg transition hover:bg-term-green/85 hover:shadow-[0_0_28px_rgba(138,246,90,0.35)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "確認中…" : "はじめる"}
        </button>
      </form>
    </section>
  );
}
