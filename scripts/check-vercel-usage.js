// scripts/fetch-vercel-usage.js（Vercel利用量の日次取得）と
// scripts/usage-report.js（判定レポート）の回帰テスト。
//
// scripts/check-gsc.js / check-site-analytics.js と同じ流儀: node:http でスタブ
// サーバーを立て、取得スクリプトを**子プロセスで実際に実行**して外形挙動を固定する。
// ネットワークには一切出ない（127.0.0.1 のスタブのみ）。依存も増やさない。
//
// この2本は**落ちるのではなく数字を静かに間違える**方向に壊れる。
// 無料枠に収まっているかの唯一の機械可読な一次情報なので、間違えたまま緑だと
// 「ずっと上限内」と書き続けたあとに本番が HTTP 402 で止まる
// （2026-08-24に実際に起きている＝docs/operations.md の㉝）。
//
// ここで固定していること:
//   【日付】1. 請求期間は**ロサンゼルス時間**で区切る（JSTでもUTCでもない）
//   【畳み】2. 明細を日付×サービス名で畳み、CLIの --json と同じ形にする
//   【判定】3. **当日は平均に入れない**（途中集計なので必ず低く見える）
//           4. **単位が予期と違うときは判定しない**（保留と明記する）
//           5. **予算表に無いサービス名を必ず出す**（黙って消えない）
//           6. **残高（Deployment Storage）は日割りしない**
//           7. **明細0件は「利用ゼロ」ではなく「取れていない」**
//   【取得】8. トークンは**ヘッダー**で送る（URLにもargvにも載せない）
//           9. 429・5xx は指数バックオフで再試行する
//          10. 401・403 は再試行せず即座に失敗する
//          11. トークン未設定なら静かにスキップしてファイルを作らない
//          12. 書き出したJSONにトークンが混入しない
//          13. エラーがJSONで返ったとき「0件」として通さない
//
// このテストを消したり緩めたりすると、「毎日静かに間違えているのに緑に見える」状態になる。

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const FETCH = path.join(__dirname, "fetch-vercel-usage.js");
const REPORT = path.join(__dirname, "usage-report.js");
const lib = require("./lib/vercel-usage.js");

const TOKEN = "stub-vercel-token-0123456789";

let failures = 0;
function ok(label, cond, detail) {
  if (cond) {
    console.log(`✓  ${label}`);
  } else {
    failures++;
    console.log(`✗  ${label}${detail ? ` … ${detail}` : ""}`);
  }
}

// ── 1. 日付（ロサンゼルス時間）──────────────────────────────────
{
  // 9月は夏時間（PDT=UTC-7）、1月は標準時（PST=UTC-8）。
  // JSTで解釈すると 15:00Z、UTC0時で解釈すると 00:00Z になるので、どの取り違えも落ちる。
  ok(
    "夏時間の日はLA0時＝07:00Z",
    lib.laMidnightUtcIso("2026-09-14") === "2026-09-14T07:00:00.000Z",
    lib.laMidnightUtcIso("2026-09-14")
  );
  ok(
    "標準時の日はLA0時＝08:00Z",
    lib.laMidnightUtcIso("2026-01-15") === "2026-01-15T08:00:00.000Z",
    lib.laMidnightUtcIso("2026-01-15")
  );
  ok(
    "plusDays はLA基準で翌日の0時",
    lib.laMidnightUtcIso("2026-09-14", { plusDays: 1 }) === "2026-09-15T07:00:00.000Z",
    lib.laMidnightUtcIso("2026-09-14", { plusDays: 1 })
  );
  // 夏時間の切り替え日（2026-11-01 に PDT→PST）をまたいでも、その日のLA0時は PDT 側。
  ok(
    "切り替え日でも収束する",
    lib.laMidnightUtcIso("2026-11-01") === "2026-11-01T07:00:00.000Z",
    lib.laMidnightUtcIso("2026-11-01")
  );
  let threw = false;
  try {
    lib.laMidnightUtcIso("2026/09/14");
  } catch {
    threw = true;
  }
  ok("形式の違う日付は落とす", threw);
}

