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
//   - db.php の「HTTP 200 で本文にエラー」「5,000行の黙った打ち切り」を「終なし」と読んで印を消す
//   - Annictで紐付けが外れた／付け替わったTIDの古い印を残す
//   - 項目の欠落・ページの形の変化を「完結した作品が無い日」と同じに見せる（黙って緑）
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
  syoboiBodyCode: null, // HTTP 200 のまま本文で返す結果コード（db.php の実際の挙動）
  syoboiRowCap: null, // この行数で黙って打ち切る（db.php は5,000行）
  danimeMarkupChanged: false, // 作品ページの h1 の形が変わった
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
    if (state.syoboiBodyCode) {
      return send(200, `<?xml version="1.0" encoding="UTF-8"?><ProgLookupResponse><Result><Code>${state.syoboiBodyCode}</Code><Message>err</Message></Result></ProgLookupResponse>`, "text/xml");
    }
    const tids = (u.searchParams.get("TID") || "").split(",").map(Number);
    let rows = tids.flatMap((t) => (state.syoboi[t] || []).map((p) => prog(t, p)));
    if (state.syoboiRowCap && rows.length > state.syoboiRowCap) rows = rows.slice(0, state.syoboiRowCap);
    return send(200, `<?xml version="1.0" encoding="UTF-8"?><ProgLookupResponse><ProgItems>${rows.join("")}</ProgItems><Result><Code>200</Code></Result></ProgLookupResponse>`, "text/xml");
  }
  if (u.pathname === "/animestore/rest/WS000118") {
    const list = state.danimeList[u.searchParams.get("cours")];
    if (!list) return send(200, { resultCd: "21", data: null });
    return send(200, {
      resultCd: "00",
      data: {
        workList: list.map((w) => ({
          workId: w.workId,
          // 本物の一覧は latestPartPublicDate を全作品 null で返す（2026-10-19実測）
          workInfo: { workTitle: w.title, latestPartPublicDate: null },
        })),
      },
    });
  }
  if (u.pathname === "/animestore/ci_pc") {
    state.danimePageHits++;
    const id = u.searchParams.get("workId");
    const n = state.danimePages[id];
    const tag = state.danimeMarkupChanged ? `<h1 class="p-title">` : `<h1>`;
    const h1 = n ? `${tag}作品${id}<span>（全${n}話）</span></h1>` : `${tag}作品${id}</h1>`;
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
      { id: 208, title: "ブルーロック", syobocalTid: null, broadcastStartDate: "2026-10-04" },
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
      { workId: "29600", title: "ブルーロック 総集編" }, // Annictの題名を含むだけ。拾ってはいけない
    ],
  };
  state.danimePages = { 29103: 12, 29285: null, 29286: null, 26308: 24, 29300: null, 29400: 1, 29600: 1 };
  state.syoboiBodyCode = null;
  state.syoboiRowCap = null;
  state.danimeMarkupChanged = false;
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
    assert.deepStrictEqual(w["101"].syoboi, { tid: 7899, finalCount: 12, finalAt: "2026-09-16T15:12:00.000Z", prevAt: "2026-09-09T15:06:00.000Z" });
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
    assert.ok(!w["208"], JSON.stringify(w["208"]));
    ok("dアニメ側がAnnictの題名を含むだけ（総集編）でも拾わない");
    assert.ok(!w["206"]);
    ok("まだ始まっていない作品はdアニメを見ない");
    assert.strictEqual(w["205"].syoboi.finalAt, "2026-10-25T11:00:00.000Z");
    ok("未来の終も書く（サイトが時刻で切り替える）");
    assert.deepStrictEqual(w["101"].danime, { workIds: ["29103"], episodes: 12, seenAt: "2026-10-19T06:00:00.000Z" });
    ok("dアニメの全N話を書く（時刻は初めて見た時刻）");
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
    assert.strictEqual(data.works["201"].danime.episodes, 13);
    ok("全部の版が全N話 → 完結");

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

    // ── 7回目: サイトが syobocalTid という項目ごと返していない → 前回の印を残し、失敗として知らせる
    //    （黙って緑のまま最終回の印が更新されなくなるのを防ぐ）
    const saved = JSON.parse(JSON.stringify(state.site));
    for (const items of Object.values(state.site)) for (const it of items) delete it.syobocalTid;
    r = await run(port, out, ["2026-autumn"]);
    assert.strictEqual(r.code, 1, r.out);
    assert.ok(/syobocalTid を返していません/.test(r.out), r.out);
    data = JSON.parse(readFileSync(out, "utf8"));
    assert.ok(data.works["207"].syoboi);
    ok("syobocalTid の項目が無い日は前回の印を残し・終了コード1");
    state.site = saved;

    // ── 7-2: HTTP 200 でも本文の結果コードがエラー → 印を消さず失敗として知らせる ──
    state.syoboiBodyCode = "500";
    r = await run(port, out, ["2026-autumn"]);
    data = JSON.parse(readFileSync(out, "utf8"));
    assert.strictEqual(r.code, 1, r.out);
    assert.ok(data.works["207"]?.syoboi, JSON.stringify(data.works["207"]));
    ok("本文の結果コードがエラー → 印を消さない・終了コード1");
    state.syoboiBodyCode = null;

    // ── 7-3: 5,000行の打ち切り → 半分に割って取り直す。1件でも打ち切られるTIDは前回の印を残す ──
    state.syoboiRowCap = 3; // 207（ガルパン）以外の行で埋まるように、テスト用に小さくする
    state.syoboi[8300] = [
      { count: "10", stTime: "2026-12-10 23:30:00" },
      { count: "11", stTime: "2026-12-17 23:30:00" },
      { count: "12", flag: 4, stTime: "2026-12-24 23:30:00" },
      { count: "12", stTime: "2026-12-25 23:30:00", chId: 2 },
    ];
    r = await run(port, out, ["2026-autumn"], { COMPLETION_ROW_CAP: "3" });
    data = JSON.parse(readFileSync(out, "utf8"));
    assert.strictEqual(r.code, 1, r.out);
    assert.strictEqual(data.works["207"].syoboi.finalAt, "2026-12-31T14:30:00.000Z", "打ち切られたTIDの前回の印が残る");
    ok("行数の上限で打ち切られたTIDは前回の印を残す・終了コード1");
    state.syoboiRowCap = null;
    state.syoboi[8300] = [{ count: "12", flag: 4, stTime: "2026-12-31 23:30:00" }];

    // ── 7-4: Annictで紐付けが外れた／付け替わった → 前回の印を消す（別作品の印かもしれない） ──
    const tr = join(dir, "tid-change.json");
    baseFixture();
    r = await run(port, tr, ["2026-autumn"]);
    data = JSON.parse(readFileSync(tr, "utf8"));
    assert.ok(data.works["207"].syoboi);
    state.site["2026-autumn"].find((it) => it.id === 207).syobocalTid = null;
    r = await run(port, tr, ["2026-autumn"]);
    data = JSON.parse(readFileSync(tr, "utf8"));
    assert.ok(!data.works["207"], JSON.stringify(data.works["207"]));
    ok("紐付けが外れたTIDの印は消す");

    // ── 7-5: 単独だったTIDが後から共有になったら、前の記録を消す（Re:ゼロ 喪失編→奪還編） ──
    const sh = join(dir, "shared.json");
    baseFixture();
    state.site = { "2026-summer": [{ id: 102, title: "Re:ゼロ 喪失編", syobocalTid: 7780, broadcastStartDate: "2026-04-08" }], "2026-autumn": [] };
    r = await run(port, sh, ["2026-summer", "2026-autumn"]);
    data = JSON.parse(readFileSync(sh, "utf8"));
    assert.ok(data.works["102"]?.syoboi, JSON.stringify(data.works));
    baseFixture();
    r = await run(port, sh, ["2026-summer", "2026-autumn"]);
    data = JSON.parse(readFileSync(sh, "utf8"));
    assert.ok(!data.works["102"]?.syoboi && !data.works["203"]?.syoboi, JSON.stringify(data.works["102"]));
    ok("単独だったTIDが共有になったら前の記録を消す");

    // ── 7-6: 題名がAnnictで変わっても書き換えない（サイトは読まない＝デプロイを起こさない） ──
    const ti = join(dir, "title.json");
    baseFixture();
    r = await run(port, ti, ["2026-autumn"]);
    const titleBefore = readFileSync(ti, "utf8");
    state.site["2026-autumn"].find((it) => it.id === 207).title = "ガールズ＆パンツァー";
    r = await run(port, ti, ["2026-autumn"]);
    assert.strictEqual(readFileSync(ti, "utf8"), titleBefore);
    ok("題名だけの変化ではファイルを書き換えない");

    // ── 7-7: dアニメの作品ページの形が変わった → 「完結が無い日」と区別して失敗にする ──
    const mk = join(dir, "markup.json");
    baseFixture();
    state.danimeMarkupChanged = true;
    r = await run(port, mk, ["2026-autumn"]);
    assert.strictEqual(r.code, 1, r.out);
    assert.ok(/ページの形が変わった/.test(r.out), r.out);
    ok("dアニメのページの形が変わったら終了コード1");
    state.danimeMarkupChanged = false;
    baseFixture();

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
      9002: { title: "前年の作品", season: "2025-autumn", danime: { workIds: ["1"], episodes: 12, seenAt: "2025-12-25T00:00:00.000Z" } },
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
