#!/usr/bin/env node
"use strict";
// scripts/verify-extra-services.ts の回帰テスト（2026-10-04導入）。
// スタブのHTTPサーバーを出典に見立てて検証スクリプトを実際に動かし、
// **通してはいけないものを通さない**ことを固定する。この検査は自動マージの門番なので、
// 「何でも合格にする」方向に壊れると、誤った配信先が人の目を通らずに本番へ出る。
// ネットワークには出ない（127.0.0.1 だけ）。

const assert = require("node:assert");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const ok = (name, note) => console.log(`  ✓ ${name}${note ? `（${note}）` : ""}`);
const TODAY = "2026-10-04";
const dir = mkdtempSync(join(tmpdir(), "verify-extra-check-"));

// Shift_JIS の符号化（Nodeは復号しか持たないので、2バイト符号を総当たりで復号して逆引き表を作る）
function toShiftJis(str) {
  const dec = new TextDecoder("shift_jis");
  const table = new Map();
  for (let hi = 0x81; hi <= 0xfc; hi++) {
    if (hi > 0x9f && hi < 0xe0) continue;
    for (let lo = 0x40; lo <= 0xfc; lo++) {
      const ch = dec.decode(Uint8Array.of(hi, lo));
      if (ch.length === 1 && !table.has(ch)) table.set(ch, [hi, lo]);
    }
  }
  const bytes = [];
  for (const ch of str) {
    if (ch.charCodeAt(0) < 0x80) bytes.push(ch.charCodeAt(0));
    else bytes.push(...table.get(ch));
  }
  return Buffer.from(bytes);
}

