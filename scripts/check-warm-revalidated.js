// scripts/warm-revalidated.sh（消したISRキャッシュを温めるバッチ）そのものの回帰テスト。
//
// 【なぜ要るか・2026-10-01】
// このスクリプトは「温めが効いていない」ことを検知して落ちる＝**検査でもある**。
// シェルの検査は「NGを出さなくなる」方向に壊れると**毎日緑のまま無力化する**
// （例: x-vercel-cache の見方を書き換えた、case の分岐を足しすぎた、変数名を打ち間違えた）。
// 緑が続くので誰も気づけず、気づくのは訪問者が数十秒待たされていることに
// 別の経路で気づいたときになる。scripts/check-verify-production.js と同じ考え方で、
// **スタブの本番サーバーを立てて warm-revalidated.sh を実際に子プロセス実行**し、
//   ・健全な応答では全部OK・exit 0
//   ・故意に壊した応答では該当項目がNG・exit 1
// の両方を固定する。とくに後者（落ちるべきときに落ちる）が本体である。
//
// ネットワークには一切出ない（127.0.0.1 のスタブのみ）。依存パッケージの追加なし。
// **jq は使わない**（Windows に無い。verify-production.sh と同じ理由で json-pick.js を通す）。

const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const SCRIPT = "scripts/warm-revalidated.sh";
const REPO_ROOT = path.join(__dirname, "..");

// 使う bash を明示的に選ぶ（check-verify-production.js と同じ理由。
// Windows では PATH の先頭が WSL の bash になり、127.0.0.1 のスタブに届かない）。
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

const SECRET = "test-secret";

