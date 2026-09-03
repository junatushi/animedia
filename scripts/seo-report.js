#!/usr/bin/env node
"use strict";

// SEOの「判定」スクリプト（2026-08-19導入）。
//
// 【なぜ要るか】
// 収集の仕組みは揃っていた（fetch-gsc.js が毎日 content/analytics/gsc/ にJSONを置く）。
// しかし**そのJSONを読んで「改善したのか / 次に何をすべきか」を答える道具が無かった**。
// そのため「毎日SEOを改善する」という運用は、実際には
//   ・毎日データが増える（自動）
//   ・改善アクションは、その日のセッションがゼロから探索して決める（毎回やり直し）
// になっていて、セッションが変わるたびに同じ集計を書き直していた。
// 2026-08-19のセッションで実際に、面別の効率差（声優が作品の8倍）という
// 判断を変える事実が**導入から2週間気づかれずに埋もれていた**ことが分かった。
//
// このスクリプトは推測を足さない。**コミット済みのJSONを読んで数えるだけ**で、
// ネットワークにも出ない。判断の材料を毎回同じ形で出すことだけが仕事。
//
// 使い方: node scripts/seo-report.js [--json]

const fs = require("fs");
const path = require("path");
const { pageType, PAGE_TYPES } = require("./lib/gsc-page-type.js");

const GSC_DIR = path.join(__dirname, "..", "content", "analytics", "gsc");

/** content/analytics/gsc/*.json を古い順に読む。ファイル名はGSCのデータ最終日。 */
function loadSnapshots() {
  if (!fs.existsSync(GSC_DIR)) return [];
  return fs
    .readdirSync(GSC_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => ({
      date: f.replace(/\.json$/, ""),
      data: JSON.parse(fs.readFileSync(path.join(GSC_DIR, f), "utf8")),
    }));
}

/** 面ごとに pages 行を畳む。CTR・順位は表示回数で重み付けする（単純平均は歪む）。 */
function byPageType(pages) {
  const acc = new Map();
  for (const row of pages || []) {
    const url = (row.keys || [])[0];
    if (!url) continue;
    const type = pageType(url);
    const cur = acc.get(type) || { pages: 0, clicks: 0, impressions: 0, weighted: 0 };
    cur.pages += 1;
    cur.clicks += row.clicks || 0;
    cur.impressions += row.impressions || 0;
    cur.weighted += (row.position || 0) * (row.impressions || 0);
    acc.set(type, cur);
  }
  return acc;
}

// content/works/aliases.ts（作品の通称）と content/services/aliases.ts（配信サービスの
// 口語形）に登録済みの語を読む。`require` ではなく正規表現で抜くのは、TSファイルを
// 読み込むとNodeの型ストリッピング警告がレポートの出力に混ざるため。
// ファイルが無い環境（テストの一時ディレクトリ）では空を返す。
function loadAliasWords() {
  const out = { work: [], service: [] };
  const files = [
    ["work", path.join(__dirname, "..", "content", "works", "aliases.ts")],
    ["service", path.join(__dirname, "..", "content", "services", "aliases.ts")],
  ];
  for (const [kind, file] of files) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/names:\s*\[([^\]]*)\]/g)) {
      for (const w of m[1].matchAll(/"([^"]+)"/g)) out[kind].push(w[1]);
    }
  }
  out.work = [...new Set(out.work)];
  out.service = [...new Set(out.service)];
  return out;
}

// 登録済みの略称を含むクエリだけを集める。「略称を出したことで検索に拾われ始めたか」を
// 判定するための入力（docs/seo-operations.md 3節の判定表）。
// 判定条件は**測れるものだけ**にする、というのがこの節を足した理由
// （測れない指標を効果の見かたとして掲げない）。
function aliasQueryStats(queries, words) {
  const hit = [];
  for (const q of queries || []) {
    const text = (q.keys && q.keys[0]) || "";
    const matched = words.filter((w) => text.includes(w));
    if (matched.length > 0) hit.push({ ...q, matched });
  }
  const clicks = hit.reduce((a, q) => a + q.clicks, 0);
  const impressions = hit.reduce((a, q) => a + q.impressions, 0);
  const weighted = hit.reduce((a, q) => a + q.position * q.impressions, 0);
  return {
    queries: hit,
    count: hit.length,
    clicks,
    impressions,
    position: impressions ? weighted / impressions : 0,
  };
}