// 出典に見立てたページ
const far = "あ".repeat(3000);
let flaky = 0;
const PAGES = {
  "/good": "<html><body><h1>テスト作品A 第2期</h1><p>配信情報 10月5日(日)より dアニメストア・Prime Video にて配信</p></body></html>",
  "/other-season": "<html><body><h1>テスト作品A</h1><p>第1期 配信情報 dアニメストア にて配信</p></body></html>",
  "/far": `<html><body><h1>テスト作品A 第2期</h1>${far}<p>U-NEXTにて独占配信</p></body></html>`,
  "/script-only": "<html><head><script>var s='テスト作品A 第2期 dアニメストアにて配信';</script></head><body>準備中</body></html>",
};
const server = http.createServer((req, res) => {
  if (req.url === "/flaky") {
    flaky++;
    if (flaky === 1) {
      res.writeHead(503);
      return res.end("busy");
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(PAGES["/good"]);
  }
  if (req.url === "/sjis") {
    // 「テスト作品A 第2期 ABEMAにて配信」を Shift_JIS で返す（TextDecoder が読めるか）
    const sjis = toShiftJis("<html><body>テスト作品A 第2期 ABEMAにて配信</body></html>");
    res.writeHead(200, { "content-type": "text/html; charset=Shift_JIS" });
    return res.end(sjis);
  }
  const page = PAGES[req.url];
  if (!page) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
});

const store = {
  sources: {
    annict: {
      "2026-autumn": {
        works: {
          100: { title: "テスト作品A 第2期", services: {} },
          101: { title: "Annictに配信がある作品", services: { d_anime: { firstSeen: "2026-09-01" } } },
        },
      },
      "2027-winter": { works: {} },
    },
  },
};
const storePath = join(dir, "first-seen.json");
writeFileSync(storePath, JSON.stringify(store));

const BASE_EXTRA = { 200: [{ key: "netflix", sourceUrl: "https://example.org/x", confirmedDate: "2026-10-01" }] };
const ACK_OK = { id: "300", title: "延期作", reason: "放送延期（https://example.org/news）", recheckOn: "2026-11-01" };

function writeExtra(name, obj) {
  const p = join(dir, `${name}.ts`);
  writeFileSync(p, `export const EXTRA_SERVICES = ${JSON.stringify(obj)};\n`);
  return p;
}
function writeAck(name, list) {
  const p = join(dir, `${name}.js`);
  writeFileSync(p, `module.exports = { ACKNOWLEDGED: ${JSON.stringify(list)} };\n`);
  return p;
}
const entry = (path, extra = {}) => ({
  key: "d_anime",
  sourceUrl: `https://official.example.jp${path}`,
  confirmedDate: TODAY,
  evidence: "10月5日(日)より dアニメストア・Prime Video にて配信",
  ...extra,
});

function run(headExtra, { baseAck = [], headAck = baseAck } = {}) {
  const env = {
    ...process.env,
    VERIFY_EXTRA_BASE: writeExtra(`base-${Math.random()}`, BASE_EXTRA),
    VERIFY_EXTRA_HEAD: writeExtra(`head-${Math.random()}`, headExtra),
    VERIFY_ACK_BASE: writeAck(`base-ack-${Math.random()}`, baseAck),
    VERIFY_ACK_HEAD: writeAck(`head-ack-${Math.random()}`, headAck),
    COVERAGE_GAPS_STORE: storePath,
    VERIFY_TODAY: TODAY,
    VERIFY_FETCH_ORIGIN: `http://127.0.0.1:${server.address().port}`,
  };
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--no-warnings", join(__dirname, "verify-extra-services.ts")], { env });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}
const withAdded = (workId, e) => ({ ...BASE_EXTRA, [workId]: [e] });

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    console.log("── 通すもの ──");
    let r = await run(withAdded(100, entry("/good")));
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /✓ \*\*#100 テスト作品A 第2期 → dアニメストア/);
    ok("抜き書きが実在し、サービス名を含み、近くに作品名の全文がある");

    r = await run({ ...BASE_EXTRA, 100: [entry("/good"), entry("/good", { key: "prime" })] });
    assert.strictEqual(r.code, 0, r.out + r.err);
    ok("同じ抜き書きで複数のサービス", "同じページは1回だけ取る");

    r = await run(withAdded(100, entry("/flaky")));
    assert.strictEqual(r.code, 0, r.out + r.err);
    ok("一時的な失敗（503）は再試行する");

    r = await run(withAdded(100, entry("/sjis", { key: "abema", evidence: "ABEMAにて配信" })));
    assert.strictEqual(r.code, 0, r.out + r.err);
    ok("Shift_JISのページも読める");

    r = await run(BASE_EXTRA, { baseAck: [], headAck: [ACK_OK] });
    assert.strictEqual(r.code, 0, r.out + r.err);
    ok("確認済みの除外: 出典URLと62日以内の期日があれば通す");

    console.log("\n── 通さないもの ──");
    const rejects = [
      ["別シーズンの配信欄（作品名の全文がページに無い）", entry("/other-season", { evidence: "第1期 配信情報 dアニメストア にて配信" }), /作品名の全文/],
      ["作品名と抜き書きが離れすぎている", entry("/far", { key: "unext", evidence: "U-NEXTにて独占配信" }), /離れすぎ/],
      ["抜き書きがページに無い（写し間違い・創作）", entry("/good", { evidence: "dアニメストアにて独占配信決定" }), /見つからない/],
      ["抜き書きにサービス名が無い", entry("/good", { key: "netflix" }), /Netflix」の名前が無い/],
      ["scriptの中にしか無い文字列", entry("/script-only", { evidence: "dアニメストアにて配信" }), /見つからない|作品名の全文/],
      ["出典が取れない（404）", entry("/missing"), /取得できなかった/],
      ["出典がX", entry("/good", { sourceUrl: "https://x.com/foo/status/1" }), /x\.com/],
      ["出典がhttp", entry("/good", { sourceUrl: "http://official.example.jp/good" }), /https/],
      ["曜日・時刻つき", entry("/good", { schedule: { weekday: 0, time: "23:00", startDate: "2026-10-05" } }), /schedule/],
      ["抜き書きが無い", entry("/good", { evidence: undefined }), /evidence/],
      ["確認日が古い", entry("/good", { confirmedDate: "2026-09-01" }), /confirmedDate/],
    ];
    for (const [name, e, re] of rejects) {
      r = await run(withAdded(100, e));
      assert.strictEqual(r.code, 1, `${name}: ${r.out}${r.err}`);
      assert.match(r.out, re, name);
      ok(name);
    }

    r = await run(withAdded(101, entry("/good")));
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /既にある作品/);
    ok("Annictに配信先が既にある作品は触らない");

    r = await run(withAdded(999, entry("/good")));
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /今期・次期の作品として記録されていない/);
    ok("今期・次期に無い作品は触らない");

    r = await run({});
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /既存の行の削除・書き換え/);
    ok("既存の行を消すPRは通さない");

    r = await run({ 200: [{ ...BASE_EXTRA[200][0], sourceUrl: "https://example.org/y" }] });
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /既存の行の削除・書き換え/);
    ok("既存の行を書き換えるPRは通さない");

    r = await run({ ...BASE_EXTRA, 100: [entry("/good"), entry("/good", { key: "netflix" })] });
    assert.strictEqual(r.code, 1);
    ok("1件でも不合格なら全体を通さない");

    r = await run(BASE_EXTRA, { headAck: [{ ...ACK_OK, reason: "放送延期" }] });
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /出典URLが無い/);
    ok("確認済みの除外: 出典URLの無い理由は通さない");

    r = await run(BASE_EXTRA, { headAck: [{ ...ACK_OK, recheckOn: "2027-06-01" }] });
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /62日以内/);
    ok("確認済みの除外: 期日が遠すぎるものは通さない", "長く隠すと欠損を見落とす");

    console.log("\n── 確かめるものが無い ──");
    r = await run(BASE_EXTRA);
    assert.strictEqual(r.code, 3, r.out + r.err);
    ok("差分が無ければ終了コード3", "合格（0）と区別する＝空のPRを自動マージしない");

    console.log("\n全件OK");
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
