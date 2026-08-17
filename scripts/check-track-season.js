#!/usr/bin/env node
"use strict";
// ───────────────────────────────────────────────────────────────
// scripts/track-season.js の回帰テスト（2026-08-12導入）。
//
// スタブのHTTPサーバー（Annictの /api/season と AniListのGraphQL の両方）を立てて
// track-season.js を**実際に子プロセスで動かし**、記録の不変条件を固定する。
// ネットワークには出ない。`track-season.js` を触ったら必ず実行する。
//
// ここで守りたいのは「壊れても気づけない」性質のもの:
//   - firstSeen が後から上書きされる → 遅れの計測が静かに嘘になる
//   - 初回観測に seeded 印が付かない → 初回の大量データを初出と誤読する
//   - 消えた作品を消してしまう → Annict側の一時的な編集で記録が飛ぶ
//   - 1情報源の失敗で全部が落ちる → 片方が不調な日の記録がまるごと消える
// ───────────────────────────────────────────────────────────────

const { createServer } = require("node:http");
// spawnSync ではなく spawn を使う（scripts/check-gsc.js・check-threads.js と同じ）。
// spawnSync はイベントループを止めるため、同じプロセス内で動かしているスタブサーバーが
// 応答できずデッドロックする。
const { spawn } = require("node:child_process");
const { readFileSync, rmSync, existsSync, mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert");

const SCRIPT = join(__dirname, "track-season.js");
const { targetSeasons } = require("./track-season.js");

let pass = 0;
function ok(label, extra = "") {
  pass++;
  console.log(`✓  ${label.padEnd(48)}${extra ? " → " + extra : ""}`);
}

// ── スタブサーバー ──────────────────────────────────────────
// state を書き換えると応答が変わる。1回だけ429を返す、といった指定もできる。
const state = {
  annict: { items: [] },
  anilist: { media: [] },
  annictStatus: 200,
  anilistStatus: 200,
  annictOnce: null, // 次の1回だけ返すHTTPステータス
  anilistGraphqlError: false,
  annictHits: 0,
};

function start() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url.startsWith("/api/season")) {
        state.annictHits++;
        if (state.annictOnce !== null) {
          const s = state.annictOnce;
          state.annictOnce = null;
          return send(s, { error: "stub" });
        }
        if (state.annictStatus !== 200) return send(state.annictStatus, { error: "stub" });
        return send(200, { items: state.annict.items });
      }
      // AniList GraphQL
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (state.anilistStatus !== 200) return send(state.anilistStatus, { errors: [{ message: "stub" }] });
        if (state.anilistGraphqlError) return send(200, { errors: [{ message: "Invalid season" }] });
        send(200, {
          data: { Page: { pageInfo: { hasNextPage: false }, media: state.anilist.media } },
        });
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// track-season.js を1回走らせる。today を渡してJSTの基準日を固定する。
function run(baseUrl, outPath, today) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, "2027", "winter"], {
      env: {
        ...process.env,
        TRACK_SITE_URL: baseUrl,
        TRACK_ANILIST_URL: `${baseUrl}/graphql`,
        TRACK_OUT_PATH: outPath,
        TRACK_TODAY: today,
        TRACK_RETRY_BASE_MS: "1", // 待ち時間は縮めてよい（判断の分岐は本番と同じ経路）
      },
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (c) => (stderr += c));
    child.stdout.on("data", (c) => (stdout += c));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr, stdout }));
  });
}

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

