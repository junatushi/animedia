#!/usr/bin/env node
"use strict";

// scripts/seo-report.js の回帰テスト（2026-08-19導入）。
//
// 【なぜ要るか】このスクリプトは「毎日SEOを改善する」運用で**判断の入力になる唯一の道具**
// （docs/seo-operations.md）。壊れ方が問題で、落ちるのではなく
// **数字を静かに間違える**方向に壊れると、間違った面に投資し続けることになる。
// 特に面別の「1ページあたりクリック」は、これを根拠に重点を決めるので、
// 集計を取り違えたまま緑になるのがいちばん怖い。
//
// 仮のGSC JSONを一時ディレクトリに置き、seo-report.js を**実際に動かして**検証する。
// ネットワークには出ない。`seo-report.js` を触ったら必ず実行する。

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SCRIPT = path.join(__dirname, "seo-report.js");
let ok = 0;
let ng = 0;

function check(label, cond, detail) {
  if (cond) {
    ok += 1;
    console.log(`✓  ${label}${detail ? "  → " + detail : ""}`);
  } else {
    ng += 1;
    console.log(`✗  ${label}${detail ? "  → " + detail : ""}`);
  }
}

/** 仮のGSCスナップショットを書いて seo-report.js を走らせ、出力を返す。 */
function runWith(snapshots, args = [], aliases = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-report-"));
  const gscDir = path.join(dir, "content", "analytics", "gsc");
  fs.mkdirSync(gscDir, { recursive: true });
  // 略称ファイル（任意）。seo-report.js は content/works/aliases.ts と
  // content/services/aliases.ts を __dirname 基準で探すので、同じ相対関係で置く。
  if (aliases) {
    for (const [rel, words] of Object.entries(aliases)) {
      const f = path.join(dir, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const body = words
        .map(
          (w, i) =>
            `  ${i + 1}: { names: [${w
              .map((x) => JSON.stringify(x))
              .join(", ")}], sourceUrl: "https://example.test", confirmedDate: "2026-08-19" },`
        )
        .join("\n");
      fs.writeFileSync(f, `export const X = {\n${body}\n};\n`);
    }
  }
  for (const [date, data] of Object.entries(snapshots)) {
    fs.writeFileSync(path.join(gscDir, `${date}.json`), JSON.stringify(data));
  }
  // seo-report.js は __dirname 基準で content/analytics/gsc を見るので、
  // スクリプトを一時ディレクトリの scripts/ に写して同じ相対関係を作る。
  const scriptsDir = path.join(dir, "scripts");
  const libDir = path.join(scriptsDir, "lib");
  fs.mkdirSync(libDir, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(scriptsDir, "seo-report.js"));
  fs.copyFileSync(
    path.join(__dirname, "lib", "gsc-page-type.js"),
    path.join(libDir, "gsc-page-type.js")
  );
  const out = execFileSync(process.execPath, [path.join(scriptsDir, "seo-report.js"), ...args], {
    encoding: "utf8",
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

const HOST = "https://example.test";
function page(p, clicks, impressions, position) {
  return { keys: [`${HOST}${p}`], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}
function query(q, clicks, impressions, position) {
  return { keys: [q], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

console.log("── seo-report.js の回帰テスト ──\n");

// ─────────────────────────────────────────────
// ① 面別の効率：1ページあたりクリックで並ぶこと
//    （表示回数の多い面が上に来てしまうと、重点の判断が逆になる）
// ─────────────────────────────────────────────
{
  const out = runWith({
    "2026-08-15": {
      totals: { clicks: 19, impressions: 847, ctr: 0.022, position: 19.8 },
      range: { startDate: "2026-07-19", endDate: "2026-08-15" },
      daily: [],
      queries: [],
      pages: [
        // 声優: 2ページで8クリック → 1ページあたり 4.00
        page("/person/A/2026/summer", 5, 50, 5.0),
        page("/person/B/2026/summer", 3, 50, 6.0),
        // 作品: 4ページで11クリック・表示は圧倒的に多い → 1ページあたり 2.75
        page("/anime/1", 4, 300, 22.0),
        page("/anime/2", 3, 200, 23.0),
        page("/anime/3", 2, 150, 24.0),
        page("/anime/4", 2, 97, 25.0),
      ],
    },
  });

  const personIdx = out.indexOf("声優");
  const workIdx = out.indexOf("作品");
  check(
    "面別は1ページあたりクリックの降順（表示回数の多い面に騙されない）",
    personIdx !== -1 && workIdx !== -1 && personIdx < workIdx,
    "声優(4.00) が 作品(2.75) より上"
  );
  check("1ページあたりの値が出る", /4\.00/.test(out) && /2\.75/.test(out), "4.00 / 2.75");
}

// ─────────────────────────────────────────────
// ② CTR・平均順位は表示回数で重み付けすること（単純平均は歪む）
// ─────────────────────────────────────────────
{
  const out = runWith({
    "2026-08-15": {
      totals: { clicks: 1, impressions: 101, ctr: 0.01, position: 50 },
      range: { startDate: "2026-07-19", endDate: "2026-08-15" },
      daily: [],
      queries: [],
      pages: [
        // 100表示で50位、1表示で1位。単純平均なら25.5位、重み付けなら約49.5位。
        page("/anime/1", 1, 100, 50.0),
        page("/anime/2", 0, 1, 1.0),
      ],
    },
  });
  check(
    "平均順位は表示回数で重み付け（単純平均25.5位にならない）",
    /49\.5/.test(out) && !/25\.5/.test(out),
    "49.5位"
  );
}

// ─────────────────────────────────────────────
// ③ 表示回数ゼロの面を名指しすること
//    （作ったが回収できていない投資が黙って消えると、畳む判断ができない）
// ─────────────────────────────────────────────
{
  const out = runWith({
    "2026-08-15": {
      totals: { clicks: 1, impressions: 10, ctr: 0.1, position: 5 },
      range: { startDate: "2026-07-19", endDate: "2026-08-15" },
      daily: [],
      queries: [],
      pages: [page("/person/A/2026/summer", 1, 10, 5.0)],
    },
  });
  check("表示ゼロの面を警告する", /表示回数ゼロの面/.test(out), "⚠ が出る");
  check("監督・制作会社が名指しされる", /監督/.test(out) && /制作会社/.test(out));
}

// ─────────────────────────────────────────────
// ④ 手を入れる候補：11〜20位のクエリを拾い、1ページ目のものは混ぜない
//    （ここが混ざると「あと一歩」の判断ができなくなる）
// ─────────────────────────────────────────────
{
  const out = runWith({
    "2026-08-15": {
      totals: { clicks: 1, impressions: 100, ctr: 0.01, position: 15 },
      range: { startDate: "2026-07-19", endDate: "2026-08-15" },
      daily: [],
      queries: [
        query("おしいクエリ", 0, 20, 12.0), // 11〜20位 → (b)に出る
        query("1ページ目のクエリ", 1, 20, 5.0), // 10位以内 → (c)に出る
        query("圏外のクエリ", 0, 20, 45.0), // 20位超 → どちらにも出ない
      ],
      pages: [],
    },
  });
  const b = out.split("(b)")[1]?.split("(c)")[0] ?? "";
  const c = out.split("(c)")[1] ?? "";
  check("(b)は11〜20位のクエリだけ", b.includes("おしいクエリ") && !b.includes("1ページ目のクエリ"));
  check("(b)に圏外(20位超)を混ぜない", !b.includes("圏外のクエリ"));
  check("(c)は10位以内のクエリ", c.includes("1ページ目のクエリ"));
}

// ─────────────────────────────────────────────
// ⑤ 表示20回以上でクリック0のページを拾い、少数表示のノイズを混ぜないこと
// ─────────────────────────────────────────────
{
  const out = runWith({
    "2026-08-15": {
      totals: { clicks: 0, impressions: 105, ctr: 0, position: 20 },
      range: { startDate: "2026-07-19", endDate: "2026-08-15" },
      daily: [],
      queries: [],
      pages: [
        page("/anime/big", 0, 100, 16.0), // 拾う
        page("/anime/small", 0, 5, 30.0), // 表示が少ない → 拾わない
      ],
    },
  });
  const a = out.split("(a)")[1]?.split("(b)")[0] ?? out.split("(a)")[1] ?? "";
  check("(a)は表示20回以上のみ", a.includes("/anime/big") && !a.includes("/anime/small"));
}

// ─────────────────────────────────────────────
// ⑥ データが無くても落ちないこと（セットアップ前・鍵未登録の日）
// ─────────────────────────────────────────────
{
  let threw = false;
  let out = "";
  try {
    out = runWith({});
  } catch {
    threw = true;
  }
  check("スナップショットが1件も無くても落ちない", !threw && /データがありません/.test(out));
}

// ─────────────────────────────────────────────
// ⑦ --json は機械可読で返すこと（後から別の道具で読めるように）
// ─────────────────────────────────────────────
{
  const out = runWith(
    {
      "2026-08-15": {
        totals: { clicks: 2, impressions: 20, ctr: 0.1, position: 5 },
        range: { startDate: "2026-07-19", endDate: "2026-08-15" },
        daily: [],
        queries: [],
        pages: [page("/person/A/2026/summer", 2, 20, 5.0)],
      },
    },
    ["--json"]
  );
  let parsed = null;
  try {
    parsed = JSON.parse(out);
  } catch {
    /* noop */
  }
  check("--json がJSONとして解釈できる", parsed !== null);
  check(
    "--json に面別の1ページあたりが入る",
    parsed?.byType?.[0]?.clicksPerPage === 2,
    parsed ? `clicksPerPage=${parsed.byType[0].clicksPerPage}` : "パース失敗"
  );
}

// ─────────────────────────────────────────────
// ⑧ ⑥通称・略称クエリ（2026-08-19導入）
//
// この節は「略称をページに出した施策が効いたか」を判定する唯一の入力なので、
// 数え間違えると判定そのものが狂う。落ちるのではなく静かに間違える方向を止める。
// ─────────────────────────────────────────────
{
  const snap = {
    "2026-08-15": {
      totals: { clicks: 0, impressions: 30, ctr: 0, position: 20 },
      range: { startDate: "2026-07-19", endDate: "2026-08-15" },
      daily: [],
      queries: [
        { keys: ["逃げ若 2期 配信"], clicks: 0, impressions: 14, ctr: 0, position: 30 },
        { keys: ["逃げ若 ネトフリ"], clicks: 1, impressions: 6, ctr: 0.16, position: 10 },
        { keys: ["まったく無関係な検索語"], clicks: 5, impressions: 100, ctr: 0.05, position: 3 },
      ],
      pages: [page("/anime/1", 0, 30, 20)],
    },
  };
  const aliases = {
    "content/works/aliases.ts": [["逃げ若"], ["逃げ若"]], // 同じ語の重複登録
    "content/services/aliases.ts": [["ネトフリ"]],
  };
  const out = runWith(snap, [], aliases);

  // 重複登録を種類として二重に数えない（作品ごとに同じ略称を登録するのが普通のため）。
  check(
    "登録済みの略称を重複排除して数える",
    /作品の通称 1種 \/ サービスの口語形 1種/.test(out),
    (out.match(/登録済み:.*/) || ["(出力なし)"])[0].trim()
  );

  // 略称を含むクエリだけを拾い、無関係なクエリを混ぜない。
  check(
    "略称を含むクエリだけを集計する",
    /略称を含むクエリ: 2種  1クリック  20表示/.test(out),
    (out.match(/略称を含むクエリ:.*/) || ["(出力なし)"])[0].trim()
  );

  // 平均順位は表示回数で重み付けする（単純平均だと20位になる）。
  check(
    "略称クエリの平均順位を表示回数で重み付けする",
    /平均24\.0位/.test(out),
    "(14×30 + 6×10) / 20 = 24.0"
  );

  // どの語で拾ったかを出す（複数該当も両方出す）。
  check(
    "どの略称で拾ったかを出す",
    /\[逃げ若・ネトフリ\]/.test(out),
    "「逃げ若 ネトフリ」は2語に該当"
  );

  // 該当ゼロを黙らない（「まだ効いていない」と「壊れている」を混同させない）。
  const zero = runWith(snap, [], {
    "content/works/aliases.ts": [["どのクエリにも出てこない語"]],
  });
  check(
    "該当ゼロのときにそう言う",
    /略称を含むクエリ: 0種/.test(zero) && /まだ1件も拾えていない/.test(zero),
    "0件でも節ごと消えない"
  );

  // 略称ファイルが無い環境でも落ちない。
  const none = runWith(snap);
  check(
    "略称ファイルが無くても落ちない",
    /登録済みの略称がありません/.test(none),
    "空を返して続行する"
  );

  // --json にも同じ数字を出す（別の道具から判定できるように）。
  const j = runWith(snap, ["--json"], aliases);
  let parsed = null;
  try {
    parsed = JSON.parse(j);
  } catch {
    /* noop */
  }
  check(
    "--json に略称クエリの数字が入る",
    parsed?.alias?.queries === 2 &&
      parsed?.alias?.clicks === 1 &&
      parsed?.alias?.impressions === 20,
    parsed ? JSON.stringify(parsed.alias) : "パース失敗"
  );
}

// ─────────────────────────────────────────────
// ⑨ ④面別の週次推移：途中の週に印を付けること（2026-09-01導入）
//
// docs/operations.md ㉟の再発防止。途中の週（days<7）を完全な週とそのまま並べて
// 「表示が増えた/減った」と結論すると、2026-08-25の診断と同じ間違いになる。
// weeklyByType の partial フラグ（scripts/lib/gsc-page-type.js）を人間の目に
// 見える形で出すのがこのスクリプトの仕事のはずなので、その表示だけを確認する。
// ─────────────────────────────────────────────
{
  const snap = {
    "2026-08-15": {
      totals: { clicks: 1, impressions: 10, ctr: 0.1, position: 5 },
      range: { startDate: "2026-07-19", endDate: "2026-08-15" },
      daily: [],
      queries: [],
      pages: [page("/anime/1", 1, 10, 5.0)],
      weeklyByType: [
        { week: "2026-08-04", type: "作品", clicks: 10, impressions: 500, ctr: 0.02, position: 20, days: 7, partial: false },
        { week: "2026-08-11", type: "作品", clicks: 3, impressions: 900, ctr: 0.003, position: 20, days: 6, partial: true },
      ],
    },
  };
  const out = runWith(snap);

  check(
    "途中の週（partial）のセルに印が付く",
    /900\*/.test(out) && !/500\*/.test(out),
    "2026-08-11の900だけに*"
  );
  check(
    "途中の週があることの注記が出る",
    /完全な週とそのまま比べない/.test(out)
  );
  check(
    "直近2週の増減に「途中」の注記が付く",
    /\+400.*どちらかの週が途中/.test(out)
  );
  check(
    "途中の週を含む比較への警告が出る",
    /途中の週を含む比較。傾向として扱わず/.test(out)
  );

  // 両方とも完全な週なら、印も警告も出ないこと（過剰警告で読み飛ばされるのを防ぐ）。
  const fullSnap = {
    "2026-08-15": {
      ...snap["2026-08-15"],
      weeklyByType: [
        { week: "2026-08-04", type: "作品", clicks: 10, impressions: 500, ctr: 0.02, position: 20, days: 7, partial: false },
        { week: "2026-08-11", type: "作品", clicks: 12, impressions: 520, ctr: 0.02, position: 20, days: 7, partial: false },
      ],
    },
  };
  const fullOut = runWith(fullSnap);
  check(
    "完全な週どうしの比較には印も警告も出ない",
    !/\*/.test(fullOut.split("④")[1]?.split("⑤")[0] ?? "") &&
      !/途中の週を含む比較/.test(fullOut)
  );
}

console.log(`\n結果（seo-report.js）: ${ok} 件OK / ${ng} 件NG`);
process.exit(ng > 0 ? 1 : 0);
