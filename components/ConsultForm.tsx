"use client";

import { DEMOS } from "@/lib/demos";
import { MESSAGE_MAX } from "@/lib/limits";

type Props = {
  message: string;
  onChangeMessage: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
};

export default function ConsultForm({ message, onChangeMessage, onSubmit, loading }: Props) {
  return (
    <section className="corner-frame border border-term-green/30 bg-term-panel/80 p-5 shadow-[0_0_50px_rgba(138,246,90,0.06)] sm:p-7">
      <p aria-hidden className="term-label text-term-muted">
        Input // Consult
      </p>
      <h2 className="neon-soft mt-2 flex items-center gap-2.5 text-lg font-bold text-term-green">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 bg-term-green" />
        いま受けている連絡について教えてください
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-term-fg/70">
        電話・SMS・SNSなどで受けた内容を、そのまま自然な言葉で書いてください。
        個人名や口座番号などは書かなくて大丈夫です。
      </p>

      <div className="mt-4">
        <p className="flex items-center gap-2 text-sm font-bold text-term-fg">
          <span aria-hidden className="h-2 w-2 shrink-0 bg-term-green/70" />
          デモ入力（架空の相談例）
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEMOS.map((demo) => (
            <button
              key={demo.id}
              type="button"
              onClick={() => onChangeMessage(demo.text)}
              disabled={loading}
              className="border border-term-green/40 bg-term-green/5 px-3.5 py-1.5 text-sm font-medium text-term-green transition hover:border-term-green hover:bg-term-green/15 disabled:opacity-40"
            >
              {demo.label}
            </button>
          ))}
        </div>
      </div>

      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="consult-input" className="sr-only">
          相談内容
        </label>
        <textarea
          id="consult-input"
          value={message}
          onChange={(e) => onChangeMessage(e.target.value)}
          maxLength={MESSAGE_MAX}
          rows={6}
          autoFocus
          disabled={loading}
          placeholder="例: 警察を名乗る電話で、口座が犯罪に使われていると言われました…"
          className="w-full resize-y border border-term-green/30 bg-term-bg/80 px-3.5 py-3 text-base leading-relaxed text-term-fg caret-term-green placeholder:text-term-muted/50 focus:border-term-green focus:outline-none focus:ring-2 focus:ring-term-green/25 disabled:opacity-60"
        />
        <div className="mt-1 text-right font-display text-xs text-term-muted">
          {message.length} / {MESSAGE_MAX}
        </div>
        <button
          type="submit"
          disabled={loading || message.trim().length === 0}
          className="mt-2 w-full bg-term-green px-4 py-3.5 text-lg font-bold text-term-bg transition hover:bg-term-green/85 hover:shadow-[0_0_28px_rgba(138,246,90,0.35)] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-10"
        >
          {loading ? "確認しています…" : "この内容で確認する"}
        </button>
      </form>
    </section>
  );
}
