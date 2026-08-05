// scripts/post-threads.js のThreads自動投稿ロジックの回帰テスト。
//
// 【経緯・2026-08-05】GitHub ActionsでのThreads自動投稿が断続的に "Media Not Found"
// （OAuthException code 24 / error_subcode 4279009）で落ちていた（直近2週間で約3割の日が
// Threadsだけ0投稿）。原因は post-threads.js 側のコメントにある通り2つ:
//   (a) コンテナ状態ポーリング waitUntilPublishable が、status が undefined のときに
//       「待たずに公開へ進む」抜け道を持っていた。
//   (b) status=FINISHED 直後の publish でも一時的に Media Not Found が返ることがあるのに、
//       1回で諦めていた。
// あわせて、投稿を1件ずつ独立させる修正（1本目が落ちても2本目は投げる）も入れた。
// このテストは、この3点の挙動が**将来また壊れないこと**を機械的に固定するために書いた。
// とくに(a)は「本番だけで起きてテスト（スタブ）では気づかない」抜け道だったため、
// THREADS_API_BASE を差し替えたスタブ相手でも post-threads.js 本体の分岐・判断ロジックは
// 本番と全く同じものを通す（待ち時間だけがゼロになる。post-threads.js 側の IS_STUB 参照）。
// このテストの検査を消したり緩めたりすると、この種の「ローカルでは再現しない本番障害」を
// 再び見逃す状態に戻る。
//
// 依存パッケージは追加していない（node:http でスタブサーバーを立て、node:child_process の
// spawn で scripts/post-threads.js を実際に子プロセス実行して外形挙動を検証する）。
// ネットワークには一切出ない（127.0.0.1 のスタブサーバーのみ。THREADS_API_BASE と
// DIGEST_SITE_URL の両方を同じスタブに向け、buildPost() が叩く /api/season も
// このスタブ内で返す。実サイト・実Threads APIには通信しない）。
//
// 【日付非依存にする工夫】buildPost()（既定 POST_KIND=digest）は実行時の実際の曜日で
// 投稿本数が変わる（日曜は複数本になりうる）ため、曜日に依存したテストは実行日によって
// 結果が変わってしまう。そこでスポットライト枠（content/sns/spotlight.js の
// SPOTLIGHT_WORKS）を使う: /api/season のダミーデータに SPOTLIGHT_WORKS 内の実在
// annictId を1件だけ含めれば、その1件が候補一意（1件しかないので日替わりローテーションの
// 余りに関わらず必ず選ばれる）でスポットライト投稿が追加され、「通常の1本＋スポットライト
// 1本＝常に2本」を曜日に関係なく再現できる。これでケース4（1件失敗・残りは投げる）も
// 実行日に左右されずに検証できている。

const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");

const POST_THREADS = path.join(__dirname, "post-threads.js");
const USER_ID = "1234";

