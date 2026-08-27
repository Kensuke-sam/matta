"use client";

import type {
  CompleteResult,
  IncidentCard,
  SafeContact,
  SearchBackend,
  SearchDebugInfo,
} from "@/lib/types";

export function ContactCards({ contacts }: { contacts: SafeContact[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {contacts.map((contact) => (
        <div
          key={contact.number}
          className="relative border border-term-green/40 bg-term-panel/80 p-4 text-center"
        >
          <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-term-green" />
          <p className="text-sm font-bold text-term-fg">{contact.name}</p>
          <p className="neon mt-1 font-display text-3xl font-bold tracking-wide text-term-green">
            {contact.number}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-term-muted">{contact.note}</p>
        </div>
      ))}
    </div>
  );
}

function OfficialContactSection({ contacts }: { contacts: SafeContact[] }) {
  return (
    <section aria-label="公式の相談窓口">
      <h3 className="mb-2 flex items-center gap-2 text-base font-bold text-term-fg">
        <span aria-hidden className="h-2 w-2 shrink-0 bg-term-green" />
        公式の相談窓口
      </h3>
      <ContactCards contacts={contacts} />
    </section>
  );
}

function SearchBackendStatus({
  backend,
  fallback,
}: {
  backend: SearchBackend;
  fallback: boolean;
}) {
  return (
    <>
      <code
        className="bg-term-green/10 px-1 font-display text-term-green"
        data-testid="search-backend"
      >
        {backend === "upstash" ? "Upstash Vector" : "ローカル意味検索"}
      </code>
      {fallback && (
        <span className="ml-2 text-term-amber" data-testid="search-fallback">
          （Vector DB障害のためローカル検索で代替）
        </span>
      )}
    </>
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
  const toneClasses: Record<typeof tone, { border: string; badge: string; title: string }> = {
    neutral: { border: "border-term-green/25", badge: "bg-term-fg/70", title: "text-term-fg" },
    warn: { border: "border-term-amber/40", badge: "bg-term-amber", title: "text-term-amber" },
    info: { border: "border-term-cyan/40", badge: "bg-term-cyan", title: "text-term-cyan" },
    danger: { border: "border-term-red/45", badge: "bg-term-red", title: "text-term-red" },
    safe: { border: "border-term-green/45", badge: "bg-term-green", title: "text-term-green" },
  };
  const c = toneClasses[tone];
  return (
    <section className={`border ${c.border} bg-term-panel/80 p-5`}>
      <h3 className={`neon-soft flex items-center gap-2 text-base font-bold ${c.title}`}>
        <span className={`inline-block h-2.5 w-2.5 ${c.badge}`} aria-hidden />
        {title}
      </h3>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-base leading-relaxed text-term-fg/90">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-term-green/50" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PauseBanner() {
  return (
    <div className="corner-frame border-2 border-term-red/70 bg-term-red/10 p-4 shadow-[0_0_44px_rgba(255,107,107,0.14)] [--corner-color:rgba(255,107,107,0.85)] sm:p-5">
      <p aria-hidden className="term-label text-term-red/80">
        Stop
      </p>
      <p className="neon-soft mt-1.5 text-base font-bold leading-relaxed text-term-red">
        まずは、相手とのやり取りをいったん止めてください。
      </p>
      <p className="mt-1 text-sm leading-relaxed text-term-fg/80">
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

      <OfficialContactSection contacts={contacts} />

      <p className="text-sm leading-relaxed text-term-muted">
        この結果は、取得した公的資料に基づく参考情報です。個別の連絡が詐欺かどうかを断定するものではありません。
        最終的な確認は公式の相談窓口をご利用ください。
      </p>

      <details
        data-testid="inspector"
        className="border border-dashed border-term-green/35 bg-term-bg/60 p-4"
      >
        <summary className="cursor-pointer select-none text-sm font-bold text-term-green">
          審査用: 検索根拠と類似度
        </summary>
        <div className="mt-3 space-y-3 text-sm text-term-fg/80">
          <p>
            検索基盤:{" "}
            <SearchBackendStatus
              backend={result.search_backend}
              fallback={result.search_fallback}
            />{" "}
            / Embedding:{" "}
            <code className="bg-term-green/10 px-1 font-display text-term-green">
              {result.embedding_model}
            </code>{" "}
            / 生成:{" "}
            <code className="bg-term-green/10 px-1 font-display text-term-green">
              {result.model}
            </code>{" "}
            / コーパス:{" "}
            <code className="bg-term-green/10 px-1 font-display text-term-green">
              {result.corpus_version}
            </code>
          </p>
          <ol className="space-y-2">
            {result.evidence.map((item, i) => (
              <li key={item.id} className="border border-term-green/20 bg-term-panel/80 p-3">
                <p className="font-bold text-term-fg">
                  [{i + 1}] {item.title}
                </p>
                <p className="mt-0.5">
                  類似度:{" "}
                  <span className="font-display text-term-green" data-testid={`similarity-${i}`}>
                    {item.similarity.toFixed(3)}
                  </span>{" "}
                  / 出典:{" "}
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-term-green underline decoration-term-green/50 underline-offset-2 hover:text-term-green/80"
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
      <section className="corner-frame border-2 border-term-red/70 bg-term-red/10 p-5 shadow-[0_0_44px_rgba(255,107,107,0.14)] [--corner-color:rgba(255,107,107,0.85)] sm:p-7">
        <p aria-hidden className="term-label text-term-red/80">
          Emergency
        </p>
        <h2 className="neon-soft mt-1.5 text-xl font-black text-term-red">{incident.title}</h2>
        <p className="mt-2 text-base leading-relaxed text-term-fg/90">{incident.lead}</p>
        <ol className="mt-4 space-y-3">
          {incident.steps.map((step, i) => (
            <li key={step.label} className="border border-term-red/35 bg-term-panel/80 p-4">
              <p className="font-bold text-term-fg">
                {i + 1}. {step.label}
              </p>
              <p className="mt-1 text-base leading-relaxed text-term-fg/85">{step.action}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-relaxed text-term-red">{incident.note}</p>
      </section>
      <OfficialContactSection contacts={contacts} />
    </div>
  );
}

export function OutOfScopeView({ message }: { message: string }) {
  return (
    <div className="space-y-4" aria-label="MATTAの対象外の案内">
      <section className="corner-frame border border-term-amber/40 bg-term-panel/80 p-5 sm:p-7">
        <p aria-hidden className="term-label text-term-muted">
          MATTA Scope
        </p>
        <h2 className="mt-1.5 text-lg font-bold text-term-fg">MATTAの対象外の内容です</h2>
        <p className="mt-2 text-base leading-relaxed text-term-fg/80">{message}</p>
      </section>
    </div>
  );
}

export function InsufficientView({
  message,
  contacts,
  search,
}: {
  message: string;
  contacts: SafeContact[];
  search?: SearchDebugInfo;
}) {
  return (
    <div className="space-y-4" aria-label="判定を行わない案内">
      <section className="corner-frame border border-term-amber/40 bg-term-panel/80 p-5 sm:p-7">
        <p aria-hidden className="term-label text-term-muted">
          Retrieval: Insufficient
        </p>
        <h2 className="mt-1.5 text-lg font-bold text-term-fg">
          十分な根拠が見つかりませんでした
        </h2>
        <p className="mt-2 text-base leading-relaxed text-term-fg/80">{message}</p>
      </section>
      <OfficialContactSection contacts={contacts} />

      {search && (
        <details
          data-testid="insufficient-inspector"
          className="border border-dashed border-term-green/35 bg-term-bg/60 p-4"
        >
          <summary className="cursor-pointer select-none text-sm font-bold text-term-green">
            審査用: 停止理由の検索情報
          </summary>
          <div className="mt-3 space-y-2 text-sm text-term-fg/80">
            <p>
              検索基盤:{" "}
              <SearchBackendStatus backend={search.backend} fallback={search.fallback} />{" "}
              / Embedding:{" "}
              <code className="bg-term-green/10 px-1 font-display text-term-green">
                {search.embedding_model}
              </code>{" "}
              / コーパス:{" "}
              <code className="bg-term-green/10 px-1 font-display text-term-green">
                {search.corpus_version}
              </code>
            </p>
            {search.stop_reason === "below_threshold" ? (
              <p>
                最上位の類似度{" "}
                <span className="font-display text-term-amber" data-testid="top-similarity">
                  {search.top_similarity === null ? "なし" : search.top_similarity.toFixed(3)}
                </span>{" "}
                ＜ 停止閾値{" "}
                <span className="font-display text-term-fg">{search.threshold.toFixed(3)}</span>{" "}
                のため、推測で回答せず停止しました
              </p>
            ) : (
              <p>
                最上位の類似度{" "}
                <span className="font-display text-term-amber" data-testid="top-similarity">
                  {search.top_similarity === null ? "なし" : search.top_similarity.toFixed(3)}
                </span>{" "}
                （閾値{" "}
                <span className="font-display text-term-fg">{search.threshold.toFixed(3)}</span>{" "}
                以上）は取得できましたが、生成モデルが資料を相談内容と無関係と判定したため、推測で回答せず停止しました
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
