# セキュリティと無料枠の防壁（2026-11-05）

このサイトの「外から壊される・外から無料枠を使い切られる」ことへの備えをまとめた正本。
経緯は `docs/operations.md` の [71]。**コード側の防壁は `node scripts/check.ts` の
「セキュリティと無料枠の防壁」節が毎回見張る**ので、ここに書いた設計を外すと CI が落ちる。

---

## 1. 脅威と、どこで止めるか

| 脅威 | 止める場所 | 状態 |
|---|---|---|
| Annictの作品名に `</script>` を入れられて任意のスクリプトが動く（保存型XSS） | `lib/jsonLd.ts`（全JSON-LDが通る） | 実装済み |
| ログイン直後に外部サイトへ送られる（オープンリダイレクト） | `lib/safeRedirect.ts` | 実装済み |
| 他サイトに枠ごと埋め込まれて押させられる（クリックジャッキング） | `next.config.mjs` のヘッダー（`/embed/**` だけは枠を許す） | 実装済み |
| cronの共有シークレット・管理トークンの総当たり／タイミング推測 | `lib/safeEqual.ts`・管理APIはURLでトークンを受けない | 実装済み |
| Next.js 14（サポート終了）の未修正の勧告（Server Actions・RSCのPOST） | Next.js 16 へ更新（2026-11-06。`npm audit` 0件）。`lib/methodGuard.ts` の拒否は多重の防壁として残す | 解消（5章） |
| 画像最適化APIの勧告と、`/_next/image` の変換枠（月5,000）の使い切り | `next.config.mjs` の `images.unoptimized` | 実装済み |
| 意味の無いクエリでCDNを外して関数を起動させ続ける | `lib/queryPolicy.ts`（middlewareで308。`?&&` のような表記揺れも） | 実装済み（表記揺れの本番での効き目は巡回が毎日確認） |
| 存在しない季節・巨大なIDでページを描かせ、404をISRに書かせ続ける | `lib/routeGuard.ts`（季節）・`lib/workId.ts`（6桁まで） | 実装済み |
| 存在しない配信サービス・制作会社・監督の名前で同じことをする | `lib/routeGuard.ts` の `unknownNameStatus`（ビルド時の一覧と照合） | 実装済み |
| 動的ルートに `.png` などを付けて middleware ごと迂回する | `middleware.ts` の matcher（動的ルートは拡張子に関係なく通す） | 実装済み |
| 計測の口（`/api/track`）に大きな本文・他サイトから送らせる | `lib/trackEventData.ts` の `trackRequestRejection` | 実装済み |
| 通知の登録を大量に入れて毎日の通知バッチを止める | `lib/userListApi.ts`（1人500件）・バッチは1回200作品まで | 実装済み（DB側の制約は下の 4章） |
| メールの安全確認がリンクを開いただけで配信停止される | 配信停止は確認画面→POST。RFC 8058 のワンクリック解除に対応 | 実装済み |
| Discord の署名付き要求の再送 | `isFreshDiscordTimestamp`（±5分） | 実装済み |
| 自動補完PRに紛れたコードが本番・特権ジョブで動く | `coverage-autofill.yml` を `pull_request_target` 化・`scripts/lib/data-literal-guard.js` | 実装済み |
| ワークフローのトークンが既定で書き込み権限を持つ | 全ワークフローに `permissions:` を明示 | 実装済み |
| 依存パッケージに新しい勧告が出ても気づかない | `security-audit.yml`（毎日・Issue `security-audit`） | 実装済み |
| **数で押す攻撃（1つのIPから大量の要求）** | **Vercel Firewall のレート制限（ダッシュボード）** | **利用者の設定待ち（2章）** |

### コードでは止められないもの（正直に書いておく）

**どんな要求も、middleware に届いた時点で1回の起動として数えられる。** コードでできるのは
「1回の要求が重い仕事（Annictへの問い合わせ・画像の描画・ISRへの書き込み）を起こさない」
ことまでで、**要求の数そのもの**は Vercel の手前（Firewall）でしか止められない。
Hobby の上限（月100万要求・100万起動）は、1台のPCから数時間で届く量である。
だから2章の設定が「恒久的に超えない」ための最後の1枚になる。

また次の2つは**閉じ切れていない**:

- `/person/[name]/…` の**存在しない名前**。今年の出演者はビルド時に決まらない（ライブ取得）ので、
  一覧と照合できない。1回の描画はキャッシュ済みのクール一覧を読むだけで軽いが、404がISRに書かれる。
- 形は正しいが存在しない作品ID（1〜999,999）。上限は実データ（最大18,000台）の50倍。

