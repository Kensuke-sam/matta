"use client";

import { useState } from "react";
import { ANSWER_MAX } from "@/lib/validate";

type Props = {
  questions: string[];
  onSubmit: (answers: { question: string; answer: string }[]) => void;
  onBack: () => void;
  loading: boolean;
};

export default function QuestionForm({ questions, onSubmit, onBack, loading }: Props) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));

  const canSubmit = answers.every((a) => a.trim().length > 0);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-lg font-bold text-stone-900">もう少しだけ教えてください</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
        安全な確認のために必要な情報です（最大2問）。分かる範囲で構いません。
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          onSubmit(
            questions.map((question, i) => ({ question, answer: answers[i].trim() })),
          );
        }}
      >
        {questions.map((question, i) => (
          <div key={question}>
            <label htmlFor={`answer-${i}`} className="block text-base font-bold leading-relaxed text-stone-800">
              {question}
            </label>
            <textarea
              id={`answer-${i}`}
              value={answers[i]}
              maxLength={ANSWER_MAX}
              rows={2}
              disabled={loading}
              onChange={(e) =>
                setAnswers((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
              }
              className="mt-1.5 w-full resize-y rounded-xl border border-stone-300 px-3.5 py-2.5 text-base text-stone-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/30 disabled:bg-stone-50"
            />
          </div>
        ))}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="rounded-xl bg-teal-800 px-6 py-3 text-base font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "確認しています…" : "回答して確認する"}
          </button>
          <button
            type="button"
            onClick={onBack}
            disabled={loading}
            className="rounded-xl border border-stone-300 px-6 py-3 text-base font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50"
          >
            相談文を書き直す
          </button>
        </div>
      </form>
    </section>
  );
}
