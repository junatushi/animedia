#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────
// 表示速度の「判定」レポート（2026-09-09導入）
//
//   node scripts/speed-report.js
//
// 【なぜ要るか】
// 収集だけ自動化して読む道具を作らないと、データはコミットされたまま誰にも読まれない。
// このリポジトリは同じ失敗を既に1回している（㉜: GSCの収集は自動化されていたのに
// 「改善したか・次に何をすべきか」を答える道具が無く、面別の効率差が2週間埋もれた）。
// 表示速度は2系統から来るので、1本のレポートに束ねる:
//
//   ・合成計測 … scripts/measure-production.js が毎日 content/analytics/speed/ に書く。
//     条件が固定なので**日々の比較ができる**。ただし実利用者の端末・回線ではない
//   ・RUM     … components/WebVitals.tsx → Supabase → content/analytics/site/ の vitals。
//     **実利用者の真値**だが、このサイトのトラフィックでは件数が溜まるのに時間が掛かる
//
// 【守っていること】
// ①**件数を必ず出し、少なければ「判定できない」と言う**。㉞・㊶で繰り返した
//   「少数からの一般化」をここで再発させない。
// ②**数字をこのファイルやドキュメントに転記しない**（CLAUDE.md の方針）。
//   読むたびに実データから出す。
// ③**目標は1箇所（下の GOALS）が持つ**。文中に 2000 と書き散らさない。
// 回帰テストは scripts/check-speed-report.js。
// ───────────────────────────────────────────────────────────────
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const SPEED_DIR = process.env.SPEED_DIR || path.join(REPO, "content/analytics/speed");
const SITE_DIR = process.env.SITE_DIR || path.join(REPO, "content/analytics/site");

// このサイトの目標と、参考にする外部基準。
// LCP を主指標にするのは「主要な中身が見えるまで」を表すため。
// 2000ms は利用者が掲げた「2秒未満」。2500ms は Google の Core Web Vitals の "good" 上限で、
// **SEO要件ではない**（CLAUDE.md の方針。速度への投資はUXと無料枠を根拠にする）。
const GOALS = { lcp: 2000, lcpReference: 2500 };
// RUM の p75 をこの件数未満で語らない。統計としてではなく「読み手が断定しないための線」。
const MIN_RUM_SAMPLES = 20;

function readDir(dir) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      out.push({ date: f.replace(/\.json$/, ""), json: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) });
    } catch {
      // 壊れた1ファイルで全部を止めない。読めなかったことは下で数える。
      out.push({ date: f.replace(/\.json$/, ""), json: null });
    }
  }
  return out;
}

function fmtDelta(now, before) {
  if (before == null || now == null) return "";
  const d = now - before;
  if (d === 0) return "  ±0";
  return `  ${d > 0 ? "+" : ""}${d}ms`;
}

