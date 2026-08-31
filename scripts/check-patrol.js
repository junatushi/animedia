// scripts/patrol.js（逆張り巡回）そのものの回帰テスト。
//
// 【なぜ要るか】
// patrol.js は「知らない壊れ方」を見つけるための道具だが、**この種の道具は
// 「NGを出さなくなる」方向に壊れると毎日緑のまま無力化する**（check-verify-production.js
// と同じ考え方）。とくに patrol.js は不変条件を1行ずつ足していく作りなので、
// 条件を1つ緩めても出力は静かに減るだけで誰も気づけない。
// スタブのサーバーを立てて patrol.js を実際に子プロセス実行し、
//   ・健全な応答では違反0件・exit 0
//   ・故意に壊した応答では該当する違反が出て exit 1
// を固定する。後者が本体。
//
// ネットワークには出ない（127.0.0.1 のスタブのみ）。依存パッケージの追加なし。

const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { dynamicRoutes } = require("./lib/app-routes.js");

const REPO_ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(__dirname, "patrol.js");

// 10進の作品IDだけを妥当とみなす（lib/workId.ts と同じ規則）。
const DECIMAL_ID = /^[1-9][0-9]{0,8}$/;
const MIN_YEAR = 2010;
const MAX_YEAR = new Date().getFullYear() + 1;

function startStub(broken) {
  const has = (k) => broken.has(k);

  const page = (h1 = true, err = false) =>
    `<!doctype html><html><body>` +
    (h1 ? `<h1>見出し</h1>` : "") +
    (err ? `<p>Annict API がエラーを返しました（500）。</p>` : "") +
    `</body></html>`;

  const server = http.createServer((req, res) => {
    // **パスを丸ごとデコードしてから分割してはいけない**。`%2F` が区切りに化けて
    // `/director/名前%2F..%2Fetc` が `/director/名前` と同じに見えてしまう
    // （実際に1度そうなって、健全なはずのスタブが違反を3件出した）。
    // 本物のルーティングと同じく、**生のパスを分割してから区切りごとにデコードする**。
    // 巡回は不正な `%` を含むURLも投げてくる（"パーセント単独"）ので、
    // デコードは lib/staticParams.ts の decodeParamName と同じく握る。
    const rawSeg = new URL(req.url, "http://x").pathname.split("/").filter(Boolean);
    const seg = rawSeg.map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
    const html = (body, code = 200) =>
      res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }).end(body);

    // 作品ID系（/anime /api/work /embed/anime）
    const idRoute =
      seg[0] === "anime" ? seg[1] : seg[0] === "api" && seg[1] === "work" ? seg[2] : null;
    const embedId = seg[0] === "embed" && seg[1] === "anime" ? seg[2] : null;
    const rawId = idRoute ?? embedId;
    if (rawId !== null && rawId !== undefined) {
      if (!DECIMAL_ID.test(rawId)) {
        // `five-xx`: 桁あふれで500系を返す（2026-08-31の実物と同じ壊れ方）。
        if (has("five-xx") && rawId.length > 15) return html("取得に失敗しました。", 502);
        // `loose-id`: 10進以外を受け入れて200を返す（同じ作品の別URL）。
        if (has("loose-id")) return html(page(true, false));
        return html("作品IDが正しくありません。", 400);
      }
      return html(page(!has("no-h1"), has("error-body")));
    }

    // クール単位のページ（/season /rankings /exclusive /service）
    if (["season", "rankings", "exclusive", "service"].includes(seg[0])) {
      // **サービス別ページは配信サービスのキーも検証する**（本番は SERVICES.find →
      // notFound()）。ここを見ていないと、巡回が `/service/d_anime🍜/...` を投げても
      // 200が返り、スタブ側の都合で「健全なのに違反6件」になる（実際にそうなった）。
      if (seg[0] === "service" && !KNOWN_NAMES.has(seg[1] ?? "")) return html("nf", 404);
      const year = Number(seg[0] === "service" ? seg[2] : seg[1]);
      const key = seg[0] === "service" ? seg[3] : seg[2];
      const inRange = year >= MIN_YEAR && year <= MAX_YEAR;
      if (!inRange && !has("out-of-range-200")) return html("nf", 404);
      if (!inRange) return html(page());
      // 未知のクール名は404。
      if (!["winter", "spring", "summer", "autumn"].includes(key)) return html("nf", 404);
      return html(page(!has("no-h1"), has("error-body")));
    }

    // 名前セグメント（/studio /director /person）。索引にある名前だけ200。
    if (["studio", "director", "person"].includes(seg[0])) {
      const name = seg[1] ?? "";
      if (!KNOWN_NAMES.has(name)) return html("nf", 404);
      // **声優ページは名前だけでなく年・クールも持つ**。ここを見ていないと、
      // 巡回が `/person/名前/99999/autumn` を投げても200が返り、スタブ側の都合で
      // 「健全なのに違反6件」になる（実際にそうなった）。本番は
      // lib/getSeasonData.ts の isValidYear / isValidSeason で 404 にする。
      if (seg[0] === "person") {
        const year = Number(seg[2]);
        const inRange = year >= MIN_YEAR && year <= MAX_YEAR;
        if (!inRange && !has("out-of-range-200")) return html("nf", 404);
        if (inRange && !["winter", "spring", "summer", "autumn"].includes(seg[3] ?? "")) {
          return html("nf", 404);
        }
      }
      return html(page(!has("no-h1"), has("error-body")));
    }
    return html("nf", 404);
  });

  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// patrol.js が索引から選ぶのと同じ値を、スタブ側でも「実在する名前」として扱う。
