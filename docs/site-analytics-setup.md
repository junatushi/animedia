# 自前計測（行動ログ）の有効化手順

2026-08-19導入。`/admin/analytics`（画面）と `content/analytics/site/<日付>.json`（日次取得）を
動かすためのセットアップ。**所要15分程度・全部ユーザー作業**（Supabase・Vercel・GitHubの
管理画面はいずれもログイン制で、セッションからは触れないため）。

仕組みの説明は `docs/operations.md` の「計測の見かた」、
コードの対応表は `CLAUDE.md` の `scripts/fetch-site-analytics.js` の項を参照。

---

## これが済むと何ができるようになるか

いま `content/affiliate/programs.ts` の提携先は3社（ABEMA・Prime Video・Hulu）で、
次にどこと提携すべきかは **`content/snapshots/` の掲載本数からの推定**で決めている
（`docs/affiliate-setup.md` の「未提携サービスの掲載本数」表）。

本当に見たいのは推定ではなく **実際にどのサービスのバッジが押されているか** で、
これはサイトが2026-07-19から `official_link_click` として記録し続けている。
にもかかわらず**誰も読めていない**（画面にしか出ず、その画面もトークン未設定で開けない）。

この手順が済むと:

1. `/admin/analytics?token=...` をブラウザで開いて自分で見られる
2. **毎日 GitHub Actions が同じ集計をJSONで取得し、リポジトリにコミットする**
   → 以後セッション（Claude）が実測値を毎日読める＝提携順を実測で決められる
3. `follow_click`（フッターのSNSフォロー導線のクリック数）も読める
   → Xアナリティクスが取得できない穴を、サイト側で測れる数字で部分的に埋められる

---

## 手順0. 前提の確認（**ここを飛ばさない**）

このダッシュボードは Supabase のテーブルを **service role キー**で読む。
そのため、以下の3つが**すでにVercelに登録済みであること**が前提になる。

| 環境変数 | 何のためか | どこで設定したか |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabaseプロジェクトの場所 | `docs/supabase-setup.md` の手順9 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 同上（設定済み判定に使う） | 同上 |
| `SUPABASE_SERVICE_ROLE_KEY` | RLSを無視して集計を読む | `docs/notify-setup.md` の手順6 |

**確認方法**: Vercel → プロジェクト → **Settings → Environment Variables** で3つの名前が並んでいるか見る。

- **3つとも有る**（＝配信開始通知メールが動いている状態）→ 手順1へ進む
- **`SUPABASE_SERVICE_ROLE_KEY` だけ無い** → `docs/notify-setup.md` の手順2で
  Supabaseの **Settings → API Keys → Secret key（`sb_secret_...`）** をコピーして
  Vercelに追加してから手順1へ。
  ※ `docs/supabase-setup.md` には「Secret keyは絶対に使わない」と書いてあるが、
    あれは**ログイン機能の話**（ブラウザに渡る鍵の話）。サーバー側だけで使う
    集計・通知には Secret key が要る。用途が違うので矛盾しない
- **3つとも無い** → 先に `docs/supabase-setup.md` を通す（Supabaseプロジェクトの作成から）

---

## 手順1. Supabase に `analytics_events` テーブルを作る

1. https://supabase.com/dashboard にログイン → 本サイトのプロジェクトを開く
2. 左メニューの **SQL Editor**（アイコンは `>_`）→ **New query**
3. 以下を**まるごと**貼り付けて **Run**（右下の緑ボタン、または Ctrl+Enter）

```sql
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  event_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.analytics_events enable row level security;
-- ポリシーは意図的に1つも作らない（anon/authenticatedからは読み書き不可。
-- service_role（RLSを無視する）経由の /api/track・/admin/analytics からのみ操作する）。
```

4. `Success. No rows returned` と出れば成功
5. 左メニュー **Table Editor** に `analytics_events` が現れていることを確認

> **ポリシーを作らないのは書き忘れではない。**
> RLSを有効にしてポリシーを1つも作らないと、通常の鍵（anon key＝ブラウザに渡る鍵）からは
> 読み書きが**完全に拒否**される。書き込むのはサーバー側の `/api/track` だけ、読むのは
> `/admin/analytics` と `/api/admin/analytics` だけで、どちらも service role キーを使うので
> RLSを迂回できる。**「ポリシーが無いと動かないのでは」と思って`for all using (true)`のような
> ポリシーを足さないこと**（足すと誰でも全行を読めるようになる）。

### 動いているかの早期確認（任意）