制作会社・監督は `dynamicParams = false` ではなく **middleware の照合**で閉じた
（`dynamicParams = false` は㊱と同じ経路で正規のページを404にしうる。照合は生の文字列・
1回デコード・2回デコードのどれかが一致すれば通す緩い形で、`node scripts/check.ts` が
実在する全件をあらゆる符号化で通すことを確かめる）。

**残りの2つは2章のレート制限でも止め切れない**（1IPあたり毎分600でも、存在しない名前を
1台から30分ほど叩けば ISR Writes の月の上限に届きうる）。ここは Next.js の更新（5章）の際に、
404がISRに書かれるか（#73101）を実測し直して閉じ方を決める（更新で直るかは未確認）。それまでは Firewall の画面と
ダッシュボードの ISR Writes を見て、急増していれば Attack Mode を入れる。

---

## 2. Vercel ダッシュボードで設定すること（利用者の作業・約10分）

コードからは設定できない（Hobby のレート制限はダッシュボードの規則だけ）。
Project → **Firewall** → **Configure**。

### 2-1. レート制限（Hobby は1本まで）— **最優先**

| 項目 | 値 |
|---|---|
| 名前 | `per-ip-burst` |
| 条件 | Request Path **does not start with** `/_next/static` |
| 方式 | Fixed Window・**60秒** |
| キー | IP Address |
| 上限 | **600** 要求 |
| 動作 | **Deny**（429） |

- 根拠: 人が1分に600回ページを開くことは無く、自前の巡回（GitHub Actions）も
  1分あたり数十件に収まる。`/_next/static` を外すのは、ブラウザ計測（`measure-speed.yml`）が
  1ページで数十個の静的ファイルを取るため。
- Firewall が止めた要求は **CDN Requests にも転送量にも数えられない**
  （<https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing>）。
- 導入後1週間は Firewall の画面で「どのIPが何回止められたか」を見て、正規の巡回や
  検索エンジンが止められていないか確かめる（止められていたら上限を上げる）。

### 2-2. カスタム規則（Hobby は計3本。レート制限と合わせて数える）

| 名前 | 条件 | 動作 | 理由 |
|---|---|---|---|
| `deny-page-post` | Method **is not** GET/HEAD/OPTIONS **かつ** Path **does not start with** `/api/` | Deny | `lib/methodGuard.ts` と同じ判定を**課金の手前**で行う（middlewareでも断るが、そこまで来ると1回の起動になる） |
| `deny-next-action` | Header `next-action` **exists** | Deny | Server Actions を使っていない（同上） |

### 2-3. 入れないもの（理由つき）

- **Bot Protection（managed ruleset）**: ブラウザ以外を一律に Challenge するので、
  自前の巡回（`verify-production.yml`・温め・計測）とカレンダーアプリの `.ics` 購読、
  RSSリーダーまで止まる。
- **AI Bots（managed ruleset）**: 学習用クローラーは既に `robots.txt` で拒否している（[62]）。
  Deny にすると AI 検索（ChatGPT の閲覧・Perplexity）からの流入も止まり、
  `docs/ai-era-strategy-2026-08-13.md` の方針と食い違う。
- **Attack Mode**: **緊急時の非常ボタン**として使う（全訪問者に Challenge。自前の巡回も止まる）。
  上限に近づいている兆候（4章）が出たときだけ入れ、収まったら切る。

---

## 3. GitHub で設定すること（利用者の作業・約5分）

リポジトリは公開なので、誰でも Issue・PR を出せる前提で設計してある。

1. **Settings → Actions → General → Workflow permissions** を
   **「Read repository contents and packages permissions」** にする。
   全ワークフローが `permissions:` を明示したので、既定を絞っても壊れない
   （`node scripts/check.ts` が明示漏れを落とす）。
   同じ画面の「Allow GitHub Actions to create and approve pull requests」は**オフ**。
2. **Settings → Code security** で **Dependabot alerts** と
   **Secret scanning（＋Push protection）** をオン（公開リポジトリは無料）。
   `security-audit.yml` と二重になるが、こちらは本番依存以外（開発用）も見る。
3. **Settings → Secrets** の `GH_SECRETS_PAT`（Threadsのトークン更新用。Secretsを書き換えられる）は
   期限付き・このリポジトリだけ・`Secrets: write` だけの fine-grained トークンであることを確かめる。

---

## 4. 監視（継続して回るもの）