function pad(s, n) {
  // 全角を2幅として数える（そろえないと表が崩れる）
  const width = [...String(s)].reduce((w, c) => w + (/[\x00-\x7F]/.test(c) ? 1 : 2), 0);
  return String(s) + " ".repeat(Math.max(0, n - width));
}

function main() {
  const snaps = loadSnapshots();
  if (snaps.length === 0) {
    console.log("content/analytics/gsc/ にデータがありません（docs/gsc-setup.md）。");
    process.exit(0);
  }

  const latest = snaps[snaps.length - 1];
  const oldest = snaps[0];
  const d = latest.data;

  if (process.argv.includes("--json")) {
    const acc = byPageType(d.pages);
    console.log(
      JSON.stringify(
        {
          latest: latest.date,
          totals: d.totals,
          byType: [...acc.entries()].map(([type, v]) => ({
            type,
            pages: v.pages,
            clicks: v.clicks,
            impressions: v.impressions,
            ctr: v.impressions ? v.clicks / v.impressions : 0,
            position: v.impressions ? v.weighted / v.impressions : 0,
            clicksPerPage: v.pages ? v.clicks / v.pages : 0,
          })),
          alias: (() => {
            const w = loadAliasWords();
            const st = aliasQueryStats(d.queries, [...w.work, ...w.service]);
            return {
              registeredWork: w.work.length,
              registeredService: w.service.length,
              queries: st.count,
              clicks: st.clicks,
              impressions: st.impressions,
              position: st.position,
            };
          })(),
        },
        null,
        2
      )
    );
    return;
  }

  console.log("════════════════════════════════════════════════════════");
  console.log(`  SEO実測レポート（GSCデータ最終日: ${latest.date}）`);
  console.log("════════════════════════════════════════════════════════");
  console.log(
    `  スナップショット ${snaps.length}件（${oldest.date} 〜 ${latest.date}）／集計期間 ${d.range?.startDate} 〜 ${d.range?.endDate}`
  );

  // ── ① 全体の推移 ───────────────────────────────
  console.log("\n── ① 全体の推移（各スナップショットの直近28日） ──");
  console.log(`  ${pad("データ最終日", 14)}${pad("クリック", 10)}${pad("表示", 8)}${pad("CTR", 8)}平均順位`);
  for (const s of snaps) {
    const t = s.data.totals || {};
    console.log(
      `  ${pad(s.date, 14)}${pad(t.clicks ?? "-", 10)}${pad(t.impressions ?? "-", 8)}${pad(
        t.ctr != null ? (t.ctr * 100).toFixed(1) + "%" : "-",
        8
      )}${t.position != null ? t.position.toFixed(1) : "-"}`
    );
  }
  const first = oldest.data.totals || {};
  const last = d.totals || {};
  if (first.clicks != null && last.clicks != null) {
    const dc = last.clicks - first.clicks;
    const di = last.impressions - first.impressions;
    const dp = (first.position ?? 0) - (last.position ?? 0);
    console.log(
      `\n  差分: クリック ${dc >= 0 ? "+" : ""}${dc} / 表示 ${di >= 0 ? "+" : ""}${di} / 順位 ${
        dp >= 0 ? "改善 " : "悪化 "
      }${Math.abs(dp).toFixed(1)}`
    );
    console.log(
      "  ※28日ローリング窓の比較なので、古い日が抜けた影響も含む。日次の実数は②で見る。"
    );
  }

  // ── ② 日次（横ばいかどうかは合計ではなく日次で見る）──────────
  const daily = d.daily || [];
  if (daily.length) {
    const half = Math.floor(daily.length / 2);
    const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const firstHalf = daily.slice(0, half);
    const lastHalf = daily.slice(half);
    console.log("\n── ② 日次クリックの前半/後半比較 ──");
    console.log(
      `  前半${firstHalf.length}日: ${sum(firstHalf, "clicks")}クリック / ${sum(firstHalf, "impressions")}表示`
    );
    console.log(
      `  後半${lastHalf.length}日: ${sum(lastHalf, "clicks")}クリック / ${sum(lastHalf, "impressions")}表示`
    );
  }

  // ── ③ 面別の効率（どこに投資すべきか）───────────────
  console.log("\n── ③ 面別の効率（直近28日・GSCのページ別上位から集計） ──");
  const acc = byPageType(d.pages);
  const rows = [...acc.entries()]
    .map(([type, v]) => ({
      type,
      pages: v.pages,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions ? v.clicks / v.impressions : 0,
      position: v.impressions ? v.weighted / v.impressions : 0,
      perPage: v.pages ? v.clicks / v.pages : 0,
    }))
    .sort((a, b) => b.perPage - a.perPage);

  console.log(
    `  ${pad("面", 12)}${pad("ページ", 8)}${pad("クリック", 10)}${pad("表示", 8)}${pad("CTR", 8)}${pad(
      "平均順位",
      10
    )}1ページあたり`
  );
  for (const r of rows) {
    console.log(
      `  ${pad(r.type, 12)}${pad(r.pages, 8)}${pad(r.clicks, 10)}${pad(r.impressions, 8)}${pad(
        (r.ctr * 100).toFixed(1) + "%",
        8
      )}${pad(r.position.toFixed(1), 10)}${r.perPage.toFixed(2)}`
    );
  }

  // 表示ゼロの面＝作ったが回収できていない投資。黙って消えないよう名指しする。
  const seen = new Set(rows.map((r) => r.type));
  const silent = PAGE_TYPES.filter((t) => !seen.has(t));
  if (silent.length) {
    console.log(`\n  ⚠ 表示回数ゼロの面: ${silent.join(" / ")}`);
    console.log(
      "    （作ったが検索に出ていない。導線が無い＝孤立か、そもそも検索需要が無いかを切り分ける）"
    );
  }

  // ── ④ 面別の週次推移（伸びている面／落ちている面）──────────
  const weekly = d.weeklyByType || [];
  if (weekly.length) {
    const weeks = [...new Set(weekly.map((r) => r.week))].sort();
    const types = [...new Set(weekly.map((r) => r.type))].sort(
      (a, b) => PAGE_TYPES.indexOf(a) - PAGE_TYPES.indexOf(b)
    );
    console.log("\n── ④ 面別の週次推移（クリック/表示） ──");
    console.log(`  ${pad("週", 12)}${types.map((t) => pad(t, 12)).join("")}`);
    let anyPartial = false;
    for (const wk of weeks) {
      const cells = types.map((t) => {
        const r = weekly.find((x) => x.week === wk && x.type === t);
        if (!r) return pad("-", 12);
        if (r.partial) anyPartial = true;
        return pad(`${r.clicks}/${r.impressions}${r.partial ? "*" : ""}`, 12);
      });
      console.log(`  ${pad(wk, 12)}${cells.join("")}`);
    }
    if (anyPartial) {
      console.log(
        "  * は途中まで（GSCの3日ラグ等でその面がまだ7日ぶん揃っていない）のデータ。" +
          "完全な週とそのまま比べない（docs/operations.md ㉟）。"
      );
    }
    // 直近2週で表示が増えた面／減った面を名指しする
    if (weeks.length >= 2) {
      const [prev, cur] = weeks.slice(-2);
      const at = (w, t) => weekly.find((x) => x.week === w && x.type === t) || null;
      const moves = types
        .map((t) => {
          const p = at(prev, t);
          const c = at(cur, t);
          return { t, diff: (c?.impressions || 0) - (p?.impressions || 0), partial: !!(p?.partial || c?.partial) };
        })
        .filter((m) => m.diff !== 0)
        .sort((a, b) => b.diff - a.diff);
      if (moves.length) {
        console.log(`\n  直近2週（${prev} → ${cur}）の表示回数の増減:`);
        for (const m of moves) {
          console.log(`    ${pad(m.t, 12)}${m.diff > 0 ? "+" : ""}${m.diff}${m.partial ? "  （どちらかの週が途中）" : ""}`);
        }
        if (moves.some((m) => m.partial)) {
          console.log(
            "  ⚠ 途中の週を含む比較。傾向として扱わず、完全な週が揃ってから判断すること。"
          );
        }
      }
    }
  }

  // ── ⑤ 手を入れる候補 ─────────────────────────
  console.log("\n── ⑤ 手を入れる候補 ──");

  // (a) 表示は多いのにクリックが0のページ＝順位かtitleの問題
  const noClick = (d.pages || [])
    .filter((p) => p.clicks === 0 && p.impressions >= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);
  if (noClick.length) {
    console.log("\n  (a) 表示20回以上でクリック0のページ（順位かtitleを疑う）");
    for (const p of noClick) {
      const u = decodeURIComponent(p.keys[0]).replace(/^https?:\/\/[^/]+/, "");
      console.log(`    ${pad(p.impressions + "表示", 10)}${pad(p.position.toFixed(1) + "位", 9)}${u}`);
    }
  }

  // (b) 11〜20位のクエリ＝1ページ目まであと一歩。ここが最も費用対効果が高い
  const nearFirstPage = (d.queries || [])
    .filter((q) => q.position > 10 && q.position <= 20 && q.impressions >= 3)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
  if (nearFirstPage.length) {
    console.log("\n  (b) 11〜20位のクエリ（1ページ目まであと一歩＝伸びしろが最大）");
    for (const q of nearFirstPage) {
      console.log(
        `    ${pad(q.impressions + "表示", 10)}${pad(q.position.toFixed(1) + "位", 9)}${q.keys[0]}`
      );
    }
  }

  // (c) 既に1ページ目にいるクエリ＝守るべき面の手がかり
  const onFirstPage = (d.queries || [])
    .filter((q) => q.position <= 10 && q.impressions >= 3)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);
  if (onFirstPage.length) {
    console.log("\n  (c) 既に1ページ目のクエリ（勝っている型。同じ型を増やす）");
    for (const q of onFirstPage) {
      console.log(
        `    ${pad(q.impressions + "表示", 10)}${pad(q.position.toFixed(1) + "位", 9)}${pad(
          q.clicks + "click",
          9
        )}${q.keys[0]}`
      );
    }
  }

  // ── ⑥ 通称・略称クエリ ─────────────────────────
  // 2026-08-19に「登録済みの略称がレンダリング後のHTMLに1回も出ていない」のを直した。
  // その効果を後から判定できるように、略称を含むクエリだけを切り出して見る。
  {
    const w = loadAliasWords();
    const words = [...w.work, ...w.service];
    console.log("\n── ⑥ 通称・略称クエリ（2026-08-19の施策の判定用） ──");
    if (words.length === 0) {
      console.log("  登録済みの略称がありません（content/works/aliases.ts）。");
    } else {
      const st = aliasQueryStats(d.queries, words);
      console.log(
        `  登録済み: 作品の通称 ${w.work.length}種 / サービスの口語形 ${w.service.length}種`
      );
      console.log(
        `  略称を含むクエリ: ${st.count}種  ${st.clicks}クリック  ${st.impressions}表示  ` +
          (st.impressions ? `平均${st.position.toFixed(1)}位` : "—")
      );
      if (st.count === 0) {
        console.log("  → まだ1件も拾えていない。索引され直すまで数週間かかる。");
      } else {
        for (const q of st.queries
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 8)) {
          console.log(
            `    ${pad(q.impressions + "表示", 10)}${pad(q.position.toFixed(1) + "位", 9)}${pad(
              q.clicks + "click",
              9
            )}${q.keys[0]}  [${q.matched.join("・")}]`
          );
        }
      }
      console.log("  → 判定期日は docs/seo-operations.md 3節の表");
    }
  }

  console.log("\n════════════════════════════════════════════════════════");
  console.log("  判断の手順は docs/seo-operations.md");
  console.log("════════════════════════════════════════════════════════\n");
}

main();
