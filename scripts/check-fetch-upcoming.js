#!/usr/bin/env node
"use strict";
// ───────────────────────────────────────────────────────────────
// scripts/fetch-upcoming.js の回帰テスト（2026-08-17導入）。
//
// スタブのHTTPサーバー（サイトの公開API /api/season と AniListのGraphQL の両方）を
// 立てて fetch-upcoming.js を**実際に子プロセスで動かし**、突き合わせ・日付の扱いの
// 不変条件を固定する。scripts/check-track-season.js と同じ形式（HTTPスタブ→子プロセス
// 実行→書き出されたJSONを検証、✓/✗ ログ、最後に失敗数でexit）を踏襲する。
// ネットワークには出ない。`fetch-upcoming.js` か `lib/upcoming-match.js` を触ったら
// 必ず実行する。
//
// ここで守りたいのは「壊れても気づけない」性質のもの:
//   - malAnimeId と idMal が一致するのにタイトル差で採用されない → 一番強い手段が
//     効いていない
//   - 突き合わせが食い違ったのに片方を採用してしまう → 無関係な作品の日付が
//     サイトに出る事故になる
//   - day が無い予定を無理に day 精度で出してしまう → 実在しない日付を主張する
//   - 過去の予定日を「これから」として出してしまう → 誤誘導になる
//   - 今回のスタブに含まれない作品の記録を消してしまう → AniList側の一時的な取得
//     失敗・編集でサイトの表示が消えたり戻ったりする
//   - 1クールの失敗で他クールぶんまで書き出されなくなる → 片方が不調な日の記録が
//     まるごと消える
//   - 429/503 のような一時的な失敗で再試行せず諦めてしまう
//   - 出力JSON（リポジトリにコミットされる）に鍵やトークンに類する語が混入する
// ───────────────────────────────────────────────────────────────

