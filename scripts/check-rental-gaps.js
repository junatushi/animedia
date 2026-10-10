#!/usr/bin/env node
"use strict";
// scripts/rental-gaps.ts の回帰テスト（2026-10-10導入）。
// HTTPスタブ（サイトの /api/season と各作品の公式サイト）を立てて CLI を実際に動かし、
// **課金の区画にだけあるサービスを拾い、拾ってはいけないものを拾わない**ことを固定する。
// この道具は「静かに0件を返す」方向に壊れると、課金が要るサービスを見放題と同じ枠に
// 並べたまま利用者に指摘されるまで誰も気づけなくなる（導入の経緯そのもの＝転剣II）。
// ネットワークには出ない。

const assert = require("node:assert");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const S = require("./lib/rental-scan.js");

const ok = (name, note) => console.log(`  ✓ ${name}${note ? `（${note}）` : ""}`);

// ── 公式サイトのスタブ（パスで作品を分ける。RENTAL_GAPS_ORIGIN でホストだけ差し替わる） ──
const PAGES = {
  // 転剣IIの実物と同じ並び。ABEMAは見出しなしの主配信、課金の区画の途中に music.jp がある。
  "/tenken/": `<a href="./onair.html">ON AIR</a><p>ABEMAにて 地上波1週間先行・独占配信決定！</p>`,
  "/tenken/onair.html": `<h3>配信情報</h3><dl><dt>ABEMA</dt><dd>9月30日より 毎週水曜日 24:30～</dd></dl>
    <h4>＜個別課金サービス＞</h4><p>10月14日 24:00〜配信開始</p>
    <ul><li>ｄアニメストア</li><li>Hulu</li><li>music.jp</li><li>FOD</li><li>バンダイチャンネル</li></ul>
    <p>※放送・配信日時は変更になる場合がございます。</p>`,
  // 見放題と都度課金の両方に載る（バンダイ・Prime の二重掲載）→ 課金扱いにしない
  "/dual/": `<h3>見放題配信</h3><p>Prime Video、バンダイチャンネル、dアニメストア</p>
    <h3>都度課金配信</h3><p>Prime Video、バンダイチャンネル</p>`,
  // トップのニュース欄に FOD の言及があっても、配信情報の表で課金だけなら拾う
  "/news/": `<p>FODほかで配信決定！</p><a href="/news/streaming/">配信情報</a>`,
  "/news/streaming/": `<h3>見放題配信</h3><p>ABEMA</p><h3>《都度課金サービス》</h3><p>FOD</p>`,
  // 括弧・※注記で1サービスだけ課金と書く形、ロゴ画像の alt
  "/inline/": `<h3>配信</h3><p><img src="a.png" alt="dアニメストア"></p><p>YouTube（レンタル配信）</p>
    <p>ニコニコチャンネル ※都度課金配信</p>`,
  // 「dアニメストア for Prime Video」は dアニメ。Prime Video は課金の区画だけ
  "/forprime/": `<h3>見放題配信</h3><p>dアニメストア for Prime Video</p><h3>都度課金配信</h3><p>Prime Video</p>`,
  // 記録済み（rentalServices.ts の 16478 は d_anime を課金扱い）なのに見放題に載っている
  "/contra/": `<h3>見放題</h3><p>dアニメストア</p><p>ABEMA</p><h3>各話購入</h3><p>Hulu</p>`,
  // 転生した大聖女の形: トップのニュース記事へのリンクが先に並び、/onair/ は4本目。
  // 見放題の「dアニメストア ニコニコ支店」が2行に割れている。
  "/split/": `<a href="/split/news/1.html">配信決定</a><a href="/split/news/2.html">配信決定</a>
    <a href="/split/news/3.html">配信情報まとめ</a><a href="/split/onair/">ON AIR</a>`,
  "/split/onair/": `<h3>見放題サービス</h3><p><a href="https://site.nicovideo.jp/danime/"><span>dアニメストア</span><span>ニコニコ支店</span></a></p>
    <h3>都度課金サービス</h3><p>ニコニコ チャンネル</p>`,
  // ドラゴンボール超 ビルスの形: ロゴ画像の alt が空で、手がかりはリンク先だけ
  "/logo/": `<h3>見放題配信</h3><a href="https://animestore.docomo.ne.jp/x"><img src="lg-danime.png" alt=""></a>
    <h3>レンタル配信</h3><a href="https://www.b-ch.com/titles/9982"><img src="lg-bandai.png" alt=""></a>`,
  // 東京リベンジャーズの形: 旧作の表では見放題、最新作の表では Disney+ 以外が都度課金
  "/arcs/": `<h2>「旧作編」配信情報</h2><h3>見放題サービス</h3><p>dアニメストア</p><p>Hulu</p>
    <h3>都度課金サービス</h3><p>DMM.com</p>
    <h2>「最新編」配信情報</h2><p>ディズニープラスにて独占配信</p><p>Disney+</p>
    <h3>都度課金サービス</h3><p>dアニメストア</p><p>Hulu</p><p>DMM TV</p>`,
  "/cf/": `<title>Just a moment...</title><div id="challenge-platform"></div>`,
  // 課金の区画が無い → 何も出さない
  "/plain/": `<h3>配信情報</h3><p>dアニメストア</p><p>U-NEXT</p>`,
};

