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

const SCRIPT = path.join(__dirname, "verify-production.sh");

// 過去クールの検査対象は content/archive/index.json の「最新クールの先頭ID」から選ばれる。
// スタブ側も同じ値を使わないと、スクリプトが選んだIDとスタブの応答がズレる。
const archive = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "content", "archive", "index.json"), "utf8")
);
const latest = archive.seasons.filter((s) => s.workIds.length > 0).at(-1);
const PAST_ID = latest.workIds[0];
const CUR_ID = 99001;

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
    if (p.startsWith("/season/")) {
      // 壊し方は⑦-10の実物に合わせる（Suspenseのfallbackだけが出た状態）。
      if (has("season-empty")) return send(`<!doctype html><html><body><div class="wrap"></div></body></html>`);
      const links = Array.from({ length: 158 }, (_, i) => `<a href="/anime/${1000 + i}">作品${i}</a>`).join("");
      return send(`<!doctype html><html><body><h1>2026年夏アニメ</h1>${links}</body></html>`);
    }
    if (p.startsWith("/embed/anime/")) {
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
    res.writeHead(404).end("nf");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function runScript(port) {
  return new Promise((resolve) => {
    const child = spawn("bash", [SCRIPT], {
      cwd: path.join(__dirname, ".."),
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
  // 検査を削ると気づけるように件数も固定する（A:2 A2:1 B:6 C:2 D:3 E:3 = 17。
  // verify-production.sh に検査を足したらこの数も更新する）。
  check("① OKが17件（検査の取りこぼしが無い）", okCount === 17, `${okCount}件`);

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
  check("③ 全部壊すと複数NGを出して最後まで走る", all.code !== 0 && ngCount >= 10, `NG ${ngCount}件 / exit=${all.code}`);
  check("③ E節（最後の検査）まで到達している", all.out.includes("E. 公開API"), all.out.includes("E. 公開API") ? "到達" : "途中で終了");

  console.log(`\n結果: ${ng === 0 ? "全件OK" : `${ng} 件NG`}`);
  process.exit(ng === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
