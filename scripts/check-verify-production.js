// scripts/verify-production.sh（本番SSRの実地検査）そのものの回帰テスト。
//
// 【なぜ要るか・2026-08-07】
// verify-production.sh は本番にしか出ない事故を捕まえるための検査だが、**その検査自身が
// 壊れていないことは誰も見ていない**。シェルスクリプトは静的検査が効かないうえ、
// この種のスクリプトが壊れるときは「NGを出さなくなる」＝毎日緑のまま無力化する方向で
// 壊れる（例: grep の対象文字列を書き換えた、変数名を打ち間違えた、jq のパスがズレた）。
// 緑が続くので誰も気づけない。scripts/check-threads.js と同じ考え方で、
// **スタブの本番サーバーを立てて verify-production.sh を実際に子プロセス実行**し、
//   ・健全な応答では全項目OK・exit 0
//   ・故意に壊した応答では該当項目が漏れなくNG・exit 1
// の両方を固定する。とくに後者（落ちるべきときに落ちる）が本体である。
//
// ネットワークには一切出ない（127.0.0.1 のスタブのみ。BASE 環境変数でスクリプトの
// 向き先を差し替える。NO_PROXY も渡すのでプロキシ配下の環境でも素通りする）。
// 依存パッケージの追加なし（node:http と node:child_process のみ）。

const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

// スクリプトは**リポジトリ相対**で渡す（cwd はこの下で repo ルートに固定する）。
// Windows の絶対パス（C:\...）を渡すと、bash の実体によっては解決できず bash が
// 127（command not found）を返し、検査が「全項目NG」に見えてしまう。
const SCRIPT = "scripts/verify-production.sh";
const REPO_ROOT = path.join(__dirname, "..");

// 使う bash を明示的に選ぶ（2026-08-11追加）。
//
// Windows には bash が複数ある。PowerShell から `bash` を呼ぶと PATH の先頭にある
// C:\Windows\System32\bash.exe＝**WSL** が選ばれるが、WSL からは Windows 側の
// 127.0.0.1 で待っているスタブサーバーに到達できず、パスの意味も変わる。
// 一方 Claude Code の Bash ツールや Git Bash 端末からは Git 同梱の bash が選ばれ、
// こちらは正常に動く。つまり**同じコマンドが呼び出し元のシェル次第で通ったり
// 落ちたりする**状態だった（しかも CI＝ubuntu では永久に再現しない）。
// Git 同梱の bash があればそれを優先し、無ければ PATH の bash に任せる。
function resolveBash() {
  if (process.platform !== "win32") return "bash";
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe"),
    process.env["ProgramFiles(x86)"] &&
      path.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? "bash";
}

const BASH = resolveBash();

// 過去クールの検査対象は content/archive/index.json の「最新クールの先頭ID」から選ばれる。
// スタブ側も同じ値を使わないと、スクリプトが選んだIDとスタブの応答がズレる。
const archive = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "content", "archive", "index.json"), "utf8")
);
const latest = archive.seasons.filter((s) => s.workIds.length > 0).at(-1);
const PAST_ID = latest.workIds[0];
const CUR_ID = 99001;

