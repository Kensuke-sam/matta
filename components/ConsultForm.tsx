"use client";

import { DEMOS } from "@/lib/demos";
import { MESSAGE_MAX } from "@/lib/validate";

type Props = {
  message: string;
  onChangeMessage: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
};

export default function ConsultForm({ message, onChangeMessage, onSubmit, loading }: Props) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-lg font-bold text-stone-900">いま受けている連絡について教えてください</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
        電話・SMS・SNSなどで受けた内容を、そのまま自然な言葉で書いてください。
        個人名や口座番号などは書かなくて大丈夫です。
      </p>

      <div className="mt-4">
        <p className="text-sm font-bold text-stone-800">デモ入力（架空の相談例）</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEMOS.map((demo) => (
            <button
              key={demo.id}
              type="button"
              onClick={() => onChangeMessage(demo.text)}
              disabled={loading}
              className="rounded-full border border-teal-800/40 bg-teal-50 px-3.5 py-1.5 text-sm font-medium text-teal-900 transition hover:bg-teal-100 disabled:opacity-50"
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
          disabled={loading}
          placeholder="例: 警察を名乗る電話で、口座が犯罪に使われていると言われました…"
          className="w-full resize-y rounded-xl border border-stone-300 px-3.5 py-3 text-base leading-relaxed text-stone-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/30 disabled:bg-stone-50"
        />
        <div className="mt-1 text-right text-xs text-stone-500">
          {message.length} / {MESSAGE_MAX}
        </div>
        <button
          type="submit"
          disabled={loading || message.trim().length === 0}
          className="mt-2 w-full rounded-xl bg-teal-800 px-4 py-3.5 text-lg font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-10"
        >
          {loading ? "確認しています…" : "この内容で確認する"}
        </button>
      </form>
    </section>
  );
}