テーブルを作った直後から `/api/track` が記録を始める（デプロイ済みのサイトで
作品カードの共有ボタンを押す・配信バッジを押す等）。
数分後に **Table Editor → analytics_events** に行が増えていれば配線は生きている。
0行のままなら、`SUPABASE_SERVICE_ROLE_KEY` がVercelに無い可能性が高い（手順0に戻る）。

---

## 手順2. トークンの文字列を決める

### これは何か

`ADMIN_DASHBOARD_TOKEN` は **Supabase や Vercel が発行するものではない**。
**あなたが自分で決める合言葉**で、`NOTIFY_CRON_SECRET` / `NOTIFY_UNSUBSCRIBE_SECRET`
（`docs/notify-setup.md` の手順4）と同じ性質のもの。
どこかの管理画面を探しても見つからないので、**探さずに自分で作る**。

役割は**ダッシュボードのパスワード**そのもの。`/admin/analytics` にはログイン機構が無く、
この文字列と一致するかどうか**だけ**で運営者を判定している
（管理者ロールを新設する規模ではないため、`x-cron-secret` と同じ「固定シークレットの一致」方式）。
**これを知っている人は誰でもダッシュボードを開ける。**

### 満たすべき条件

| 条件 | 理由 |
|---|---|
| **32文字以上**（推奨64文字） | 総当たりで当てられないため。**8文字未満は特に危険**（下記） |
| **英数字だけ**（`a-z` `A-Z` `0-9`）。記号・日本語・空白を使わない | ブラウザからは `?token=...` ＝**URLの一部**として、取得スクリプトからは `x-admin-token` ＝**HTTPヘッダー**として送られる。記号はURLエンコードが要るし、非ASCII文字はヘッダーに載せられない |
| **前後に空白・改行を含まない** | 照合は単純な文字列一致（`!==`）で、トリムも正規化もしない。**末尾に改行が1つ入っているだけで404になる** |
| 他の秘密の使い回しをしない | `NOTIFY_CRON_SECRET` 等と共用すると、片方が漏れたときに両方失う |

> **8文字未満を絶対に使わないこと。** 取得スクリプトには「書き出すJSONに
> トークンが混ざっていたら書かずに落とす」安全装置（`assertNoSecrets`）があるが、
> これは**8文字未満の値を検査対象から除外する**（短すぎる文字列は偶然どこにでも
> 出現し、誤検知だらけになるため）。つまり短いトークンは**安全装置が効かない**まま
> 公開リポジトリにコミットされうる。

### 作り方（環境ごと）

どれも「32バイトの乱数を16進64文字にする」という同じことをしている。**1つだけ実行すればよい。**

**A. Node.js がある場合**（このプロジェクトを動かしているPCなら必ず入っている。最も簡単）

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**B. macOS / Linux で Node を使わない場合**

```
openssl rand -hex 32
```

**C. Windows の PowerShell で Node を使わない場合**

```powershell
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
-join ($b | ForEach-Object { $_.ToString('x2') })
```

> PowerShell の `Get-Random` は暗号用途の乱数ではないので、`Get-Random` を使った
> 短い書き方は**使わない**。上の書き方は暗号用の乱数生成器を明示的に呼んでいる。

**D. コマンドを使いたくない場合**

1Password・Bitwarden 等のパスワード生成機能でもよい。設定は
**長さ64・記号なし（Symbols をオフ）・英数字のみ**にする。
「覚えやすいパスフレーズ」形式は使わない（空白や記号が入るため）。

### 出力の例（形だけの見本。**これをそのまま使わない**）

```
3f8a1c04e97b25d6a0fe4318bc7d2905e61af83d472c9b0e5d8a1746fc302b9e
```

64文字の16進（`0-9` と `a-f` だけ）になっていれば正しい。

### 作ったあとの扱い

- **パスワード管理ソフト（1Password・Bitwarden 等）に保存する。**
  この後の手順3（Vercel）と手順4（GitHub）で**同じ値**を貼るので、
  それまで確実に取り出せる場所に置いておく
- **チャット・メール・Issue・コミットに貼らない**（このセッションにも貼らないでください）
- `.env.local` に書くのは**ローカルでもダッシュボードを開きたい場合だけ**で、
  本番の動作には不要。書く場合は `.gitignore` 済みであることを確認する
  （このリポジトリでは既に除外されている）
- ターミナルに表示したままにしない。コピーしたら画面を閉じる
  （シェルの履歴には残らない — 上のコマンドは**トークンを引数に取らない**ので、
  履歴に残るのはコマンド文字列だけで生成結果は残らない）

### コピーするときの注意

**ここでの失敗が、この手順書で最も多いつまずき所**（手順3・手順4で同じ値を2回貼るため）。

