# MATTA（マッタ）

不審な連絡を公的な詐欺事例と照合し、被害にあう前の「安全な次の行動」を根拠付きで確認できる対話型RAGプロトタイプ。

- 授業: ICT社会応用論D（2026年度）
- 位置づけ: 審査・デモ用の限定公開プロトタイプ（PIN制）

## 機能

- 相談文入力・3種類のデモ入力（ニセ警察電話 / 宅配フィッシングSMS / 怪しい副業DM）・固定文言の追加質問（最大2問）を備えた1画面UI
- 公的資料（警察庁・国民生活センター・事業者公式FAQ）の要約12チャンクを `text-embedding-3-small` で意味検索し、Top 3の根拠だけを使って `gpt-5.6-luna` が5点出力を生成
  - 類似する公的事例 / 危険サイン / 本物なら通常こうする / 今してはいけないこと / 安全な確認方法
- 被害後（既遂）の入力は検索を通さず固定の緊急対応カードへ分岐
- 根拠不足（類似度が閾値未満・資料が無関係）の場合は判定せず停止
- 数値類似度・出典・モデル情報は「審査用」折りたたみ欄だけに表示

## 環境変数（サーバー側のみ）

`.env.example` を参照。値は各自が直接設定する（リポジトリ・チャット・RAGに書かない）。

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | ✔ | OpenAI APIキー |
| `MATTA_DEMO_PIN` | ✔ | デモ用PIN（8文字以上） |
| `MATTA_CHAT_MODEL` | - | 既定 `gpt-5.6-luna` |
| `MATTA_EMBEDDING_MODEL` | - | 既定 `text-embedding-3-small` |
| `MATTA_MIN_SIMILARITY` | - | 根拠不足の停止閾値。既定 `0.3` |

## 開発

```bash
npm install
cp .env.example .env.local   # 値を自分で設定
npm run dev
```

## 検証

```bash
npm run lint      # ESLint
npm run test      # Vitest（検索順位・質問分岐・PIN・入力検証・API異常系）
npm run build     # 型チェック込みビルド
npm run test:e2e  # Playwright（PC/スマホ、3事例、圏外入力、被害後分岐。OpenAIはモック）
```

E2EはOpenAI APIを呼ばない（`OPENAI_BASE_URL` でローカルモックへ向ける）。

## デプロイ（Vercel CLI）

```bash
vercel deploy          # Preview
vercel --prod          # Production
```

環境変数はVercelダッシュボードまたはCLIで設定してから再デプロイする:

```bash
vercel env add OPENAI_API_KEY production
vercel env add MATTA_DEMO_PIN production
```

## 安全設計

- APIキー・PINはサーバー環境変数のみ。ブラウザへ渡さない
- 相談文は保存しない。ログにも本文を残さない（分析のためOpenAI APIへは送信される）
- 「詐欺です」「安全です」の断定はしない。公式窓口（#9110 / 188 / 110)への確認を常に案内
- PIN認証はHttpOnly Cookie（HMAC署名・24時間で失効）。PIN試行・分析実行にレート制限あり
- コーパスは原文引用ではなく要約。各チャンクに出典URLと確認日を記録
