"use client";

import type { CompleteResult, IncidentCard, SafeContact } from "@/lib/types";

export function ContactCards({ contacts }: { contacts: SafeContact[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {contacts.map((contact) => (
        <div
          key={contact.number}
          className="rounded-xl border border-stone-200 bg-white p-4 text-center shadow-sm"
        >
          <p className="text-sm font-bold text-stone-700">{contact.name}</p>
          <p className="mt-1 text-3xl font-black tracking-wide text-teal-900">{contact.number}</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">{contact.note}</p>
        </div>
      ))}
    </div>
  );
}

function BulletCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "neutral" | "warn" | "info" | "danger" | "safe";
}) {
  const toneClasses: Record<typeof tone, { border: string; badge: string }> = {
    neutral: { border: "border-stone-200", badge: "bg-stone-700" },
    warn: { border: "border-amber-300", badge: "bg-amber-600" },
    info: { border: "border-sky-300", badge: "bg-sky-700" },
    danger: { border: "border-red-300", badge: "bg-red-700" },
    safe: { border: "border-teal-300", badge: "bg-teal-700" },
  };
  const c = toneClasses[tone];
  return (
    <section className={`rounded-2xl border ${c.border} bg-white p-5 shadow-sm`}>
      <h3 className="flex items-center gap-2 text-base font-bold text-stone-900">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${c.badge}`} aria-hidden />
        {title}
      </h3>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-base leading-relaxed text-stone-800">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PauseBanner() {
  return (
    <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 sm:p-5">
      <p className="text-base font-bold leading-relaxed text-red-900">
        まずは、相手とのやり取りをいったん止めてください。
      </p>
      <p className="mt-1 text-sm leading-relaxed text-red-800">
        返信・振り込み・URLを開く・アプリを入れる操作は、確認が終わるまで行わないでください。
      </p>
    </div>
  );
}

export function ResultView({
  result,
  contacts,
}: {
  result: CompleteResult;
  contacts: SafeContact[];
}) {
  return (
    <div className="space-y-4" aria-label="確認結果">
      <PauseBanner />
      <BulletCard title="類似する公的事例" items={result.similar_cases} tone="neutral" />
      <BulletCard title="危険サイン" items={result.danger_signs} tone="warn" />
      <BulletCard title="本物なら通常こうする" items={result.normal_response} tone="info" />
      <BulletCard title="今、してはいけないこと" items={result.do_not} tone="danger" />
      <BulletCard title="安全な確認方法" items={result.safe_verification} tone="safe" />

      <section aria-label="公式の相談窓口">
        <h3 className="mb-2 text-base font-bold text-stone-900">公式の相談窓口</h3>
        <ContactCards contacts={contacts} />
      </section>

      <p className="text-sm leading-relaxed text-stone-500">
        この結果は、取得した公的資料に基づく参考情報です。個別の連絡が詐欺かどうかを断定するものではありません。
        最終的な確認は上の公式窓口をご利用ください。
      </p>

      <details
        data-testid="inspector"
        className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-4"
      >
        <summary className="cursor-pointer select-none text-sm font-bold text-stone-600">
          審査用: 検索根拠と類似度（通常の相談では開く必要はありません）
        </summary>
        <div className="mt-3 space-y-3 text-sm text-stone-700">
          <p>
            生成モデル: <code className="rounded bg-stone-200 px-1">{result.model}</code> / Embedding検索
            Top {result.evidence.length} / コーパス版:{" "}
            <code className="rounded bg-stone-200 px-1">{result.corpus_version}</code>
          </p>
          <ol className="space-y-2">
            {result.evidence.map((item, i) => (
              <li key={item.id} className="rounded-lg border border-stone-200 bg-white p-3">
                <p className="font-bold text-stone-800">
                  [{i + 1}] {item.title}
                </p>
                <p className="mt-0.5">
                  コサイン類似度: <span data-testid={`similarity-${i}`}>{item.similarity.toFixed(3)}</span>
                </p>
                <p className="mt-0.5">
                  出典:{" "}
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal-800 underline"
                  >
                    {item.sourceName}
                  </a>
                </p>
              </li>
            ))}
          </ol>
        </div>
      </details>
    </div>
  );
}

export function IncidentView({
  incident,
  contacts,
}: {
  incident: IncidentCard;
  contacts: SafeContact[];
}) {
  return (
    <div className="space-y-4" aria-label="緊急対応の案内">
      <section className="rounded-2xl border-2 border-red-400 bg-red-50 p-5 sm:p-7">
        <h2 className="text-xl font-black text-red-900">{incident.title}</h2>
        <p className="mt-2 text-base leading-relaxed text-red-900">{incident.lead}</p>
        <ol className="mt-4 space-y-3">
          {incident.steps.map((step, i) => (
            <li key={step.label} className="rounded-xl border border-red-200 bg-white p-4">
              <p className="font-bold text-stone-900">
                {i + 1}. {step.label}
              </p>
              <p className="mt-1 text-base leading-relaxed text-stone-800">{step.action}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-relaxed text-red-800">{incident.note}</p>
      </section>
      <section aria-label="公式の相談窓口">
        <h3 className="mb-2 text-base font-bold text-stone-900">公式の相談窓口</h3>
        <ContactCards contacts={contacts} />
      </section>
    </div>
  );
}

export function InsufficientView({
  message,
  contacts,
}: {
  message: string;
  contacts: SafeContact[];
}) {
  return (
    <div className="space-y-4" aria-label="判定を行わない案内">
      <section className="rounded-2xl border border-stone-300 bg-stone-100 p-5 sm:p-7">
        <h2 className="text-lg font-bold text-stone-900">十分な根拠が見つかりませんでした</h2>
        <p className="mt-2 text-base leading-relaxed text-stone-700">{message}</p>
      </section>
      <section aria-label="公式の相談窓口">
        <h3 className="mb-2 text-base font-bold text-stone-900">公式の相談窓口</h3>
        <ContactCards contacts={contacts} />
      </section>
    </div>
  );
}