// ハードコードせず patrol.js に選ばせた結果を受け取る（規則が変わっても古くならない）。
const KNOWN_NAMES = new Set();

function runPatrol(port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BASE: `http://127.0.0.1:${port}`,
        PATROL_CONC: "4",
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

// 実際には叩かず、崩す対象の一覧だけを出させる（patrol.js の PATROL_LIST=1）。
function listPatrolCases() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env, PATROL_LIST: "1", BASE: "http://127.0.0.1:1" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => resolve(out));
  });
}

let ng = 0;
function check(name, pass, detail) {
  if (!pass) ng++;
  console.log(`${pass ? "✓" : "✗"}  ${name.padEnd(50)} → ${detail}`);
}

async function withStub(broken, fn) {
  const server = await startStub(new Set(broken));
  try {
    return await fn(server.address().port);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function main() {
  console.log("── 逆張り巡回（patrol.js）自身の回帰テスト ──\n");

  // patrol.js が選んだ「実在する値」をスタブに教える（1回目の実行から読み取る）。
  const probe = await withStub([], runPatrol);
  const line = probe.out.match(
    /実在する値: 制作会社=(.*?) \/ 監督=(.*?) \/ 声優=(.*?) \/ 作品#(\d+) \/ サービス=(.*)/
  );
  if (!line) {
    console.error("patrol.js の出力から実在する値を読み取れませんでした:\n" + probe.out);
    process.exit(1);
  }
  const [, studio, director, person, workId, serviceKey] = line;
  for (const n of [studio, director, person, workId, serviceKey]) KNOWN_NAMES.add(n);
  console.log(`（巡回が選んだ値: ${studio} / ${director} / ${person} / #${workId} / ${serviceKey}）\n`);

  // ① 非ASCIIの名前を選んでいること。ASCII名を選ぶと崩し方の大半が恒等写像になり、
  //    2026-08-31の事故（㊱＝日本語名だけが404）と同じ形を素通りさせる。
  const nonAscii = [studio, director].filter((n) => [...n].some((c) => c.codePointAt(0) > 0x7f));
  check(
    "① 非ASCIIの名前を選んでいる",
    nonAscii.length >= 1,
    nonAscii.length ? nonAscii.join(" / ") : `ASCIIばかり（${studio} / ${director}）`
  );

  // ② 健全なスタブでは違反0件・exit 0。
  const good = await withStub([], runPatrol);
  check("② 健全な応答では違反0件", / 0 件が違反/.test(good.out), (good.out.match(/合計.*/) || [""])[0]);
  check("② exit 0 で終わる", good.code === 0, `exit=${good.code}`);

  // ③ 壊すと、その事故が確実に出る。
  const faults = [
    ["five-xx", "公開APIが5xxを返す（㊲の再現）", "5xx（502）"],
    ["loose-id", "10進以外のIDで200を返す（同じ作品の別URL）", "崩した形なのに200を返した"],
    ["error-body", "200なのにエラー本文が出ている", "200なのに「エラーを返しました」"],
    ["no-h1", "200なのに見出しが無い", "200なのに<h1>が無い"],
    ["out-of-range-200", "範囲外の年が200を返す（㊲の再現）", "崩した形なのに200を返した"],
  ];
  for (const [fault, label, needle] of faults) {
    const r = await withStub([fault], runPatrol);
    const failed = r.code !== 0;
    const mentioned = r.out.includes(needle);
    check(
      `③ ${label}`,
      failed && mentioned,
      failed ? (mentioned ? "違反として検出" : "exit1だが該当メッセージ無し") : "見逃した"
    );
  }

  // ④ 相手が居ないときに「違反なし」で終わらないこと。
  //    巡回が静かに成功して見えるのが最悪の壊れ方なので、そこだけは固定する。
  //    空いているポートを1つ確保してすぐ閉じ、そこへ向けて走らせる。
  const deadPort = await new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const dead = await runPatrol(deadPort);
  check(
    "④ 相手が居なければ違反として出る",
    dead.code !== 0 && /到達できない/.test(dead.out),
    `exit=${dead.code} / ${/到達できない/.test(dead.out) ? "「到達できない」を出す" : "静かに成功した"}`
  );

  // ⑤ 対象URLを**走査から導出している**こと（手書きの列挙に戻していない）。
  //
  // 初版は対象URLを手書きしており、`/anime/[id]/opengraph-image` を1つも崩して
  // いなかった。同じ日に check.ts でも同じ取りこぼしをしている（窓口を3つと手で
  // 数えて名指しで書き、4つ目が漏れた）。手書きに戻ると**その日から新しい面が
  // 静かに検査対象外になる**ので、ここで固定する。
  {
    const routes = dynamicRoutes(path.join(REPO_ROOT, "app"));
    const listed = await listPatrolCases();
    const declared = Number((listed.match(/走査したルート: (\d+) 件/) || [])[1] || 0);
    check(
      "⑤ 対象URLを app/ の走査から導出している",
      declared === routes.length && routes.length >= 10,
      `走査 ${routes.length} 件 / 巡回の申告 ${declared} 件`
    );
    // 走査で見つかったルートが1つ残らず崩されていること（拾って捨てていない）。
    // 「対照/」だけで実際には崩していないルートも取りこぼし扱いにする。
    const missed = routes.filter((r) => !listed.includes(`${r.routePath} [`));
    check(
      "⑤ 走査したルートを1つも取りこぼさない",
      missed.length === 0,
      missed.length ? `崩していない: ${missed.map((r) => r.routePath).join(" / ")}` : `${routes.length} ルート全部を崩した`
    );
    // 画像ルート（OG画像）も崩している。初版が取りこぼした実物なので名指しで固定する。
    const og = listed.includes("/anime/[id]/opengraph-image [id]/");
    check("⑤ OG画像のルートも崩している", og, og ? "崩している" : "初版と同じ取りこぼし");
  }

  console.log(`\n結果: ${ng === 0 ? "全件OK" : `${ng} 件NG`}`);
  process.exit(ng === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
