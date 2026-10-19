#!/usr/bin/env node
"use strict";
// ───────────────────────────────────────────────────────────────
// scripts/fetch-completion.js の回帰テスト（2026-10-19導入）。
//
// スタブのHTTPサーバー（サイトの /api/season・しょぼいカレンダーの db.php・dアニメストアの
// 一覧と作品ページ）を立てて fetch-completion.js を**実際に子プロセスで動かし**、
// 書き出された content/works/completion.json 相当を検証する。ネットワークには出ない。
// `fetch-completion.js` か `lib/completion-signals.js` を触ったら必ず実行する。
//
// ここで守りたいのは「壊れても画面では気づけない」性質のもの:
//   - 終フラグが無い・食い違う作品に完結の印を書いてしまう → 放送中の作品に「完結」
//   - 1つのTIDを複数の作品が共有しているのに使ってしまう（Re:ゼロ 4th の喪失編/奪還編）
//   - 題名の部分一致でdアニメの別作品の「（全N話）」を拾う（うまゆる→旧作の全24話）
//   - 【規制解除版】【TV放送版】の片方だけが完結なのに完結にする
//   - 一度見えたdアニメの印を、表記が消えた日に消してしまう（続編が同じIDで始まる）
//   - 未来の「終」が取り下げられたのに、古い印を残してしまう
//   - 取得に失敗したバッチの作品の印を消してしまう／失敗を黙る
//   - 中身が変わらない日にファイルを書き換える（＝無駄な本番デプロイ）
//   - 独自の User-Agent を送らない（しょぼいカレンダーの規約）
// ───────────────────────────────────────────────────────────────

