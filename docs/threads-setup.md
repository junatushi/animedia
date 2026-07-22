# Threads自動投稿 セットアップ手順

`.github/workflows/daily-digest.yml`・`season-announce.yml`からのThreads自動投稿
（`scripts/post-threads.js`）を有効化するための一度きりの設定手順。

**概要**: 投稿API自体は無料（レート制限は投稿250件/24h）。有効化にはMeta側で
Threadsアプリの準備・認可が必要で、**所要15〜20分の一度きりの作業**。以降の投稿は
毎日/告知のワークフローが自動で行い、長期アクセストークン（60日有効）も
`docs/operations.md`の⑦-3（`threads-refresh-token.yml`）が週次で自動延長するため、
通常運用では手を動かす必要はない。

以下の手順のうち、Meta側の管理画面操作（アプリ作成・Threadsユースケース追加・
認可フロー）は変更が入りやすく、このリポジトリ側で一次確認できていないため、
**公式ドキュメントへのリンクで誘導する**（画面の細部を断定して書かない）。

---

## 1. Metaアプリの作成とThreadsユースケース追加

1. https://developers.facebook.com/ でMetaデベロッパーアカウントを用意し、アプリを作成する。
2. アプリに「Threads」のユースケースを追加する。
3. 自分自身のアカウントに投稿するだけであれば**アプリ審査は不要**（Threads Testerとして
   自分を招待し、Threadsアプリ側の設定から招待を承認するだけでよい）。

具体的な画面操作は変更されうるため、必ず公式の開始ガイドに従うこと:
- 開始ガイド: https://developers.facebook.com/docs/threads/get-started/
- Threadsユースケース: https://developers.facebook.com/docs/development/create-an-app/threads-use-case/

---

## 2. 必要な権限

トークンの認可時に以下2つの権限（scope）を要求する:
- `threads_basic`（ユーザーID取得・基本情報）
- `threads_content_publish`（投稿の作成・公開）

---

## 3. 認可 → 短期トークン → 長期トークンの交換

認可フローの具体的な手順（リダイレクトURL設定・認可コードの取得画面など）は
公式ドキュメントに従う:
- トークン取得（アクセストークンと権限）: https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions/
- 短期トークンを長期トークン（60日有効）に交換する手順: https://developers.facebook.com/docs/threads/get-started/long-lived-tokens

最終的に手元に残るのは**長期アクセストークン（60日有効な文字列）**。これが
`THREADS_ACCESS_TOKEN`になる。ユーザーIDは`post-threads.js`が実行のたびに
`GET /me?fields=id`で取得するため、別途控えておく必要はない。

---

## 4. GitHub Secretsへの登録（THREADS_ACCESS_TOKEN）

1. GitHubで対象リポジトリを開く → **Settings → Secrets and variables → Actions**
2. 「New repository secret」
3. Name: `THREADS_ACCESS_TOKEN`、Secret: 手順3で取得した長期アクセストークン
4. 「Add secret」

これだけで`daily-digest.yml`・`season-announce.yml`のThreadsステップが有効になる
（未登録の間は「Threads未設定のためスキップします」とログを出すだけで、
ワークフロー自体は失敗しない）。

---

## 5. 自動延長用PAT（GH_SECRETS_PAT）の登録

60日ごとの手動更新を避けるため、`threads-refresh-token.yml`が毎週トークンを
リフレッシュしてSecretsへ書き戻す仕組みがある（`docs/operations.md`の⑦-3）。
これを動かすには、GitHub Secretsを書き換えられるPATが別途必要。

1. GitHubの https://github.com/settings/personal-access-tokens → 「Generate new token」
   （fine-grained personal access token）
2. **Repository access**: 対象リポジトリ（このリポジトリ）のみを選択
3. **Permissions → Repository permissions → Secrets**: `Read and write`
4. 生成されたトークンを、手順4と同じ画面で `GH_SECRETS_PAT` という名前のSecretとして登録する

**PAT自体にも有効期限がある**（fine-grained PATの仕様）。期限が切れるとSecretの
書き戻し（`gh secret set`）が認証エラーになり`threads-refresh-token.yml`が失敗して
GitHubから通知が届くので、届いたらPATを作り直して`GH_SECRETS_PAT`を更新する。

`GH_SECRETS_PAT`を登録しない場合でも投稿自体（手順4）は動く。その場合は
60日ごとに手動でこのページの手順3〜4をやり直すことになる。

---

## 6. 動作確認

1. GitHubリポジトリを開く → **Actions** タブ
2. 左メニューから「**毎日ダイジェスト**」を選択 → 右上「Run workflow」で手動実行
3. 実行ログの「Threadsへ自動投稿」ステップを確認
   - 期待値: `Threadsに投稿しました: <id>` が出て、実際にThreadsアカウントに投稿される
   - `THREADS_ACCESS_TOKEN`未登録時は `Threads未設定のためスキップします` のログのみで
     ステップ自体は成功扱い

---

## 7. トラブル時

- **投稿ステップが失敗する（`Threads投稿に失敗しました（401等）`）**: 長期アクセストークンが
  期限切れ（60日）になっている可能性が高い。手順3から再認可し、`THREADS_ACCESS_TOKEN`を
  新しい値で登録し直す。
- **`threads-refresh-token.yml`が失敗する**: 同じく60日の期限切れ、または`GH_SECRETS_PAT`の
  期限切れ・権限不足が原因のことが多い。手順3（トークン再認可）または手順5（PAT作り直し）を
  やり直す。ワークフロー失敗時はGitHubから通知が届くため、それが「対応が必要」のサインになる。
