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

`ADMIN_DASHBOARD_TOKEN` は Supabase や Vercel が発行するものではなく、
**あなたが決める合言葉**（`NOTIFY_CRON_SECRET` と同じ性質）。
パスワード相当なので、推測されにくい長い文字列にする。

PCのターミナルで:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

出てきた64文字の16進文字列をコピーしておく（手順3と手順4で**同じ値**を使う）。

> **メモ帳やチャットに貼らない・コミットしない。** これを知っている人は誰でも
> `/admin/analytics` を開けるため、実質的にダッシュボードのパスワード。
> `.env.local` に書く場合も、そのファイルは `.gitignore` 済みであることを確認する。

---

## 手順3. Vercel に環境変数を追加する

1. https://vercel.com/dashboard → 本サイトのプロジェクト
2. 上部タブ **Settings** → 左メニュー **Environment Variables**
3. **Add New**
   - Key: `ADMIN_DASHBOARD_TOKEN`
   - Value: 手順2で作った文字列
   - Environment: **Production** にチェック（Preview・Developmentは任意）
4. **Save**
5. **必ず再デプロイする**: 上部タブ **Deployments** → 最新デプロイの右端「…」→ **Redeploy**

> **手順5を飛ばすと反映されない。** 環境変数は保存しただけでは既に動いている
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

## 手順4. GitHub Secrets に**同じ値**を登録する

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

### 動作確認（待たずに今すぐ試せる）

1. GitHub → 上部タブ **Actions** → 左の一覧から **「サイト行動ログ集計の日次取得」**
2. 右上の **Run workflow** → **Run workflow**（緑ボタン）
3. 1分ほどで完了する。ログを開いて確認する:

| ログの内容 | 意味 |
|---|---|
| `書き出し: .../content/analytics/site/2026-08-19.json` | **成功**。以後は毎日自動で回る |
| `ADMIN_DASHBOARD_TOKEN が未登録のためスキップします` | 手順4の登録ができていない |
| `サイト側が未設定のためスキップします: Supabaseが未設定です` | 手順0の環境変数が欠けている |
| `恒久的なエラー: HTTP 404` | **Vercel側とGitHub側でトークンが食い違っている** |

4. 成功していれば、リポジトリに `content/analytics/site/<日付>.json` が
   自動コミットされている（`git pull` で手元にも降りてくる）

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