async function main() {
  console.log("── クールの決め方 ──");
  assert.deepStrictEqual(targetSeasons("2026-08-12"), ["2026-summer", "2026-autumn", "2027-winter"]);
  ok("8月 → 夏・秋・翌冬", "年またぎを含む");
  assert.deepStrictEqual(targetSeasons("2026-11-30"), ["2026-autumn", "2027-winter", "2027-spring"]);
  ok("11月 → 秋・翌冬・翌春", "年またぎ2つ");
  assert.deepStrictEqual(targetSeasons("2026-01-05"), ["2026-winter", "2026-spring", "2026-summer"]);
  ok("1月 → 冬・春・夏", "年内で収まる");

  const server = await start();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const dir = mkdtempSync(join(tmpdir(), "track-season-"));
  const out = join(dir, "first-seen.json");

  try {
    console.log("\n── 初回観測（種まき）──");
    state.annict.items = [
      { id: 1, title: "作品A", watchers: 100, broadcastStartDate: "2027-01-05", services: [{ key: "d_anime" }] },
      { id: 2, title: "作品B", watchers: 50, broadcastStartDate: null, services: [] },
    ];
    state.anilist.media = [
      { id: 900, title: { native: "作品A" }, startDate: { year: 2027, month: 1, day: 5 }, popularity: 300 },
    ];
    let r = await run(baseUrl, out, "2026-08-12");
    assert.strictEqual(r.status, 0, r.stderr);
    let store = read(out);
    assert.strictEqual(store.sources.annict["2027-winter"].works["1"].seeded, true);
    assert.strictEqual(store.sources.annict["2027-winter"].works["1"].services.d_anime.seeded, true);
    assert.strictEqual(store.sources.anilist["2027-winter"].works["900"].seeded, true);
    ok("初回は seeded 印が付く", "作品もサービスも");
    assert.strictEqual(store.sources.annict["2027-winter"].works["1"].firstSeen, "2026-08-12");
    assert.strictEqual(store.sources.annict["2027-winter"].daily.length, 1);
    ok("初回の日次行が1本できる", "作品2件・配信あり1件");

    console.log("\n── 同じ日にもう一度走らせる ──");
    r = await run(baseUrl, out, "2026-08-12");
    assert.strictEqual(r.status, 0, r.stderr);
    store = read(out);
    assert.strictEqual(store.sources.annict["2027-winter"].daily.length, 1);
    ok("日次行が二重にならない", "scheduleの重複起動に耐える");

    console.log("\n── 翌日: 作品とサービスが増える ──");
    state.annict.items = [
      // 作品Aに配信サービスが1つ増える
      {
        id: 1,
        title: "作品A",
        watchers: 120,
        broadcastStartDate: "2027-01-05",
        services: [{ key: "d_anime" }, { key: "unext" }],
      },
      // 作品Bは消える（Annict側の一時的な編集を模す）
      { id: 3, title: "作品C", watchers: 10, broadcastStartDate: null, services: [] },
    ];
    state.anilist.media = [
      { id: 900, title: { native: "作品A" }, startDate: { year: 2027, month: 1, day: 5 }, popularity: 320 },
      { id: 901, title: { romaji: "Sakuhin C" }, startDate: { year: 2027, month: 1, day: 9 }, popularity: 40 },
    ];
    r = await run(baseUrl, out, "2026-08-13");
    assert.strictEqual(r.status, 0, r.stderr);
    store = read(out);
    const annictW = store.sources.annict["2027-winter"].works;
    assert.strictEqual(annictW["3"].firstSeen, "2026-08-13");
    assert.strictEqual(annictW["3"].seeded, undefined);
    ok("2日目に現れた作品は seeded 無し", "＝これは本当の初出として使える");
    assert.strictEqual(annictW["1"].services.unext.firstSeen, "2026-08-13");
    assert.strictEqual(annictW["1"].services.unext.seeded, undefined);
    ok("後から増えたサービスの初出日が入る", "配信の遅れが測れる");
    assert.strictEqual(annictW["1"].firstSeen, "2026-08-12");
    ok("既存の firstSeen は上書きされない", "作品Aは初日のまま");
    assert.ok(annictW["2"], "消えた作品Bの記録が残っていること");
    assert.strictEqual(annictW["2"].firstSeen, "2026-08-12");
    ok("消えた作品の記録を消さない", "揺れを持ち込まない");
    assert.strictEqual(annictW["1"].rank, 120);
    ok("変動する値（注目度）は更新される", "firstSeen だけが不変");
    assert.strictEqual(store.sources.anilist["2027-winter"].works["901"].title, "Sakuhin C");
    ok("AniList側も同じ規則で記録される", "nativeが無ければromaji");

    console.log("\n── 一時的な失敗は再試行する ──");
    state.annictOnce = 429;
    const before = state.annictHits;
    r = await run(baseUrl, out, "2026-08-14");
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(state.annictHits >= before + 2, "429のあと再試行していること");
    ok("429 は指数バックオフで再試行する", "恒久エラーと区別する");

    console.log("\n── 恒久的な失敗は即座に失敗させる（片方だけ）──");
    state.annictStatus = 400;
    r = await run(baseUrl, out, "2026-08-15");
    assert.strictEqual(r.status, 1, "失敗として終了コード1を返すこと");
    assert.ok(r.stderr.includes("annict/2027-winter"), "どれが失敗したか出すこと");
    store = read(out);
    const anilistDaily = store.sources.anilist["2027-winter"].daily;
    assert.ok(
      anilistDaily.some((d) => d.date === "2026-08-15"),
      "Annictが落ちてもAniList側は記録されること"
    );
    ok("1情報源の失敗で残りを巻き添えにしない", "AniList側は記録が続く");
    assert.strictEqual(store.updatedAt, "2026-08-15");
    ok("部分成功でも書き出す", "取れた分を捨てない");
    state.annictStatus = 200;

    console.log("\n── 200で返るGraphQLエラーを失敗として扱う ──");
    state.anilistGraphqlError = true;
    r = await run(baseUrl, out, "2026-08-16");
    assert.strictEqual(r.status, 1, "GraphQLエラーは失敗にすること");
    assert.ok(r.stderr.includes("anilist/2027-winter"));
    ok("HTTP 200 のGraphQLエラーを見逃さない", "probe-series.ts と同じ扱い");
    state.anilistGraphqlError = false;

    console.log("\n── 壊れた記録ファイルを黙って上書きしない ──");
    require("node:fs").writeFileSync(out, "{ これはJSONではない");
    r = await run(baseUrl, out, "2026-08-17");
    assert.strictEqual(r.status, 1, "読めないファイルは失敗にすること");
    assert.ok(r.stderr.includes("手で確認"), "手当てを促すこと");
    ok("壊れたファイルを空で上書きしない", "積み上げた記録を守る");

    console.log(`\n${pass} 件すべてOK`);
  } finally {
    server.close();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("\n✗ テストが失敗しました:\n", e);
  process.exit(1);
});
