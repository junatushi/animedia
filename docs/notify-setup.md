# 配信開始メール通知 セットアップ手順

「配信開始をメールで通知」機能（🔔アイコン）を動かすための設定手順。実装計画は
`.claude/plans/cheerful-wobbling-valiant.md`参照。`docs/supabase-setup.md`と同じく、
すべてブラウザ上の管理画面操作。

**重要な制約（先にお読みください）**: 実際のユーザーへのメール送信には独自ドメイン
（DNS設定可能なもの）が必要です。今回はドメイン未取得のまま進めるため、**Resendの
テストモードとなり、実際にメールが届くのはResendアカウント登録メールアドレス
（＝あなた自身）宛のみ**です。他のユーザーが🔔をONにしても、この状態では実際には
メールが届きません（仕組みとしては正しく動作しますが配信されない状態）。将来ドメインを
用意した時点で、Resendダッシュボードでドメイン検証し`from`アドレスを変更するだけで
全ユーザーへの配信が有効になります（コード変更は基本的に不要）。

---

## 1. Resendアカウント作成・APIキー取得

1. https://resend.com にアクセスしアカウント作成
2. ダッシュボード → **API Keys** → 「Create API Key」
3. 権限は「Sending access」で十分。名前は任意（例: `anime-haishin`）
4. 発行された**APIキー（`re_`から始まる文字列）**を控えておく（**この画面を閉じると二度と表示されないので必ずコピー**）

---

## 2. SupabaseのService role keyを取得

視聴済み機能とは別に、全ユーザーの通知希望データを横断して読むためのキーが必要です。

1. Supabaseダッシュボード → **Settings → API Keys**
2. **Legacy API Keys**タブ（または表示されていれば新しい「Secret keys」欄）を開く
3. **service_role**（または`sb_secret_...`のSecret key）をコピー
   ※これは`.env.local`の`NEXT_PUBLIC_SUPABASE_ANON_KEY`とは**別物**で、**絶対にクライアント側に公開してはいけない秘密鍵**です。`NEXT_PUBLIC_`を付けずに設定してください

---

## 3. テーブルを作成

Supabase **SQL Editor**で以下を実行（`watched`テーブルと同じ形）。

```sql
create table if not exists public.notify_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, work_id)
);
alter table public.notify_requests enable row level security;
create policy "notify_select_own" on public.notify_requests for select using (auth.uid() = user_id);
create policy "notify_insert_own" on public.notify_requests for insert with check (auth.uid() = user_id);
create policy "notify_delete_own" on public.notify_requests for delete using (auth.uid() = user_id);
```

---

## 4. ランダムな秘密文字列を2つ用意

以下2つは、あなた自身で適当なランダム文字列を決めるだけでOKです（Resend/Supabaseの発行物ではありません）。長く推測されにくい文字列であれば何でも構いません。

- `NOTIFY_CRON_SECRET`: cron（後述のGitHub Actions）から通知実行APIを叩く際の合言葉
- `NOTIFY_UNSUBSCRIBE_SECRET`: 通知停止リンクの署名用の秘密鍵

作り方の一例（お使いのPCのターミナルで）:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
これを2回実行して、それぞれ別の値を`NOTIFY_CRON_SECRET`・`NOTIFY_UNSUBSCRIBE_SECRET`に使ってください。

---

## 5. 環境変数を設定（ローカル）

`.env.local`に以下を追記（既存の行はそのまま）:

```
RESEND_API_KEY=手順1のAPIキー
SUPABASE_SERVICE_ROLE_KEY=手順2のservice_role/Secret key
NOTIFY_CRON_SECRET=手順4で決めた文字列その1
NOTIFY_UNSUBSCRIBE_SECRET=手順4で決めた文字列その2
```

---

## 6. 環境変数を設定（本番・Vercel）

1. https://vercel.com/dashboard → 対象プロジェクト → **Settings → Environment Variables**
2. 手順5と同じ4つを追加（Environment: Production）
3. 保存後、**Deployments → 最新デプロイの「…」→ Redeploy**

---

## 7. GitHub Actionsのsecretを設定

cronワークフロー（`.github/workflows/notify-run.yml`）が`NOTIFY_CRON_SECRET`をヘッダーに載せて送るため、GitHubリポジトリ側にも同じ値を登録する必要があります。

1. GitHubで対象リポジトリを開く → **Settings → Secrets and variables → Actions**
2. 「New repository secret」
3. Name: `NOTIFY_CRON_SECRET`、Secret: 手順4で決めた文字列その1（**Vercel側と完全に同じ値**）
4. 「Add secret」

---

## 完了後の確認

### ステップA. 初回実行テスト（配信対象がない状態）

1. GitHubリポジトリを開く → **Actions** タブ
2. 左メニューから「**配信開始メール通知の実行**」をクリック
3. 右上「**Run workflow**」ボタン → ドロップダウンで「main」を選択 → 「**Run workflow**」
4. 実行ログを確認
   - **期待値**: `status=200` で終了（メールが送信されていない場合も200。条件に合う作品がなかったため）
   - **NG**: `status=401`（`NOTIFY_CRON_SECRET`が未設定またはGitHub Secretsの値が間違っている）

---

### ステップB. テスト用に通知希望を登録

5. http://localhost:3000 にアクセス（または本番のanimedia-khaki.vercel.appにアクセス）
6. **Googleログイン**（画面右上のGoogleアイコン）
7. カレンダー表示で**「今日」配信のある作品**を探す
   - 左上「年」「季節」で現在の時期を選択
   - 「カレンダー」タブで「今日」の曜日をクリック
   - または「一覧」で作品名→右側の配信欄で「本日配信」と書いてある作品を探す
8. その作品カードの**3つ目のアイコン（🔔ベル）をクリック**
   - アイコンが光ると、通知登録完了（ログイン状態で複数作品登録OK）

---

### ステップC. メール受信テスト

9. **同じGitHub Actionsで再度「Run workflow」**を実行
10. 実行ログで`status=200`を確認
11. Resendアカウント登録時のメールアドレス（Gmailなど）の**受信ボックスをチェック**
    - **期待値**: 件名「本日配信のアニメ（アニメ視聴ガイド）」のメールが届く
    - 本文に「《作品名》第N話 本日配信 — 配信先: dアニメ・ABEMA...」という形式で記載
    - 末尾に「配信通知をすべて停止する」リンク
    - **NG**: メールが届かない
      - → Resendダッシュボード → **Logs** → 最新リクエストを確認し、エラーが出ていないか確認
      - → `.env.local`と Vercel の `RESEND_API_KEY` が正しいかコピーし直す
      - → 本番環境（Vercel）で Environment: **Production** に設定したか確認

---

### ステップD. 配信停止リンクの確認

12. メール本文の「**配信通知をすべて停止する**」リンクをクリック
13. ブラウザに遷移し、「**配信通知をすべて停止しました。**」というメッセージが表示されるか確認
14. サイトに戻り、ログアウトしていないなら、同じ作品の🔔アイコンが OFF状態に変わっているか確認
    - （RLSで保護されているため、メールのリンクをクリック→DB削除→🔔が OFF になる流れが動作している証拠）

---

ここまで確認できたら、完了です！「完了した」と教えてください。
