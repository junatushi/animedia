// サイト自身の行動ログ集計（/api/admin/analytics）を取得し、リポジトリに保存する。
//
// 【なぜ要るか・2026-08-19】
// 自前計測（Supabase の analytics_events）は `/admin/analytics?token=...` の画面に
// しか出ておらず、**ブラウザで開く以外に読む方法が無かった**。そのためセッション
// （Claude）は実測値を一度も読めておらず、docs/affiliate-setup.md の
// 「順番を決め直すときの一次情報」＝「未提携サービスへのクリックが多い順に提携する」
// という判断が、ユーザーが手で数字を写すまで止まったままだった。
// GSC（scripts/fetch-gsc.js）とまったく同じ解き方をする:
//   外向き通信ができる GitHub Actions から取り、リポジトリにJSONを置く。
//   以後セッションは**コミット済みのJSONを読むだけ**でよくなる。
//
// 【必要な環境変数】
//   ADMIN_DASHBOARD_TOKEN … `/admin/analytics` と同じトークン。GitHub Secrets に置く。
//   SITE_ANALYTICS_BASE   … 省略可。取得先のオリジン（テスト用の差し替え先）
//   SITE_ANALYTICS_OUT_DIR … 省略可。出力先（テストがリポジトリを汚さないため）
//
// 【失敗の扱い】CLAUDE.md「外部APIに投げる処理は一時的な失敗を前提に書く」に従う:
//   ・429 と 5xx（＝一時的）だけを指数バックオフで再試行する
//   ・404（トークン不一致）など恒久的なエラーは即座に失敗させる（再試行しない）
//   ・失敗はログだけで終わらせずワークフローから GitHub Issue に出す
//
// 【書き出すJSONに秘密を混ぜない】
// GSC取得（scripts/check-gsc.js）と同じ理由で、**トークンは絶対に出力へ入れない**。
// ここはリポジトリにコミットされる＝公開されるファイルなので、混入すると即漏洩になる。
// `assertNoSecrets` が書き出す直前に本文を検査し、混じっていたら書かずに落とす。

const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.SITE_ANALYTICS_BASE || "https://animedia-khaki.vercel.app";
const OUT_DIR =
  process.env.SITE_ANALYTICS_OUT_DIR || path.join(__dirname, "..", "content", "analytics", "site");

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = Number(process.env.SITE_ANALYTICS_RETRY_BASE_MS ?? 1000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class PermanentError extends Error {}

/** HTTP 429 と 5xx だけを「待てば直るかもしれない」扱いにする。 */
function isTransient(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function requestWithRetry(url, token) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      // トークンはクエリではなくヘッダーで送る（URLはログ・リファラに残りうるため）。
      res = await fetch(url, { headers: { "x-admin-token": token } });
    } catch (e) {
      lastErr = new Error(`接続に失敗しました (${e.message})`);
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      continue;
    }
    if (res.ok) return res.json();

    const text = await res.text().catch(() => "");
    const snippet = text.slice(0, 300);
    if (res.status === 404) {
      // 画面と同じく「不一致は404」。何度投げても同じなので即止める。
      throw new PermanentError(
        `HTTP 404: トークンが一致しないか、エンドポイントがまだデプロイされていません`
      );
    }
    if (!isTransient(res.status)) {
      throw new PermanentError(`HTTP ${res.status} ${snippet}`);
    }
    lastErr = new Error(`HTTP ${res.status} ${snippet}`);
    if (attempt === MAX_ATTEMPTS) break;
    await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
  }
  throw lastErr;
}

/**
 * 書き出す直前に、秘密が本文へ混ざっていないかを確かめる。
 * コミットされるファイルなので、混じっていたら**書かずに落とす**（消すより出さない）。
 */
function assertNoSecrets(serialized, secrets) {
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    if (serialized.includes(secret)) {
      throw new PermanentError("書き出す内容に秘密（トークン）が含まれています。中止しました。");
    }
  }
}

/** JST基準の日付。ファイル名に使う（GSCと違いこちらは即時のデータなので当日で良い）。 */
function jstDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

async function main() {
  const token = process.env.ADMIN_DASHBOARD_TOKEN;
  if (!token) {
    // 未設定の間は「静かにスキップ」する（GSCの鍵未登録時と同じ設計思想）。
    // ここで失敗させると、セットアップが済むまで毎日Issueが積み上がる。
    console.log("ADMIN_DASHBOARD_TOKEN が未設定のためスキップします（docs/operations.md「計測の見かた」）。");
    return;
  }

  const url = `${BASE.replace(/\/$/, "")}/api/admin/analytics`;
  const json = await requestWithRetry(url, token);

  if (json.configured === false) {
    // サイト側がまだ未設定（Supabaseのテーブルが無い等）。これは失敗ではないので
    // ファイルを作らずに正常終了する（空のJSONを毎日コミットしても意味が無い）。
    console.log(`サイト側が未設定のためスキップします: ${json.reason ?? "(理由なし)"}`);
    return;
  }

  const result = {
    fetchedAt: new Date().toISOString(),
    source: url,
    ...json,
  };

  const serialized = JSON.stringify(result, null, 2) + "\n";
  assertNoSecrets(serialized, [token]);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${jstDate()}.json`);
  fs.writeFileSync(outPath, serialized, "utf8");
  console.log(`書き出し: ${outPath}`);

  if (result.truncated) {
    // 打ち切りを黙らない（「全部取れた」と誤読すると合計を過小に読む）。
    console.log(`⚠ ${result.rowCount}行で打ち切られています（上限に到達）。合計は過小です。`);
  }
  const top = (result.officialClicks ?? [])[0];
  if (top) {
    console.log(`未提携サービスへのクリック 1位: ${top[0]}（${top[1]}回）`);
  }
}

main().catch((e) => {
  console.error(e instanceof PermanentError ? `恒久的なエラー: ${e.message}` : `失敗: ${e.message}`);
  process.exit(1);
});