const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const { readFileSync, writeFileSync, existsSync, mkdtempSync, statSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert");

const SCRIPT = join(__dirname, "fetch-completion.js");

let pass = 0;
function ok(label, extra = "") {
  pass++;
  console.log(`✓  ${label.padEnd(50)}${extra ? " → " + extra : ""}`);
}

// ── スタブの中身 ──────────────────────────────────────────────
const state = {
  site: {}, // season → items | { status }
  syoboiStatus: null, // 恒久的な失敗を模す
  syoboiOnce: [], // 先頭から1回ずつ返すステータス（一時的な失敗）
  syoboi: {}, // tid → [{ count, flag, stTime, chId, deleted }]
  danimeList: {}, // cours → [{ workId, title, latest }]
  danimePages: {}, // workId → 話数（null＝表記なし）
  userAgents: new Set(),
  danimePageHits: 0,
};

function prog(tid, p) {
  return (
    `<ProgItem id="${tid}${p.count}${p.chId || 1}"><LastUpdate>2026-09-01 00:00:00</LastUpdate>` +
    `<TID>${tid}</TID><StTime>${p.stTime}</StTime><StOffset>${p.stOffset || 0}</StOffset>` +
    `<EdTime>${p.stTime}</EdTime><Count>${p.count}</Count><SubTitle></SubTitle>` +
    `<Flag>${p.flag || 0}</Flag><Deleted>${p.deleted ? 1 : 0}</Deleted><ChID>${p.chId || 1}</ChID></ProgItem>`
  );
}

function handler(req, res) {
  state.userAgents.add(req.headers["user-agent"] || "");
  const u = new URL(req.url, "http://localhost");
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  if (u.pathname === "/api/season") {
    const key = `${u.searchParams.get("year")}-${u.searchParams.get("season")}`;
    const v = state.site[key];
    if (!v) return send(404, { error: "none" });
    if (v.status) return send(v.status, { error: "x" });
    return send(200, { season: key, items: v });
  }
  if (u.pathname === "/db.php") {
    if (state.syoboiOnce.length > 0) return send(state.syoboiOnce.shift(), "busy", "text/plain");
    if (state.syoboiStatus) return send(state.syoboiStatus, "err", "text/plain");
    const tids = (u.searchParams.get("TID") || "").split(",").map(Number);
    const items = tids.flatMap((t) => (state.syoboi[t] || []).map((p) => prog(t, p))).join("");
    return send(200, `<?xml version="1.0" encoding="UTF-8"?><ProgLookupResponse><ProgItems>${items}</ProgItems><Result><Code>200</Code></Result></ProgLookupResponse>`, "text/xml");
  }
  if (u.pathname === "/animestore/rest/WS000118") {
    const list = state.danimeList[u.searchParams.get("cours")];
    if (!list) return send(200, { resultCd: "21", data: null });
    return send(200, {
      resultCd: "00",
      data: {
        workList: list.map((w) => ({
          workId: w.workId,
          workInfo: { workTitle: w.title, latestPartPublicDate: w.latest || null },
        })),
      },
    });
  }
  if (u.pathname === "/animestore/ci_pc") {
    state.danimePageHits++;
    const id = u.searchParams.get("workId");
    const n = state.danimePages[id];
    const h1 = n ? `<h1>作品${id}<span>（全${n}話）</span></h1>` : `<h1>作品${id}</h1>`;
    const ld = n ? `<script type="application/ld+json">{"@type":"TVSeries","numberOfEpisodes":"${n}"}</script>` : "";
    return send(200, `<html><head>${ld}</head><body>${h1}</body></html>`, "text/html");
  }
  send(404, "not found", "text/plain");
}

function run(port, outPath, args = [], extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        ...process.env,
        COMPLETION_SITE_URL: `http://localhost:${port}`,
        COMPLETION_SYOBOI_URL: `http://localhost:${port}/db.php`,
        COMPLETION_DANIME_URL: `http://localhost:${port}/animestore`,
        COMPLETION_OUT_PATH: outPath,
        COMPLETION_TODAY: "2026-10-19",
        COMPLETION_NOW: "2026-10-19T06:00:00.000Z",
        COMPLETION_RETRY_BASE_MS: "5",
        COMPLETION_PACE_MS: "0",
        ...extraEnv,
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

function baseFixture() {
  state.site = {
    "2026-summer": [
      { id: 101, title: "LV999の村人", syobocalTid: 7899, broadcastStartDate: "2026-07-02" },
      { id: 102, title: "Re:ゼロ 喪失編", syobocalTid: 7780, broadcastStartDate: "2026-04-08" },
    ],
    "2026-autumn": [
      { id: 201, title: "生徒会にも穴はある！", syobocalTid: 8005, broadcastStartDate: "2026-10-04" },
      { id: 202, title: "FX戦士くるみちゃん", syobocalTid: 8100, broadcastStartDate: "2026-10-01" },
      { id: 203, title: "Re:ゼロ 奪還編", syobocalTid: 7780, broadcastStartDate: "2026-10-01" },
      { id: 204, title: "うまゆる ふるげ～と！", syobocalTid: null, broadcastStartDate: "2026-10-02" },
      { id: 205, title: "わたしの幸せな結婚 特別篇", syobocalTid: 8200, broadcastStartDate: "2026-10-11" },
      { id: 206, title: "まだ始まらない作品", syobocalTid: null, broadcastStartDate: "2026-11-30" },
      { id: 207, title: "ガルパン", syobocalTid: 8300, broadcastStartDate: "2026-10-01" },
    ],
  };
  state.syoboi = {
    // 終フラグ（4）が複数チャンネルに。再放送（12）とDeletedは無視される。
    7899: [
      { count: "11", stTime: "2026-09-10 00:06:00" },
      { count: "12", flag: 4, stTime: "2026-09-17 00:06:00", stOffset: 360, chId: 7 },
      { count: "12", flag: 4, stTime: "2026-09-17 00:36:00", chId: 239 },
      { count: "12", flag: 12, stTime: "2026-09-01 00:00:00", chId: 9 },
      { count: "12", flag: 4, stTime: "2026-08-01 00:00:00", chId: 10, deleted: true },
    ],
    8005: [{ count: "3", stTime: "2026-10-18 00:30:00" }], // 放送中・終なし
    // 食い違い: ABEMAが#12に終、AT-Xに#13（終なし）→ 使わない
    8100: [
      { count: "12", flag: 4, stTime: "2026-12-17 22:00:00", chId: 239 },
      { count: "13", stTime: "2026-12-24 22:00:00", chId: 20 },
    ],
    7780: [{ count: "85", flag: 4, stTime: "2026-09-30 22:30:00" }], // 共有TID → 使わない
    8200: [{ count: "3", flag: 4, stTime: "2026-10-25 20:00:00" }], // 未来の終（事前に入っている）
    8300: [{ count: "12", flag: 4, stTime: "2026-12-24 23:30:00" }],
  };
  state.danimeList = {
    202603: [{ workId: "29103", title: "LV999の村人" }],
    202604: [
      { workId: "29285", title: "生徒会にも穴はある！【規制解除版】", latest: "2026-10-17T15:30:00.0Z" },
      { workId: "29286", title: "生徒会にも穴はある！【TV放送版】", latest: "2026-10-17T15:30:00.0Z" },
      { workId: "26308", title: "うまゆる" }, // 旧作（全24話）。部分一致で拾ってはいけない
      { workId: "29300", title: "わたしの幸せな結婚 特別篇", latest: "2026-10-25T11:00:00.0Z" },
      { workId: "29400", title: "まだ始まらない作品" },
    ],
  };
  state.danimePages = { 29103: 12, 29285: null, 29286: null, 26308: 24, 29300: null, 29400: 1 };
}

async function main() {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const dir = mkdtempSync(join(tmpdir(), "completion-"));
  const out = join(dir, "completion.json");

  try {
    // ── 1回目: ふつうの取得 ──
    baseFixture();
    let r = await run(port, out, ["2026-summer", "2026-autumn"]);
    assert.strictEqual(r.code, 0, r.out);
    let data = JSON.parse(readFileSync(out, "utf8"));
    const w = data.works;
    assert.deepStrictEqual(w["101"].syoboi, { tid: 7899, finalCount: 12, finalAt: "2026-09-16T15:12:00.000Z" });
    ok("終フラグの最も早い枠（StOffset込み）を採る", w["101"].syoboi.finalAt);
    ok("再放送・削除済みの枠の終は無視する");
    assert.ok(!w["202"], JSON.stringify(w["202"]));
    ok("終の話数より先の話がある作品は書かない（FX戦士）");
    assert.ok(!w["102"] && !w["203"]);
    ok("共有TIDの作品はどちらにも書かない（Re:ゼロ）");
    assert.ok(!w["201"]);
    ok("放送中（終なし・全N話なし）の作品は書かない");
    assert.ok(!w["204"]);
    ok("題名の部分一致で別作品の全N話を拾わない（うまゆる）");
    assert.ok(!w["206"]);
    ok("まだ始まっていない作品はdアニメを見ない");
    assert.strictEqual(w["205"].syoboi.finalAt, "2026-10-25T11:00:00.000Z");
    ok("未来の終も書く（サイトが時刻で切り替える）");
    assert.deepStrictEqual(w["101"].danime, { workIds: ["29103"], episodes: 12, finalAt: null, seenAt: "2026-10-19T06:00:00.000Z" });
    ok("dアニメの全N話を書く（時刻なし→初めて見た時刻）");
    assert.ok([...state.userAgents].every((ua) => ua.startsWith("animedia-completion (+https://")));
    ok("独自の User-Agent を送る", [...state.userAgents][0]);

    // ── 2回目: 何も変わらない → ファイルを書き換えない（updatedAtも含めて1バイトも） ──
    const before = readFileSync(out, "utf8");
    const mtime = statSync(out).mtimeMs;
    r = await run(port, out, ["2026-summer", "2026-autumn"], { COMPLETION_TODAY: "2026-10-20", COMPLETION_NOW: "2026-10-20T06:00:00.000Z" });
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(readFileSync(out, "utf8"), before);
    assert.strictEqual(statSync(out).mtimeMs, mtime);
    ok("中身が同じ日はファイルを書き換えない（＝デプロイしない）");

    // ── 3回目: 片方の版だけ完結 → まだ書かない。両方そろえば書く ──
    state.danimePages[29285] = 13;
    r = await run(port, out, ["2026-autumn"]);
    data = JSON.parse(readFileSync(out, "utf8"));
    assert.ok(!data.works["201"]);
    ok("【規制解除版】だけ全N話 → まだ完結にしない");
    state.danimePages[29286] = 13;
    r = await run(port, out, ["2026-autumn"]);
    data = JSON.parse(readFileSync(out, "utf8"));
    assert.deepStrictEqual(data.works["201"].danime.workIds, ["29285", "29286"]);
    assert.strictEqual(data.works["201"].danime.finalAt, "2026-10-17T15:30:00.000Z");
    ok("全部の版が全N話 → 完結（dアニメの最終話の時刻つき）");

    // ── 4回目: dアニメの表記が消えても記録は残す。未来の終が取り下げられたら消す ──
    state.danimePages[29103] = null;
    state.syoboi[8200] = [{ count: "3", stTime: "2026-10-25 20:00:00" }]; // 終が外れた
    r = await run(port, out, ["2026-summer", "2026-autumn"], { COMPLETION_NOW: "2026-10-21T06:00:00.000Z" });
    data = JSON.parse(readFileSync(out, "utf8"));
    assert.strictEqual(data.works["101"].danime.seenAt, "2026-10-19T06:00:00.000Z");
    ok("一度見えたdアニメの印は消さない（seenAtも変えない）");
    assert.ok(!data.works["205"]);
    ok("取り下げられた終は消す（印が無くなった作品ごと）");

    // ── 5回目: しょぼいカレンダーが恒久的に失敗 → 前回の印を残し、終了コードで知らせる ──
    state.syoboiStatus = 403;
    r = await run(port, out, ["2026-summer", "2026-autumn"]);
    data = JSON.parse(readFileSync(out, "utf8"));
    assert.strictEqual(r.code, 1, r.out);
    assert.ok(data.works["101"].syoboi && data.works["207"].syoboi);
    ok("取得に失敗したバッチの印は残す・失敗は終了コード1");
    state.syoboiStatus = null;

    // ── 6回目: 一時的な失敗（503）は再試行する ──
    state.syoboiOnce = [503, 429];
    state.syoboi[8300] = [{ count: "12", flag: 4, stTime: "2026-12-31 23:30:00" }]; // 延期
    r = await run(port, out, ["2026-autumn"]);
    data = JSON.parse(readFileSync(out, "utf8"));
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(data.works["207"].syoboi.finalAt, "2026-12-31T14:30:00.000Z");
    ok("503/429は再試行して取る（延期した終は上書き）");

    // ── 7回目: サイトが syobocalTid を返していない（デプロイ前）→ 落ちずに理由を出す ──
    const saved = JSON.parse(JSON.stringify(state.site));
    for (const items of Object.values(state.site)) for (const it of items) delete it.syobocalTid;
    r = await run(port, out, ["2026-autumn"]);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/syobocalTid を返していません/.test(r.out), r.out);
    data = JSON.parse(readFileSync(out, "utf8"));
    assert.ok(data.works["207"].syoboi);
    ok("syobocalTid が無い日は黙らず、前回の印を残す");
    state.site = saved;

    // ── 8回目: サイトが全部落ちている → ファイルを変えず失敗 ──
    const snapshot = readFileSync(out, "utf8");
    state.site = { "2026-summer": { status: 500 }, "2026-autumn": { status: 500 } };
    r = await run(port, out, ["2026-summer", "2026-autumn"]);
    assert.strictEqual(r.code, 1, r.out);
    assert.strictEqual(readFileSync(out, "utf8"), snapshot);
    ok("サイトが取れない日はファイルを変えない・終了コード1");

    // ── 9回目: 壊れたファイルを上書きしない ──
    writeFileSync(out, "{ broken");
    baseFixture();
    r = await run(port, out, ["2026-autumn"]);
    assert.strictEqual(r.code, 1);
    assert.strictEqual(readFileSync(out, "utf8"), "{ broken");
    ok("壊れたファイルは上書きせずに落ちる");

    // ── 10回目: 引数なし＝今期と前期 ──
    const fresh = join(dir, "fresh.json");
    baseFixture();
    r = await run(port, fresh, []);
    assert.ok(/対象クール: 2026-summer, 2026-autumn/.test(r.out), r.out);
    assert.ok(existsSync(fresh));
    ok("引数なしは今期と前期を見る");

    // ── 11回目: 前年より古いクールの記録は消す（サイトが読まないのに増え続けるため）。
    //    対象外のクールでも今年・前年の記録は残す（印は一度見えたら消さない＝dアニメ）。
    const aged = join(dir, "aged.json");
    writeFileSync(aged, JSON.stringify({ works: {
      9001: { title: "2年前の作品", season: "2024-autumn", syoboi: { tid: 1, finalCount: 12, finalAt: "2024-12-20T15:00:00.000Z" } },
      9002: { title: "前年の作品", season: "2025-autumn", danime: { workIds: ["1"], episodes: 12, finalAt: null, seenAt: "2025-12-25T00:00:00.000Z" } },
    } }));
    baseFixture();
    r = await run(port, aged, ["2026-autumn"]);
    data = JSON.parse(readFileSync(aged, "utf8"));
    assert.ok(!data.works["9001"] && data.works["9002"], JSON.stringify(Object.keys(data.works)));
    assert.strictEqual(data.works["205"].season, "2026-autumn");
    ok("前年より古いクールの記録は消し、前年までは残す");
  } finally {
    server.close();
  }
  console.log(`\n結果（完結の印の取得）: ${pass} 件OK`);
}

main().catch((e) => {
  console.error(`✗  ${e.message}`);
  process.exitCode = 1;
});
