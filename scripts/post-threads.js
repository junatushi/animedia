// Threads（無料・投稿APIに料金はかからない）へ自動投稿する。
// 投稿内容は POST_KIND（digest=日次 / season=新シーズン告知）で切り替わる
// （buildPost経由。post-mastodon.js/post-bluesky.jsと共通ロジック）。
// Secrets未設定の間は「まだ設定されていない」ログを出してスキップする（失敗扱いにしない）。
//
// 必要SecretはTHREADS_ACCESS_TOKEN（長期アクセストークン）のみ。ユーザーIDはSecretに
// 持たせず、実行のたびに GET /me?fields=id で取得する（保存する秘密情報を1つに絞り、
// トークンさえ無効化すれば止められるようにするため。ユーザーID自体は非公開情報ではない）。
//
// 投稿は2ステップ（Threads公式仕様。参考: 投稿リファレンス
// https://developers.facebook.com/docs/threads/reference/publishing/）:
//   1. POST /{user-id}/threads … media_type=TEXT + text でコンテナ（下書き）を作成 → creation_id
//   2. POST /{user-id}/threads_publish … creation_id を渡して公開
// POSTのパラメータはURLSearchParamsのボディで送る（トークンをURLに載せるのはGETの
// ユーザーID取得だけにとどめる）。
//
// 画像添付はしない: ThreadsのIMAGE投稿は公開URLのimage_urlが必須で、バイナリの直接
// アップロードに対応していない。本スクリプトのスクリーンショット（Playwrightで撮る
// PNGバイナリ）は公開URLを持たないため添付できない。ただし本文中の最初のURL
// （ダイジェストのサイトURL）はmedia_type=TEXTでも自動でリンクプレビューカードになる
// （link_attachment未指定時の公式仕様）ため、画像なしでも導線は保たれる。
// post.screenshot は他SNS向けの指定なのでここでは無視する。
//
// レート制限は投稿250件/24h、本文上限は500字（既存のMAX_LEN=260で余裕を持って収まる）。
const { buildPost } = require("./lib/build-digest");

// THREADS_API_BASE はローカルのスタブサーバーに向けた動作確認用（build-digest.js の
// DIGEST_SITE_URL と同じ思想）。通常運用では未設定のまま本番APIを使う。
const API_BASE = process.env.THREADS_API_BASE || "https://graph.threads.net/v1.0";

async function main() {
  const accessToken = process.env.THREADS_ACCESS_TOKEN;

  if (!accessToken) {
    console.log("Threads未設定のためスキップします（THREADS_ACCESS_TOKEN が未登録）。");
    return;
  }

  const meRes = await fetch(`${API_BASE}/me?fields=id&access_token=${encodeURIComponent(accessToken)}`);
  if (!meRes.ok) {
    throw new Error(`ThreadsユーザーID取得に失敗しました（${meRes.status}）: ${await meRes.text()}`);
  }
  const { id: userId } = await meRes.json();

  const { posts } = await buildPost();

  for (const post of posts) {
    // 1. コンテナ作成（この時点ではまだ公開されない）
    const createRes = await fetch(`${API_BASE}/${userId}/threads`, {
      method: "POST",
      body: new URLSearchParams({
        media_type: "TEXT",
        text: post.text,
        access_token: accessToken,
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Threads投稿に失敗しました（${createRes.status}）: ${await createRes.text()}`);
    }
    const { id: creationId } = await createRes.json();

    // 2. 公開
    const publishRes = await fetch(`${API_BASE}/${userId}/threads_publish`, {
      method: "POST",
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: accessToken,
      }),
    });
    if (!publishRes.ok) {
      throw new Error(`Threads投稿に失敗しました（${publishRes.status}）: ${await publishRes.text()}`);
    }
    const json = await publishRes.json();
    console.log("Threadsに投稿しました:", json.id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
