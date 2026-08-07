# Discord スラッシュコマンド セットアップ手順（2026-08-07導入）

サイトの配信情報を Discord から `/anime title:<作品名>` で引けるようにする。

## なぜやるか

`docs/growth-strategy-2026-08.md` の Tier 2④。AnimeSchedule が Discord bot 経由で
得ている露出と同じ型で、**サーバー管理者が自分で見つけて追加する**形なので、
「リプライ・DM・フォロー営業をしない」というこのプロジェクトの方針と矛盾しない。

保留されていた理由は「ホスティング費用の判断待ち」だったが、**常時起動のプロセスは要らない**。
Discord には Gateway に常時接続する方式のほかに **Interactions Endpoint**（ただのHTTPエンドポイント）
方式があり、後者なら既存の Vercel に相乗りできる。新しい費用も運用先も発生しない。

## 仕組み

| | |
|---|---|
| 受け口 | `app/api/discord/route.ts`（`runtime = "nodejs"`。Ed25519の検証に `node:crypto` を使うため） |
| ロジック | `lib/discord.ts`（署名検証・文面組み立て。`scripts/check.ts` が検査する） |
| 環境変数 | `DISCORD_PUBLIC_KEY`（Discord のアプリごとの公開鍵。16進64文字） |

`DISCORD_PUBLIC_KEY` が未設定のときは 503 を返すだけで、サイトの他の機能には影響しない。

## 手順

### 1. Discord アプリを作る

1. https://discord.com/developers/applications を開き「New Application」
2. 名前は「アニメ視聴ガイド」等
3. **General Information** の「Public Key」をコピー（これが `DISCORD_PUBLIC_KEY`）

### 2. 環境変数を設定

- ローカル: `.env.local` に `DISCORD_PUBLIC_KEY=...`（**絶対にコミットしない**）
- 本番: Vercel のプロジェクト設定 → Environment Variables に同じものを追加 → 再デプロイ

### 3. Interactions Endpoint URL を登録

Discord のアプリ設定 → **General Information** → 「Interactions Endpoint URL」に

```
https://<本番のドメイン>/api/discord
```

を入れて保存する。

**保存時、Discord は「わざと壊れた署名」を送って 401 が返るかを確かめる。**
返さないエンドポイントは登録を拒否される。この挙動は `scripts/check.ts` の
「Discordスラッシュコマンド」節で検査してあるので、検査を消さないこと。

保存できない場合はまず、①環境変数が本番に反映されているか（再デプロイ済みか）、
②URLの綴り、の順に確認する。

### 4. スラッシュコマンドを登録

アプリの Bot トークン（または Client Credentials）で、次のコマンドを1回登録する。

- コマンド名: `anime`
- オプション名: `title`（必須・文字列）

登録は Discord の API に1回 POST するだけ。コマンド名・オプション名は
`lib/discord.ts` の `COMMAND_NAME` / `COMMAND_OPTION` と**一致させること**（変えるなら両方）。

### 5. サーバーに追加する

OAuth2 の URL Generator で `applications.commands` スコープを選び、生成されたURLから
自分のサーバーに追加してテストする。

## 返信の中身と、その制約

- 今期の作品 … 「dアニメ・ABEMA で配信されています」と言い切る
- **放送が終わったクールの作品 … サービス名を並べず、作品ページへ案内するに留める**
  （CLAUDE.mdの基本ルール。Annictは配信終了を記録しないので、過去作に「配信中」と
  書けない。Discordの返信は**他人のサーバーに残る**ぶん、誤りの影響が自サイトに閉じない）
- 見つからない場合 … サイトの検索へ案内
- リンクには `?ref=discord` を付ける（流入の実測。ウィジェットの `?ref=embed` と同じ）
- `allowed_mentions` を空にして、返信が誰かにメンションを飛ばさないようにしている

## 3秒ルールについて

Discord は3秒以内の応答を要求する。遅延応答（type 5）は「返した後に続きを実行する」
必要があってサーバーレスでは壊れやすいので**使っていない**。代わりに、
今期のシーズンデータ（15分キャッシュ・`warm-cache.yml` で温めてある）だけで即答し、
2秒で間に合わなければサイトへのリンクを返す。

そのため**過去クールの横断検索はしない**。今期に見つからなければ検索ページへ案内する。

## 検索できる範囲を広げたくなったら

過去クールまで引きたい場合、`content/snapshots/` を関数バンドルに載せると重くなるので、
`/api/search-index` を内部で叩く形にするか、軽量な「タイトル→作品ID」索引を別に作ること。
どちらにしても3秒ルールを先に確かめる。
