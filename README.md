# アニメ視聴ガイド

シーズンごとのアニメを、観られる**国内配信サービス**で一覧できるサイト。
データは Annict から**リアルタイム取得**します（トークンはサーバー側に隠すので安全）。

---

## 5分で動かす（ローカル・デプロイ不要）

必要なもの: **Node.js 18 以上**

```bash
# 1) Annict のトークンを取得
#    https://annict.com/settings/tokens で「Read」権限のトークンを発行

# 2) 雛形をコピーして .env.local を作り、トークンを設定
cp .env.local.example .env.local
#    → .env.local を開いて ANNICT_TOKEN=... を書き換える

# 3) 依存をインストール
npm install

# 4) 起動
npm run dev
#    → http://localhost:3000 を開く
```

シーズン（冬/春/夏/秋）と年を切り替えると、その期のアニメと配信サービスが出ます。
上部のサービス名チップで絞り込み、検索ボックスで作品名検索ができます。

---

## 公開する（Vercel・無料）

Next.js 製なので [Vercel](https://vercel.com) に無料で公開できます。ローカルの `.env.local` は
**公開時にアップロードされない**ため、`ANNICT_TOKEN` は Vercel 側に別途登録します
（サーバー側でのみ使われ、ブラウザには出ません）。

### 方法A: GitHub 連携（おすすめ・更新のたび自動デプロイ）

1. GitHub に新しいリポジトリを作り、このフォルダを push する
   ```bash
   git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
   git push -u origin main
   ```
2. [vercel.com](https://vercel.com) にログイン →**Add New… → Project**→ 上記リポジトリを **Import**
3. **Environment Variables** に以下を追加（Production / Preview / Development すべてにチェック）
   - Name: `ANNICT_TOKEN` ／ Value: 取得済みのトークン
4. **Deploy** を押す → 数十秒で `https://<プロジェクト名>.vercel.app` が発行される

### 方法B: Vercel CLI（GitHub なしで手早く）

```bash
npm i -g vercel                 # 初回のみ
vercel                          # 対話に従ってプロジェクト作成（初回はプレビュー環境）
vercel env add ANNICT_TOKEN     # トークンを登録（Production を選択）
vercel --prod                   # 本番公開
```

### 補足
- 公開後もデータは Annict からリアルタイム取得（`revalidate: 600` で最大10分キャッシュ）。
- 応答を速くしたい場合、Vercel の Project → Settings → Functions で
  **Region を Tokyo (hnd1)** にすると Annict（日本）への通信が速くなります（任意）。

---

## 構成（エージェント → コードの対応）

| エージェント | 役割 | 実体 |
|---|---|---|
| ① 収集 | シーズン作品＋チャンネルを Annict から取得 | `lib/annict.ts` |
| ② 配信正規化 | チャンネル名を国内配信サービスに変換、TVは除外 | `lib/services.ts` |
| （窓口） | ①②をつないで整形JSONを返す | `app/api/season/route.ts` |
| ③ UI | シーズン選択・検索・絞り込み・一覧表示 | `app/page.tsx` |
| ④ 検証/更新 | 毎シーズンの再取得・差分・欠損チェック（運用役） | 都度実行 / Claude Code サブエージェント化 |

---

## カスタマイズ

- **配信サービスを増やす**: `lib/services.ts` の `SERVICES` に1行追加するだけ。
  `match` は正規化後（小文字・半角・空白除去）の名前に対する正規表現。
- **取得のリアルタイム度**: `lib/annict.ts` の `next: { revalidate: 600 }` を調整。
  `0` で常に最新、大きくすると Annict への負荷が下がる。
- **判定ロジックの確認**: `node scripts/check.ts` でサンプルのチャンネル名判定をテスト。

## 注意

配信情報は Annict のコミュニティ更新がベースで、網羅率は100%ではありません。
特に新作は反映が遅れることがあるため、視聴前に各サービスの最新情報もご確認ください。