// F節（索引方針）で使う経路。verify-production.sh 側と同じ求め方をする。
// ハードコードしないのは、索引や日付が変わったときに検査だけが古くなるのを避けるため。
const INDEXED_PERSON_PATH = "/person/%E6%AB%BB%E4%BA%95%E5%AD%9D%E5%AE%8F/2023/summer";
function nextSeasonPath() {
  const order = ["winter", "spring", "summer", "autumn"];
  const now = new Date();
  const m = now.getUTCMonth() + 1;
  const cur = m <= 3 ? "winter" : m <= 6 ? "spring" : m <= 9 ? "summer" : "autumn";
  const i = order.indexOf(cur);
  const y = now.getUTCFullYear();
  return i === 3 ? `${y + 1}/winter` : `${y}/${order[i + 1]}`;
}
// verify-production.sh が選ぶ「閾値に届かない過去年の声優」と同じ人を選ぶ。
function thinPersonPath() {
  const fsMod = require("node:fs");
  const root = path.join(__dirname, "..");
  const idx = JSON.parse(fsMod.readFileSync(path.join(root, "content/archive/people.json"), "utf8")).people;
  const src = fsMod.readFileSync(path.join(root, "lib/personPage.ts"), "utf8");
  const m = src.match(/PERSON_PAGE_INDEX_MIN_TOTAL_WORKS\s*=\s*(\d+)/);
  const th = m ? Number(m[1]) : 50;
  const year = new Date().getUTCFullYear();
  const cour = new Map();
  for (const [n, ws] of Object.entries(idx)) {
    for (const w of ws) {
      const k = `${n}|${w[2]}|${w[3]}`;
      cour.set(k, (cour.get(k) || 0) + 1);
    }
  }
  for (const [k, c] of cour) {
    const [n, y, se] = k.split("|");
    if (c >= 2 && Number(y) < year && (idx[n] || []).length < th) {
      return `/person/${encodeURIComponent(n)}/${y}/${se}`;
    }
  }
  return "";
}

// クール単位のページの年が、サイトが扱う範囲に入っているか。
// lib/resolveSeasonParams.ts の isSeasonYearInRange と同じ規則（2010〜今年+1）を、
// スタブ側でも再現する。**数値を直書きせずソースから読む**ので、規則を変えたときに
// このテストだけが古くなることがない。
const MIN_SEASON_YEAR = (() => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "lib/resolveSeasonParams.ts"), "utf8");
  const m = src.match(/MIN_SEASON_YEAR\s*=\s*(\d+)/);
  return m ? Number(m[1]) : 2010;
})();
function yearInRange(year) {
  const y = Number(year);
  if (!/^\d{4}$/.test(String(year))) return false;
  return y >= MIN_SEASON_YEAR && y <= new Date().getFullYear() + 1;
}
// 作品IDの厳密な検証。lib/workId.ts の正規表現をソースから読んで再現する
// （直書きすると規則を変えたときにこのテストだけが古くなる）。
const WORK_ID_RE = (() => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "lib/workId.ts"), "utf8");
  const m = src.match(/test\((?:raw)\)[\s\S]*?/) && src.match(/\/\^\[1-9\]\[0-9\]\{0,(\d+)\}\$\//);
  return m ? new RegExp(`^[1-9][0-9]{0,${m[1]}}$`) : /^[1-9][0-9]{0,8}$/;
})();
const validWorkId = (raw) => WORK_ID_RE.test(raw);

// 実在するとみなす名前・キー（H-2＝存在しない名前が404になるかの検査用）。
const KNOWN_CREDIT_NAMES = new Set(["小野勝巳", "ぴえろ"]);
const KNOWN_SERVICE_KEYS = new Set(["netflix", "d_anime"]);

