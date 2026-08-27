# MATTA（マッタ）

不審な連絡を公的な詐欺事例と照合し、被害にあう前の「安全な次の行動」を根拠付きで確認できる対話型RAGプロトタイプ。

- 授業: ICT社会応用論D（2026年度）
- 位置づけ: 審査・デモ用の限定公開プロトタイプ（PIN制）

## 機能

- 相談文入力・3種類のデモ入力（ニセ警察電話 / 宅配フィッシングSMS / 怪しい副業DM）・固定文言の追加質問（最大2問）を備えた1画面UI
- PIN付き共有リンク `https://<ホスト>/#pin=<PIN>` で、PIN入力なしで相談フォームへ直行できる（フラグメントはサーバーへ送信されず、URLからも即座に除去される）。PINに `&` `%` `#` を含める場合はリンク作成時にパーセントエンコードする（`+` はそのまま使える）
- 公的資料（警察庁・国民生活センター・事業者公式FAQ）の要約12チャンクを `text-embedding-3-small` で意味検索し、Top 3の根拠だけを使って `gpt-5.6-luna` が5点出力を生成
  - 類似する公的事例 / 危険サイン / 本物なら通常こうする / 今してはいけないこと / 安全な確認方法
- 意味検索は通常 **Upstash Vector**（Vercel Marketplace連携のVector DB。`corpus_version`ごとのnamespace）で行い、DB障害・索引異常のときだけ同一Embeddingモデルのローカル意味検索へ自動フォールバック。類似度不足は障害ではないためフォールバックせず停止する
- 相談文中の電話番号・URL・メールアドレスは、Embedding・LLMへ渡る前に固定プレースホルダーへ置換（外部API・Vector DBへ原文の連絡先を送らない。Vector DBに保存するのはコーパス由来のベクトルと非機密メタデータだけ）
- 被害後（既遂）の入力は検索を通さず固定の緊急対応カードへ分岐
- 根拠不足（類似度が閾値未満・資料が無関係）の場合は判定せず停止し、審査用欄に「どのバックエンドで検索し、最上位類似度が閾値をいくつ下回ったか」を表示
- 数値類似度・出典・検索バックエンド・フォールバック有無・モデル情報は「審査用」折りたたみ欄だけに表示

## 環境変数（サーバー側のみ）

`.env.example` を参照。値は各自が直接設定する（リポジトリ・チャット・RAGに書かない）。

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | ✔ | OpenAI APIキー |
| `MATTA_DEMO_PIN` | ✔ | デモ用PIN（8文字以上） |
| `MATTA_CHAT_MODEL` | - | 既定 `gpt-5.6-luna` |
| `MATTA_EMBEDDING_MODEL` | - | 既定 `text-embedding-3-small` |
| `MATTA_MIN_SIMILARITY` | - | 根拠不足の停止閾値。既定 `0.3` |
| `UPSTASH_VECTOR_REST_URL` | - | Upstash VectorのREST URL（Marketplace連携で自動注入） |
| `UPSTASH_VECTOR_REST_TOKEN` | - | 同トークン。seed（書き込み）にも使う |
| `UPSTASH_VECTOR_REST_READONLY_TOKEN` | - | あれば検索・healthの読み取りに優先使用 |
| `MATTA_SEARCH_BACKEND` | - | `upstash` / `local` の明示切替（ロールバック手段）。未設定時はUpstash設定の有無で自動判定 |

## 開発

```bash
npm install
cp .env.example .env.local   # 値を自分で設定
npm run dev
```

## 検証

```bash
npm run lint      # ESLint
npm run test      # Vitest（検索順位・質問分岐・PIN・入力検証・PII除去・Vector検索・API異常系）
npm run build     # 型チェック込みビルド
npm run test:e2e  # Playwright（PC/スマホ、3事例、圏外入力、被害後分岐、Vector経路とDB障害フォールバック）
```

E2Eは外部APIを一切呼ばない（`OPENAI_BASE_URL` / `UPSTASH_VECTOR_REST_URL` でローカルモックへ向ける）。
使用ポート（3971 / 3972 / 8965 / 8966）は `E2E_APP_PORT` などの環境変数で上書きできる。

デプロイ済み環境（Preview / Production）への受け入れ検証は、実API・実Vector DBを使って行う:

```bash
MATTA_VERIFY_PIN=<PIN> npm run verify:deploy -- --url https://<デプロイ先>
```

health・PINログイン・3デモ・言い換え3件（必要な場合は固定質問への回答を含む）・圏外停止・既遂分岐・各60秒以内・根拠ドメイン一致・
バックエンド/フォールバック状態を自動チェックする（ローカル検索構成の検証は `--expect-backend local`）。

## Vector DB（Upstash Vector）

セットアップは1回だけ:

1. [Vercel Marketplace](https://vercel.com/marketplace/upstash) から Upstash を `matta` プロジェクトへ接続し、**1536次元 / cosine** のVectorインデックスを作成（無料枠で可）
2. 環境変数が自動注入される。ローカルへは `vercel env pull`（Sensitive型で取得できない場合はUpstashダッシュボードからコピー）
3. コーパスを登録（冪等。`corpus_version`ごとのnamespaceへchunk IDで上書きするため何度実行しても重複しない）:

```bash
npm run seed:vector
```

4. `/api/health` の `vector_store.namespace_vector_count` が `12` になっていることを確認

`lib/corpus.ts` が正本で、Vector DBは再生成できる派生索引。チャンクを変えたら `CORPUS_VERSION` を上げて再seedする（旧namespaceは検索対象から自動的に外れる）。

ロールバック: 環境変数 `MATTA_SEARCH_BACKEND=local` を設定して再デプロイすると、Vector DBを使わない従来のローカル意味検索へ即座に戻せる。

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

## Cloud9でのプレビュー（standalone成果物）

Cloud9のルートボリューム上では依存パッケージのインストールやビルドを行わず、GitHub ActionsがLinux環境で作成したstandalone成果物だけを配置する。
この手順には既存のAWS Cloud9環境が必要になる。AWS Cloud9は新規顧客への提供を終了しているため、新しいAWSアカウントでは環境を作成できない。
Cloud9側にはNode.js 20.9.0以上が必要になる。

### 1. GitHub Actionsから成果物を取得する

1. GitHubでこのリポジトリの **Actions** を開く
2. **CI** ワークフローの成功した実行を開く。成果物がない場合は、**Run workflow** から`main`のCIを実行する
3. 画面下部の **Artifacts** から `matta-standalone-linux-x64` をダウンロードする
4. ダウンロードしたZIPを手元のPCで展開し、`matta-standalone-linux-x64.tar.gz`を取り出す

成果物の保存期間はCI実行後7日間。
成果物には`.env.local`やAPIキーなどの秘密値を含めていない。

### 2. Cloud9へ配置する

Cloud9 IDEで`matta-standalone-linux-x64.tar.gz`を`~/environment`へアップロードする。
展開前に、ディスク容量とinodeに余裕があることを確認する。

```bash
df -h /
df -i /
```

初回は実行用ディレクトリを作り、成果物を展開する。

```bash
mkdir -p ~/environment/matta-runtime
tar -xzf ~/environment/matta-standalone-linux-x64.tar.gz \
  -C ~/environment/matta-runtime
rm ~/environment/matta-standalone-linux-x64.tar.gz
```

`server.js`が配置されたことを確認する。

```bash
ls ~/environment/matta-runtime/server.js
```

### 3. 環境変数を設定する

実行用ディレクトリに`.env.local`を作成する。

```bash
nano ~/environment/matta-runtime/.env.local
chmod 600 ~/environment/matta-runtime/.env.local
```

Upstash Vectorを使わないCloud9プレビューでは、最低限次の3変数を設定する。
ローカル意味検索でもEmbeddingと回答生成にOpenAI APIを使うため、`OPENAI_API_KEY`は必要になる。

```dotenv
OPENAI_API_KEY=<OpenAI APIキー>
MATTA_DEMO_PIN=<8文字以上のPIN>
MATTA_SEARCH_BACKEND=local
```

秘密値はGitHub、README、チャット、シェルのコマンド履歴へ書かない。

### 4. サーバーを起動する

Node.jsのバージョンを確認する。

```bash
node -v
```

20.9.0未満の場合は、Cloud9に入っているnvmでNode.js 20へ切り替える。

```bash
nvm install 20
nvm use 20
nvm alias default 20
```

Cloud9の内蔵プレビューが対応するポート8080でstandaloneサーバーを起動する。
Cloud9上で`npm ci`や`npm run build`を実行する必要はない。

```bash
cd ~/environment/matta-runtime
PORT=8080 HOSTNAME=0.0.0.0 node server.js
```

別のターミナルからhealthを確認する。

```bash
curl -sS http://127.0.0.1:8080/api/health | python3 -m json.tool
```

`openai_configured`と`pin_configured`が`true`、`search_backend`が`local`なら起動準備は完了している。
環境変数を修正した場合は、`Ctrl+C`でサーバーを停止してから起動し直す。

### 5. Cloud9で表示する

1. Cloud9 IDEの **Preview** から **Preview Running Application** を選ぶ
2. 埋め込みプレビュー右上の「新しいブラウザータブで開く」ボタンを押す
3. 新しいタブのCloud9プレビューURLでPINを入力する

埋め込みプレビューはiframe内で動くため、ブラウザーが認証Cookieを次のAPIリクエストへ送らず、相談送信時にPIN画面へ戻る場合がある。
PIN入力から相談実行まで、新しいブラウザータブで操作する。
`localhost:8080`ではなく、Cloud9が発行する次の形式のURLを使う。

```text
https://<環境ID>.vfs.cloud9.<リージョン>.amazonaws.com/
```

このURLはCloud9 IDEを開いている同じブラウザーでの確認用であり、チームへの共有URLには使わない。
確認を終了するときは、サーバーを起動したターミナルで`Ctrl+C`を押す。

### 成果物を更新する

新しい成果物へ入れ替えるときは、現在の`.env.local`を一時退避してから実行用ディレクトリを置き換える。

```bash
mv ~/environment/matta-runtime/.env.local ~/environment/matta-runtime.env.local
rm -rf ~/environment/matta-runtime
mkdir -p ~/environment/matta-runtime
tar -xzf ~/environment/matta-standalone-linux-x64.tar.gz \
  -C ~/environment/matta-runtime
mv ~/environment/matta-runtime.env.local ~/environment/matta-runtime/.env.local
chmod 600 ~/environment/matta-runtime/.env.local
rm ~/environment/matta-standalone-linux-x64.tar.gz
```

AWS公式資料: [AWS Cloud9 IDEで実行中のアプリケーションをプレビューする](https://docs.aws.amazon.com/cloud9/latest/user-guide/app-preview.html)

## 安全設計

- APIキー・PINはサーバー環境変数のみ。ブラウザへ渡さない
- 相談文は保存しない。ログにも本文を残さない（分析のためOpenAI APIへは送信される）
- 「詐欺です」「安全です」の断定はしない。公式窓口（#9110 / 188 / 110)への確認を常に案内
- PIN認証はHttpOnly Cookie（HMAC署名・24時間で失効）。PIN試行・分析実行にレート制限あり
- コーパスは原文引用ではなく要約。各チャンクに出典URLと確認日を記録
