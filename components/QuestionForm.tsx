"use client";

import { useState } from "react";
import { ANSWER_MAX } from "@/lib/limits";
import type { AnswerInput, QuestionItem } from "@/lib/types";

type Props = {
  questions: QuestionItem[];
  onSubmit: (answers: AnswerInput[]) => void;
  onBack: () => void;
  loading: boolean;
};

export default function QuestionForm({ questions, onSubmit, onBack, loading }: Props) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));

  const canSubmit = answers.every((a) => a.trim().length > 0);

  return (
    <section className="corner-frame border border-term-green/30 bg-term-panel/80 p-5 shadow-[0_0_50px_rgba(138,246,90,0.06)] sm:p-7">
      <p aria-hidden className="term-label text-term-muted">
        Follow-up // Max 2
      </p>
      <h2 className="neon-soft mt-2 flex items-center gap-2.5 text-lg font-bold text-term-green">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 bg-term-green" />
        もう少しだけ教えてください
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-term-fg/70">
        安全な確認のために必要な情報です（最大2問）。分かる範囲で構いません。
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          onSubmit(
            questions.map((question, i) => ({
              questionId: question.id,
              answer: answers[i].trim(),
            })),
          );
        }}
      >
        {questions.map((question, i) => (
          <div key={question.id}>
            <label
              htmlFor={`answer-${i}`}
              className="block text-base font-bold leading-relaxed text-term-fg"
            >
              {question.text}
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
              className="mt-1.5 w-full resize-y border border-term-green/30 bg-term-bg/80 px-3.5 py-2.5 text-base text-term-fg caret-term-green focus:border-term-green focus:outline-none focus:ring-2 focus:ring-term-green/25 disabled:opacity-60"
            />
          </div>
        ))}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="bg-term-green px-6 py-3 text-base font-bold text-term-bg transition hover:bg-term-green/85 hover:shadow-[0_0_28px_rgba(138,246,90,0.35)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "確認しています…" : "回答して確認する"}
          </button>
          <button
            type="button"
            onClick={onBack}
            disabled={loading}
            className="border border-term-green/40 px-6 py-3 text-base font-medium text-term-green transition hover:bg-term-green/10 disabled:opacity-40"
          >
            相談文を書き直す
          </button>
        </div>
      </form>
    </section>
  );
}
