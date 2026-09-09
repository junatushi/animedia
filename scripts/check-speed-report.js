#!/usr/bin/env node
// scripts/speed-report.js の回帰テスト（2026-09-09導入）。
//
// このレポートは**落ちるのではなく静かに間違った判定を出す**方向に壊れる。
// 「目標を満たしている」と書き続けるレポートは、遅くなったことを隠すので
// 無いより悪い。仮のディレクトリを渡して実際に走らせ、判定が変わることを固定する。
// ネットワークには出ない。`scripts/speed-report.js` を触ったら必ず実行する。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "speed-report.js");
let ng = 0;

function run(speed, site) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speedrep-"));
  const sd = path.join(dir, "speed");
  const td = path.join(dir, "site");
  fs.mkdirSync(sd);
  fs.mkdirSync(td);
  for (const [name, json] of Object.entries(speed)) {
    fs.writeFileSync(path.join(sd, name), typeof json === "string" ? json : JSON.stringify(json));
  }
  for (const [name, json] of Object.entries(site)) {
    fs.writeFileSync(path.join(td, name), JSON.stringify(json));
  }
  return execFileSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, SPEED_DIR: sd, SITE_DIR: td },
  });
}

function check(label, cond, detail = "") {
  if (!cond) ng++;
  console.log(`${cond ? "✓" : "✗"}  ${label.padEnd(52)} ${cond ? "OK" : `NG ${detail}`}`);
}

const page = (face, over) => ({
  face,
  routePath: `/${face}`,
  path: `/${face}`,
  runs: 3,
  lcp: over ? 2400 : 900,
  fcp: 500,
  ttfb: 100,
  load: 1200,
  blockingMs: 200,
  domNodes: 1000,
  loadKB: 150,
  scrollKB: 0,
  scrollPrefetch: 0,
});
const snap = (base, pages) => ({
  fetchedAt: "2026-09-09T00:00:00Z",
  base,
  conditions: { cpuThrottle: 4, netKbps: 1600, latencyMs: 150, runs: 3 },
  skipped: [],
  failures: [],
  pages,
});
const PROD = "https://example.test";

console.log("── 表示速度レポートの回帰テスト ──");

// ① 目標を超えた面は ✗ と書く（超えていない面は書かない）。
{
  const out = run({ "2026-09-08.json": snap(PROD, [page("anime", true), page("season", false)]) }, {});
  check("目標超過の面を ✗ にする", /anime[\s\S]*?✗ 目標/.test(out), out.slice(0, 200));
  check("目標内の面は ✗ にしない", /season.*✓/.test(out));
  check("満たした面の数を数える", /2 面中 1 面が目標/.test(out), out.match(/\d+ 面中 \d+ 面[^\n]*/)?.[0] ?? "");
}

// ② 遅くなったことを前回比で出す（改善と悪化の符号が逆になっていないこと）。
{
  const out = run(
    {
      "2026-09-07.json": snap(PROD, [{ ...page("anime", false), lcp: 800 }]),
      "2026-09-08.json": snap(PROD, [{ ...page("anime", false), lcp: 1000 }]),
    },
    {}
  );
  check("遅くなったら前回比が + になる", /\+200ms/.test(out), out.match(/anime[^\n]*/)?.[0] ?? "");
}
{
  const out = run(
    {
      "2026-09-07.json": snap(PROD, [{ ...page("anime", false), lcp: 1000 }]),
      "2026-09-08.json": snap(PROD, [{ ...page("anime", false), lcp: 800 }]),
    },
    {}
  );
  check("速くなったら前回比が − になる", /-200ms/.test(out), out.match(/anime[^\n]*/)?.[0] ?? "");
}

// ③ 計測元(base)が違う断面を比較に混ぜない（localhost の値で本番を語らない）。
{
  const out = run(
    {
      "2026-09-07.json": snap("http://localhost:3100", [{ ...page("anime", false), lcp: 100 }]),
      "2026-09-08.json": snap(PROD, [{ ...page("anime", false), lcp: 1000 }]),
    },
    {}
  );
  check("別の計測元を前回比に使わない", !/-900ms|\+900ms/.test(out), out.match(/anime[^\n]*/)?.[0] ?? "");
  check("混ざっていることを告げる", /別の計測元の断面/.test(out));
}

// ④ 先読みの復活（㊴）を警告する。
{
  const out = run(
    { "2026-09-08.json": snap(PROD, [{ ...page("anime", false), scrollPrefetch: 42, scrollKB: 500 }]) },
    {}
  );
  check("スクロール中の先読みを警告する", /先読みが飛んでいる面[\s\S]*anime\(42件/.test(out));
}
{
  const out = run({ "2026-09-08.json": snap(PROD, [page("anime", false)]) }, {});
  check("先読み0件では警告しない", !/先読みが飛んでいる面/.test(out));
}

// ⑤ RUM は件数が足りないうちは判定しない（少数からの一般化を再発させない）。
{
  const out = run(
    { "2026-09-08.json": snap(PROD, [page("anime", false)]) },
    { "2026-09-08.json": { windowDays: 30, vitals: [{ face: "anime", metric: "LCP", p75: 5000, count: 3 }] } }
  );
  check("件数不足なら LCP を判定しない", /件数不足/.test(out) && !/5000[\s\S]{0,40}✗ 目標/.test(out));
  check("判定できないと明言する", /まだ判定できない/.test(out));
}
{
  const out = run(
    { "2026-09-08.json": snap(PROD, [page("anime", false)]) },
    { "2026-09-08.json": { windowDays: 30, vitals: [{ face: "anime", metric: "LCP", p75: 5000, count: 50 }] } }
  );
  check("件数が足りれば遅さを ✗ にする", /5000[\s\S]{0,20}✗ 目標/.test(out), out.match(/anime\s+LCP[^\n]*/)?.[0] ?? "");
  check("足りたら「判定できない」と言わない", !/まだ判定できない/.test(out));
}

// ⑥ データが無いときに「速い」と読める出力を出さない。
{
  const out = run({}, {});
  check("合成計測ゼロ件を明示する", /まだデータが無い/.test(out));
  check("ゼロ件で目標達成と書かない", !/面が目標/.test(out));
}

// ⑦ 壊れたJSONで全部を止めない（1日ぶん読めなくても残りを出す）。
{
  const out = run({ "2026-09-07.json": "{壊れている", "2026-09-08.json": snap(PROD, [page("anime", false)]) }, {});
  check("壊れたファイルがあっても残りを出す", /anime/.test(out));
  check("読めなかったことを黙らない", /読めなかったファイル[\s\S]*2026-09-07/.test(out));
}

console.log(`結果（表示速度レポート）: ${ng === 0 ? "全てOK" : `${ng} 件NG`}`);
process.exit(ng === 0 ? 0 : 1);