- ターミナルからのコピーで**末尾に改行が入りやすい**。貼り付け先で行末をよく見る
- ダブルクリックでの選択は単語区切りで切れることがある。**行全体を選択**する
- 手順3（Vercel）と手順4（GitHub）は**同じクリップボードの内容を続けて貼る**のが安全。
  間に別のコピー操作を挟まない

---

## 手順3. Vercel に環境変数を追加する

> **【注意】「チーム階層」と「プロジェクト階層」に同名の画面がある。**
> 左サイドバーの **Environment Variables**（チーム`animedi`の直下）は
> 全プロジェクトの変数を**一覧するだけの集約ビュー**で、**追加ボタンが無い**。
> 上部に「All Projects ⌄」と出ていたらそちら＝間違い。
> チーム側の「Shared」タブからも追加はできるが、全プロジェクト共有になるので**使わない**。

1. https://vercel.com/dashboard → 左サイドバー **Projects** → **`animedia`**
   （直接行くなら `https://vercel.com/animedi/animedia/settings/environment-variables`）
2. 上部タブ **Settings** → 左メニュー **Environment Variables**
3. **Add New**（＝「Add Environment Variable」ダイアログが開く）
   - Key: `ADMIN_DASHBOARD_TOKEN`
   - Value: 手順2で作った文字列
   - **Sensitive: ON**（推奨。保存後は値を読み出せなくなる）
   - Environments: **Production and Preview**（既存の変数に合わせる。Productionだけでも動く）
   - Branch: 空のまま（カスタムプレビュー用の任意項目）
4. **Save**

> **Sensitive を ON にすると、保存後は値を二度と表示できない。**
> 手順4で同じ値をGitHubにも貼るので、Saveを押す前に
> Value欄の 👁 アイコンで **64文字・末尾に空白や改行が無いこと**を目視し、
> パスワード管理ソフトに保存しておく。

5. **必ず再デプロイする**: 上部タブ **Deployments** → 最新デプロイの右端「…」→ **Redeploy**
   - Choose Environment: **Production**
   - 対象は `main` の最新（Current と表示されているもの）
   - 「Use existing Build Cache」はどちらでもよい

> **再デプロイを飛ばすと反映されない。** 環境変数は保存しただけでは既に動いている
> デプロイに適用されない。再デプロイして初めて `/admin/analytics` が
> 「未設定です」表示から本来の画面に変わる。

### ここで一度確認する

ブラウザで `https://animedia-khaki.vercel.app/admin/analytics?token=<手順2の文字列>` を開く。

| 見えたもの | 意味 |
|---|---|
| 「効果測定ダッシュボード」＋グラフ | **成功**。手順4へ |
| 「効果測定ダッシュボードは未設定です」 | 環境変数が反映されていない → 再デプロイし直す |
| 404ページ | トークンの打ち間違い（前後の空白・改行の混入に注意） |
| 「Supabaseが未設定のため…」 | 手順0の3つの環境変数のどれかが欠けている |

---

## 手順4. PRをマージして GitHub Secrets に**同じ値**を登録する

### 4-1. まずマージする

`/api/admin/analytics`（窓口）と `.github/workflows/site-analytics.yml`（日次取得）は
**mainに入って初めて存在する**。マージしていないと:

- Actions タブに **「サイト行動ログ集計の日次取得」が現れない**（`Run workflow` を押せない）
- 仮に叩けても `/api/admin/analytics` が本番に無いので **404**

**マージ → mainへの自動デプロイ完了（1〜2分）を待つ** → 4-2へ。

### 4-2. GitHub Secrets に登録する

ここまでで画面は見られるようになったが、**セッション（Claude）はまだ読めない**
（本番ドメインへの外向き通信が遮断されているため）。
毎日 GitHub Actions が取得してリポジトリにJSONを置く経路を有効にする。

1. GitHub で `junatushi/animedia` を開く
2. **Settings** → 左メニュー **Secrets and variables** → **Actions**
3. **New repository secret**
   - Name: `ADMIN_DASHBOARD_TOKEN`
   - Secret: **手順2の文字列（Vercelに入れたものと完全に同じ）**
4. **Add secret**

> **ここが最も間違えやすい。** Vercel側とGitHub側で値が1文字でも違うと、
> ワークフローは404を受け取り（＝トークン不一致）、**再試行せず即座に失敗**して
> `site-analytics` ラベルのIssueを立てる。コピー&ペーストの際に末尾の改行や
> 空白が混ざるのがよくある原因。

### 4-3. 動作確認（毎日の実行を待たずに試せる）

