// Google Search Console の検索パフォーマンスを取得し、リポジトリに保存する。
//
// 【なぜ要るか・2026-08-10】
// GSC は画面もAPIもログインが要るため、セッション（Claude）からは実測値を読めない。
// 代わりに GSC の通知メールを読む方法を試したが、全期間で5通しか無く、内訳は
// セットアップ案内2通・インデックス問題の検出2通（**対象URLも件数も書かれていない**）・
// 「クリック数が10に到達」1通（**下限値しか分からない**）だった。表示回数・CTR・
// 平均掲載順位・クエリ別・ページ別は一切届かない＝定点観測（docs/operations.md
// 「実測サマリ」）を埋めるには足りない。
// そこで GitHub Actions（＝外向き通信ができる場所）から Search Console API を日次で叩き、
// 結果をリポジトリに置く。以後セッションは**コミット済みのJSONを読むだけ**でよくなり、
// ログインも外向き通信も要らなくなる。
//
// 【依存パッケージは追加していない】
// googleapis は入れず、サービスアカウントのJWT署名を node:crypto で行い、
// トークン交換とAPI呼び出しは fetch で叩く。
//
// 【必要な環境変数】
//   GSC_SERVICE_ACCOUNT_JSON … サービスアカウントの鍵JSON（全文）。GitHub Secrets に置く。
//   GSC_SITE_URL             … 省略可。GSCのプロパティURL（URLプレフィックス型は末尾スラッシュ必須）
//   GSC_TOKEN_URL / GSC_API_BASE … テスト用の差し替え先（値だけを差し替える。判断の分岐は
//                                  テストと本番で同じ経路を通す＝CLAUDE.mdの基本ルール）
//
// 【失敗の扱い】CLAUDE.md「外部APIに投げる処理は一時的な失敗を前提に書く」に従う:
//   ・429 と 5xx（＝一時的）だけを指数バックオフで再試行する
//   ・401/403/400 など恒久的なエラーは即座に失敗させる（再試行しない）
//   ・各クエリは1件ずつ try/catch で独立させ、1つの失敗で残りを巻き添えにしない
//   ・部分的にでも取れた分はファイルに書いたうえで、終了コードを1にして
//     ワークフロー側から GitHub Issue に出す
//
// 【面（ページ種別）ごとの時系列を足した・2026-08-11】
// 従来は date / query / page を**別々の軸**で取っていたため、
// 「日別の合計」と「ページ別の合計」は分かっても**面ごとの推移**が存在しなかった。
// そのせいで「作品ページはクールの進行とともに落ちるが、声優ページは落ちない」
// （＝作品名＋配信は放送中しか需要が立たないが、声優名は放送に紐付かない）という
// 仮説を、推測でしか語れなかった。
// GSCは16ヶ月ぶんを保持しているので、date×page の交差表を長期間まとめて1回取れば
// **待たずに**答えが出る。生の行をそのままコミットするとファイルが肥大化するため、
// 取得直後に「週 × 面」へ畳んでから書き出す（分類と集計は scripts/lib/gsc-page-type.js）。

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { aggregateWeeklyByType } = require("./lib/gsc-page-type.js");

const SITE_URL = process.env.GSC_SITE_URL || "https://animedia-khaki.vercel.app/";
const TOKEN_URL = process.env.GSC_TOKEN_URL || "https://oauth2.googleapis.com/token";
const API_BASE = process.env.GSC_API_BASE || "https://searchconsole.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

// 出力先。テストはここを差し替えてリポジトリを汚さない（差し替えるのは値だけで、
// 判断の分岐はテストと本番で同じ経路を通す）。
const OUT_DIR = process.env.GSC_OUT_DIR || path.join(__dirname, "..", "content", "analytics", "gsc");

// GSCのデータは確定までに数日かかる。直近3日は歯抜けになるので終端をずらす。
const LAG_DAYS = 3;
const WINDOW_DAYS = 28;