// ── 2. 明細の畳み込み ──────────────────────────────────────────
const CHARGES = [
  // 同じ日・同じサービスは足される
  c("ISR Writes", 1000, "writes", "2026-09-10T03:00:00Z", 0.5),
  c("ISR Writes", 500, "writes", "2026-09-10T15:00:00Z", 0.25),
  c("Fluid Active CPU", 0.1, "hours", "2026-09-10T03:00:00Z", 2),
  c("ISR Writes", 2000, "writes", "2026-09-11T03:00:00Z", 1),
  c("Fluid Active CPU", 0.2, "hours", "2026-09-11T03:00:00Z", 3),
];
function c(ServiceName, PricingQuantity, PricingUnit, ChargePeriodStart, BilledCost) {
  return {
    ServiceName,
    PricingQuantity,
    PricingUnit,
    ChargePeriodStart,
    BilledCost,
    EffectiveCost: BilledCost,
    Tags: { ProjectName: "animedia" },
  };
}
{
  const agg = lib.aggregateCharges(CHARGES, { from: "F", to: "T" });
  ok("日付はChargePeriodStartの先頭10文字", agg.breakdown.data.map((d) => d.periodKey).join(",") === "2026-09-10,2026-09-11");
  const d10 = agg.breakdown.data[0];
  const isr10 = d10.services.find((s) => s.name === "ISR Writes");
  ok("同じ日・同じサービスは合算する", isr10.pricingQuantity === 1500, String(isr10.pricingQuantity));
  ok("単位を保つ", isr10.pricingUnit === "writes", isr10.pricingUnit);
  ok("日ごとの合計が出る", d10.totals.pricingQuantity === 1500.1, String(d10.totals.pricingQuantity));
  ok("サービスは請求額の降順", d10.services[0].name === "Fluid Active CPU", d10.services[0].name);
  const isrAll = agg.services.find((s) => s.name === "ISR Writes");
  ok("期間全体でも合算する", isrAll.pricingQuantity === 3500, String(isrAll.pricingQuantity));
  ok("明細の件数を持つ", agg.chargeCount === 5, String(agg.chargeCount));
  ok("CLIと同じ形（breakdown.period=daily）", agg.breakdown.period === "daily");
  ok("ServiceName が無ければ Unknown", lib.aggregateCharges([{ PricingQuantity: 1 }]).services[0].name === "Unknown");
  ok(
    "JSON Linesを読む（空行は捨てる）",
    lib.parseJsonLines('{"a":1}\n\n{"a":2}\n').length === 2
  );
  let threw = false;
  try {
    lib.parseJsonLines('{"a":1}\n{壊れ\n');
  } catch {
    threw = true;
  }
  ok("壊れた行は黙って捨てない", threw);
}

