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
// 【重要・2026-07-24修正】1と2の間にはサーバー側の処理待ちが必要。コンテナ作成直後に
// publishすると "Media Not Found"（OAuthException code 24, subcode 4279009）で失敗する
// （2026-07-22の導入初日から毎回これで落ちていた）。公式も「公開前にコンテナのstatusが
// FINISHEDになるまで待つ」ことを推奨しているため、GET /{creation-id}?fields=status,error_message
// をポーリングし、FINISHEDを確認してから公開する。
//
// 【重要・2026-08-05修正】上のポーリングを入れてもなお "Media Not Found" で落ちる日が
// 残っていた（7/29・8/2の2回。直近2週間で約3割の日にThreadsだけ0投稿になっていた）。
// 原因は2つ:
//   (a) status が返らない（undefined）ときに「待たずに公開へ進む」抜け道があった。これは
//       スタブ動作確認用のつもりだったが、本番APIが status を省いて返した場合にも効いて
//       しまい、待ちなしで publish する＝修正前と同じ状態になっていた。
//       → undefined は IN_PROGRESS と同じ「まだ公開できない」として扱い、待ち続ける。
//         スタブとの差はポーリング間隔の長さだけにして、判断の分岐は本番と揃える。
//   (b) status=FINISHED を確認した直後の publish でも Media Not Found が返ることがある
//       （Threads側の伝播待ち）。1回で諦めていたためその日の投稿が丸ごと落ちていた。
//       → publish を指数バックオフで再試行する（一時的なエラーのときだけ）。
// あわせて、投稿は1件ずつ独立させた。1本目が落ちても2本目は投げ、最後にまとめて
// 失敗を報告する（従来は throw で抜けるため、1本目の失敗＝その日は全滅だった）。
//
// 【画像の扱い・2026-07-27修正】ThreadsのIMAGE投稿は公開サーバー上のimage_urlが必須で、
// バイナリの直接アップロードに対応していない（公式: "We will cURL your image using the URL
// provided so it must be on a public server."）。そのため他SNS向けのPlaywright製
// スクリーンショット（post.screenshot＝公開URLを持たないPNGバイナリ）は添付できず、
// 導入時からThreadsだけ画像なしになっていた。
// サイト側に公開画像エンドポイント（app/api/sns-image）を用意し、post.image に入れた
// 公開URLを media_type=IMAGE + image_url で渡す形に変更した。
// post.image が無い投稿は従来どおり media_type=TEXT（本文中の最初のURLが自動で
// リンクプレビューカードになるので導線は保たれる）。
//
// 【ハッシュタグ・2026-07-27修正】Threadsは1投稿につきトピックタグを1つしか受け付けない。
// 2つ目以降の「#タグ」はリンクにならず地の文として残るため、toSingleHashtagText で
// 末尾のタグ行を先頭1つに削ってから投稿する。
//
// レート制限は投稿250件/24h、本文上限は500字（既存のMAX_LEN=260で余裕を持って収まる）。
const { buildPost, toSingleHashtagText } = require("./lib/build-digest");

// THREADS_API_BASE はローカルのスタブサーバーに向けた動作確認用（build-digest.js の
// DIGEST_SITE_URL と同じ思想）。通常運用では未設定のまま本番APIを使う。
const API_BASE = process.env.THREADS_API_BASE || "https://graph.threads.net/v1.0";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// THREADS_API_BASE を差し替えている＝ローカルのスタブ相手の動作確認/自動テスト。
// このときは待ち時間だけ潰す（分岐や判断は本番と同じものを通す。テストで通った経路と
// 本番の経路がズレると、今回のような「テストでは出ない本番だけの穴」が生まれるため）。
const IS_STUB = Boolean(process.env.THREADS_API_BASE);
const wait = (ms) => (IS_STUB ? Promise.resolve() : sleep(ms));