const SEASON_ITEMS = [
  { id: 900001, title: "転剣テスト", officialSiteUrl: "https://tenken.example/tenken/", services: ["abema", "d_anime", "hulu", "fod", "bandai", "prime"] },
  { id: 900002, title: "二重掲載", officialSiteUrl: "https://dual.example/dual/", services: ["prime", "bandai", "d_anime"] },
  { id: 900003, title: "ニュース欄", officialSiteUrl: "https://news.example/news/", services: ["abema", "fod"] },
  { id: 900004, title: "注記", officialSiteUrl: "https://inline.example/inline/", services: ["d_anime", "youtube", "niconico"] },
  { id: 900005, title: "for Prime", officialSiteUrl: "https://fp.example/forprime/", services: ["d_anime", "prime"] },
  { id: 16478, title: "記録の見直し", officialSiteUrl: "https://c.example/contra/", services: ["d_anime", "abema", "hulu"] },
  { id: 900010, title: "支店", officialSiteUrl: "https://s.example/split/", services: ["d_anime", "niconico"] },
  { id: 900011, title: "ロゴだけ", officialSiteUrl: "https://l.example/logo/", services: ["d_anime", "bandai"] },
  { id: 900012, title: "編ごとの表", officialSiteUrl: "https://a.example/arcs/", services: ["disney", "d_anime", "hulu", "dmm"] },
  // rental-acknowledged.js の実在の行（期日 2026-11-10）
  { id: 17851, title: "確認済み除外", officialSiteUrl: "https://g.example/forprime/", services: ["d_anime", "prime"] },
  { id: 900013, title: "確認画面", officialSiteUrl: "https://cf.example/cf/", services: ["d_anime", "unext"] },
  { id: 900007, title: "課金なし", officialSiteUrl: "https://p.example/plain/", services: ["d_anime", "unext"] },
  { id: 900008, title: "読めない", officialSiteUrl: "https://x.example/missing/", services: ["d_anime", "unext"] },
  { id: 900009, title: "1社だけ", officialSiteUrl: "https://x.example/tenken/", services: ["abema"] },
].map((w) => ({ ...w, services: w.services.map((key) => ({ key })) }));

function startStub({ seasonStatus = 200, items = SEASON_ITEMS } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://stub");
    hits.push(u.pathname);
    if (u.pathname === "/api/season") {
      res.writeHead(seasonStatus, { "content-type": "application/json" });
      res.end(seasonStatus === 200 ? JSON.stringify({ items: u.searchParams.get("season") === "autumn" ? items : [] }) : "{}");
      return;
    }
    const html = PAGES[u.pathname];
    if (!html) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<html><body>${html}</body></html>`);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, hits, origin: `http://127.0.0.1:${server.address().port}` })));
}