// ── 3〜7. 判定 ────────────────────────────────────────────────
{
  // 7日ぶん。1日5,000 writes（予算は 200,000/30 = 6,666.7）＝30日見込み150,000＝75%。
  const days = [];
  for (let i = 10; i <= 16; i++) {
    days.push({
      periodKey: `2026-09-${String(i).padStart(2, "0")}`,
      services: [{ name: "ISR Writes", pricingQuantity: 5000, pricingUnit: "writes" }],
      totals: { pricingQuantity: 5000 },
    });
  }
  // 基準日（当日）は途中集計なので極端に小さい。平均に入れると合格に見えてしまう。
  days.push({
    periodKey: "2026-09-17",
    services: [{ name: "ISR Writes", pricingQuantity: 1, pricingUnit: "writes" }],
    totals: { pricingQuantity: 1 },
  });
  const snap = { breakdown: { period: "daily", data: days }, chargeCount: 99 };

  const r = judgeOf(snap, { days: 7, today: "2026-09-17" });
  const isr = r.metrics.find((m) => m.key === "isrWrites");
  ok("当日を平均に入れない", r.days === 7 && isr.perDay === 5000, `days=${r.days} perDay=${isr.perDay}`);
  ok("1日の予算は上限÷30", Math.abs(isr.perDayBudget - 200000 / 30) < 1e-9, String(isr.perDayBudget));
  ok("30日の見込みを出す", isr.projected === 150000, String(isr.projected));
  ok("余裕があれば ok", isr.status === "ok", isr.status);

  // 8割を超えたら警告（超えてから気づくのでは遅い。ここが無いと 99% まで緑になる）。
  const warnSnap = {
    chargeCount: 9,
    breakdown: {
      period: "daily",
      data: days.slice(0, 7).map((d) => ({
        ...d,
        services: [{ name: "ISR Writes", pricingQuantity: 6000, pricingUnit: "writes" }],
      })),
    },
  };
  ok(
    "上限の8割を超えたら warn",
    judgeOf(warnSnap, { days: 7, today: "2026-09-17" }).metrics.find((m) => m.key === "isrWrites")
      .status === "warn"
  );

  // 1日7,000 に上げると 210,000＝超過。
  const overSnap = {
    chargeCount: 9,
    breakdown: {
      period: "daily",
      data: days.slice(0, 7).map((d) => ({
        ...d,
        services: [{ name: "ISR Writes", pricingQuantity: 7000, pricingUnit: "writes" }],
      })),
    },
  };
  ok(
    "上限を超えたら over",
    judgeOf(overSnap, { days: 7, today: "2026-09-17" }).metrics.find((m) => m.key === "isrWrites")
      .status === "over"
  );

  // 4. 単位が違えば判定しない（over とも ok とも言わない）
  const unitSnap = {
    chargeCount: 9,
    breakdown: {
      period: "daily",
      data: days.slice(0, 7).map((d) => ({
        ...d,
        services: [{ name: "ISR Writes", pricingQuantity: 999999, pricingUnit: "MIUs" }],
      })),
    },
  };
  const um = judgeOf(unitSnap, { days: 7, today: "2026-09-17" }).metrics.find((m) => m.key === "isrWrites");
  ok("単位が違えば判定を保留する", um.status === "unit-mismatch", um.status);
  ok("保留のときは比率を出さない", um.ratio === null, String(um.ratio));

  // 5. 予算表に無いサービス名は必ず出す
  const unknownSnap = {
    chargeCount: 2,
    breakdown: {
      period: "daily",
      data: [
        {
          periodKey: "2026-09-10",
          services: [{ name: "Brand New Metric", pricingQuantity: 42, pricingUnit: "x" }],
          totals: { pricingQuantity: 42 },
        },
      ],
    },
  };
  const ur = judgeOf(unknownSnap, { days: 7, today: "2026-09-17" });
  ok(
    "予算表に無いサービス名を出す",
    ur.unknownServices.length === 1 && ur.unknownServices[0].name === "Brand New Metric",
    JSON.stringify(ur.unknownServices)
  );
  ok("表記ゆれは吸収する", lib.budgetFor("isr  writes")?.key === "isrWrites");

  // 6. 残高（Deployment Storage）は日割りしない
  const balSnap = {
    chargeCount: 1,
    breakdown: {
      period: "daily",
      data: [
        {
          periodKey: "2026-09-10",
          services: [{ name: "Deployment Storage", pricingQuantity: 28.2, pricingUnit: "GB" }],
          totals: { pricingQuantity: 28.2 },
        },
      ],
    },
  };
  const bal = judgeOf(balSnap, { days: 7, today: "2026-09-17" }).metrics.find(
    (m) => m.key === "deploymentStorage"
  );
  ok("残高は日割りしない", bal.status === "balance" && bal.perDay === null && bal.projected === null, bal.status);

  // 7. 明細0件は「利用ゼロ」ではない
  const empty = judgeOf({ chargeCount: 0, breakdown: { period: "daily", data: [] } }, {});
  ok("明細0件は empty として区別する", empty.empty === true);
  ok("0件のとき ok の指標を作らない", empty.metrics.every((m) => m.status !== "ok"));
}
function judgeOf(snap, opts) {
  return lib.judge(snap, opts);
}