1. GitHub → 上部タブ **Actions** → 左の一覧から **「サイト行動ログ集計の日次取得」**
2. 右上の **Run workflow** → **Run workflow**（緑ボタン）
3. 1分ほどで完了する。ログを開いて確認する:

| ログの内容 | 意味 |
|---|---|
| `書き出し: .../content/analytics/site/2026-08-19.json` | **成功**。以後は毎日自動で回る |
| `ADMIN_DASHBOARD_TOKEN が未登録のためスキップします` | 手順4の登録ができていない |
| `サイト側が未設定のためスキップします: Supabaseが未設定です` | 手順0の環境変数が欠けている |
| `恒久的なエラー: HTTP 404` | 原因は2つ。①**Vercel側とGitHub側でトークンが食い違っている** ②`/api/admin/analytics` がまだ本番に無い（マージ直後でデプロイが終わっていない）。**先に`/admin/analytics`の画面が開けるか**を見れば切り分けられる（開けるならトークンは正しい＝②） |

4. 成功していれば、リポジトリに `content/analytics/site/<日付>.json` が
   自動コミットされている（`git pull` で手元にも降りてくる）

---

## 手順5. **書き込み側**が届いているかを確かめる（ここまでやって初めて完了）

手順4までで確かめられるのは**読み出し**（Actions → 本番 → JSON）だけで、
**ブラウザ → `/api/track` → Supabase** の書き込みが生きているかは分からない。
`/api/track` は計測の失敗でユーザー体験を壊さないよう、**挿入に失敗しても
静かに握りつぶす**（`{ ok: false }` を返すだけ）ので、壊れていても画面には何も出ない。

そのため `rowCount: 0` は2つの意味を持つ:

| 状況 | `rowCount: 0` の意味 |
|---|---|
| テーブルを作った直後 | **正常**。テーブルが無かった間の操作は記録されていないので、0から積み上がる |
| 数日経っても0のまま | **書き込みが届いていない**。手順1のDDLの列名がコードとズレている疑い（`event_name` / `event_data` / `created_at`） |

切り分けは10秒でできる:

1. 本番サイト（https://animedia-khaki.vercel.app/ ）を開く
2. 作品カードの**配信サービスのバッジを1つ押す**
   （`official_link_click` か `affiliate_click` が飛ぶ）
3. Actions → 「サイト行動ログ集計の日次取得」→ **Run workflow**
4. `content/analytics/site/<日付>.json` の `rowCount` が **0 → 1以上**になっていれば完了

なっていなければ Supabase の Table Editor で `analytics_events` の列名を見る。
`app/api/track/route.ts` が挿入するのは `event_name`（text）と `event_data`（jsonb）で、
`created_at` は**デフォルト値（`now()`）が要る**（コード側は渡していない）。

### 2026-08-19 時点の実測

- 手順4までは**通っている**（`configured: true` / `rowCount: 0` / Actionsは成功）
  ＝トークン一致・Supabase接続・テーブル存在まで確認済み
- `rowCount: 0` はテーブルを作った当日のため。**上の切り分けはまだ未実施**

---

## 完了後

- 以後、毎日 **07:10 JST 前後**に自動取得される
  （GitHub Actions の schedule は数時間遅れるので時刻は目安。
  1日1回で足りる集計なので精度は要らない）
- 失敗した日は `site-analytics` ラベルの GitHub Issue が立つ（黙って止まらない）
- **次にセッションへ依頼すること**: 「`content/analytics/site/` を読んで、
  未提携サービスへのクリックが多い順に提携の優先順位を組み直して」
  → `docs/affiliate-setup.md` の「提携の優先順位」を掲載本数ベースから実測ベースに置き換える

---

## トークンを変えたくなったら

1. 手順2で新しい文字列を作る
2. Vercel の `ADMIN_DASHBOARD_TOKEN` を上書き保存 → **再デプロイ**
3. GitHub Secrets の `ADMIN_DASHBOARD_TOKEN` を **Update secret** で同じ値に
4. **2と3は同じ日のうちに両方やる**（片方だけだと翌朝から404で失敗し続ける）

## 記録される内容（プライバシー）

`event_name`（コード側でホワイトリスト済みの14種のみ）と `event_data`（`service`名等の
付随情報）だけ。**IPアドレス・Cookie・ユーザーIDは一切記録しない**。
`/privacy` の記載もこの内容と同期させること（実装を変えたら文面も直す）。

書き出されるJSONにトークンが混入しないことは `scripts/fetch-site-analytics.js` が
書き出す直前に検査し、混じっていたら**書かずに落とす**
（`content/analytics/` はコミットされる＝公開されるため）。
