// scripts/fetch-site-analytics.js（サイト自身の行動ログ集計の日次取得）の回帰テスト。
//
// scripts/check-gsc.js と同じ流儀: node:http でスタブサーバーを立て、
// fetch-site-analytics.js を **子プロセスで実際に実行**して外形挙動を固定する。
// ネットワークには一切出ない（127.0.0.1 のスタブのみ）。依存パッケージも追加しない。
//
// ここで固定していること:
//   1. 正常系: 集計がそのままJSONに落ち、トークンは**ヘッダーで**送られる
//      （URLに秘密を載せない。クエリに載せるとログ・リファラに残る）
//   2. 429 は指数バックオフで再試行して成功する（一時的なエラーで丸ごと落ちない）
//   3. 5xx も同様に再試行する
//   4. 404（トークン不一致）は**再試行せず即座に失敗**する（何度投げても直らない）
//   5. トークン未設定なら**静かにスキップ**する（成功扱い・ファイルを作らない）。
//      ここで失敗させると、セットアップが済むまで毎日Issueが積み上がる
//   6. サイト側が未設定（configured:false）ならファイルを作らずに正常終了する
//      （空のJSONを毎日コミットしても意味が無い）
//   7. **書き出したJSONにトークンが混入しない**。このファイルはリポジトリに
//      コミットされる＝公開されるので、混入は即漏洩になる
//   8. 打ち切り（truncated）を黙らない。「全部取れた」と誤読すると合計を過小に読む
//
// このテストを消したり緩めたりすると、「毎日静かに失敗しているのに緑に見える」状態になる。

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const FETCH = path.join(__dirname, "fetch-site-analytics.js");
const TOKEN = "stub-admin-token-0123456789";

let failures = 0;
function ok(label, cond, detail) {
  if (cond) {
    console.log(`✓  ${label}`);
  } else {
    failures++;
    console.log(`✗  ${label}${detail ? ` … ${detail}` : ""}`);
  }
}