const { createServer } = require("node:http");
// spawnSync ではなく spawn を使う（scripts/check-track-season.js と同じ理由。
// spawnSync はイベントループを止めるため、同じプロセス内のスタブサーバーが
// 応答できずデッドロックする）。
const { spawn } = require("node:child_process");
const { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert");

const SCRIPT = join(__dirname, "fetch-upcoming.js");

let pass = 0;
function ok(label, extra = "") {
  pass++;
  console.log(`✓  ${label.padEnd(48)}${extra ? " → " + extra : ""}`);
}

// AniListのクエリ変数 season（"SUMMER"等）→ 本サイトのクール表記（"summer"等）。
// fetch-upcoming.js の ANILIST_SEASON の逆引き。
const REVERSE_SEASON = { WINTER: "winter", SPRING: "spring", SUMMER: "summer", FALL: "autumn" };

// ── スタブサーバー ──────────────────────────────────────────
// state.site / state.anilist はクール文字列（例: "2026-autumn"）ごとに応答を持てる。
//   { status }        … 常にそのHTTPステータスを返す（恒久的な失敗を模す）
//   { once: [429,503] } … 先頭から1回ずつ消費してそのステータスを返し、尽きたら正常応答
//   { items } / { media } … 正常応答の中身
const state = { site: {}, anilist: {}, siteHits: {}, anilistHits: {} };

function resetState() {
  state.site = {};
  state.anilist = {};
  state.siteHits = {};
  state.anilistHits = {};
}

function start() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/season")) {
        const year = url.searchParams.get("year");
        const season = url.searchParams.get("season");
        const seasonStr = `${year}-${season}`;
        state.siteHits[seasonStr] = (state.siteHits[seasonStr] || 0) + 1;
        const cfg = state.site[seasonStr] || { items: [] };
        if (cfg.once && cfg.once.length) return send(cfg.once.shift(), { error: "stub" });
        if (cfg.status && cfg.status !== 200) return send(cfg.status, { error: "stub" });
        return send(200, { items: cfg.items || [] });
      }
      // AniList GraphQL
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const vars = body.variables || {};
        const seasonName = REVERSE_SEASON[vars.season] || "unknown";
        const seasonStr = `${vars.seasonYear}-${seasonName}`;
        state.anilistHits[seasonStr] = (state.anilistHits[seasonStr] || 0) + 1;
        const cfg = state.anilist[seasonStr] || { media: [] };
        if (cfg.once && cfg.once.length) return send(cfg.once.shift(), { errors: [{ message: "stub" }] });
        if (cfg.status && cfg.status !== 200) return send(cfg.status, { errors: [{ message: "stub" }] });
        if (cfg.graphqlError) return send(200, { errors: [{ message: "stub graphql error" }] });
        send(200, {
          data: { Page: { pageInfo: { hasNextPage: false }, media: cfg.media || [] } },
        });
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// fetch-upcoming.js を1回走らせる。extraArgs を渡すと ["2026","autumn"] のように
// クールを明示できる（省略すると今日の日付から自動で3クールを対象にする）。
function run(baseUrl, outPath, today, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...extraArgs], {
      env: {
        ...process.env,
        UPCOMING_SITE_URL: baseUrl,
        UPCOMING_ANILIST_URL: `${baseUrl}/graphql`,
        UPCOMING_OUT_PATH: outPath,
        UPCOMING_TODAY: today,
        UPCOMING_RETRY_BASE_MS: "15", // 待ち時間は縮めてよい（判断の分岐は本番と同じ経路）
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
  const server = await start();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  // 出力先はリポジトリの外（一時ディレクトリ）。content/works/autoSchedule.json は
  // 絶対に触らない。
  const dir = mkdtempSync(join(tmpdir(), "fetch-upcoming-check-"));

  try {
    // ── ケース1〜4: 突き合わせと日付の扱い（1回の実行でまとめて検証）──────
    console.log("── 突き合わせ／日付の扱い ──");
    resetState();
    const today1 = "2026-08-17";
    const season1 = "2026-autumn";
    state.site[season1] = {
      items: [
        // ケース1: malAnimeIdが一致（タイトルは違う）
        { id: 111, title: "サイト側タイトルA", malAnimeId: 555, broadcastStartDate: null, releaseDate: null, officialSiteUrl: null },
        // ケース2: malは作品X、タイトルは作品Yを指す（食い違い）
        { id: 222, title: "作品Bタイトル", malAnimeId: 556, broadcastStartDate: null, releaseDate: null, officialSiteUrl: null },
        // ケース3: AniList側のstartDateがdayを持たない
        { id: 333, title: "月精度作品", malAnimeId: 557, broadcastStartDate: null, releaseDate: null, officialSiteUrl: null },
        // ケース4: 予定日が基準日より過去
        { id: 444, title: "過去作品", malAnimeId: 558, broadcastStartDate: null, releaseDate: null, officialSiteUrl: null },
      ],
    };
    state.anilist[season1] = {
      media: [
        { id: 9001, idMal: 555, title: { native: "アニリスト側タイトルA", romaji: null }, startDate: { year: 2026, month: 10, day: 5 }, externalLinks: [] },
        { id: 9002, idMal: 556, title: { native: "作品Bタイトル別", romaji: null }, startDate: { year: 2026, month: 10, day: 6 }, externalLinks: [] },
        { id: 9003, idMal: null, title: { native: "作品Bタイトル", romaji: null }, startDate: { year: 2026, month: 10, day: 7 }, externalLinks: [] },
        { id: 9004, idMal: 557, title: { native: "月精度作品", romaji: null }, startDate: { year: 2026, month: 11, day: null }, externalLinks: [] },
        { id: 9005, idMal: 558, title: { native: "過去作品", romaji: null }, startDate: { year: 2026, month: 7, day: 1 }, externalLinks: [] },
      ],
    };
    const out1 = join(dir, "case1.json");
    let r = await run(baseUrl, out1, today1, ["2026", "autumn"]);
    assert.strictEqual(r.status, 0, r.stderr);
    let store = read(out1);

    assert.strictEqual(store.works["111"].matchedBy, "mal");
    assert.strictEqual(store.works["111"].date, "2026-10-05");
    assert.strictEqual(store.works["111"].precision, "day");
    ok("MAL優先の突き合わせ", "タイトルが違ってもmalAnimeId一致で採用・matchedBy=mal");

    assert.strictEqual(store.works["222"], undefined);
    ok("食い違いは採用しない", "malと title/url が別のAniList作品を指したら不採用");

    assert.strictEqual(store.works["333"].precision, "month");
    assert.strictEqual(store.works["333"].date, "2026-11");
    assert.ok(!("weekday" in store.works["333"]), "weekdayを持たないこと");
    assert.ok(!("time" in store.works["333"]), "timeを持たないこと");
    ok("月精度: dayが無いときはprecision:month", "weekday/timeは出さない");

    assert.strictEqual(store.works["444"], undefined);
    ok("過去の予定日は落とす", "UPCOMING_TODAYより前の日付は出力に現れない");

    // ── ケース5: 既存エントリを消さない ──────────────────────
    console.log("\n── 既存エントリの保持 ──");
    const out2 = join(dir, "case2-preserve.json");
    const previous = {
      updatedAt: "2026-08-10",
      source: "AniList (https://anilist.co) — scripts/fetch-upcoming.js が生成。手で編集しない",
      works: {
        "999": {
          kind: "broadcast",
          date: "2026-09-01",
          precision: "day",
          sourceUrl: "https://anilist.co/anime/1",
          fetchedDate: "2026-08-10",
          matchedBy: "mal",
          title: "温存作品",
        },
      },
    };
    writeFileSync(out2, JSON.stringify(previous, null, 2));
    resetState();
    const season2 = "2026-winter"; // 今回のスタブ応答には対象作品が1件も無いクール
    state.site[season2] = { items: [] };
    state.anilist[season2] = { media: [] };
    r = await run(baseUrl, out2, "2026-08-17", ["2026", "winter"]);
    assert.strictEqual(r.status, 0, r.stderr);
    store = read(out2);
    assert.ok(store.works["999"], "前回分の作品が残っていること");
    assert.strictEqual(store.works["999"].date, "2026-09-01");
    ok("既存エントリを消さない", "今回のスタブ応答に含まれない作品IDが残る");

    // ── ケース6: 1情報源の失敗で残りを巻き添えにしない ────────────
    console.log("\n── 1クールの失敗を他クールへ波及させない ──");
    resetState();
    const today3 = "2026-08-17"; // targetSeasons → 2026-summer / 2026-autumn / 2027-winter
    state.site["2026-summer"] = {
      items: [{ id: 601, title: "夏の作品", malAnimeId: 700, broadcastStartDate: null, releaseDate: null, officialSiteUrl: null }],
    };
    state.anilist["2026-summer"] = {
      media: [{ id: 9601, idMal: 700, title: { native: "夏の作品" }, startDate: { year: 2026, month: 9, day: 1 }, externalLinks: [] }],
    };
    state.site["2026-autumn"] = { status: 500 }; // このクールだけ常に失敗させる
    state.anilist["2026-autumn"] = { media: [] };
    state.site["2027-winter"] = {
      items: [{ id: 602, title: "冬の作品", malAnimeId: 701, broadcastStartDate: null, releaseDate: null, officialSiteUrl: null }],
    };
    state.anilist["2027-winter"] = {
      media: [{ id: 9602, idMal: 701, title: { native: "冬の作品" }, startDate: { year: 2027, month: 1, day: 10 }, externalLinks: [] }],
    };
    const out3 = join(dir, "case3-partial-failure.json");
    r = await run(baseUrl, out3, today3); // 引数なし＝自動で3クールを対象にする
    assert.strictEqual(r.status, 1, "1クールでも失敗があれば終了コードは0以外");
    store = read(out3);
    assert.ok(store.works["601"], "失敗しなかったクール（夏）は書き出される");
    assert.ok(store.works["602"], "失敗しなかったクール（翌冬）は書き出される");
    ok("1情報源の失敗で残りを巻き添えにしない", "500のクール以外は書き出され、終了コードは1");

    // ── ケース7: 一時エラーの再試行 ────────────────────────
    console.log("\n── 一時エラーの再試行 ──");
    resetState();
    const season4 = "2026-autumn";
    state.site[season4] = {
      once: [429, 503],
      items: [{ id: 701, title: "再試行作品", malAnimeId: 800, broadcastStartDate: null, releaseDate: null, officialSiteUrl: null }],
    };
    state.anilist[season4] = {
      media: [{ id: 9701, idMal: 800, title: { native: "再試行作品" }, startDate: { year: 2026, month: 10, day: 20 }, externalLinks: [] }],
    };
    const out4 = join(dir, "case4-retry.json");
    r = await run(baseUrl, out4, "2026-08-17", ["2026", "autumn"]);
    assert.strictEqual(r.status, 0, r.stderr);
    store = read(out4);
    assert.ok(store.works["701"], "429→503のあと最終的に成功していること");
    assert.ok((state.siteHits[season4] || 0) >= 3, "429と503のあと3回目で成功していること");
    ok("一時エラー(429/503)は指数バックオフで再試行して成功する", `site hits=${state.siteHits[season4]}`);

    // ── ケース8: 鍵やトークンが出力に混入しない ────────────────
    console.log("\n── 秘密情報の混入検査 ──");
    for (const [name, path] of [["case1", out1], ["case3", out3], ["case4", out4]]) {
      const text = readFileSync(path, "utf8");
      for (const word of ["token", "Token", "Bearer", "Authorization"]) {
        assert.ok(!text.includes(word), `${name} に "${word}" が含まれていないこと`);
      }
    }
    ok("出力JSONに鍵やトークンに類する語が混入しない", "token/Token/Bearer/Authorization");

    console.log(`\n${pass} 件すべてOK`);
  } finally {
    server.close();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("\n✗ テストが失敗しました:\n", e);
  // process.exit() ではなく exitCode（Windows では書き込み途中のstdoutを巻き込んで
  // 終了コードが 0xC0000409 になる。scripts/check.ts 末尾の注記と同じ罠）。
  process.exitCode = 1;
});
