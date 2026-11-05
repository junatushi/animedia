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
| Next.js 14（サポート終了）の未修正の勧告（Server Actions・RSCのPOST） | `lib/methodGuard.ts`（ページへのPOST・`Next-Action`を描画前に拒否） | 緩和済み。根本対応は 15/16 系への更新（別PR） |
| 画像最適化APIの勧告と、`/_next/image` の変換枠（月5,000）の使い切り | `next.config.mjs` の `images.unoptimized` | 実装済み |
| 意味の無いクエリでCDNを外して関数を起動させ続ける | `lib/queryPolicy.ts`（middlewareで308） | 実装済み |
| 存在しない季節・巨大なIDでページを描かせ、404をISRに書かせ続ける | `lib/routeGuard.ts`（季節）・`lib/workId.ts`（6桁まで） | 実装済み |
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

また次の2つは**意図して閉じていない**（閉じると正規のページを消す危険のほうが大きい）:

- `/studio/[name]`・`/director/[name]`・`/person/[name]/…` の**存在しない名前**。
  `dynamicParams = false` で閉じられるが、㊱（日本語名の事前生成ページが本番で404）と同じ
  経路で**正規のページが404になる**危険がある。描画は索引の照合だけで軽い。
- 形は正しいが存在しない作品ID（1〜999,999）。上限は実データ（最大18,000台）の50倍。

この2つの残りは2章のレート制限が止める。

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
Next.js 14 の12件は **2026-12-05** が期日で、それまでに 15/16 系へ上げる（5章）。

---

## 5. Next.js 15/16 系への更新（別PRで行う）

Next.js 14 はサポートが終わっており、14系には修正版が出ない（`npm audit` の修正候補は 16 系）。
いまは middleware で入口を閉じているが、**今後の勧告も14系には直らない**ので更新は必須。
別PRにする理由は、更新でキャッシュの既定が変わる（15 で `fetch` と GET の route handler が
既定でキャッシュされなくなる）ため、**ISR Writes・Active CPU が増えて2026-08-24の停止（㉝）を
再発させうる**から。更新のPRでは次を必ず確かめる:

1. `npm run build` 後の `.next/prerender-manifest.json` の `initialRevalidateSeconds` が更新前と同じ
2. `node scripts/check.ts`・`check-page-css.js`・`check-build-size.js` が全部OK
3. route handler に `export const revalidate`／`dynamic = "force-static"` が付いて、キャッシュが維持されている
4. `params`・`searchParams`・`cookies()` の非同期化（`lib/supabase/server.ts` の注意書き）

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