function jsonRes(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

// 正常系で返す集計。画面（/admin/analytics）と同じ形＝lib/adminAnalytics.ts の
// buildSnapshot が返す形をそのまま使う。
const SNAPSHOT = {
  configured: true,
  windowDays: 30,
  rowCount: 42,
  truncated: false,
  events: [
    { event: "official_link_click", label: "公式サイトへ（未提携）", last7: 5, last30: 18 },
    { event: "affiliate_click", label: "広告リンクをクリック（提携済み）", last7: 2, last30: 7 },
  ],
  filterService: [["d_anime", 9]],
  officialClicks: [
    ["d_anime", 11],
    ["bandai", 4],
  ],
  affiliateClicks: [["abema", 7]],
};

/**
 * スタブサーバー。behavior で失敗の出し方を切り替える。
 * seen に「何回叩かれたか」「どうやってトークンが送られてきたか」を記録する。
 */
function startStub(behavior = {}) {
  const seen = { count: 0, headerTokens: [], urls: [] };
  const server = http.createServer((req, res) => {
    seen.count++;
    seen.headerTokens.push(req.headers["x-admin-token"] ?? null);
    seen.urls.push(req.url);
    const status = (behavior.plan || [])[seen.count - 1];
    if (status) return jsonRes(res, status, { error: "stub_error" });
    return jsonRes(res, 200, behavior.body ?? SNAPSHOT);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, seen, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function runFetch({ baseUrl, outDir, token = TOKEN, extraEnv = {} }) {
  const env = {
    ...process.env,
    SITE_ANALYTICS_BASE: baseUrl,
    SITE_ANALYTICS_OUT_DIR: outDir,
    SITE_ANALYTICS_RETRY_BASE_MS: "1", // 待ち時間**だけ**を短くする。分岐は本番と同じ経路
    ...extraEnv,
  };
  if (token === null) delete env.ADMIN_DASHBOARD_TOKEN;
  else env.ADMIN_DASHBOARD_TOKEN = token;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FETCH], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

function readOutput(outDir) {
  const files = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith(".json")) : [];
  if (files.length !== 1) return null;
  const text = fs.readFileSync(path.join(outDir, files[0]), "utf8");
  return { name: files[0], text, json: JSON.parse(text) };
}

async function withStub(behavior, fn, runOpts = {}) {
  const stub = await startStub(behavior);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-analytics-check-"));
  try {
    const result = await runFetch({ baseUrl: stub.baseUrl, outDir, ...runOpts });
    await fn({ ...result, seen: stub.seen, outDir, output: readOutput(outDir) });
  } finally {
    stub.server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log("── サイト行動ログ取得スクリプトの検査 ──");

  // 1. 正常系
  await withStub({}, ({ code, output, seen }) => {
    ok("正常系: 成功する", code === 0, `code=${code}`);
    ok("正常系: JSONが1件書かれる", output !== null);
    ok(
      "正常系: ファイル名がYYYY-MM-DD.json",
      output !== null && /^\d{4}-\d{2}-\d{2}\.json$/.test(output.name),
      output?.name
    );
    if (output) {
      const j = output.json;
      ok("正常系: 未提携クリックがそのまま入る", j.officialClicks?.[0]?.[0] === "d_anime", JSON.stringify(j.officialClicks));
      ok("正常系: 提携済みクリックがそのまま入る", j.affiliateClicks?.[0]?.[0] === "abema");
      ok("正常系: 取得日時と取得元が入る", typeof j.fetchedAt === "string" && typeof j.source === "string");
    }
    ok("正常系: トークンはヘッダーで送られる", seen.headerTokens[0] === TOKEN, String(seen.headerTokens[0]));
    ok(
      "正常系: トークンをURLに載せない",
      seen.urls.every((u) => !u.includes(TOKEN)),
      seen.urls.join(",")
    );
  });

  // 2. 429 は再試行して成功する
  await withStub({ plan: [429, 429] }, ({ code, output, seen }) => {
    ok("429: 再試行して成功する", code === 0 && output !== null, `code=${code}`);
    ok("429: 3回叩いている（＝再試行している）", seen.count === 3, `count=${seen.count}`);
  });

  // 3. 5xx も再試行する
  await withStub({ plan: [503] }, ({ code, output, seen }) => {
    ok("5xx: 再試行して成功する", code === 0 && output !== null, `code=${code}`);
    ok("5xx: 2回叩いている", seen.count === 2, `count=${seen.count}`);
  });

  // 4. 404（トークン不一致）は再試行せず即失敗
  await withStub({ plan: [404, 404, 404, 404, 404] }, ({ code, err, seen, output }) => {
    ok("404: 失敗する", code === 1, `code=${code}`);
    ok("404: 再試行しない（1回だけ）", seen.count === 1, `count=${seen.count}`);
    ok("404: 恒久的なエラーとして報告される", err.includes("恒久的なエラー"), err.trim().slice(0, 120));
    ok("404: ファイルを書かない", output === null);
  });

  // 5. トークン未設定なら静かにスキップ
  await withStub(
    {},
    ({ code, out, seen, output }) => {
      ok("トークン未設定: 成功扱いで終わる", code === 0, `code=${code}`);
      ok("トークン未設定: サイトを叩かない", seen.count === 0, `count=${seen.count}`);
      ok("トークン未設定: ファイルを作らない", output === null);
      ok("トークン未設定: 理由をログに出す", out.includes("ADMIN_DASHBOARD_TOKEN"), out.trim().slice(0, 120));
    },
    { token: null }
  );

  // 6. サイト側が未設定なら、ファイルを作らずに正常終了する
  await withStub(
    { body: { configured: false, reason: "Supabaseが未設定です" } },
    ({ code, out, output }) => {
      ok("サイト側が未設定: 成功扱いで終わる", code === 0, `code=${code}`);
      ok("サイト側が未設定: ファイルを作らない", output === null);
      ok("サイト側が未設定: 理由をログに出す", out.includes("未設定"), out.trim().slice(0, 120));
    }
  );

  // 7. トークンが応答に紛れ込んでも、書き出さずに落ちる
  //    （サイト側の不具合でトークンが反射されるような事故を、コミット前で止める）
  await withStub(
    { body: { ...SNAPSHOT, echo: TOKEN } },
    ({ code, err, output }) => {
      ok("秘密の混入: 失敗する", code === 1, `code=${code}`);
      ok("秘密の混入: ファイルを書かない", output === null);
      ok("秘密の混入: 理由を報告する", err.includes("秘密"), err.trim().slice(0, 160));
    }
  );

  // 8. 打ち切りを黙らない
  await withStub({ body: { ...SNAPSHOT, truncated: true, rowCount: 5000 } }, ({ code, out, output }) => {
    ok("打ち切り: 成功はする", code === 0 && output !== null, `code=${code}`);
    ok("打ち切り: 警告をログに出す", out.includes("打ち切"), out.trim().slice(0, 160));
  });

  console.log(failures === 0 ? "\n全件OK" : `\nNG ${failures}件`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