// スタブの既定の挙動。健全な本番を模す。
//   ・POST /api/revalidate?scope=... → warm.data / warm.pages を返す
//   ・GET  /api/season...            → 200
//   ・GET  ページ                     → 1回目は miss、2回目以降は hit（本物のISRと同じ形）
function makeStub(opts = {}) {
  const seen = new Map();
  const calls = { revalidate: [], data: [], pages: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const p = url.pathname;

    if (p === "/api/revalidate") {
      const scope = url.searchParams.get("scope");
      calls.revalidate.push(scope);
      if (req.headers["x-cron-secret"] !== SECRET) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (opts.revalidateStatus) {
        res.writeHead(opts.revalidateStatus, { "content-type": "text/plain" });
        res.end("boom");
        return;
      }
      const pages =
        opts.noWarmPages
          ? undefined
          : scope === "next"
            ? ["/season/2027/winter", "/rankings/2027/winter"]
            : ["/", "/season/2026/autumn"];
      const season = scope === "next" ? "2027&season=winter" : "2026&season=autumn";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          warm: { data: [`/api/season?year=${season}`], pages },
        })
      );
      return;
    }

    if (p === "/api/season") {
      calls.data.push(req.url);
      res.writeHead(opts.dataStatus || 200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }

    // ページ。
    calls.pages.push(p);
    const n = (seen.get(p) || 0) + 1;
    seen.set(p, n);
    if (opts.pageStatus) {
      res.writeHead(opts.pageStatus, { "content-type": "text/html" });
      res.end("boom");
      return;
    }
    // opts.cache で2回目の値を差し替えられる（温まらない本番を模す）。
    const cache = n === 1 ? "MISS" : (opts.cache ?? "HIT");
    const headers = { "content-type": "text/html" };
    if (cache !== "(none)") headers["x-vercel-cache"] = cache;
    res.writeHead(200, headers);
    res.end("<html></html>");
  });
  return { server, calls };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function runScript(port) {
  return new Promise((resolve) => {
    const child = spawn(BASH, [SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BASE: `http://127.0.0.1:${port}`,
        CRON_SECRET: SECRET,
        // プロキシ配下でも 127.0.0.1 を素通りさせる。
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        http_proxy: "",
        https_proxy: "",
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

async function withStub(opts, fn) {
  const { server, calls } = makeStub(opts);
  const port = await listen(server);
  try {
    const r = await runScript(port);
    await fn(r, calls);
  } finally {
    server.close();
  }
}

let ng = 0;
function check(label, ok, detail = "") {
  if (!ok) ng++;
  console.log(`${ok ? "✓" : "✗"}  ${label.padEnd(54)} ${ok ? "OK" : `NG ${detail}`}`);
}

(async () => {
  console.log("── 消した面の温め（scripts/warm-revalidated.sh）の検査 ──");

  // ① 健全な本番: 全部OK・exit 0
  await withStub({}, (r, calls) => {
    check("健全な応答では成功する", r.code === 0, `exit=${r.code}\n${r.out}`);
    check("全てOKと出す", /全てOK/.test(r.out), r.out);
    // **順番に意味がある**（共有タグを古くするのは current だけなので、逆順だと冷える）。
    check(
      "current → next の順に叩く",
      JSON.stringify(calls.revalidate) === JSON.stringify(["current", "next"]),
      JSON.stringify(calls.revalidate)
    );
    // データ層を先に温める（ページの温めが軽くなる）。
    check("データ層を温める", calls.data.length === 2, JSON.stringify(calls.data));
    // CDNから返って関数が走らない事故を防ぐ毎回違うクエリ。
    check(
      "データ層の温めでCDNを避ける（_warm を足す）",
      calls.data.every((u) => /[?&]_warm=\d+/.test(u)),
      JSON.stringify(calls.data)
    );
    // 温め先は応答から取る＝クール名を書き写していない。
    check(
      "応答が指した面を温める",
      calls.pages.includes("/") && calls.pages.includes("/season/2026/autumn") &&
        calls.pages.includes("/season/2027/winter"),
      JSON.stringify(calls.pages)
    );
    // 温めたあともう1回取って確認している（1面あたり2回）。
    check(
      "温めたあと確認のためもう1回取る",
      calls.pages.filter((p) => p === "/").length === 2,
      JSON.stringify(calls.pages)
    );
    // 作品ページは温めない（件数に比例する仕事を増やさない）。
    check("作品ページは温めない", !calls.pages.some((p) => p.startsWith("/anime/")),
      JSON.stringify(calls.pages));
  });

  // ② **落ちるべきときに落ちる（本体）**: 温めても miss のまま
  await withStub({ cache: "MISS" }, (r) => {
    check("温まらなければ落ちる", r.code === 1, `exit=${r.code}\n${r.out}`);
    check("温めが効いていないと名指しする", /温めが効いていません/.test(r.out), r.out);
    check("x-vercel-cache の実測値を出す", /x-vercel-cache=miss/.test(r.out), r.out);
  });

  // ③ BYPASS（動的扱い）も「待たせた」側として落とす。
  await withStub({ cache: "BYPASS" }, (r) => {
    check("BYPASSでも落ちる", r.code === 1, `exit=${r.code}`);
  });

  // ④ ヘッダーが付かない相手を**黙って成功にしない**
  //    （本番以外や設定変更で消えたとき、空を「温まった」に倒すと見張りが無力化する）。
  await withStub({ cache: "(none)" }, (r) => {
    check("x-vercel-cache が無ければ落ちる", r.code === 1, `exit=${r.code}`);
    check("無いことを「なし」と出す", /x-vercel-cache=なし/.test(r.out), r.out);
  });

  // ⑤ STALE / PRERENDER は成功（どちらも訪問者は待っていない）。
  for (const cache of ["STALE", "PRERENDER"]) {
    await withStub({ cache }, (r) => {
      check(`${cache} は成功として扱う`, r.code === 0, `exit=${r.code}\n${r.out}`);
    });
  }

  // ⑥ 窓口が落ちている → 落ちる。かつ**もう片方のクールは続ける**
  //    （1件の失敗で残りを巻き添えにしない＝CLAUDE.mdの基本ルール）。
  await withStub({ revalidateStatus: 500 }, (r, calls) => {
    check("窓口が500なら落ちる", r.code === 1, `exit=${r.code}`);
    check("再検証の失敗を名指しする", /再検証に失敗しました/.test(r.out), r.out);
    check(
      "片方が失敗してももう片方を続ける",
      JSON.stringify(calls.revalidate) === JSON.stringify(["current", "next"]),
      JSON.stringify(calls.revalidate)
    );
  });

  // ⑦ 温め先が返ってこない → 黙って成功しない。
  await withStub({ noWarmPages: true }, (r, calls) => {
    check("温め先が無ければ落ちる", r.code === 1, `exit=${r.code}`);
    check("温め先が無いことを名指しする", /温める先が返ってきませんでした/.test(r.out), r.out);
    check("温め先が無いならページを叩かない", calls.pages.length === 0, JSON.stringify(calls.pages));
  });

  // ⑧ データ層が温まらない → 落ちる。
  await withStub({ dataStatus: 500 }, (r) => {
    check("データ層を温められなければ落ちる", r.code === 1, `exit=${r.code}`);
    check("データ層の失敗を名指しする", /データ層を温められませんでした/.test(r.out), r.out);
  });

  // ⑨ ページが200でない → 落ちる。
  await withStub({ pageStatus: 500 }, (r) => {
    check("ページが200でなければ落ちる", r.code === 1, `exit=${r.code}`);
    check("ページの失敗を名指しする", /温められませんでした/.test(r.out), r.out);
  });

  // ⑩ 秘密が違えば窓口が401＝落ちる（秘密の設定漏れで黙って止まらない）。
  {
    const { server } = makeStub({});
    const port = await listen(server);
    try {
      const r = await new Promise((resolve) => {
        const child = spawn(BASH, [SCRIPT], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            BASE: `http://127.0.0.1:${port}`,
            CRON_SECRET: "wrong",
            NO_PROXY: "127.0.0.1,localhost",
            no_proxy: "127.0.0.1,localhost",
            HTTP_PROXY: "",
            HTTPS_PROXY: "",
            http_proxy: "",
            https_proxy: "",
          },
        });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        child.on("close", (code) => resolve({ code, out }));
      });
      check("秘密が違えば落ちる", r.code === 1, `exit=${r.code}\n${r.out}`);
    } finally {
      server.close();
    }
  }

  console.log(ng === 0 ? "結果（消した面の温め）: 全てOK" : `結果（消した面の温め）: ${ng} 件NG`);
  if (ng > 0) process.exitCode = 1;
})();
