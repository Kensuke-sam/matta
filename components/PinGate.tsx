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
    <section className="mx-auto w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-lg font-bold text-stone-900">デモ用PINの入力</h2>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">
        このアプリは審査・デモ用の限定公開です。共有されたPINを入力してください。
      </p>
      {configWarnings.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-bold">設定が未完了です</p>
          <ul className="mt-1 list-disc pl-5">
            {configWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={submit} className="mt-5">
        <label htmlFor="pin-input" className="block text-sm font-bold text-stone-800">
          PIN
        </label>
        <input
          id="pin-input"
          type="password"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base text-stone-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/30"
          placeholder="共有されたPIN"
        />
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || pin.length === 0}
          className="mt-4 w-full rounded-lg bg-teal-800 px-4 py-3 text-base font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "確認中…" : "はじめる"}
        </button>
      </form>
    </section>
  );
}
