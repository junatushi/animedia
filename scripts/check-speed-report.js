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
{
  // **外した理由が2つあるとき、件数を取り違えないこと**（2026-09-29追加）。
  // usable は「計測元が違う」と「遅延の当て方が違う」の両方を外すので、
  // その差をまとめて「別の計測元」として数えると水増しになる。
  // ここは計測元違い1件・当て方違い1件で、どちらも「1 日ぶん」と出るのが正しい。
  const withMode = (base, pages) => {
    const sn = snap(base, pages);
    sn.conditions = { ...sn.conditions, latencyMode: "perRequest" };
    return sn;
  };
  const out = run(
    {
      "2026-09-06.json": snap("http://localhost:3100", [{ ...page("anime", false), lcp: 100 }]),
      "2026-09-07.json": snap(PROD, [{ ...page("anime", false), ttfb: 30 }]),
      "2026-09-08.json": withMode(PROD, [{ ...page("anime", false), ttfb: 180 }]),
    },
    {}
  );
  check(
    "別の計測元の件数を水増ししない",
    /別の計測元の断面が 1 日ぶん/.test(out),
    out.match(/別の計測元の断面[^\n]*/)?.[0] ?? "(出ていない)"
  );
  check(
    "当て方違いの件数も別に数える",
    /2026-09-07 までの 1 日ぶんは擬似遅延の当て方が違う/.test(out),
    out.match(/⚠[^\n]*擬似遅延[^\n]*/)?.[0] ?? "(出ていない)"
  );
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

// ④-2 初回（1回目）の値の読み方
//   （2026-09-27追加 → 09-29に作り直し → **09-30にもう一度作り直した**）。
//
// 3度とも壊れ方は同じで、「初回が遅い」という観測に**「事前生成されていない」という
// 原因を貼り付けた**。以下は3度ぶんの再発防止をまとめて固定する。
//
// 1度目 … `lcpFirst` が中央値より1.5倍かつ500ms以上大きい＝事前生成されていない疑い。
//   実データで17面中11面が発火し、完全静的なページまで含んでいた
//   （about・privacy・director。`generateStaticParams`と何の関係も無い）。
// 2度目 … 同じ主張を `htmlDlFirst`（responseEnd − responseStart の1回目）に載せ替えた。
//   理屈（ストリーミングだから生成の待ちは responseEnd 側）は局所実験では成り立ったが、
//   **本番では成り立たなかった**。2026-09-30の実データで17面中15面が発火し、そこにも
//   `about`（初回596ms / 中央値238ms）・`privacy`（686/251ms）が入った。さらに
//   **焼いていない面のほうが短い**（`anime-current` 112ms < 焼いてある `season-current` 1111ms）。
// 3度目＝いまの判定 … `htmlDlFirst` に**絶対値の門**（目標の半分＝1000ms）を足し、
//   **原因は一切名乗らない**。事前生成の有無は `.next/prerender-manifest.json` で見る。
//
// **静かに間違った原因を名指しするレポートも、静かに沈黙する見張りも、無いより悪い。**
// 以下は「どちらの向きに壊れても落ちる」ように対で固定する。
{
  // A: 初回だけHTML本体の受信が長い面。**原因は言わない。**
  const out = run(
    { "2026-09-08.json": snap(PROD, [{ ...page("anime", false), lcpFirst: 2600, htmlDl: 120, htmlDlFirst: 2200 }]) },
    {}
  );
  check(
    "初回だけHTML本体の受信が長い面を警告する",
    /初回だけHTML本体の受信が長い面[\s\S]*anime\(初回2200ms/.test(out),
    out.match(/初回だけHTML本体の受信が長い面[^\n]*/)?.[0] ?? "(警告が出ていない)"
  );
  check("その警告で事前生成のせいにしない", !/事前生成されていない疑い/.test(out));
  check("その警告で generateStaticParams を促さない", !/generateStaticParams/.test(out));
  check("代わりに prerender-manifest を見るよう促す", /prerender-manifest\.json/.test(out));
}
{
  // **2度目の誤りの再発防止（重要）。** 完全静的な面でも初回は中央値の2〜3倍になる。
  // 実データの about は初回596ms / 中央値238ms＝比では2.5倍・差358msで、
  // 2度目の判定（比と差だけ）では発火した。絶対値の門が無いとここが落ちる。
  const out = run(
    { "2026-09-08.json": snap(PROD, [{ ...page("about", false), htmlDl: 238, htmlDlFirst: 596 }]) },
    {}
  );
  check("完全静的な面の初回の伸び（比は大きいが絶対値が小さい）では警告しない",
    !/初回だけHTML本体の受信が長い面/.test(out),
    out.match(/初回だけHTML本体の受信が長い面[^\n]*/)?.[0] ?? "");
}
{
  // 絶対値の門は「目標の半分」。境界のすぐ上では出ること（門を上げ過ぎると沈黙する）。
  const out = run(
    { "2026-09-08.json": snap(PROD, [{ ...page("anime", false), htmlDl: 300, htmlDlFirst: 1010 }]) },
    {}
  );
  check("目標の半分を超えれば警告する", /初回だけHTML本体の受信が長い面[\s\S]*anime\(初回1010ms/.test(out),
    out.match(/初回だけHTML本体の受信が長い面[^\n]*/)?.[0] ?? "(警告が出ていない)");
}
{
  // 受信が1回目から速ければ警告しない。
  const out = run(
    { "2026-09-08.json": snap(PROD, [{ ...page("anime", false), htmlDl: 100, htmlDlFirst: 130 }]) },
    {}
  );
  check("受信が初回から速ければ警告しない", !/初回だけHTML本体の受信が長い面/.test(out));
}
{
  // **受信の値を持たない古い断面では、見張りが黙って消える。** それを告げること
  // （黙って沈黙するのが最悪の壊れ方。1度目・2度目の誤りはどちらもこの形だった）。
  const out = run({ "2026-09-08.json": snap(PROD, [{ ...page("anime", false), lcpFirst: 950 }]) }, {});
  check("受信を記録していない断面ではそう告げる", /初回の受信の判定はしていない/.test(out));
  check("受信が無い列は「—」で示す", /anime[^\n]*—/.test(out), out.match(/anime[^\n]*/)?.[0] ?? "");
}
{
  // 1度目の誤りの再発防止。初回のLCPだけが遅い面を「事前生成されていない疑い」と呼ばない。
  const out = run(
    { "2026-09-08.json": snap(PROD, [{ ...page("anime", false), lcpFirst: 2600, htmlDl: 100, htmlDlFirst: 120 }]) },
    {}
  );
  check("初回のLCPが遅いだけでは事前生成のせいにしない", !/事前生成されていない疑い/.test(out));
  check("その場合も generateStaticParams を促さない", !/generateStaticParams/.test(out));
  check("受信を記録していれば「判定していない」とは言わない", !/初回の受信の判定はしていない/.test(out));
  check(
    "初回が目標を超えたことは出す",
    /初回が目標\(2000ms\)を超えた面[\s\S]*anime\(初回2600ms/.test(out),
    out.match(/初回が目標[^\n]*/)?.[0] ?? "(警告が出ていない)"
  );
  check("原因を特定できないと明示する", /原因はこの計測では特定できない/.test(out));
}
{
  // 初回が目標の内側なら何も言わない（導入時の判定はここで11面ぶん誤発火していた。
  // 実データの about は初回1784ms・中央値436ms＝比では4.1倍だが、目標は満たしている）。
  const out = run(
    { "2026-09-08.json": snap(PROD, [{ ...page("anime", false), lcp: 436, lcpFirst: 1784, ttfbFirst: 105 }]) },
    {}
  );
  check("初回が目標内なら警告しない", !/初回が目標\(2000ms\)を超えた面/.test(out));
}
{
  // 初回は1回しか測らない（n=1）ので、何日続いたかを添えること。
  // 1日だけの跳ねを「実体」と読ませない。
  const out = run(
    {
      "2026-09-06.json": snap(PROD, [{ ...page("anime", false), lcpFirst: 900, ttfbFirst: 105 }]),
      "2026-09-07.json": snap(PROD, [{ ...page("anime", false), lcpFirst: 2600, ttfbFirst: 105 }]),
      "2026-09-08.json": snap(PROD, [{ ...page("anime", false), lcpFirst: 2700, ttfbFirst: 105 }]),
    },
    {}
  );
  check("続いた日数を数える", /anime\(初回2700ms[^)]*・2日連続\)/.test(out), out.match(/初回が目標[^\n]*/)?.[0] ?? "");
  check("n=1であることを断る", /n=1/.test(out));
}
{
  const out = run(
    { "2026-09-08.json": snap(PROD, [{ ...page("anime", false), lcpFirst: 950, ttfbFirst: 110 }]) },
    {}
  );
  check("初回も速ければどちらの警告も出さない", !/初回が目標|初回だけ応答が遅い面/.test(out));
}
{
  // 初回の値を持たない古い断面（この仕組みを入れる前のJSON）で、
  // 警告も例外も出さずに「—」と出すこと。
  const out = run({ "2026-09-08.json": snap(PROD, [page("anime", false)]) }, {});
  check("初回の値が無い断面では警告しない", !/初回が目標|初回だけ応答が遅い面/.test(out));
  check("初回の値が無いことを「—」で示す", /anime[^\n]*—/.test(out), out.match(/anime[^\n]*/)?.[0] ?? "");
}

// ④-3 **擬似遅延の当て方が変わった日を跨いでTTFBを比べない**（2026-09-29追加）。
// 2026-09-29まで擬似遅延はTTFBに乗っていなかった（Chromiumのネットワーク擬似条件は
// 遅延を応答が始まったあとに効かせるため、`responseStart`に出ない）。直した日に
// TTFBは30ms前後から180ms前後へ跳ねるが、**それは悪化ではない**。
// 黙っていると次に読む人が必ず「遅くなった」と読む。
{
  const withMode = (base, pages) => {
    const sn = snap(base, pages);
    sn.conditions = { ...sn.conditions, latencyMode: "perRequest" };
    return sn;
  };
  const out = run(
    {
      "2026-09-07.json": snap(PROD, [{ ...page("anime", false), ttfb: 30 }]),
      "2026-09-08.json": withMode(PROD, [{ ...page("anime", false), ttfb: 180 }]),
    },
    {}
  );
  check(
    "当て方が違う断面を外したことを告げる",
    /2026-09-07 までの 1 日ぶんは擬似遅延の当て方が違う/.test(out),
    out.match(/⚠[^\n]*擬似遅延[^\n]*/)?.[0] ?? "(出ていない)"
  );
  check("跳ね上がりは悪化ではないと断る", /遅くなったのではなく/.test(out));
  check("条件行に当て方を出す", /遅延150ms（リクエストごと＝TTFBに乗る）/.test(out), out.match(/条件:[^\n]*/)?.[0] ?? "");
  // **当て方が違う断面を前回比に使わないこと**（TTFBは30→180msで+150ms、
  // LCP・FCPも動くので、跨いだ前回比はどの指標でも意味を持たない）。
  check("当て方が違う断面を前回比に使わない", !/\+150ms/.test(out), out.match(/anime[^\n]*/)?.[0] ?? "");
  check("外した結果を断面数に反映する", /断面 1 日ぶん/.test(out), out.match(/条件:[^\n]*/)?.[0] ?? "");
}
{
  // 全断面が同じ当て方なら、この注意は出さない（毎回出ると読まれなくなる）。
  const sn = snap(PROD, [{ ...page("anime", false), ttfb: 180 }]);
  sn.conditions = { ...sn.conditions, latencyMode: "perRequest" };
  const out = run({ "2026-09-08.json": sn }, {});
  check("混ざっていなければ注意を出さない", !/擬似遅延の当て方が変わって/.test(out));
}
{
  // 古い断面だけのときは「TTFBには乗っていない」と正直に出す。
  const out = run({ "2026-09-08.json": snap(PROD, [page("anime", false)]) }, {});
  check("古い断面では遅延がTTFBに乗っていないと書く", /遅延150ms（TTFBには乗っていない）/.test(out), out.match(/条件:[^\n]*/)?.[0] ?? "");
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