// コンテナ作成後、公開できる状態（status=FINISHED）になるまで待つ。テキスト投稿は
// 通常数秒で FINISHED になるが、初回は遅れることがあるため余裕を持ってポーリングする
// （最大 POLL_TRIES 回 × POLL_INTERVAL_MS）。ERROR/EXPIRED なら即中断。
// status が返らない（undefined）ときは「まだ分からない」であって「公開してよい」では
// ないので、IN_PROGRESS と同じく待ち続ける（2026-08-05修正。ここを素通りさせていたのが
// Media Not Found の原因のひとつだった）。
// タイムアウトしても投げない。publish側に再試行があるので、そこで一度試させてから
// 判断する（待ちきれなかっただけで実際は公開できることがある）。
const POLL_TRIES = 12;
const POLL_INTERVAL_MS = 3000;
async function waitUntilPublishable(creationId, accessToken) {
  for (let i = 0; i < POLL_TRIES; i++) {
    const res = await fetch(
      `${API_BASE}/${creationId}?fields=status,error_message&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) {
      throw new Error(`Threadsコンテナの状態取得に失敗しました（${res.status}）: ${await res.text()}`);
    }
    const { status, error_message: errorMessage } = await res.json();
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`Threadsコンテナが公開不可の状態です（${status}）: ${errorMessage || "詳細なし"}`);
    }
    // IN_PROGRESS / status未返却 → 待って再確認
    await wait(POLL_INTERVAL_MS);
  }
  console.warn(
    `Threadsコンテナが${(POLL_TRIES * POLL_INTERVAL_MS) / 1000}秒以内にFINISHEDになりませんでした。` +
      "このまま公開を試みます（失敗すれば再試行します）。"
  );
}

// 公開（threads_publish）。status=FINISHED を確認した直後でも Threads 側の伝播待ちで
// "Media Not Found" が返ることがあるため、一時的なエラーに限って再試行する。
// 恒久的なエラー（トークン失効・本文不正など）は再試行しても同じなので即座に投げる。
const PUBLISH_TRIES = 5;
const PUBLISH_BACKOFF_MS = [5000, 10000, 20000, 30000];
// Media Not Found（コンテナがまだ見えていないだけ。時間を置けば解決する）
const TRANSIENT_SUBCODES = new Set([4279009]);

function isTransientPublishError(httpStatus, body) {
  if (httpStatus === 429 || httpStatus >= 500) return true;
  try {
    return TRANSIENT_SUBCODES.has(JSON.parse(body)?.error?.error_subcode);
  } catch {
    return false;
  }
}

async function publish(userId, creationId, accessToken) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API_BASE}/${userId}/threads_publish`, {
      method: "POST",
      body: new URLSearchParams({ creation_id: creationId, access_token: accessToken }),
    });
    if (res.ok) return (await res.json()).id;

    const body = await res.text();
    if (attempt >= PUBLISH_TRIES || !isTransientPublishError(res.status, body)) {
      throw new Error(`Threads投稿に失敗しました（${res.status}）: ${body}`);
    }
    const backoffMs = PUBLISH_BACKOFF_MS[Math.min(attempt - 1, PUBLISH_BACKOFF_MS.length - 1)];
    console.warn(
      `Threadsの公開が一時的に失敗しました（${res.status}）。${backoffMs / 1000}秒後に再試行します` +
        `（${attempt}/${PUBLISH_TRIES - 1}回目）: ${body}`
    );
    await wait(backoffMs);
  }
}

// コンテナ（下書き）を1つ作る。成功でcreation_id、失敗でnullを返す（呼び出し側が
// 画像あり→なしへフォールバックできるよう、ここでは投げずにnullで返す）。
async function createContainer(userId, accessToken, fields) {
  const res = await fetch(`${API_BASE}/${userId}/threads`, {
    method: "POST",
    body: new URLSearchParams({ ...fields, access_token: accessToken }),
  });
  if (!res.ok) {
    console.warn(`Threadsコンテナの作成に失敗（${res.status}）: ${await res.text()}`);
    return null;
  }
  const { id } = await res.json();
  return id ?? null;
}

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

  // 投稿は1件ずつ独立させる。1本目が落ちても2本目は投げ、最後にまとめて報告する
  // （2026-08-05修正。従来は1本目の失敗でその日のThreads投稿が全滅していた）。
  const failures = [];

  for (const post of posts) {
    try {
      await postOne(userId, accessToken, post);
    } catch (err) {
      failures.push(err);
      console.error(`Threadsの1件が投稿できませんでした（残りは続行します）: ${err.message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Threads投稿に失敗しました（${posts.length}件中${failures.length}件）。詳細は上のログを参照。`);
  }
}

async function postOne(userId, accessToken, post) {
  const text = toSingleHashtagText(post.text);

  // 1. コンテナ作成（この時点ではまだ公開されない）
  // 画像付きを試し、失敗したらテキストのみで作り直す。image_url はThreads側が
  // cURLで取りに来る外部依存なので、画像生成の一時的な失敗やデプロイ直後の
  // コールドスタートで取得できないことがある。そこで毎日の投稿そのものを
  // 落とすのは割に合わない（画像は「あると良い」もので、本文とリンクが本体）。
  let creationId = null;
  if (post.image) {
    creationId = await createContainer(userId, accessToken, { media_type: "IMAGE", text, image_url: post.image });
    if (!creationId) {
      console.warn(`画像付きコンテナの作成に失敗したため、テキストのみで投稿します: ${post.image}`);
    }
  }
  if (!creationId) {
    creationId = await createContainer(userId, accessToken, { media_type: "TEXT", text });
    if (!creationId) {
      throw new Error("Threads投稿に失敗しました（テキストのみのコンテナも作成できませんでした）");
    }
  }

  // 1.5. コンテナがサーバー側で処理され公開可能（FINISHED）になるまで待つ。
  // これを飛ばすと直後の公開が "Media Not Found" で失敗する（2026-07-24修正の要点）。
  await waitUntilPublishable(creationId, accessToken);

  // 2. 公開（一時的な Media Not Found はバックオフして再試行する）
  const id = await publish(userId, creationId, accessToken);
  console.log("Threadsに投稿しました:", id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