function main() {
  const speed = readDir(SPEED_DIR);
  const site = readDir(SITE_DIR);
  const broken = speed.filter((s) => s.json === null).map((s) => s.date);

  console.log("== 表示速度レポート ==\n");

  // ── ① 合成計測（条件固定・日々比較できる）
  const all = speed.filter((s) => s.json && Array.isArray(s.json.pages) && s.json.pages.length);
  // **計測元(base)が違う断面を並べて比較しない。** BASE=http://localhost:3100 で試すと
  // 同じディレクトリにファイルが落ちるので、放っておくと「本番が急に速くなった」に見える
  // （ローカルはネットワーク往復もコールドスタートも無いので必ず速く出る）。
  // 最新の base と同じものだけを時系列として扱い、混ざっていることは必ず告げる。
  //
  // **計測条件（擬似遅延の当て方）が違う断面も同じ理由で混ぜない**（2026-09-29追加）。
  // 2026-09-29まで擬似遅延はTTFBに乗っていなかった（Chromiumのネットワーク擬似条件は
  // 遅延を応答が始まったあとに効かせるので `responseStart` に出ない。経緯は
  // `scripts/lib/measure-page.js` の `LATENCY_MODE`）。直すとTTFBだけでなく
  // **LCP・FCPも動く**——局所実験では多資源のページで372ms→356ms（−4%）だったが、
  // 単一の大きな文書では384ms→220ms（−43%）だった。前者だけを見て
  //「LCPは跨いで比べてよい」と書きかけたが、後者で否定された。
  // どの指標が安全かを当て推量で決めるより、**境界で時系列を切る**ほうが静かに間違わない。
  // 新しい当て方の断面が2日ぶん溜まれば前回比は自動で復活する。
  const latestBase = all.at(-1)?.json.base ?? null;
  const latestLatencyMode = (all.at(-1)?.json.conditions ?? {}).latencyMode ?? null;
  const sameSetup = (s) =>
    (s.json.base ?? null) === latestBase &&
    ((s.json.conditions ?? {}).latencyMode ?? null) === latestLatencyMode;
  const usable = all.filter(sameSetup);
  const otherBaseSnaps = all.filter((s) => (s.json.base ?? null) !== latestBase);
  const otherBases = [...new Set(otherBaseSnaps.map((s) => s.json.base))];
  // baseは同じだが遅延の当て方が違う断面（＝直した日の境界）。
  const otherLatency = all.filter(
    (s) => (s.json.base ?? null) === latestBase && !sameSetup(s)
  );
  if (usable.length === 0) {
    console.log("① 合成計測: **まだデータが無い**");
    console.log("   `node scripts/measure-production.js` が1日1回書く（.github/workflows/measure-speed.yml）。");
    console.log("   本番へ到達できる環境でしか動かないので、手元やサンドボックスでは BASE を指定して試す。\n");
  } else {
    const latest = usable[usable.length - 1];
    const prev = usable[usable.length - 2] ?? null;
    // 7日前に最も近い断面（無ければ最古）。
    const target = new Date(new Date(latest.date).getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const weekAgo = usable.filter((s) => s.date <= target).at(-1) ?? usable[0];
    const byFace = (snap, face) => snap?.json.pages.find((p) => p.face === face) ?? null;
    // 【2026-10-04追加】面の名前が同じでも**測ったURLが違えば比べない**。
    // `-current` の面はクールが替わるとURLが替わる（2026-10-04に夏→秋へ直した日がまさにそれ）。
    // 別のページの値を「前回比」として並べると、秋のほうが遅い／速いと読ませてしまう。
    // path を持たない古い断面は、従来どおり比べる（持っていないことを違いとみなさない）。
    const samePath = (q, p) => (q && q.path && p.path && q.path !== p.path ? null : q);

    const c = latest.json.conditions ?? {};
    console.log(`① 合成計測（${latest.date}・${latest.json.base ?? "?"}）`);
    const latMode = c.latencyMode ?? null;
    console.log(
      `   条件: CPU ${c.cpuThrottle ?? "?"}倍 / ${c.netKbps ?? "?"}kbps / ` +
        `遅延${c.latencyMs ?? "?"}ms（${latMode === "perRequest" ? "リクエストごと＝TTFBに乗る" : "TTFBには乗っていない"}） / ` +
        `${c.runs ?? "?"}回の中央値 ／ 断面 ${usable.length} 日ぶん\n`
    );
    const rows = [...latest.json.pages].sort((a, b) => (b.lcp ?? 0) - (a.lcp ?? 0));
    console.log(
      "   面".padEnd(19) + "LCP".padStart(9) + "初回".padStart(9) + "前回比".padStart(9) + "7日前比".padStart(10) +
        "FCP".padStart(8) + "TTFB".padStart(8) + "受信".padStart(8) + "TBT".padStart(8) + "KB".padStart(7) + "  判定"
    );
    let over = 0;
    for (const p of rows) {
      const ok = p.lcp != null && p.lcp < GOALS.lcp;
      if (!ok) over++;
      console.log(
        "   " + String(p.face).padEnd(16) +
          `${p.lcp}ms`.padStart(9) +
          (p.lcpFirst == null ? "—" : `${p.lcpFirst}ms`).padStart(9) +
          fmtDelta(p.lcp, samePath(byFace(prev, p.face), p)?.lcp).padStart(9) +
          fmtDelta(p.lcp, samePath(byFace(weekAgo, p.face), p)?.lcp).padStart(10) +
          `${p.fcp}ms`.padStart(8) + `${p.ttfb}ms`.padStart(8) +
          // 「受信」＝ responseEnd − responseStart。RUMの `HTML_DL` と同じ定義なので
          // ②の表と直に比べられる。**この列が無かったせいで、RUMが問題だと言っている
          // 場所を合成計測が一度も測っていなかった**（2026-09-29追加）。
          // **列名は2026-09-30に「生成」から「受信」へ訂正した。** 本番の実測では生成の
          // 待ちはTTFB側に出ており（`docs/operations.md`の[59]）、この列を「サーバーが
          // 本文を作り終えるまで」と読むと診断を丸ごと間違える（下の「初回の値の読み方」）。
          (p.htmlDl == null ? "—" : `${p.htmlDl}ms`).padStart(8) +
          `${p.blockingMs}ms`.padStart(8) + `${p.loadKB}KB`.padStart(7) +
          (ok ? "  ✓" : `  ✗ 目標${GOALS.lcp}ms超`)
      );
    }
    console.log(
      `\n   → ${rows.length} 面中 ${rows.length - over} 面が目標（LCP ${GOALS.lcp}ms未満）を満たす` +
        `／Google基準(${GOALS.lcpReference}ms)なら ${rows.filter((p) => p.lcp < GOALS.lcpReference).length} 面`
    );
    // ── 初回（1回目）の値の読み方
    //   （2026-09-27導入 → 09-29に作り直し → **09-30にもう一度作り直した**）。
    //
    // **経緯を全部残すのは、同じ間違いを3度やったから。** 形はいつも同じで、
    // 「初回が遅い」という観測に「事前生成されていない」という**原因を貼り付けた**。
    //
    // ① 2026-09-27: `lcpFirst - lcp > 500 && lcpFirst > lcp * 1.5` を
    //    「事前生成されていない疑い」として警告した。実データ17面中11面で発火し、
    //    `generateStaticParams` と無関係な**完全静的なページ**（about・privacy・director）
    //    まで入った。→ 判定を `lcpFirst >= GOALS.lcp`（下のB）へ置き換えた。
    // ② 2026-09-29: 同じ主張を `htmlDlFirst` に載せ替えた。「ストリーミングなので生成の
    //    待ちは responseEnd 側に出る」という理屈は**局所実験では成り立った**
    //    （本文に2,000ms掛かるサーバー: ストリーミング ttfb 35ms/htmlDl 2000ms、
    //    非ストリーミング ttfb 2005ms/htmlDl 8ms）。
    // ③ 2026-09-30の実データで②も外れた:
    //    ・17面中**15面**で発火。`about`・`privacy`（データ取得ゼロ・動的セグメント無し＝
    //      完全静的）まで初回596/686ms vs 中央値238/251ms。
    //    ・**焼いていない面のほうが短い**。`anime-current` 112ms・`service-current` 115ms
    //      vs 焼いてある `season-current` 1111ms・`rankings-current` 239ms。
    //      同一ルートでも `anime`（過去・焼いてある）266ms > `anime-current`（焼いていない）112ms。
    //    ・本番をcurlした実測（`docs/operations.md`の[59]）では、キャッシュMISSでも
    //      最初のバイト→完了が14〜17ms。**生成の待ちはTTFB側に出ていた。**
    //
    // **なぜ初回だけ長いのか（分かっていること）**: `measure()` は毎回ブラウザを起動し直し、
    // 指標の読み取りも `withScroll` の分岐より前なので、3回とも条件は同じ。差はサーバー／
    // CDN側の状態だけ（2・3回目は1回目が温めたエッジに当たる）。だから `htmlDlFirst` が
    // 見ているのは**エッジの温まり具合**で、事前生成の有無ではない。
    //
    // **この計測では事前生成の有無を判定できない**（構造的な限界）。長い裾の `revalidate` は
    // 604800秒なので、毎日同じURLを測るとISRキャッシュは前日から生きており、
    // **初回生成をそもそも踏めない**。知りたいときはビルド成果物の
    // `.next/prerender-manifest.json` を見る。
    //
    // いま出すのは次の2つで、**どちらも原因を書かない**:
    //   A 初回だけHTML本体の受信が長い面（絶対値が目標の半分を超えたときだけ）
    //   B 初回のLCPが目標(2秒)を超えた面
    // Bの閾値を「中央値との比」から「目標そのもの」に変えたのは、
    // **要件が「表示2秒未満」**であって「初回と中央値の差」ではないから。
    const hasFirst = (p) => typeof p.lcpFirst === "number" && typeof p.lcp === "number";

    // 【2026-10-01追加】**初回がその場生成だったかを、推測ではなくヘッダーで分ける。**
    // `cacheFirst` は1回目の文書応答の `x-vercel-cache`（scripts/lib/measure-page.js）。
    // これが入る前は「初回だけ遅い」の原因を言う手段が無く、**3回続けて事前生成のせいだと
    // 誤って名指しした**（docs/operations.md の[60]）。いまは次のように分かれる:
    //   miss / bypass            … キャッシュに無く、**その場で作って待たせた**
    //   hit / stale / prerender  … キャッシュから配った＝待ちは生成ではない
    // **付いていない（null）を「違う」に倒さないこと。** 本番以外では付かないし、
    // この列を入れる前の断面にも無い。分からないときは分からないと書く。
    const COLD_CACHE = new Set(["miss", "bypass"]);
    const WARM_CACHE = new Set(["hit", "stale", "prerender"]);
    const isColdGen = (p) => typeof p.cacheFirst === "string" && COLD_CACHE.has(p.cacheFirst);
    const isWarmGen = (p) => typeof p.cacheFirst === "string" && WARM_CACHE.has(p.cacheFirst);
    // 【2026-10-04追加】**記録はあるが、どちらとも言えない値**（`revalidated` ほか未知の値）。
    // `revalidated` は「キャッシュが消されていて、この要求が作り直した」と読めそうだが、
    // 2026-10-03/04の実測で**一度も消していない完全静的なページ**（/about・/privacy・
    // /studio・/director）の初回にも出た。つまり「その場生成した」とは言い切れない。
    // **生成のせいにも、生成ではないとも書かない**（[60]の3度の誤りと同じ轍を踏まない）。
    // 以前はこの値を黙って説明から落とし、しかも「記録していない」と事実と逆のことを
    // 出していた（10-04の断面で 37秒の service-current の状態が説明から消えていた）。
    const isAmbiguousGen = (p) =>
      typeof p.cacheFirst === "string" && !COLD_CACHE.has(p.cacheFirst) && !WARM_CACHE.has(p.cacheFirst);
    // 原因を1行で付け足す。`list` に入っている面だけを見て判断する
    // （断面全体で判断すると、速い面のHITで遅い面のMISSを打ち消してしまう）。
    const explainFirst = (list) => {
      const cold = list.filter(isColdGen);
      const warm = list.filter(isWarmGen);
      const ambiguous = list.filter(isAmbiguousGen);
      const lines = [];
      if (cold.length > 0) {
        lines.push(
          `     → **その場生成を待っている**（初回の x-vercel-cache が ` +
            cold.map((p) => `${p.face}=${p.cacheFirst}`).join(" ") +
            "）。"
        );
        lines.push(
          "       消したあとの温めが届いていない。`.github/workflows/revalidate.yml` の温めステップと、"
        );
        lines.push(
          "       その面が `app/api/revalidate/route.ts` の `warm.pages` に入っているかを見る。"
        );
      }
      if (warm.length > 0) {
        lines.push(
          `     → 初回もキャッシュから出ている面（` +
            warm.map((p) => `${p.face}=${p.cacheFirst}`).join(" ") +
            "）は**その場生成ではない**ので、転送量と描画の側を見る。"
        );
      }
      if (ambiguous.length > 0) {
        lines.push(
          `     → 初回の x-vercel-cache が判別できない値の面（` +
            ambiguous.map((p) => `${p.face}=${p.cacheFirst}`).join(" ") +
            "）は**その場生成かどうか言えない**。"
        );
        lines.push(
          "       `revalidated` は一度も消していない完全静的なページの初回にも出る（2026-10-03/04実測）。"
        );
      }
      // 「記録していない」と言ってよいのは、本当に値が無い面だけのとき。
      if (list.length > 0 && list.every((p) => typeof p.cacheFirst !== "string")) {
        lines.push("     **原因はこの計測では特定できない**（この断面は初回の x-vercel-cache を記録していない）。");
        lines.push("     事前生成の有無はビルド成果物の .next/prerender-manifest.json で確かめる。");
      }
      return lines;
    };

    // A: 初回だけHTML本体の受信が長い面。**原因は言わない**（上の③）。
    // 絶対値の門（目標の半分）を置くのは、比だけで見ると**完全静的な面まで全部入る**から。
    // 訪問者にとって意味があるのは「2秒の予算のうち何msを受信で使ったか」なので、
    // 予算の半分を超えたときだけ出す（09-30の実データでは15面→2面）。
    const FIRST_DL_FLOOR = Math.round(GOALS.lcp / 2);
    const slowFirstDl = rows.filter(
      (p) => typeof p.htmlDlFirst === "number" && typeof p.htmlDl === "number" &&
        p.htmlDlFirst >= FIRST_DL_FLOOR &&
        p.htmlDlFirst - p.htmlDl > 300 && p.htmlDlFirst > p.htmlDl * 1.5
    );
    if (slowFirstDl.length > 0) {
      console.log(
        `   ⚠ 初回だけHTML本体の受信が長い面（${FIRST_DL_FLOOR}ms以上）: ` +
          slowFirstDl.map((p) => `${p.face}(初回${p.htmlDlFirst}ms / 中央値${p.htmlDl}ms)`).join(" ")
      );
      // 原因は `cacheFirst` が答える。**推測では書かない**（完全静的な面でも初回は長く出る＝
      // 上のコメント③。だから「初回が長い」だけでは生成のせいだと言えない）。
      for (const line of explainFirst(slowFirstDl)) console.log(line);
    }
    // `htmlDlFirst` を持たない断面（この列を入れる前のJSON）では、上の判定が
    // **静かに沈黙する**。黙って見張りが消えるのが最悪なので、そのことを告げる。
    if (rows.length > 0 && rows.every((p) => typeof p.htmlDlFirst !== "number")) {
      console.log("   ℹ この断面はHTML本体の受信時間(受信)を記録していないので、初回の受信の判定はしていない。");
      console.log("     `scripts/measure-production.js` が新しくなった翌日の断面から効く。");
    }

    // B: 初回が目標を超えた面。**原因は書かない**（この計測では特定できない）。
    // 初回は1回しか測らない＝n=1なので、何日続いたかを添える。
    const streakOf = (face) => {
      let n = 0;
      const latestPath = byFace(usable[usable.length - 1], face)?.path;
      for (let i = usable.length - 1; i >= 0; i--) {
        const q = byFace(usable[i], face);
        if (!q || typeof q.lcpFirst !== "number") break;
        // URLが替わった日をまたいで数えない（別のページの「連続」は実体の証拠にならない）。
        if (latestPath && q.path && q.path !== latestPath) break;
        if (q.lcpFirst < GOALS.lcp) break;
        n++;
      }
      return n;
    };
    const coldFirst = rows.filter((p) => hasFirst(p) && p.lcpFirst >= GOALS.lcp);
    if (coldFirst.length > 0) {
      console.log(
        `   ⚠ 初回が目標(${GOALS.lcp}ms)を超えた面: ` +
          coldFirst.map((p) => `${p.face}(初回${p.lcpFirst}ms / 中央値${p.lcp}ms・${streakOf(p.face)}日連続)`).join(" ")
      );
      console.log("     初回は1回しか測らない（n=1）ので、1日だけなら偶発と区別できない。2日以上続いたら実体として扱う。");
      console.log(`     デプロイのたびにISRキャッシュが飛ぶので、訪問者はこの初回の値を引きうる。`);
      for (const line of explainFirst(coldFirst)) console.log(line);
    }

    // 初回がその場生成だった面は、遅くなかった日も記録に残す（今日は間に合っていても
    // **温めが届いていない**という事実は同じで、作品数が増えた日に遅くなる）。
    const coldCacheOnly = rows.filter((p) => isColdGen(p) && !(hasFirst(p) && p.lcpFirst >= GOALS.lcp));
    if (coldCacheOnly.length > 0) {
      console.log(
        "   ℹ 初回がキャッシュに無かった面（今日は目標内だが、その場生成を踏んでいる）: " +
          coldCacheOnly.map((p) => `${p.face}(${p.cacheFirst}・初回${p.lcpFirst ?? "—"}ms)`).join(" ")
      );
    }
    // `cacheFirst` を持たない断面では上の切り分けが**静かに沈黙する**ので、そう告げる。
    if (rows.length > 0 && rows.every((p) => typeof p.cacheFirst !== "string")) {
      console.log("   ℹ この断面は初回の x-vercel-cache を記録していないので、その場生成かどうかの切り分けはしていない。");
      console.log("     `scripts/lib/measure-page.js` が新しくなった翌日の断面から効く。");
    }
    // ── 初期表示のバイト数が増えていないか（2026-10-01追加） ──
    //
    // 一覧系の面（トップ・シーズン・ランキング・独占配信）のHTMLは**作品数に比例する**。
    // いまの実測ではここは律速ではない（遅さの大半はサーバー側の待ち＝上のA/B）が、
    // クールが増えるたび作品数は増えるので、**いつか律速に変わる**。
    // そのとき気づけるように、増えたことだけを出す（どれだけが上限かは決めない＝
    // 数字をここに書き写さない）。比較は7日前の同じ面と行い、
    // 比（+15%以上）と絶対値（+30KB以上）の**両方**を満たしたときだけ出す
    // （小さい面の±数KBのぶれで毎日鳴ると読まれなくなる）。
    const KB_GROWTH_RATIO = 1.15;
    const KB_GROWTH_FLOOR_KB = 30;
    const fatter = rows
      .map((p) => ({ p, was: byFace(weekAgo, p.face)?.loadKB }))
      .filter(
        ({ p, was }) =>
          typeof p.loadKB === "number" &&
          typeof was === "number" &&
          was > 0 &&
          p.loadKB - was >= KB_GROWTH_FLOOR_KB &&
          p.loadKB >= was * KB_GROWTH_RATIO
      );
    if (fatter.length > 0) {
      console.log(
        `   ⚠ 初期表示のバイト数が7日前より増えた面（+${KB_GROWTH_FLOOR_KB}KB以上かつ+${Math.round(
          (KB_GROWTH_RATIO - 1) * 100
        )}%以上）: ` + fatter.map(({ p, was }) => `${p.face}(${was}KB→${p.loadKB}KB)`).join(" ")
      );
      console.log("     一覧系の面のHTMLは作品数に比例する。クールが増えれば必ず増えるので、");
      console.log("     増えた理由が作品数なのか、別のものを足したのかを先に分ける。");
    }

    // ㊴の逆戻り（画面内の先読みが復活すると、押してもいないページのために数MB飛ぶ）。
    const pf = rows.filter((p) => typeof p.scrollPrefetch === "number" && p.scrollPrefetch > 0);
    if (pf.length > 0) {
      console.log(`   ⚠ スクロールだけで先読みが飛んでいる面: ${pf.map((p) => `${p.face}(${p.scrollPrefetch}件/${p.scrollKB}KB)`).join(" ")}`);
      console.log("     `components/IntentLink.tsx` の素振り判定が壊れていないか見ること（㊴）。");
    }
    const missing = (latest.json.failures ?? []).concat(latest.json.skipped ?? []);
    if (missing.length > 0) console.log(`   ⚠ 測っていない: ${missing.join(" / ")}`);
    if (otherBases.length > 0) {
      // **`all.length - usable.length` で数えないこと**（2026-09-29修正）。usable は
      // 遅延の当て方が違う断面も外すようになったので、その差を「別の計測元」として
      // 数えると水増しになる（外した理由が2つあるのに1つの名前で報告してしまう）。
      console.log(`   ⚠ 別の計測元の断面が ${otherBaseSnaps.length} 日ぶん混ざっている（${otherBases.join(", ")}）。`);
      console.log("     比較からは外してある。手元で試したファイルなら消すこと。");
    }
    // 直した日の境界を必ず告げる（黙って断面が減ると「収集が止まった」と読まれる）。
    if (otherLatency.length > 0) {
      const last = otherLatency.at(-1).date;
      console.log(`   ⚠ ${last} までの ${otherLatency.length} 日ぶんは擬似遅延の当て方が違う（TTFBに乗っていない）ので比較から外してある。`);
      console.log("     この境界でTTFBは30ms前後→180ms前後に跳ねるが、**遅くなったのではなく**");
      console.log("     それまで測れていなかった往復ぶんが乗っただけ。LCP・FCPも動くので前回比は出さない。");
    }
    if (/localhost|127\.0\.0\.1/.test(String(latest.json.base))) {
      console.log("   ⚠ これは**ローカルの計測**。本番の数字ではない（実データ・実画像が無いので");
      console.log("     LCPの候補が存在せず FCP と同じ値になる＝㊶と同じ落とし穴）。");
    }
    console.log("");
  }

  // ── ② RUM（実利用者の真値。件数が少ないうちは判定に使わない）
  const latestSite = site.filter((s) => s.json).at(-1);
  const vitals = latestSite?.json.vitals ?? [];
  console.log(`② 実利用者の実測（RUM${latestSite ? `・${latestSite.date} 時点の直近${latestSite.json.windowDays ?? "?"}日` : ""}）`);
  if (!latestSite) {
    console.log("   行動ログがまだ1件もコミットされていない。\n");
  } else if (vitals.length === 0) {
    console.log("   **まだ0件**。components/WebVitals.tsx は 2026-09-09 に本番投入したので、");
    console.log("   最初の値が載るのは翌日以降の site-analytics cron から。");
    console.log("   数日経っても0件のままなら、収集が静かに壊れている（送信は sendBeacon なので画面に出ない）。\n");
  } else {
    console.log("   面".padEnd(14) + "指標".padEnd(11) + "p75".padStart(9) + "件数".padStart(7) + "  判定");
    for (const v of vitals) {
      const enough = v.count >= MIN_RUM_SAMPLES;
      const judged =
        v.metric !== "LCP" ? "" : !enough ? `  — 件数不足（${MIN_RUM_SAMPLES}件未満）` : v.p75 < GOALS.lcp ? "  ✓" : `  ✗ 目標${GOALS.lcp}ms超`;
      console.log(
        "   " + String(v.face).padEnd(11) + String(v.metric).padEnd(11) +
          String(v.p75).padStart(9) + String(v.count).padStart(7) + judged
      );
    }
    const lcp = vitals.filter((v) => v.metric === "LCP");
    const enough = lcp.filter((v) => v.count >= MIN_RUM_SAMPLES);
    if (enough.length === 0 && lcp.length > 0) {
      console.log(`\n   → **まだ判定できない**（LCPの最大件数 ${Math.max(...lcp.map((v) => v.count))} 件 < ${MIN_RUM_SAMPLES} 件）。`);
      console.log("     検索からの流入は実測で1日数クリックなので、面ごとに溜まるには時間が掛かる。");
      console.log("     いま判断に使えるのは①の合成計測のほう。");
    }
    console.log("");
  }

  if (broken.length > 0) console.log(`⚠ 読めなかったファイル: ${broken.join(", ")}`);
  console.log("※ ここに出た数字をドキュメントへ転記しないこと（断面が固定されて実測とズレる）。");
}

main();