// 面ごとの推移を見るための長期の窓。GSCの保持期間は16ヶ月なので、それより手前を
// 要求しても空が返るだけ（エラーにはならない）。テストからは短くできるようにしておく。
const LONG_WINDOW_DAYS = Number(process.env.GSC_LONG_WINDOW_DAYS ?? 480);

// ページ送りの上限。GSCの1日あたりのエクスポート上限が50,000行なので、そこで止める。
// **打ち切ったときは黙らずログに出す**（「全部取れた」と誤読すると分析が狂うため）。
const MAX_PAGINATED_ROWS = 50000;

// 一時的な失敗の再試行（1s → 2s → 4s → 8s）。
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = Number(process.env.GSC_RETRY_BASE_MS ?? 1000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ISO日付（UTC基準）。GSCの日付はプロパティのタイムゾーンではなくUTC近似で十分。 */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateRange(now = new Date(), windowDays = WINDOW_DAYS) {
  const end = new Date(now.getTime() - LAG_DAYS * 86400000);
  const start = new Date(end.getTime() - (windowDays - 1) * 86400000);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** サービスアカウントの鍵で、トークン交換用のJWTを作る（RS256）。 */
function buildJwt({ client_email, private_key }, nowSec) {
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(private_key);
  return `${signingInput}.${base64url(signature)}`;
}

/** HTTP 429 と 5xx だけを「待てば直るかもしれない」扱いにする。 */
function isTransient(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

class PermanentError extends Error {}

async function requestWithRetry(label, url, init) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      // 接続そのものの失敗はネットワーク都合＝一時的として扱う。
      lastErr = new Error(`${label}: 接続に失敗しました (${e.message})`);
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      continue;
    }
    if (res.ok) return res.json();

    const text = await res.text().catch(() => "");
    const snippet = text.slice(0, 300);
    if (!isTransient(res.status)) {
      // 認証失敗・権限不足・リクエスト不正は、何度投げても同じ。ここで止める。
      throw new PermanentError(`${label}: HTTP ${res.status} ${snippet}`);
    }
    lastErr = new Error(`${label}: HTTP ${res.status} ${snippet}`);
    if (attempt === MAX_ATTEMPTS) break;
    await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
  }
  throw lastErr;
}

async function getAccessToken(credentials) {
  const nowSec = Math.floor(Date.now() / 1000);
  let assertion;
  try {
    assertion = buildJwt(credentials, nowSec);
  } catch (e) {
    // 鍵の形式が壊れている＝直らないので即失敗。
    throw new PermanentError(`JWTの署名に失敗しました（鍵の形式を確認してください）: ${e.message}`);
  }
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const json = await requestWithRetry("アクセストークンの取得", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!json.access_token) throw new PermanentError("アクセストークンが応答に含まれていません");
  return json.access_token;
}

async function searchAnalytics(token, spec, range) {
  const url = `${API_BASE}/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`;
  const all = [];
  let startRow = 0;

  // spec.paginate が false のものは「上位N件だけ欲しい」意図の打ち切りなので1回で終える
  // （queries/pages は上位100件という設計）。paginate:true のものだけページ送りする。
  for (;;) {
    const json = await requestWithRetry(`${spec.label}の取得`, url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: spec.dimensions,
        rowLimit: spec.rowLimit,
        startRow,
      }),
    });
    const rows = (json.rows || []).map((row) => ({
      keys: row.keys,
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    }));
    all.push(...rows);

    if (!spec.paginate) break;
    if (rows.length < spec.rowLimit) break; // 最終ページ
    startRow += rows.length;
    if (startRow >= MAX_PAGINATED_ROWS) {
      // 黙って切らない。切ったことが分からないと「全部取れた」と誤読される。
      console.warn(`${spec.label}: ${MAX_PAGINATED_ROWS}行で打ち切りました（以降は未取得）`);
      break;
    }
  }
  return all;
}

/** 日別の行から期間合計を出す。ctr/positionは表示回数で重み付けする（単純平均だと歪む）。 */
function summarize(daily) {
  const clicks = daily.reduce((a, r) => a + r.clicks, 0);
  const impressions = daily.reduce((a, r) => a + r.impressions, 0);
  const weighted = daily.reduce((a, r) => a + r.position * r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weighted / impressions : 0,
  };
}

