# Supabase + Googleログイン セットアップ手順

「視聴済み」機能（ログイン機能）を動かすための、Supabase側・Google Cloud側の設定手順。
**この手順はコードを書く必要はなく、すべてブラウザ上の管理画面操作**。実装計画の全体は
`.claude/plans/bubbly-chasing-rose.md` を参照。

コールバックURLを Supabase → Google → Supabase の順に受け渡すため、**必ず番号順に進める**こと。

---

## 1. Supabaseプロジェクトを作成

1. https://supabase.com にアクセスし、アカウント作成（GitHub/Googleアカウントでのサインアップが簡単）
2. ダッシュボードで「New Project」
3. 入力項目:
   - **Name**: 任意（例: `anime-haishin`）
   - **Database Password**: 強力なパスワードを生成し、**必ず控えておく**（後で使うことは少ないが、紛失すると再発行が必要）
   - **Region**: **Northeast Asia (Tokyo)** を選択（推奨。海外リージョンだとプライバシーポリシー上「データは海外で処理される」旨の開示が必要になるため、東京を選べば国内処理にできる）
4. 「Create new project」→ プロビジョニング完了まで1〜2分待つ

---

## 2. Supabase側でGoogleログインを有効化（コールバックURLを取得）

1. 左メニュー **Authentication** → **Providers** → **Google** を開く
2. まだ有効化しない。この画面に表示される **Callback URL (for OAuth)** をコピーしておく
   （形式: `https://<プロジェクトref>.supabase.co/auth/v1/callback`）
   → このURLを次の手順3でGoogle Cloud側に登録する

---

## 3. Google Cloud ConsoleでOAuthクライアントを作成

1. https://console.cloud.google.com にアクセス（Googleアカウントでログイン）
2. 画面上部でプロジェクトを新規作成（または既存のものを選択）
3. **APIとサービス → OAuth同意画面** を開く
   - User Type: **External** を選択
   - アプリ名・ユーザーサポートメール・デベロッパーの連絡先メールを入力
   - スコープ: 追加不要（デフォルトの email / profile / openid のみで足りる）
   - テストユーザー: 一旦スキップしてよい（後述の「公開」で誰でもログイン可能にする）
4. **APIとサービス → 認証情報 → 認証情報を作成 → OAuthクライアントID** を開く
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 名前: 任意
   - **承認済みのリダイレクトURI**: 手順2でコピーした Supabase の Callback URL を貼り付け
   - 「作成」
5. 表示された **クライアントID** と **クライアントシークレット** を控えておく
6. OAuth同意画面に戻り、**「アプリを公開」**をクリックする（Testing状態のままだと、事前登録したテストユーザー以外はログインできない。email/profileのみの非機密スコープなのでGoogleの追加審査は通常不要）

---

## 4. SupabaseにGoogleの認証情報を登録

1. 手順2の **Authentication → Providers → Google** に戻る
2. トグルを **有効化**
3. 手順3で控えた **クライアントID** と **クライアントシークレット** を貼り付けて保存

---

## 5. リダイレクトURLの許可リストを設定

1. **Authentication → URL Configuration** を開く
2. **Site URL**: 本番ドメイン（例: `https://animedia-khaki.vercel.app`）を設定
3. **Redirect URLs** に以下の2つを追加:
   - `http://localhost:3000/auth/callback`（開発用）
   - `https://animedia-khaki.vercel.app/auth/callback`（本番用。実際のドメインに置き換え）

---

## 6. テーブルを作成

1. 左メニュー **SQL Editor** を開く
2. 「New query」で以下を貼り付けて実行（Runボタン）

```sql
create table if not exists public.watched (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id integer not null,
  watched_at timestamptz not null default now(),
  primary key (user_id, work_id)
);

alter table public.watched enable row level security;

create policy "watched_select_own" on public.watched for select using (auth.uid() = user_id);
create policy "watched_insert_own" on public.watched for insert with check (auth.uid() = user_id);
create policy "watched_delete_own" on public.watched for delete using (auth.uid() = user_id);
```

3. 「Success」と出れば完了。**Table Editor**で`watched`テーブルが見えるはず

---

## 7. APIキーを取得

※ Supabaseのダッシュボード改訂により、「Project Settings → API」ではなく
**「Settings → API Keys」**に変わっています（2026-07時点で確認）。また、従来の
`anon` キーは2026年末で廃止予定のため、新しい **publishable key** を使います。

1. プロジェクト画面上部の **Connect** ボタンを開き、**Project URL**（例: `https://xxxxxxxx.supabase.co`）をコピー
2. 左メニュー **Settings → API Keys** を開く
3. **Publishable and secret API keys** タブを選ぶ（まだ無ければ「Create new API Keys」）
4. **Publishable key**（`sb_publishable_...`）をコピー
   （**Secret key（`sb_secret_...`）は絶対に使わない・コピーしない**。今回必要なのはPublishable keyのみ）
   ※「Legacy API Keys」タブに旧来の`anon`/`service_role`キーが残っている場合がありますが、
   期限が近いためそちらは使わず、Publishable keyの方を使ってください

---

## 8. 環境変数を設定（ローカル）

プロジェクト直下の `.env.local` に、既存の `ANNICT_TOKEN` の行に加えて以下2行を追記する（このファイル自体は編集せずお願いします。私からは読み書きしない方針のため）:

```
NEXT_PUBLIC_SUPABASE_URL=手順7でコピーしたProject URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=手順7でコピーしたPublishable key（sb_publishable_から始まる文字列）
```

（変数名は`ANON_KEY`のままですが、値は新しいPublishable keyを入れて問題ありません。
Supabaseの認証SDK側は同じ用途のキーとして扱います。）

保存後、`npm run dev` を再起動すれば反映される。

---

## 9. 環境変数を設定（本番・Vercel）

1. https://vercel.com/dashboard にアクセス（このサイトのデプロイに使っているVercelアカウントでログイン）
2. 画面上部にチーム切り替えがあれば、対象のチーム/個人アカウントを選択
3. プロジェクト一覧から `anime-haishin`（本サイトのプロジェクト）をクリック
4. 上部タブの **Settings** → 左メニューの **Environment Variables** を開く
5. 手順8と同じ2つの変数名・値を追加（Environment: Production。Previewでも使うならそちらにもチェック）
   - Key: `NEXT_PUBLIC_SUPABASE_URL` / Value: 手順7のProject URL
   - Key: `NEXT_PUBLIC_SUPABASE_ANON_KEY` / Value: 手順7のPublishable key
6. 「Save」
7. 保存しただけでは既存のデプロイには反映されない（`NEXT_PUBLIC_*` はビルド時に埋め込まれるため）。
   上部タブの **Deployments** → 最新デプロイの「…」メニュー → **Redeploy** で再デプロイする

---

## 完了後の確認

1. `npm run dev` でローカル起動 → ヘッダーに「Googleでログイン」ボタンが表示されることを確認
2. クリックしてGoogleログイン→トップページに戻ることを確認
3. 任意の作品カードの目玉アイコンをクリック→枠が光る（視聴済み状態）ことを確認
4. ページをリロードしても状態が保持されることを確認
5. Supabaseダッシュボードの **Table Editor → watched** に、`user_id`・`work_id`の行が実際に追加されていることを確認
6. ログアウト→ヘッダーが「Googleでログイン」表示に戻り、目玉アイコンをクリックしても記録されない（未ログイン扱い）ことを確認

ここまで確認できたら教えてください。一緒に最終チェックします。