| 何を | どこで | 頻度 | 異常時 |
|---|---|---|---|
| 依存パッケージの新しい勧告 | `security-audit.yml` → `scripts/security-audit.js` | 毎日 | Issue `security-audit`（0件で自動クローズ） |
| 本番の防壁が効いているか（POST拒否・クエリ正規化・季節/IDの404・ヘッダー） | `verify-production.yml` → `scripts/patrol.js` | 毎日 | Issue `production-check` |
| コード側の防壁の逆戻り | `ci.yml` → `scripts/check.ts`「セキュリティと無料枠の防壁」 | PR・mainへのpush | CIが赤 |
| 自動補完PRの中身 | `coverage-autofill.yml`（データ以外が混ざれば人の確認へ） | PRごと | ラベル `coverage-autofill-review` |
| Vercel の利用量 | **ダッシュボードの目視のみ**（Hobby は利用量APIが無い。[51]） | `usage-check.yml` の判定日 | Issue |
| 日次巡回での確認 | `docs/daily-ops.md` の「セキュリティ」節 | 毎日 | 日報 |

### 認めた勧告の扱い

`npm audit` の勧告のうち、この構成では到達できない・ビルド時専用のものは
`scripts/lib/security-acknowledged.js` に**理由と再確認の期日つき**で載せる。
期日が来ると Issue に戻る（`coverage-acknowledged.js` と同じ仕組み）。
2026-11-05に載せた17件（Next.js 14 の12件とビルド時専用の5件）は、16 へ上げて全部消えた（いまは0件）。

---

## 5. Next.js 16 への更新（2026-11-06）

14 はサポートが終わっており修正版が出ないので、**16.4（Active LTS）**へ上げた。15 は
2027-01-31 でセキュリティ修正が終わる（<https://nextjs.org/support-policy>）ので、15 で止めても
3ヶ月後にもう一度上げることになる。経緯と数字は `docs/operations.md` の [72]。

**確かめたこと（更新のPRで実測）**

1. `.next/prerender-manifest.json` の `initialRevalidateSeconds` が 4,966 ルートで更新前と同じ
   （1週間 4,409・6時間 4・1時間 1・固定 552）
2. ルートの静的／動的の区分が更新前と同じ。**`/feed.xml` と `/llms.txt` だけが静的→要求ごとに起動へ
   黙って変わっていた**（15 から GET の route handler が既定でキャッシュされない）ので
   `dynamic = "force-static"` を付けて戻した。逆戻りは `node scripts/check.ts` の
   「引数なしの GET はキャッシュの扱いを明示する」が見張る
3. `revalidateTag` は第2引数が必須になり、`"max"` などは「古いまま配って裏で作り直す」動きになる。
   温めのバッチは「消す→取り直す→HIT」を前提にしているので、公式が Route Handler 向けに示す
   **`{ expire: 0 }`（即時失効）**で呼ぶ（`app/api/revalidate/route.ts` の `PURGE_NOW`。検査あり）
4. `params`・`searchParams`・`cookies()` は非同期（codemod＋`lib/supabase/server.ts` を async に）
5. ローカルの本番サーバーで防壁（POST拒否・`Next-Action`・余計なクエリの308・季節/ID/名前の404・
   ヘッダー・`/_next/image` の404）が更新前と同じに効く
6. ルートの設定値は数値リテラルで書く（`6 * 60 * 60` は 16 のビルドで止まる）

**更新で増えるもの（要観察）**

- **ページを作るたびに、プリフェッチ用の分割ファイル（`.segments/`）も書き出される**。16 では止める設定が無い
  （Next.js のソースに「再生成のたびに全部を書く」とある）。全ページで計算すると、1回あたりの
  ISR への書き込みは**8KB単位で約1.7倍**、成果物は約1.7倍（`check-build-size.js` の予算の47%→79%）。
  Vercel がこれを ISR Writes に数えるかは本番でしか分からないので、**マージの前後で
  ダッシュボードの ISR Writes を見る**（4章）。上限の5割を超えていたら、マージを見送るか
  Attack Mode・revalidate の延長で吸収できるかを先に決める
- `middleware.ts` は 16 で非推奨（`proxy.ts` へ改名）だが、**proxy は Node.js 実行だけで edge を選べない**。
  実行環境が変わると起動の課金のされ方も変わりうるので、今回は改名しない（ビルドに警告が出るのは承知の上）。
  将来 middleware が削除される版が出たら、そのとき別PRで移す

---

## 6. Supabase 側で任意で足すとよい制約（利用者の作業）

ログイン利用者は匿名キー＋自分のセッションで Supabase に**直接**書けるので、
route の件数上限（`lib/userListApi.ts`）だけでは迂回できる。通知バッチ側にも上限を入れて
あるので致命的ではないが、DB側でも縛るなら SQL Editor で:

```sql
alter table public.notify_requests
  add constraint notify_requests_work_id_range check (work_id between 1 and 999999);
alter table public.watched
  add constraint watched_work_id_range check (work_id between 1 and 999999);
```

RLS が有効か（`analytics_events`・`service_sightings` はポリシー無し＝匿名キーから読めない）は
Table Editor の各テーブルの「RLS enabled」表示で確かめる。