// ── 8〜13. 取得スクリプト（HTTPスタブ）────────────────────────────
function startStub(behavior = {}) {
  const seen = { count: 0, auth: [], urls: [] };
  const server = http.createServer((req, res) => {
    seen.count++;
    seen.auth.push(req.headers.authorization ?? null);
    seen.urls.push(req.url);
    const status = (behavior.plan || [])[seen.count - 1];
    if (status) {
      res.writeHead(status, { "Content-Type": "application/json" });
      // 本文は差し替えられる。404でも「このプランに請求が無い」と「その他の404」を
      // 文言で見分けているので、**本物と同じ本文**を流せないと検査にならない。
      return res.end(behavior.planBody ?? JSON.stringify({ error: { code: "stub", message: "stub" } }));
    }
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end(behavior.body ?? CHARGES.map((x) => JSON.stringify(x)).join("\n") + "\n");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, seen, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function run(script, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "usage-check-"));
}
function readOut(dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  return files.length ? JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8")) : null;
}

async function withStub(behavior, fn) {
  const stub = await startStub(behavior);
  try {
    return await fn(stub);
  } finally {
    await new Promise((r) => stub.server.close(r));
  }
}

async function main() {
  // 8. 正常系 + トークンはヘッダー + LA時間の窓
  await withStub({}, async ({ baseUrl, seen }) => {
    const dir = tmpDir();
    const r = await run(FETCH, {
      VERCEL_TOKEN: TOKEN,
      VERCEL_USAGE_BASE: baseUrl,
      VERCEL_USAGE_OUT_DIR: dir,
      VERCEL_USAGE_DAYS: "35",
    });
    ok("正常系は成功する", r.code === 0, r.err || r.out);
    const json = readOut(dir);
    ok("明細を畳んで書き出す", json && json.chargeCount === 5, JSON.stringify(json?.chargeCount));
    ok("日次の内訳が入る", json?.breakdown?.data?.length === 2);
    ok(
      "トークンをAuthorizationヘッダーで送る",
      seen.auth[0] === `Bearer ${TOKEN}`,
      String(seen.auth[0])
    );
    ok(
      "トークンをURLに載せない",
      seen.urls.every((u) => !u.includes(TOKEN)),
      seen.urls.join(" ")
    );
    // 窓はLA0時＝UTCの07:00か08:00。JSTなら15:00、UTC0時なら00:00になるので落ちる。
    const q = new URLSearchParams(seen.urls[0].split("?")[1]);
    const from = q.get("from");
    const to = q.get("to");
    ok(
      "取得の窓はロサンゼルス時間の0時",
      /T(07|08):00:00\.000Z$/.test(from) && /T(07|08):00:00\.000Z$/.test(to),
      `${from} 〜 ${to}`
    );
    ok(
      "窓の幅は要求した日数+1日",
      Math.round((Date.parse(to) - Date.parse(from)) / 86400000) === 36,
      `${(Date.parse(to) - Date.parse(from)) / 86400000}日`
    );
    // 12. 書き出したJSONにトークンが混入しない
    ok(
      "書き出したJSONにトークンが混入しない",
      !fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8").includes(TOKEN)
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 9. 429・5xx は再試行する
  for (const [label, plan] of [
    ["429は再試行して成功する", [429, 429]],
    ["5xxは再試行して成功する", [503]],
  ]) {
    await withStub({ plan }, async ({ baseUrl, seen }) => {
      const dir = tmpDir();
      const r = await run(FETCH, {
        VERCEL_TOKEN: TOKEN,
        VERCEL_USAGE_BASE: baseUrl,
        VERCEL_USAGE_OUT_DIR: dir,
        VERCEL_USAGE_RETRY_BASE_MS: "1",
      });
      ok(label, r.code === 0 && seen.count === plan.length + 1, `code=${r.code} calls=${seen.count}`);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  // 10. 401・403 は再試行せず即失敗
  for (const status of [401, 403]) {
    await withStub({ plan: [status, status, status, status, status] }, async ({ baseUrl, seen }) => {
      const dir = tmpDir();
      const r = await run(FETCH, {
        VERCEL_TOKEN: TOKEN,
        VERCEL_USAGE_BASE: baseUrl,
        VERCEL_USAGE_OUT_DIR: dir,
        VERCEL_USAGE_RETRY_BASE_MS: "1",
      });
      ok(
        `${status}は再試行せず即座に失敗する`,
        r.code !== 0 && seen.count === 1,
        `code=${r.code} calls=${seen.count}`
      );
      ok(`${status}のときファイルを作らない`, readOut(dir) === null);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  // 10'. 404「Plan not found」＝このプランに請求の仕組みが無い（2026-09-19・実測で確定）。
  //      Hobbyで実際に返ってきた本文をそのまま流す。**失敗にしない**（直し方が無いものを
  //      毎朝Issueに積むと、数日で読まれなくなって本物の障害まで見逃す＝㉔）。
  //      ただし**黙って抜けない**ので、理由が出ていることまで見る。
  await withStub(
    {
      plan: [404],
      planBody: JSON.stringify({ error: { code: "not_found", message: "Plan not found." } }),
    },
    async ({ baseUrl, seen }) => {
      const dir = tmpDir();
      const r = await run(FETCH, {
        VERCEL_TOKEN: TOKEN,
        VERCEL_USAGE_BASE: baseUrl,
        VERCEL_USAGE_OUT_DIR: dir,
        VERCEL_USAGE_RETRY_BASE_MS: "1",
      });
      ok("請求の無いプランは失敗にしない", r.code === 0, `code=${r.code} ${r.err}`);
      ok("請求の無いプランでも再試行しない", seen.count === 1, String(seen.count));
      ok("請求の無いプランではファイルを作らない", readOut(dir) === null);
      ok("黙って抜けず理由を出す", /請求明細がありません/.test(r.out), r.out.slice(0, 120));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  );

  // 10''. **その他の404は従来どおり失敗させる。** 文言ではなくステータスだけで
  //       省略扱いにすると、teamIdの指定ミス（同じ `not_found` が返る）を黙って飲み込む。
  await withStub(
    {
      plan: [404],
      planBody: JSON.stringify({ error: { code: "not_found", message: "Team not found." } }),
    },
    async ({ baseUrl }) => {
      const dir = tmpDir();
      const r = await run(FETCH, {
        VERCEL_TOKEN: TOKEN,
        VERCEL_USAGE_BASE: baseUrl,
        VERCEL_USAGE_OUT_DIR: dir,
        VERCEL_USAGE_RETRY_BASE_MS: "1",
      });
      ok("請求以外の404は失敗のままにする", r.code !== 0, `code=${r.code}`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  );

  // 11. トークン未設定なら静かにスキップ
  await withStub({}, async ({ baseUrl, seen }) => {
    const dir = tmpDir();
    const env = {
      VERCEL_USAGE_BASE: baseUrl,
      VERCEL_USAGE_OUT_DIR: dir,
      VERCEL_TOKEN: "",
    };
    const r = await run(FETCH, env);
    ok("トークン未設定なら成功扱いでスキップ", r.code === 0, r.err);
    ok("スキップ時は取りに行かない", seen.count === 0, String(seen.count));
    ok("スキップ時はファイルを作らない", readOut(dir) === null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 12'. 秘密が応答経由で本文に回り込んだら、書かずに落とす。
  //      （assertNoSecrets を外すと通ってしまう＝この1件だけがその検査の番人）
  await withStub(
    {
      body:
        JSON.stringify({
          ServiceName: `ISR Writes ${TOKEN}`,
          PricingQuantity: 1,
          PricingUnit: "writes",
          ChargePeriodStart: "2026-09-10T00:00:00Z",
        }) + "\n",
    },
    async ({ baseUrl }) => {
      const dir = tmpDir();
      const r = await run(FETCH, {
        VERCEL_TOKEN: TOKEN,
        VERCEL_USAGE_BASE: baseUrl,
        VERCEL_USAGE_OUT_DIR: dir,
        VERCEL_USAGE_RETRY_BASE_MS: "1",
      });
      ok(
        "本文にトークンが混ざったら書かずに落とす",
        r.code !== 0 && readOut(dir) === null,
        `code=${r.code} / ${JSON.stringify(readOut(dir))?.slice(0, 120)}`
      );
      fs.rmSync(dir, { recursive: true, force: true });
    }
  );

  // 13. エラーがJSONで返ったとき「0件」として通さない
  await withStub({ body: JSON.stringify({ error: { code: "forbidden", message: "no" } }) }, async ({ baseUrl }) => {
    const dir = tmpDir();
    const r = await run(FETCH, {
      VERCEL_TOKEN: TOKEN,
      VERCEL_USAGE_BASE: baseUrl,
      VERCEL_USAGE_OUT_DIR: dir,
      VERCEL_USAGE_RETRY_BASE_MS: "1",
    });
    ok("200で返るAPIエラーを0件として通さない", r.code !== 0 && readOut(dir) === null, `code=${r.code}`);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ── レポート ─────────────────────────────────────────────
  const dir = tmpDir();
  const write = (name, obj) =>
    fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2), "utf8");

  write("2026-09-17.json", { fetchedAt: "x", chargeCount: 0, breakdown: { period: "daily", data: [] } });
  let r = await run(REPORT, { VERCEL_USAGE_OUT_DIR: dir });
  ok(
    "0件のとき「利用ゼロ」と書かず失敗する",
    r.code !== 0 && r.out.includes("取れていません"),
    r.out.slice(0, 200)
  );

  const day = (d, qty) => ({
    periodKey: d,
    services: [{ name: "ISR Writes", pricingQuantity: qty, pricingUnit: "writes" }],
    totals: { pricingQuantity: qty },
  });
  write("2026-09-17.json", {
    fetchedAt: "x",
    chargeCount: 70,
    breakdown: {
      period: "daily",
      data: [10, 11, 12, 13, 14, 15, 16].map((i) => day(`2026-09-${i}`, 9000)).concat([day("2026-09-17", 1)]),
    },
  });
  r = await run(REPORT, { VERCEL_USAGE_OUT_DIR: dir });
  ok("超過を ✗ で出して失敗する", r.code !== 0 && r.out.includes("✗"), r.out.slice(-300));
  ok("当日を平均に入れない（レポート側）", r.out.includes("9,000"), r.out.slice(0, 600));

  write("2026-09-17.json", {
    fetchedAt: "x",
    chargeCount: 3,
    breakdown: {
      period: "daily",
      data: [
        {
          periodKey: "2026-09-10",
          services: [{ name: "Brand New Metric", pricingQuantity: 5, pricingUnit: "x" }],
          totals: { pricingQuantity: 5 },
        },
      ],
    },
  });
  r = await run(REPORT, { VERCEL_USAGE_OUT_DIR: dir });
  ok("予算表に無いサービス名をレポートに出す", r.out.includes("Brand New Metric"), r.out.slice(-400));
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(failures === 0 ? "\n全て OK" : `\n${failures} 件の失敗`);
  if (failures > 0) process.exitCode = 1;
}

main();
