// scripts/freshness.js（収集の欠測検知）そのものの回帰テスト。
//
// 【なぜ要るか】
// この検査は「毎日のデータが来なくなったこと」を見張る唯一の道具だが、
// **NGを出さなくなる方向に壊れると毎日緑のまま無力化する**（check-patrol.js /
// check-verify-production.js と同じ考え方）。しかも壊れていることは、
// 次に収集が止まった日まで分からない＝その日のデータはもう取り返せない。
//
// 仮の収集ディレクトリ（FRESHNESS_ROOT）と仮の基準日（FRESHNESS_TODAY）を渡して
// freshness.js を実際に子プロセス実行し、
//   ・健全なら失敗0・exit 0
//   ・取り返せない系列の欠測は**失敗**
//   ・取り返せる系列の欠測は**警告**（exit 0 のまま）
//   ・最新が古すぎるときは、取り返せる系列でも**失敗**（＝収集が止まっている）
//   ・収集先の登録漏れは**失敗**
//   ・既知として記録した欠測は失敗にしないが、**同じ腕の別の日は失敗する**
//   ・そもそもファイルが無いときに静かに成功しない
// を固定する。ネットワークには出ない。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "freshness.js");

let ng = 0;
function check(name, pass, detail) {
  if (!pass) ng++;
  console.log(`${pass ? "✓" : "✗"}  ${name.padEnd(52)} → ${detail}`);
}