function jsonRes(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

// シナリオ設定から、Threads API + サイトAPI(/api/season)の両方を兼ねるスタブサーバーを
// 立てる。呼び出しはすべて calls に時系列で記録し、テスト側で回数・順序を検証できるようにする。
//   scenario.seasonData … GET /api/season が返すJSON
//   scenario.status(creationId, attempt) … GET /{creationId} が返すJSON（statusを含む/含まない）
//   scenario.publish(creationId, attempt) … POST /{userId}/threads_publish の結果
//     { ok: true, postId } または { ok: false, httpStatus, body }
function createStub(scenario) {
  let nextContainerId = 1;
  const statusCounts = new Map(); // creationId -> 呼び出し回数
  const publishCounts = new Map(); // creationId -> 呼び出し回数
  const calls = []; // { type: "create"|"status"|"publish", id, attempt?, ok? }

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");

    if (req.method === "GET" && pathname === "/me") {
      return jsonRes(res, 200, { id: USER_ID });
    }

    if (req.method === "GET" && pathname === "/api/season") {
      return jsonRes(res, 200, scenario.seasonData);
    }

    if (req.method === "POST" && pathname === `/${USER_ID}/threads`) {
      await readBody(req);
      const id = `c${nextContainerId++}`;
      statusCounts.set(id, 0);
      publishCounts.set(id, 0);
      calls.push({ type: "create", id });
      return jsonRes(res, 200, { id });
    }

    if (req.method === "POST" && pathname === `/${USER_ID}/threads_publish`) {
      const body = await readBody(req);
      const creationId = new URLSearchParams(body).get("creation_id");
      const attempt = (publishCounts.get(creationId) || 0) + 1;
      publishCounts.set(creationId, attempt);
      const result = scenario.publish(creationId, attempt);
      calls.push({ type: "publish", id: creationId, attempt, ok: result.ok });
      if (result.ok) {
        return jsonRes(res, 200, { id: result.postId || `post-${creationId}` });
      }
      return jsonRes(res, result.httpStatus, result.body);
    }

    const m = pathname.match(/^\/(c\d+)$/);
    if (req.method === "GET" && m) {
      const creationId = m[1];
      const attempt = (statusCounts.get(creationId) || 0) + 1;
      statusCounts.set(creationId, attempt);
      calls.push({ type: "status", id: creationId, attempt });
      return jsonRes(res, 200, scenario.status(creationId, attempt));
    }

    jsonRes(res, 404, { error: `stub未対応: ${req.method} ${pathname}` });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        calls,
        statusCallCount: (id) => statusCounts.get(id) || 0,
        publishCallCount: (id) => publishCounts.get(id) || 0,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// creationId について、最初の publish 呼び出しより前に何回 status ポーリング(GET)が
// 行われたかを数える。「statusを見ずに素通りして公開していないか」の判定に使う。
function statusCallsBeforeFirstPublish(calls, creationId) {
  let count = 0;
  for (const c of calls) {
    if (c.id !== creationId) continue;
    if (c.type === "status") count++;
    if (c.type === "publish") break;
  }
  return count;
}

function lastPublishOk(calls, creationId) {
  const publishes = calls.filter((c) => c.type === "publish" && c.id === creationId);
  if (publishes.length === 0) return undefined;
  return publishes[publishes.length - 1].ok;
}

// scripts/post-threads.js を子プロセスで実行する。THREADS_API_BASE / DIGEST_SITE_URL の
// 両方をスタブに向け、POST_KIND=digest（既定値）で buildPost() を通す。
function runPostThreads(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [POST_THREADS], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        THREADS_API_BASE: baseUrl,
        DIGEST_SITE_URL: baseUrl,
        THREADS_ACCESS_TOKEN: "stub-token",
        POST_KIND: "digest",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function seasonData(items) {
  return { count: items.length, items };
}

// SPOTLIGHT_WORKS（content/sns/spotlight.js）に実在する annictId=14132（逃げ上手の若君
// 第二期）を1件だけ含めることで、スポットライト枠の日替わりローテーションを
// 「候補1件しかないので必ずそれが選ばれる」形にし、曜日に関係なく決定的にする。
const PRIMARY_ITEM = {
  id: 1,
  title: "テスト作品A",
  watchers: 500,
  services: [{ key: "netflix", short: "Netflix" }],
  broadcastStartDate: null,
  broadcastWeekday: null,
  broadcastTime: null,
};
const SPOTLIGHT_ITEM = {
  id: 14132,
  title: "逃げ上手の若君 第二期",
  watchers: 50,
  services: [{ key: "netflix", short: "Netflix" }],
  broadcastStartDate: null,
  broadcastWeekday: null,
  broadcastTime: null,
};

const MEDIA_NOT_FOUND_BODY = {
  error: {
    message: "The requested resource does not exist",
    type: "OAuthException",
    code: 24,
    error_subcode: 4279009,
    fbtrace_id: "stub",
  },
};
const PERMANENT_ERROR_BODY = {
  error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190, fbtrace_id: "stub" },
};

const results = []; // { name, pass }
function check(name, pass) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"}  ${name}`);
}

async function runScenario(name, scenario, assert) {
  const stub = await createStub(scenario);
  const { code, stdout, stderr } = await runPostThreads(stub.baseUrl);
  await stub.close();
  assert({ code, stdout, stderr, calls: stub.calls, statusCallCount: stub.statusCallCount, publishCallCount: stub.publishCallCount, lastPublishOk: (id) => lastPublishOk(stub.calls, id), statusBeforePublish: (id) => statusCallsBeforeFirstPublish(stub.calls, id) });
}

async function main() {
  // ① statusを返さないコンテナで、待たずに公開しない（今回の穴の再発防止・最重要）
  await runScenario(
    "① status未返却",
    {
      seasonData: seasonData([PRIMARY_ITEM]), // スポットライト候補を含めない→1件のみの投稿
      status: () => ({}), // statusフィールドを一切含まないレスポンスを返し続ける
      publish: () => ({ ok: true, postId: "p1" }),
    },
    ({ code, statusBeforePublish }) => {
      check("①-a status未返却でもプロセスはexit code 0で終了する", code === 0);
      check("①-b 公開前にコンテナ状態を2回以上ポーリングしている（素通りしていない）", statusBeforePublish("c1") >= 2);
    }
  );

  // ② 一時的な Media Not Found（error_subcode 4279009）から回復する
  await runScenario(
    "② 一時的エラーから回復",
    {
      seasonData: seasonData([PRIMARY_ITEM]),
      status: () => ({ status: "FINISHED" }),
      publish: (_id, attempt) => (attempt === 1 ? { ok: false, httpStatus: 400, body: MEDIA_NOT_FOUND_BODY } : { ok: true, postId: "p2" }),
    },
    ({ code, publishCallCount }) => {
      check("②-a 一時的エラーから回復してexit code 0で終わる", code === 0);
      check("②-b publishが2回呼ばれている（1回目失敗→2回目成功）", publishCallCount("c1") === 2);
    }
  );

  // ③ 恒久的なエラー（error_subcodeなし）は再試行しない
  await runScenario(
    "③ 恒久的エラー",
    {
      seasonData: seasonData([PRIMARY_ITEM]),
      status: () => ({ status: "FINISHED" }),
      publish: () => ({ ok: false, httpStatus: 400, body: PERMANENT_ERROR_BODY }),
    },
    ({ code, publishCallCount }) => {
      check("③-a 恒久的エラーはプロセスが非0で終了する", code !== 0);
      check("③-b publishの呼び出しは1回だけ（無駄な再試行をしない）", publishCallCount("c1") === 1);
    }
  );

  // ④ 1件失敗しても残りは投げる（2投稿: 通常枠 + スポットライト枠）
  await runScenario(
    "④ 1件失敗・残りは投げる",
    {
      seasonData: seasonData([PRIMARY_ITEM, SPOTLIGHT_ITEM]),
      status: () => ({ status: "FINISHED" }),
      publish: (creationId) =>
        creationId === "c1" ? { ok: false, httpStatus: 400, body: PERMANENT_ERROR_BODY } : { ok: true, postId: "p4" },
    },
    ({ code, publishCallCount, lastPublishOk }) => {
      check("④-a 1件目が恒久エラーでもプロセス全体は最後まで実行され非0で終了する", code !== 0);
      check("④-b 2つの別コンテナ(c1,c2)それぞれにpublishが呼ばれている", publishCallCount("c1") === 1 && publishCallCount("c2") === 1);
      check("④-c 1件目は失敗・2件目(c2)は成功している", lastPublishOk("c1") === false && lastPublishOk("c2") === true);
    }
  );

  const ok = results.filter((r) => r.pass).length;
  const ng = results.filter((r) => !r.pass).length;
  console.log(`\n結果: ${ok}件OK / ${ng}件NG`);
  if (ng > 0) process.exit(1);
}

main();
