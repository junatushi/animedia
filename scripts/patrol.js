#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────
// 逆張り巡回（2026-08-31導入）
//
//   node scripts/patrol.js            … 本番を叩く
//   BASE=http://localhost:3100 node scripts/patrol.js
//
// 【なぜ要るか】
// これまでの本番検査（scripts/verify-production.sh）は「事故が起きたら、その事故を
// 捕まえる検査を1本足す」という積み上げ方だった。守っている不変条件はどれも実在の
// 事故から来ているので価値はあるが、**知らない壊れ方は原理的に見つからない**。
// 見る場所も「sitemapに載っているURL」と「サイト内リンクの先」に限られていて、
// 2026-08-31に見つけた事故（㊲）はそのどちらにも載っていないURLで起きていた。
//
// そこで、URLを列挙するのではなく**URLの「形」を崩して不変条件を確かめる**巡回を分けた。
// 実際にこの方式で、既存のどの検査にも掛からない事故が3つ出た（いずれも本番で実測）:
//
//   /api/work/99999999999999999999    → **502**（Number.isInteger(1e20) が true）
//   /embed/anime/99999999999999999999 → **502**
//   /anime/0x3374                     → 200（16進として13172に解決＝同じ作品の別URL）
//
// 【設計の要点】
// ①**値をハードコードしない**。実在する制作会社名・監督名・声優名・作品IDは
//   リポジトリ同梱の索引から取る（索引が変わっても検査が古くならない）。
// ②**不変条件はURLの形に依らないものだけ**を書く。「このURLは200」ではなく
//   「5xxを返さない」「200なのにエラー本文が出ていない」のように書く。
// ③**404の中身は見ない**。notFound() 経由の404は描画開始後に投げられるため
//   HTMLのシェルが既に送出済みで、画面の中身はRSCストリーム側に入る。ブラウザでは
//   正しく出るが生HTMLをgrepしても見つからない（⑦-10と同じ形の制約）。そちらは
//   `node scripts/check.ts` の「notFound() を呼ぶページに404の境界がある」が担保する。
//
// シークレット不要・公開URLの読み取りのみ。回帰テストは scripts/check-patrol.js。
// 経緯は docs/operations.md の㊲。
// ───────────────────────────────────────────────────────────────
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const BASE = process.env.BASE || "https://animedia-khaki.vercel.app";
const CONC = Number(process.env.PATROL_CONC || 6);
const E = encodeURIComponent;

// ── 実在する値を索引から取る（ハードコードしない）───────────────
function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
}
function realValues() {
  const studios = readJson("content/archive/studios.json");
  const archive = readJson("content/archive/index.json");
  const people = readJson("content/archive/people.json").people;
  // 配信1件以上の作品を持つ、いちばん新しい過去クール。
  const season = [...archive.seasons].filter((s) => s.workIds.length > 0).at(-1);
  // 声優は「そのクールに2作品以上」の人を1人。ページが実在する条件と同じ。
  let person = null;
  const counts = new Map();
  for (const [name, works] of Object.entries(people)) {
    for (const w of works) {
      if (w[2] === season.year && w[3] === season.season) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
  }
  const eligible = [...counts].filter(([, c]) => c >= 2).map(([n]) => n);
  person = eligible.find((n) => [...n].some((ch) => ch.codePointAt(0) > 0x7f)) ?? eligible[0] ?? null;
  // 配信サービスのキーは lib/services.ts の正準リストから読む。
  const svcSrc = fs.readFileSync(path.join(REPO, "lib/services.ts"), "utf8");
  const serviceKey = (svcSrc.match(/\{\s*key:\s*"([a-z_]+)"/) || [])[1] || "d_anime";
  // **非ASCIIの名前を優先して選ぶ**。2026-08-31の事故（㊱）は日本語名にだけ出たので、
  // ASCII名を選ぶと崩し方の大半が恒等写像になり、検査が素通りする。
  const preferNonAscii = (names) =>
    names.find((n) => [...n].some((ch) => ch.codePointAt(0) > 0x7f)) ?? names[0];
  return {
    studio: preferNonAscii(Object.keys(studios.studios)),
    director: preferNonAscii(Object.keys(studios.directors)),
    person: person,
    workId: String(season.workIds[0]),
    year: String(season.year),
    season: season.season,
    serviceKey,
  };
}

// ── 崩し方 ────────────────────────────────────────────────
// 名前（[name] セグメント）
function nameShapes(real) {
  return [
    ["生の値", E(real)],
    ["二重エンコード", E(E(real))],
    ["前後空白", E(` ${real} `)],
    ["全角空白付き", E(`${real}　`)],
    ["NFD正規化", E(real.normalize("NFD"))],
    ["絵文字付き", E(`${real}🍜`)],
    ["パス区切り混入", `${E(real)}%2F..%2Fetc`],
    ["パーセント単独", `${E(real)}%`],
    // 250字程度に抑える。これ以上長くすると、Windowsでローカル実行したときに
    // next start 側が ISR キャッシュのディレクトリを作れず ENOENT を吐く（製品の欠陥ではない）。
    ["超長", E(real.repeat(200)).slice(0, 250)],
  ];
}
// 作品ID（[id] セグメント）。10進以外は同じ作品の別URLになってはいけない。
const ID_SHAPES = [
  ["ゼロ", "0"],
  ["負", "-1"],
  ["先頭ゼロ", "0000000"],
  ["小数", "1.0"],
  ["指数", "1e5"],
  ["16進", "0x3374"],
  ["桁あふれ", "99999999999999999999"],
  ["全角数字", E("１２３４５")],
  ["数字でない", "abc"],
];
const SEASON_SHAPES = [
  ["大文字", "Summer"],
  ["日本語", E("夏")],
  ["未知", "monsoon"],
];

// 崩した結果が正規の形と同じ文字列になることがある（ASCIIだけの名前は
// encodeURIComponent も NFD 正規化も恒等写像になる）。その場合は「崩せていない」ので
// 対照扱いにする。これをやらないと `/director/FROGMAN` を違反として数えてしまう。
function buildCases(v) {
  const c = [];
  const push = (label, seg, canonical, url, kind) =>
    c.push([seg === canonical ? `対照/${label}` : label, url, kind]);

  for (const [label, s] of nameShapes(v.studio)) {
    push(`studio/${label}`, s, E(v.studio), `/studio/${s}`, "html");
  }
  for (const [label, s] of nameShapes(v.director)) {
    push(`director/${label}`, s, E(v.director), `/director/${s}`, "html");
  }
  if (v.person) {
    for (const [label, s] of nameShapes(v.person)) {
      push(`person/${label}`, s, E(v.person), `/person/${s}/${v.year}/${v.season}`, "html");
    }
  }
  for (const [label, s] of ID_SHAPES) {
    c.push([`anime/${label}`, `/anime/${s}`, "html"]);
    c.push([`api-work/${label}`, `/api/work/${s}`, "api"]);
    c.push([`embed/${label}`, `/embed/anime/${s}`, "api"]);
  }
  // クール名の崩し。
  //
  // **大文字違いは localhost に向けたときだけ飛ばす。**
  // Windowsのローカル本番ビルドでは `/season/2025/Summer` が200になる（事前生成した
  // `summer.html` が大文字小文字を区別しないファイルシステムに当たるため）。しかも
  // next start がその要求で `Summer.html` を書こうとして正規の `summer.html` を壊し、
  // **本来200のURLが以後404になる**。本番（Linux）では正しく404で、実測でもそうだった。
  // 「CIは緑なのに手元では必ず失敗する」状態を作らない（docs/operations.md の㉔）。
  const localOnly = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
  for (const [label, s] of SEASON_SHAPES) {
    if (localOnly && label === "大文字") continue;
    c.push([`season/${label}`, `/season/${v.year}/${s}`, "html"]);
    c.push([`rankings/${label}`, `/rankings/${v.year}/${s}`, "html"]);
  }
  // 年の範囲（㊲）。範囲外は200を返してはいけない。
  const far = new Date().getFullYear() + 5;
  for (const p of [
    `/season/${far}/winter`,
    `/rankings/${far}/winter`,
    `/exclusive/${far}/winter`,
    `/service/${v.serviceKey}/${far}/winter`,
  ]) {
    c.push([`範囲外の年/${p.split("/")[1]}`, p, "html"]);
  }
  // 正規のURL（対照）。これが200で返らないなら巡回自体が壊れている。
  c.push(["対照/作品", `/anime/${v.workId}`, "html"]);
  c.push(["対照/制作会社", `/studio/${E(v.studio)}`, "html"]);
  return c;
}

const ERROR_PHRASES = ["エラーを返しました", "取得に失敗しました", "Internal Server Error"];

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      const body = await r.text().catch(() => "");
      return { status: r.status, body };
    } catch (e) {
      if (i === 2) return { status: `ERR:${e.cause?.code || e.message}`, body: "" };
      await new Promise((s) => setTimeout(s, 700 * (i + 1)));
    }
  }
}