// ── 仮の収集先を組み立てる ───────────────────────────────────
const day = (base, offset) => {
  const d = new Date(Date.UTC(+base.slice(0, 4), +base.slice(5, 7) - 1, +base.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/**
 * @param {object} o
 * @param {string[]} o.gsc          GSCのファイル日付
 * @param {string[]} o.site         行動ログのファイル日付
 * @param {Record<string,string[]>} o.firstSeen  "情報源 クール" → 日付の並び
 * @param {string[]} [o.extraDirs]  登録されていない収集先（登録漏れの再現）
 */
function fixture(o) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freshness-"));
  const w = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  for (const d of o.gsc || []) w(`content/analytics/gsc/${d}.json`, "{}");
  for (const d of o.site || []) w(`content/analytics/site/${d}.json`, "{}");
  if (o.firstSeen) {
    const sources = {};
    for (const [arm, dates] of Object.entries(o.firstSeen)) {
      const [source, cour] = arm.split(" ");
      sources[source] ??= {};
      sources[source][cour] = { daily: dates.map((date) => ({ date, works: 1 })) };
    }
    w("content/coverage/first-seen.json", JSON.stringify({ sources }));
  }
  for (const d of o.extraDirs || []) fs.mkdirSync(path.join(root, d), { recursive: true });
  return root;
}

function run(root, today) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, FRESHNESS_ROOT: root, FRESHNESS_TODAY: today },
    encoding: "utf8",
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// 直近n日を連続で並べる。
const streak = (today, n, skip = []) =>
  Array.from({ length: n }, (_, i) => day(today, -(n - 1 - i))).filter((d) => !skip.includes(d));

const TODAY = "2026-09-10";
// GSCはデータ終了日で命名するので、健全でも数日古い（ラグ3日を再現する）。
const gscHealthy = streak(day(TODAY, -3), 10);
const siteHealthy = streak(TODAY, 10);
const fsHealthy = {
  "annict 2026-autumn": streak(TODAY, 10),
  "anilist 2026-autumn": streak(TODAY, 10),
};

function main() {
  console.log("── 収集の欠測検知（freshness.js）自身の回帰テスト ──\n");
  const tmps = [];
  const use = (o) => {
    const r = fixture(o);
    tmps.push(r);
    return r;
  };

  // ① 健全なら失敗0・exit 0。
  {
    const r = run(use({ gsc: gscHealthy, site: siteHealthy, firstSeen: fsHealthy }), TODAY);
    check("① 健全なら失敗0", /結果: 失敗なし/.test(r.out), (r.out.match(/結果:.*/) || [""])[0]);
    check("① exit 0 で終わる", r.code === 0, `exit=${r.code}`);
  }

  // ② 取り返せない系列（first-seen）の欠測は失敗。
  {
    const hole = day(TODAY, -4);
    const r = run(
      use({
        gsc: gscHealthy,
        site: siteHealthy,
        // 展開を先に置くこと。後ろに置くと健全な並びが穴あきを上書きして、
        // 「見逃した」ように見える（実際に1度そうなった）。
        firstSeen: { ...fsHealthy, "annict 2026-autumn": streak(TODAY, 10, [hole]) },
      }),
      TODAY
    );
    const caught = r.code !== 0 && r.out.includes(hole);
    check("② 取り返せない欠測は失敗になる", caught, caught ? `${hole} を失敗として検出` : "見逃した");
  }

  // ③ 取り返せる系列（GSC）の欠測は警告どまり（exit 0）。
  //    ここを失敗にすると毎日赤くなり、そのうち誰も読まなくなる。
  {
    const hole = day(TODAY, -6);
    const r = run(
      use({ gsc: streak(day(TODAY, -3), 10, [hole]), site: siteHealthy, firstSeen: fsHealthy }),
      TODAY
    );
    const warned = r.code === 0 && r.out.includes("⚠") && r.out.includes(hole);
    check("③ 取り返せる欠測は警告どまり", warned, warned ? `${hole} を警告として検出` : `exit=${r.code}`);
  }

  // ④ 最新が古すぎるときは、取り返せる系列でも失敗（＝1日落ちたのではなく止まっている）。
  {
    const r = run(use({ gsc: gscHealthy, site: streak(day(TODAY, -8), 5), firstSeen: fsHealthy }), TODAY);
    const caught = r.code !== 0 && /収集が止まっている/.test(r.out);
    check("④ 最新が古すぎれば失敗になる", caught, caught ? "「収集が止まっている」を出す" : `exit=${r.code}`);
  }

  // ⑤ 登録されていない収集先があれば失敗（見張り漏れが静かに増えない）。
  {
    const r = run(
      use({
        gsc: gscHealthy,
        site: siteHealthy,
        firstSeen: fsHealthy,
        extraDirs: ["content/analytics/newthing"],
      }),
      TODAY
    );
    const caught = r.code !== 0 && r.out.includes("newthing");
    check("⑤ 収集先の登録漏れは失敗になる", caught, caught ? "未登録として検出" : "見逃した");
  }

  // ⑥ 既知として記録した欠測は失敗にしない。ただし**同じ腕の別の日は失敗する**。
  //    記録が腕まるごとに効いてしまうと、そこだけ永久に見張られなくなる。
  {
    const known = "2026-08-25"; // ACKNOWLEDGED に記録済み（本番停止の日）
    const base = streak("2026-08-31", 19, [known]);
    const r1 = run(
      use({
        gsc: streak(day("2026-08-31", -3), 10),
        site: streak("2026-08-31", 10),
        firstSeen: { "annict 2026-autumn": base, "anilist 2026-autumn": streak("2026-08-31", 19) },
      }),
      "2026-08-31"
    );
    check(
      "⑥ 既知の欠測は失敗にしない",
      r1.code === 0 && /既知の欠測/.test(r1.out),
      r1.code === 0 ? "記録済みとして通す" : `exit=${r1.code}`
    );

    const other = "2026-08-20";
    const r2 = run(
      use({
        gsc: streak(day("2026-08-31", -3), 10),
        site: streak("2026-08-31", 10),
        firstSeen: {
          "annict 2026-autumn": streak("2026-08-31", 19, [known, other]),
          "anilist 2026-autumn": streak("2026-08-31", 19),
        },
      }),
      "2026-08-31"
    );
    const caught = r2.code !== 0 && r2.out.includes(other);
    check("⑥ 記録は同じ腕の別の日には効かない", caught, caught ? `${other} を失敗として検出` : "見逃した");
  }

  // ⑦ 収集先そのものが無いときに静かに成功しない（この種の道具の最悪の壊れ方）。
  {
    const r = run(use({ gsc: gscHealthy, site: siteHealthy }), TODAY); // first-seen を作らない
    const caught = r.code !== 0 && /一度も成功していない|が無い/.test(r.out);
    check("⑦ 収集先が無ければ失敗になる", caught, caught ? "失敗として検出" : "静かに成功した");
  }

  for (const t of tmps) fs.rmSync(t, { recursive: true, force: true });
  console.log(`\n結果: ${ng === 0 ? "全件OK" : `${ng} 件NG`}`);
  process.exit(ng === 0 ? 0 : 1);
}

main();