// range: "recent" は直近28日（従来どおり）、"long" は面ごとの推移を見るための長期の窓。
// transform を持つものは、取得した生の行をそのまま書かず畳んでから書き出す。
const SPECS = [
  { key: "daily", label: "日別", dimensions: ["date"], rowLimit: 1000, range: "recent" },
  { key: "queries", label: "クエリ別", dimensions: ["query"], rowLimit: 100, range: "recent" },
  { key: "pages", label: "ページ別", dimensions: ["page"], rowLimit: 100, range: "recent" },
  {
    key: "weeklyByType",
    label: "面別（週次・長期）",
    dimensions: ["date", "page"],
    // Search Analytics API の1リクエストあたりの上限。テストからは小さくして
    // ページ送りを実際に働かせる（差し替えるのは**数値だけ**で、分岐は本番と同じ経路）。
    rowLimit: Number(process.env.GSC_PAGE_ROW_LIMIT ?? 25000),
    range: "long",
    paginate: true,
    transform: aggregateWeeklyByType,
  },
];

async function main() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error("GSC_SERVICE_ACCOUNT_JSON が未設定です。docs/gsc-setup.md を参照してください。");
    process.exit(1);
  }
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    console.error("GSC_SERVICE_ACCOUNT_JSON がJSONとして読めません。鍵JSONを丸ごと入れてください。");
    process.exit(1);
  }
  if (!credentials.client_email || !credentials.private_key) {
    console.error("鍵JSONに client_email / private_key がありません。");
    process.exit(1);
  }

  const now = new Date();
  const range = dateRange(now);
  const longRange = dateRange(now, LONG_WINDOW_DAYS);
  const token = await getAccessToken(credentials); // ここで落ちたら以降は無意味なので握らない

  const result = {
    fetchedAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    range,
    longRange,
    totals: null,
    daily: [],
    queries: [],
    pages: [],
    weeklyByType: [],
    errors: [],
  };

  // 種類ごとに1件ずつ独立させる。1つ落ちても残りは取りにいく。
  for (const spec of SPECS) {
    try {
      const rows = await searchAnalytics(token, spec, spec.range === "long" ? longRange : range);
      result[spec.key] = spec.transform ? spec.transform(rows) : rows;
      console.log(
        spec.transform
          ? `${spec.label}: ${rows.length}行 → ${result[spec.key].length}行に集約`
          : `${spec.label}: ${result[spec.key].length}行`
      );
    } catch (e) {
      console.error(`${spec.label}の取得に失敗: ${e.message}`);
      result.errors.push({ key: spec.key, message: e.message });
    }
  }

  if (result.daily.length > 0) result.totals = summarize(result.daily);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${range.endDate}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`書き出し: ${path.relative(path.join(__dirname, ".."), outPath)}`);
  if (result.totals) {
    const t = result.totals;
    console.log(
      `期間 ${range.startDate}〜${range.endDate}: クリック${t.clicks} / 表示${t.impressions} / ` +
        `CTR${(t.ctr * 100).toFixed(2)}% / 平均掲載順位${t.position.toFixed(1)}`
    );
  }

  // 部分的に取れていても、取りこぼしは運用動線（Issue）に出したいので終了コードは1にする。
  //
  // process.exit() ではなく exitCode を立てるだけにする（2026-08-11）。
  // Windowsで標準出力がパイプのとき、書き込みが残ったまま process.exit() すると
  // プロセスが異常終了し、終了コードが 1 ではなく 3221226505（0xC0000409）になる。
  // ここは何行もログを出したあとなので必ず踏む。**この経路はCIに入っていない**
  // （ci.yml が回すのは check.ts と check-threads.js）ため、
  // 「ローカルでは check-gsc.js が常に赤い＝誰も実行しなくなる」形で放置されていた。
  // exitCode ならNodeが出力を吐き切ってから終了するので、値がそのまま伝わる。
  if (result.errors.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof PermanentError ? `恒久的なエラー: ${e.message}` : `失敗: ${e.message}`);
  process.exit(1);
});