// URLの形に依らず成り立つべきこと。
function violations(label, kind, r) {
  const v = [];
  if (typeof r.status !== "number") return [`到達できない（${r.status}）`];
  // ①どんな入力でもサーバーを落とさない。
  if (r.status >= 500) v.push(`5xx（${r.status}）`);
  if (r.status === 200) {
    // ②200なのに失敗の本文が出ていない（Annict障害がそのまま索引に載る形）。
    for (const p of ERROR_PHRASES) if (r.body.includes(p)) v.push(`200なのに「${p}」`);
    // ③200のHTMLには見出しがある（中身が空のページを公開していない）。
    if (kind === "html" && !/<h1/i.test(r.body)) v.push("200なのに<h1>が無い");
    // ④10進以外のIDや崩した名前で200を返さない（同じ資源の別URL＝無駄な書き込み）。
    if (!label.startsWith("対照/")) v.push("崩した形なのに200を返した");
  }
  return v;
}

async function main() {
  const v = realValues();
  const cases = buildCases(v);
  console.log(`逆張り巡回: ${BASE}`);
  console.log(
    `実在する値: 制作会社=${v.studio} / 監督=${v.director} / 声優=${v.person ?? "(無し)"} / 作品#${v.workId}`
  );
  console.log(`検査対象: ${cases.length} 件\n`);

  const rows = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (i < cases.length) {
        const [label, p, kind] = cases[i++];
        const r = await get(BASE + p);
        rows.push([label, p, kind, r.status, violations(label, kind, r)]);
      }
    })
  );
  rows.sort((a, b) => a[0].localeCompare(b[0], "ja"));

  const codes = new Map();
  for (const [, , , st] of rows) codes.set(st, (codes.get(st) || 0) + 1);
  console.log("── HTTPコードの分布 ──");
  for (const [c, n] of [...codes].sort()) console.log(String(n).padStart(4), c);

  const bad = rows.filter((r) => r[4].length);
  console.log("\n── 不変条件に反したもの ──");
  if (!bad.length) console.log("  なし");
  for (const [label, p, , st, vs] of bad) {
    console.log(`  NG ${String(st).padEnd(5)} ${label.padEnd(26)} ${decodeURIComponent(p).slice(0, 64)}`);
    for (const x of vs) console.log(`        → ${x}`);
  }
  console.log(`\n合計 ${rows.length} 件中 ${bad.length} 件が違反`);
  if (bad.length) {
    console.log("docs/operations.md の㊲を確認してください。");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