// ── スタブ本番サーバー ───────────────────────────────────────
// broken: 壊す項目名の集合。空なら健全な応答を返す。
function startStub(broken) {
  const has = (k) => broken.has(k);

  const workPage = (title, sentence, opts = {}) =>
    `<!doctype html><html><body>` +
    (opts.noH1 ? "" : `<h1>${title}</h1>`) +
    `<p>${sentence}</p>` +
    `<summary>ブログ・サイトに「${title}」の配信先を貼る（無料・HTMLをコピー）</summary>` +
    `<p class="detail-updated">配信情報の${opts.confirmWord ? "確認日" : "取得日"}: 2026-08-07</p>` +
    `</body></html>`;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const send = (body, type = "text/html; charset=utf-8", extra = {}) =>
      res.writeHead(200, { "Content-Type": type, ...extra }).end(body);

    if (p === "/api/season") {
      return send(
        JSON.stringify({ items: [{ id: CUR_ID, watchers: 900, services: [{ key: "d_anime" }] }] }),
        "application/json"
      );
    }
    if (p.startsWith("/api/work/")) {
      const raw = p.split("/").pop() || "";
      // 厳密な検証（H-3）。`loose-id` を立てると `Number.isInteger` 相当の緩い判定に
      // 戻り、MAX_SAFE_INTEGER を超える値で502を返す＝2026-08-31の事故を再現する。
      if (!validWorkId(raw)) {
        if (!has("loose-id")) {
          return res
            .writeHead(400, { "Content-Type": "application/json", ...(has("api-cors") ? {} : { "Access-Control-Allow-Origin": "*" }) })
            .end(JSON.stringify({ error: "作品IDを整数で指定してください。" }));
        }
        if (Number(raw) > Number.MAX_SAFE_INTEGER) {
          return res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "取得に失敗しました。" }));
        }
      }
      const id = Number(p.split("/").pop());
      const status = id === PAST_ID ? (has("api-status") ? "airing" : "finished") : "airing";
      return send(
        JSON.stringify({
          id,
          services: [{ key: "d_anime", name: "dアニメストア", short: "dアニメ" }],
          airingStatus: status,
        }),
        "application/json",
        has("api-cors") ? {} : { "Access-Control-Allow-Origin": "*" }
      );
    }
    // sitemap（2026-08-31追加。F節＝索引方針が本番に出ているかの検査で使う）。
    // 「過去年の声優ページが1件も載っていない」＝規則が今期のみに戻った、を検知したいので、
    // 健全な応答には過去年ぶんを1件入れておく。
    if (p === "/sitemap.xml") {
      const b = `http://127.0.0.1:${server.address().port}`;
      // G節（sitemapのURLが200を返すか）のため、面ごとに1件ずつ載せる。
      // **日本語名を入れる**（2026-08-31の障害は非ASCIIだけに出たので、ASCII名しか
      // 載っていないと検査が素通りする）。
      const thisYear = new Date().getFullYear();
      const locs = [
        `${b}/season/${thisYear}/summer`,
        `${b}/anime/${PAST_ID}`,
        `${b}/director/${encodeURIComponent("小野勝巳")}`,
        `${b}/studio/${encodeURIComponent("ぴえろ")}`,
        // G節はサービス別ページも見る（2026-08-31追加）。面ごと1件では
        // 「その1件がたまたま生きている面」の事故を丸ごと見逃すため件数も増やした。
        `${b}/service/d_anime/${thisYear}/summer`,
        `${b}/service/netflix/${thisYear}/summer`,
      ];
      if (!has("sitemap-no-past-person")) locs.push(`${b}${INDEXED_PERSON_PATH}`);
      if (has("sitemap-lists-noindex")) locs.push(`${b}${thinPersonPath()}`);
      if (!has("sitemap-no-next-season")) locs.push(`${b}/season/${nextSeasonPath()}`);
      // **xmlns を必ず付ける**（本物と同じ形にする）。ここを素の <urlset> にしていたため、
      // 「XML全体から https?:// を拾う」実装のバグ＝名前空間URL
      // （http://www.sitemaps.org/schemas/sitemap/0.9）を抜き取り対象に含めてしまう不具合が
      // CIで再現せず、本番で301として初めて出た（2026-09-01）。
      // スタブは本物の形を省略しないこと。省略した部分がそのまま検知できない穴になる。
      return send(
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
          `${locs.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`,
        "application/xml"
      );
    }
    // 制作会社・監督ページ。2026-08-31の障害（非ASCII名の事前生成ページが404）を
    // 再現できるように、pregen-404 を立てると日本語名だけ404を返す。
    if (p.startsWith("/director/") || p.startsWith("/studio/")) {
      const name = decodeURIComponent(p.split("/").pop() || "");
      const nonAscii = [...name].some((ch) => ch.codePointAt(0) > 0x7f);
      if (has("pregen-404") && nonAscii) {
        return res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }).end("<h1>404</h1>");
      }
      // 索引に無い名前は404（H-2）。`unknown-name-200` を立てると200を返し、
      // 「存在しない名前を200で公開してしまう」事故を再現する。
      if (!KNOWN_CREDIT_NAMES.has(name) && !has("unknown-name-200")) {
        return notFoundPage(res);
      }
      return send(`<!doctype html><html><body><h1>${name}</h1></body></html>`);
    }
    // クール単位のページ（/rankings /exclusive /service）。年の範囲と、
    // 取得失敗の本文が索引可能な形で出ていないかを見るために必要（H節）。
    if (p.startsWith("/rankings/") || p.startsWith("/exclusive/") || p.startsWith("/service/")) {
      const seg = p.split("/").filter(Boolean);
      const isService = seg[0] === "service";
      const year = isService ? seg[2] : seg[1];
      if (isService && !KNOWN_SERVICE_KEYS.has(seg[1]) && !has("unknown-name-200")) {
        return notFoundPage(res);
      }
      // 範囲外の年は404。`soft-404` を立てると200を返し、㊲の事故を再現する。
      if (!yearInRange(year) && !has("soft-404")) return notFoundPage(res);
      return send(
        `<!doctype html><html><head><meta name="robots" content="index, follow"></head><body>` +
          `<h1>${seg[0]}</h1>` +
          (has("error-body-indexed") ? `<p>Annict API がエラーを返しました（500）。</p>` : "") +
          `</body></html>`
      );
    }
    if (p.startsWith("/person/")) {
      const pYear = p.split("/").filter(Boolean)[2];
      if (!yearInRange(pYear) && !has("soft-404")) return notFoundPage(res);
      // sitemapに載せた過去年のページは index、閾値に届かない人は noindex。
      const listed = decodeURIComponent(p) === decodeURIComponent(INDEXED_PERSON_PATH);
      const pname = decodeURIComponent(p.split("/")[2] || "");
      const pNonAscii = [...pname].some((ch) => ch.codePointAt(0) > 0x7f);
      const pastYear = !p.includes(`/${new Date().getFullYear()}/`);
      if (has("pregen-404") && pNonAscii && pastYear) {
        return res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }).end("<h1>404</h1>");
      }
      const noindex = listed ? has("person-indexed-is-noindex") : !has("person-thin-is-index");
      return send(
        `<!doctype html><html><head><meta name="robots" content="${
          noindex ? "noindex, follow" : "index, follow"
        }"></head><body><h1>声優</h1></body></html>`
      );
    }
    if (p.startsWith("/season/")) {
      const sYear = p.split("/").filter(Boolean)[1];
      if (!yearInRange(sYear) && !has("soft-404")) return notFoundPage(res);
      // 壊し方は⑦-10の実物に合わせる（Suspenseのfallbackだけが出た状態）。
      if (has("season-empty")) return send(`<!doctype html><html><body><div class="wrap"></div></body></html>`);
      const links = Array.from({ length: 158 }, (_, i) => `<a href="/anime/${1000 + i}">作品${i}</a>`).join("");
      return send(
        `<!doctype html><html><body><h1>${sYear}年夏アニメ</h1>${links}` +
          (has("error-body-indexed") ? `<p>取得に失敗しました。</p>` : "") +
          `</body></html>`
      );
    }
    if (p.startsWith("/embed/anime/")) {
      const eRaw = p.split("/").pop() || "";
      if (!validWorkId(eRaw)) {
        if (!has("loose-id")) {
          return res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end("作品IDが正しくありません。");
        }
        if (Number(eRaw) > Number.MAX_SAFE_INTEGER) {
          return res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" }).end("取得に失敗しました。");
        }
      }
      const base = `http://127.0.0.1:${server.address().port}`;
      return send(
        `<!doctype html><html><body>` +
          `<a href="${base}/anime/${PAST_ID}${has("embed-ref") ? "" : "?ref=embed"}">見る</a>` +
          (has("embed-script") ? `<script>alert(1)</script>` : "") +
          (has("embed-external") ? `<a href="https://px.a8.net/x">広告</a>` : "") +
          `</body></html>`
      );
    }
    if (p.startsWith("/anime/")) {
      const aRaw = p.split("/").pop() || "";
      // 厳密な検証（H-3）。緩いと 0x3374 / 0013180 / 13180.0 が同じ作品の別URLとして
      // 200を返し、無駄なISR書き込みが起きる。
      if (!validWorkId(aRaw) && !has("loose-id")) return notFoundPage(res);
      const id = Number(p.split("/").pop());
      if (id === PAST_ID) {
        return send(
          workPage(
            "過去作",
            has("past-wording")
              ? "「過去作」は dアニメストア で視聴できます（2026-08-07時点）。"
              : "「過去作」の配信情報があるのは dアニメストア です（2026-08-07時点のAnnictデータ）。",
            { confirmWord: has("past-confirm-word") }
          )
        );
      }
      return send(
        workPage(
          "今期作",
          has("current-wording")
            ? "「今期作」の配信情報があるのは dアニメストア です。"
            : "「今期作」は dアニメストア で視聴できます（2026-08-07時点）。",
          { noH1: has("current-no-h1") }
        )
      );
    }
    return notFoundPage(res);
  });

  // 404ページ（I節）。行き止まりにしない＝h1・サイト内リンク・noindex を持つ。
  // `notfound-dead-end` でリンクを消し、`notfound-soft` で200を返す（ソフト404の再現）。
  function notFoundPage(res) {
    const body =
      `<!doctype html><html><head><meta name="robots" content="noindex"></head><body>` +
      `<h1>ページが見つかりません</h1>` +
      (has("notfound-dead-end")
        ? ""
        : `<a href="/">トップ</a><a href="/about">運営者情報</a><a href="/season/2025/summer">2025年夏</a>`) +
      `</body></html>`;
    const code = has("notfound-soft") ? 200 : 404;
    return res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }).end(body);
  }

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function runScript(port) {
  return new Promise((resolve) => {
    const child = spawn(BASH, [SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BASE: `http://127.0.0.1:${port}`,
        // プロキシ配下の開発環境でもスタブへ直接届くようにする。
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

// ── テスト本体 ──────────────────────────────────────────────
let ng = 0;
function check(name, pass, detail) {
  if (!pass) ng++;
  console.log(`${pass ? "✓" : "✗"}  ${name.padEnd(52)} → ${detail}`);
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
  console.log("── 本番SSRの実地検査（verify-production.sh）自身の回帰テスト ──");
  console.log(`（過去クールの検査対象: 作品#${PAST_ID} / ${latest.year}-${latest.season}）\n`);

  // ① 健全な応答では全項目OK・exit 0。
  const good = await withStub([], runScript);
  check("① 健全な本番では成功する", good.code === 0, `exit=${good.code}`);
  check(
    "① NGが1件も出ない",
    !/^\s*NG\s/m.test(good.out),
    good.out.match(/^\s*NG\s+.*/m)?.[0]?.trim() ?? "NGなし"
  );
  const okCount = (good.out.match(/^\s*OK\s/gm) || []).length;
  // 検査を削ると気づけるように件数も固定する
  // （A:2 A2:1 B:6 C:2 D:3 E:3 F:4 G:7 H:4 I:3 = 35。
  //  verify-production.sh に検査を足したらこの数も更新する）。
  check("① OKが35件（検査の取りこぼしが無い）", okCount === 35, `${okCount}件`);

  // ①-2 sitemap全体からの抜き取りが**実際に1件以上叩いている**こと。
  // ここは「0件でもOKを出す」形で静かに無力化していた（awk の NR % s == 1 が s=1 のとき
  // 1件も選ばず、スタブのsitemapは常に20件未満だったので、CIでは一度も抜き取りが
  // 走っていなかった。2026-09-01）。件数を見ないと、この壊れ方は緑のまま通る。
  const sampled = good.out.match(/sitemap全体からの抜き取り\s+(\d+)件/);
  const sampledN = sampled ? Number(sampled[1]) : 0;
  check(
    "①-2 sitemapの抜き取りが1件以上走っている",
    sampledN > 0,
    sampled ? `${sampledN}件を実際に叩いた` : "抜き取りのOK行が出ていない＝0件で通っている"
  );

  // ② 壊れた応答では、その項目が確実にNGになる（＝検査が生きている）。
  //    1項目ずつ壊して「その事故だけを捕まえる」ことを確かめる。
  const faults = [
    ["season-empty", "シーズンページが空HTML（⑦-10の再現）", "<h1> が 0 個"],
    ["current-no-h1", "作品ページに<h1>が無い", "<h1> が 0 個"],
    ["past-wording", "過去作に「視聴できます」（⑰の再現）", "現在形の断定をしていない"],
    ["past-confirm-word", "「確認日」と書いてしまった", "取得日と書いている"],
    ["current-wording", "放送中作品が終了作品の文言になった", "断定形が出ている"],
    ["embed-script", "埋め込みに<script>が入った（⑯の再現）", "<script> を含まない"],
    ["embed-external", "埋め込みに自サイト外リンクが入った（⑯の再現）", "自サイト外へのリンク"],
    ["embed-ref", "埋め込みのリンクから?ref=embedが消えた", "ref=embed"],
    ["api-status", "公開APIのairingStatusが誤り", "airingStatus"],
    ["api-cors", "公開APIのCORSヘッダが消えた", "CORSヘッダ"],
    // F節（索引方針・2026-08-31追加）。この4件は「直したつもりで本番に出ていない」を
    // 捕まえるための検査なので、落ちるべきときに落ちることを必ず固定する（㉟）。
    ["person-thin-is-index", "閾値未満の声優ページがindexのまま（未デプロイの再現）", "index のまま"],
    ["sitemap-no-past-person", "索引方針が今期のみに戻った", "過去年の声優ページが1件も無い"],
    ["person-indexed-is-noindex", "sitemapに載せたページがnoindexになった", "noindex"],
    ["sitemap-lists-noindex", "noindexのページをsitemapが申告している", "sitemapが申告"],
    ["sitemap-no-next-season", "次クールがsitemapから消えた", "次クール"],
    // G節（2026-08-31追加）。日本語名の事前生成ページが本番で404になっていた事故。
    // robotsメタを見るだけの検査は「404にはrobotsが無い→noindexではない→合格」で
    // すり抜けていたので、HTTPコードで捕まえられることを固定する。
    ["pregen-404", "日本語名の事前生成ページが404（㊱の再現）", "が 404"],
    // H/I節（2026-08-31追加）。取得に失敗したページ・中身が空のページが 200＋index で
    // 返っていた事故（㊲）。年の判定が「4桁の数字か」だけだったため、存在しない年の
    // URLがAnnictへのライブ取得とISR書き込みを無制限に発生させていた。
    ["soft-404", "範囲外の年が200を返す（㊲の再現）", "範囲外の年が"],
    ["unknown-name-200", "存在しない名前・キーが200を返す", "存在しない名前が"],
    ["error-body-indexed", "sitemapのページにエラー本文が出ている（㊲の再現）", "取得失敗の本文"],
    ["notfound-soft", "存在しないURLが200を返す（ソフト404）", "ソフト404になっている"],
    ["notfound-dead-end", "404ページが行き止まり（㊲の再現）", "行き止まりになっている"],
    // 作品IDの検証が緩い（㊲。逆張り巡回で見つけた。公開APIと埋め込みが502を返していた）。
    ["loose-id", "作品IDの検証が緩く502や重複URLが出る（㊲の再現）", "作品IDの形を崩したら"],
  ];
  for (const [fault, label, needle] of faults) {
    const r = await withStub([fault], runScript);
    const failed = r.code !== 0;
    const mentioned = new RegExp(`^\\s*NG\\s+.*${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(r.out);
    check(`② ${label}`, failed && mentioned, failed ? (mentioned ? "NGで検出" : `exit1だが該当NG無し`) : "見逃した");
  }

  // ③ 全部まとめて壊しても、1件目で止まらず最後まで検査する
  //    （途中で exit すると残りの事故が見えなくなる）。
  const all = await withStub(faults.map(([f]) => f), runScript);
  const ngCount = (all.out.match(/^\s*NG\s/gm) || []).length;
  check("③ 全部壊すと複数NGを出して最後まで走る", all.code !== 0 && ngCount >= 16, `NG ${ngCount}件 / exit=${all.code}`);
  check("③ E節（最後の検査）まで到達している", all.out.includes("E. 公開API"), all.out.includes("E. 公開API") ? "到達" : "途中で終了");

  console.log(`\n結果: ${ng === 0 ? "全件OK" : `${ng} 件NG`}`);
  process.exit(ng === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
