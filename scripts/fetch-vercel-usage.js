// Vercelの利用量（請求明細）を日次で取得し、リポジトリに保存する。
//
// 【なぜ要るか・2026-09-15】
// 無料枠に収まっているかの唯一の一次情報は Vercel のダッシュボードだが、
// **ログインが要るためセッション（Claude）からは読めない**。そのため
// 「9/14の改修で本当に減ったのか」の答え合わせが、毎回ユーザーが画面の数字を
// 手で写すまで止まる。しかも写すのは目視なので、実際に2〜4倍読み違えた記録がある
// （docs/operations.md の㉝・㊶）。
// GSC（fetch-gsc.js）・行動ログ（fetch-site-analytics.js）とまったく同じ形にする:
//   外向き通信ができる GitHub Actions から取り、リポジトリにJSONを置く。
//   以後セッションは**コミット済みのJSONを読むだけ**でよい（scripts/usage-report.js）。
//
// 【何を叩くか】
// `vercel usage --breakdown daily --json` と同じデータ。CLIの実装を読むと、中では
//   GET https://api.vercel.com/v1/billing/charges?from=<ISO>&to=<ISO>[&teamId=]
// をJSON Lines（1行1レコード）で受け取っているだけなので、CLIを入れずに直接取る。
//   ・CIに296パッケージ（npx vercel）を入れない＝実行が速く、供給網の面も小さい
//   ・**トークンを argv に載せない**（`--token` はプロセス一覧に出る）。ヘッダーで送る
// 畳み方は scripts/lib/vercel-usage.js が持ち、**CLIの --json と同じ形**で書き出す
// （人が手元でCLIを叩けば同じ形が出る＝突き合わせができる）。
//
// 【必要な環境変数】
//   VERCEL_TOKEN          … https://vercel.com/account/tokens で作る。GitHub Secrets に置く。
//   VERCEL_TEAM_ID        … 省略可。個人アカウント（Hobby）なら不要。
//   VERCEL_USAGE_BASE     … 省略可。取得先（テスト用の差し替え先）
//   VERCEL_USAGE_OUT_DIR  … 省略可。出力先（テストがリポジトリを汚さないため）
//   VERCEL_USAGE_DAYS     … 省略可。何日ぶん遡るか（既定35＝ローリング30日+余裕）
//
// 【失敗の扱い】CLAUDE.md「外部APIに投げる処理は一時的な失敗を前提に書く」に従う:
//   ・429 と 5xx（＝一時的）だけを指数バックオフで再試行する
//   ・401/403（トークン不正・権限不足）は即座に失敗させる（再試行しない）
//
// 【書き出すJSONに秘密を混ぜない】
// ここはリポジトリにコミットされる＝公開されるファイルなので、混入すると即漏洩になる。
// `assertNoSecrets` が書き出す直前に本文を検査し、混じっていたら**書かずに落とす**。

const fs = require("node:fs");
const path = require("node:path");
const {
  laMidnightUtcIso,
  jstToday,
  shiftDate,
  parseJsonLines,
  aggregateCharges,
} = require("./lib/vercel-usage.js");

const BASE = process.env.VERCEL_USAGE_BASE || "https://api.vercel.com";
const OUT_DIR =
  process.env.VERCEL_USAGE_OUT_DIR || path.join(__dirname, "..", "content", "analytics", "usage");
const DAYS = Number(process.env.VERCEL_USAGE_DAYS ?? 35);

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = Number(process.env.VERCEL_USAGE_RETRY_BASE_MS ?? 1000);

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
      // トークンはクエリでもコマンドライン引数でもなく**ヘッダー**で送る
      // （URLはログ・リファラに残り、argv はプロセス一覧に出る）。
      res = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
    } catch (e) {
      lastErr = new Error(`接続に失敗しました (${e.message})`);
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      continue;
    }
    const text = await res.text().catch(() => "");
    if (res.ok) return text;

    const snippet = text.slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      // 何度投げても直らない。トークンが違うか、そのアカウントでは請求明細を読めない。
      throw new PermanentError(
        `HTTP ${res.status}: トークンが不正か、このアカウントでは請求明細を読めません。` +
          `docs/vercel-usage-setup.md の「うまくいかないとき」を確認してください / ${snippet}`
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

async function main() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    // 未登録の間は「静かにスキップ」する（GSC・行動ログと同じ設計思想）。
    // ここで失敗させると、セットアップが済むまで毎日Issueが積み上がる。
    console.log("VERCEL_TOKEN が未設定のためスキップします（docs/vercel-usage-setup.md）。");
    return;
  }

  const today = jstToday();
  const fromDay = shiftDate(today, -DAYS);
  // 請求期間はロサンゼルス時間で区切られる（CLIの --from/--to と同じ解釈）。
  // `to` はその日の終わり＝翌日の0時。
  const from = laMidnightUtcIso(fromDay);
  const to = laMidnightUtcIso(today, { plusDays: 1 });

  const query = new URLSearchParams({ from, to });
  if (process.env.VERCEL_TEAM_ID) query.set("teamId", process.env.VERCEL_TEAM_ID);
  const url = `${BASE.replace(/\/$/, "")}/v1/billing/charges?${query}`;

  const text = await requestWithRetry(url, token);

  let charges;
  try {
    charges = parseJsonLines(text);
  } catch (e) {
    throw new PermanentError(`応答を明細として読めませんでした: ${e.message}`);
  }
  // エラーがJSONオブジェクトで返ることがある（1行だけの {"error":{...}}）。
  // これを明細0件として扱うと「利用ゼロ」に見えてしまうので区別する。
  if (charges.length === 1 && charges[0] && charges[0].error) {
    throw new PermanentError(`APIがエラーを返しました: ${JSON.stringify(charges[0].error).slice(0, 300)}`);
  }

  const snapshot = aggregateCharges(charges, { from, to });
  const result = {
    fetchedAt: new Date().toISOString(),
    source: `${BASE.replace(/\/$/, "")}/v1/billing/charges`,
    requestedDays: DAYS,
    ...snapshot,
  };

  const serialized = JSON.stringify(result, null, 2) + "\n";
  assertNoSecrets(serialized, [token, process.env.VERCEL_TEAM_ID]);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${today}.json`);
  fs.writeFileSync(outPath, serialized, "utf8");
  console.log(`書き出し: ${outPath}（${fromDay}〜${today}）`);

  if (result.chargeCount === 0) {
    // **「利用がゼロ」ではなく「取れていない」**。Hobbyプランで請求明細が
    // 返るかはこの環境から確かめられなかったので、0件を黙って通すと
    // 「ずっと無料枠内」という誤った結論を毎日書き続けることになる。
    console.log(
      "⚠ 明細が0件でした。利用がゼロなのではなく、このアカウントでは請求明細が" +
        "返っていない可能性があります（docs/vercel-usage-setup.md の「うまくいかないとき」）。"
    );
    return;
  }
  console.log(`明細 ${result.chargeCount} 件 / ${result.breakdown.data.length} 日分`);
  for (const svc of result.services.slice(0, 5)) {
    console.log(`  ${svc.name}: ${svc.pricingQuantity} ${svc.pricingUnit}`);
  }
}

main().catch((e) => {
  console.error(e instanceof PermanentError ? `恒久的なエラー: ${e.message}` : `失敗: ${e.message}`);
  process.exit(1);
});