function runCli(origin, extraArgs = [], today = "2026-10-10") {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(__dirname, "rental-gaps.ts"), ...extraArgs], {
      env: { ...process.env, RENTAL_GAPS_SITE: origin, RENTAL_GAPS_ORIGIN: origin, RENTAL_GAPS_TODAY: today, NODE_NO_WARNINGS: "1" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

(async () => {
  console.log("── 行の区画分け（純関数） ──");
  const cls = (n) => (/dアニメ|ｄアニメ/i.test(n) ? "d_anime" : /music\.jp/.test(n) ? null : null);
  assert.deepStrictEqual(S.htmlToLines('<p>A<br>B</p><img alt="dアニメストア">'), ["A", "B", "dアニメストア"]);
  ok("画像の alt を行として残す", "配信表がロゴ画像だけのサイトがある");
  const r0 = S.classifySections(["＜個別課金サービス＞", "ｄアニメストア"], cls);
  assert.deepStrictEqual(r0.payOnly, ["d_anime"]);
  ok("課金の見出しの下だけにあるサービスを拾う");

  console.log("── CLI を実際に動かす ──");
  const stub = await startStub();
  try {
    const { code, out } = await runCli(stub.origin, ["--json"]);
    assert.strictEqual(code, 0);
    const res = JSON.parse(out);
    const by = Object.fromEntries(res.map((r) => [r.work.id, r]));

    assert.strictEqual(by[900001].kind, "gap");
    assert.deepStrictEqual(by[900001].missing, ["bandai", "d_anime", "fod", "hulu"]);
    ok("転剣IIの形: ABEMA以外の課金サービスを全部拾う", "music.jp で区画が閉じない・公式の課金区画に無い prime は出さない");

    assert.notStrictEqual(by[900002].kind, "gap");
    ok("見放題と都度課金の両方に載るサービスは課金扱いにしない");

    assert.strictEqual(by[900003].kind, "gap");
    assert.deepStrictEqual(by[900003].missing, ["fod"]);
    ok("トップのニュース欄の言及で、配信情報の表の課金専用を打ち消さない");

    assert.strictEqual(by[900004].kind, "gap");
    assert.deepStrictEqual(by[900004].missing, ["niconico", "youtube"]);
    ok("括弧書き・※注記の課金を拾い、ロゴ画像の dアニメは拾わない");

    assert.deepStrictEqual(by[900005].missing, ["prime"]);
    ok("「dアニメストア for Prime Video」は dアニメとして数える");

    assert.strictEqual(by[16478].kind, "gap");
    assert.ok(by[16478].contradicted.includes("d_anime"));
    ok("記録済みなのに見放題に載っているサービスを「見直し」として出す");

    assert.deepStrictEqual(by[900010].missing, ["niconico"]);
    ok("配信情報のページをニュース記事より先に取り、2行に割れた「ニコニコ支店」を dアニメとして数える", "文字のあるリンクはリンク先のドメインで名前を補わない");

    assert.deepStrictEqual(by[900011].missing, ["bandai"]);
    ok("ロゴ画像だけの配信表を、リンク先のドメインで読む");

    assert.deepStrictEqual(by[900012].missing, ["d_anime", "dmm", "hulu"]);
    assert.ok(by[900012].evidence.includes("【「最新編」配信情報】"));
    ok("編ごとの配信表を別々に読み、旧作の見放題で最新作の課金を打ち消さない", "抜き書きにどの表かを出す");

    assert.strictEqual(by[900007].kind, "ok");
    ok("課金の区画が無いサイトでは何も出さない");

    assert.strictEqual(by[900008].kind, "unread");
    assert.strictEqual(by[900013].kind, "unread");
    ok("読めなかったサイトを「問題なし」に数えない");

    assert.ok(!by[900009]);
    ok("配信サービスが1社だけの作品は見に行かない", "相手のサイトへの取得を減らす");

    const issue = await runCli(stub.origin);
    assert.strictEqual(issue.code, 0);
    assert.match(issue.out, /転剣テスト/);
    assert.match(issue.out, /読めなかった作品 2件/);
    assert.doesNotMatch(issue.out, /課金なし/);
    ok("Issue本文に要対応と読めなかった作品を出す");

    assert.doesNotMatch(issue.out, /確認済み除外/);
    const later = await runCli(stub.origin, [], "2026-11-10");
    assert.match(later.out, /確認済み除外/);
    assert.match(later.out, /前回の理由/);
    ok("確認済みの除外は期日まで隠し、期日が来たら理由つきで戻す");
  } finally {
    stub.server.close();
  }

  const clean = await startStub({ items: SEASON_ITEMS.filter((w) => [900002, 900007].includes(w.id)) });
  try {
    const { code, out } = await runCli(clean.origin);
    assert.strictEqual(code, 0);
    assert.strictEqual(out, "");
    ok("要対応が0件なら標準出力は空", "ワークフローはそれを見てIssueを閉じる");
  } finally {
    clean.server.close();
  }

  const down = await startStub({ seasonStatus: 404 });
  try {
    const { code, out } = await runCli(down.origin);
    assert.notStrictEqual(code, 0);
    assert.strictEqual(out, "");
    ok("作品一覧が取れない日は失敗で落ちる", "0件として静かに成功しない");
  } finally {
    down.server.close();
  }
  console.log("rental-gaps: 全件OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
