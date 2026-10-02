"use strict";
// ───────────────────────────────────────────────────────────────
// 配信先が未登録の作品の洗い出し（2026-10-02導入）
//
// 【なぜ要るか】
// 2026秋クールの開始直後、Annictに登録された130作品のうち48作品が配信サービス0件で、
// その中に**配信先が公式に決まっている独占配信**（Netflix・Prime Video・Disney+・FOD）が
// 7作品混ざっていた。配信オリジナルはAnnictの番組表（programs）に載らないまま配信日を
// 迎えることが多く、サイトは「配信情報なし」と出し続ける。
// 人力補完（content/works/extraServices.ts）の仕組みは既にあったが、**どの作品を
// 補完すべきかを毎日出す道具が無かった**ので、利用者に指摘されるまで誰も気づけなかった。
//
// 【何を出すか】
// content/coverage/first-seen.json（scripts/track-season.js が毎日コミットする）だけを
// 読み、**今期と次期**の作品のうち配信サービスが0件のものを、急ぐ順に並べる。
//   ① 放送/配信が既に始まっている（いちばん実害が大きい）
//   ② 開始まで HORIZON_DAYS 日以内（配信先の発表は開始の1〜3週間前に出る＝
//      docs/next-season-coverage.md の⑤。いま調べれば見つかる時期）
//   ③ 開始日が不明だがクールは始まっている（配信オリジナルはAnnictに開始日が無いことが多い）
// 開始が HORIZON_DAYS 日より先の作品は出さない（まだ発表されていないので調べても無駄）。
// 開始日は Annict → content/works/autoSchedule.json（AniList由来の予定日）→ クールの初日 の順に取る。
//
// 【出さないもの】
//   - 劇場作品（media === "MOVIE"、または autoSchedule の kind === "release"）。公開中に配信が無いのは普通で、毎日並べると
//     本物の欠損が埋もれる（毎日赤い報告は数日で読まれなくなる＝㉔）。件数だけ出す。
//   - scripts/coverage-gaps.js の ACKNOWLEDGED に理由つきで記録した作品
//     （放送延期・TV放送のみと一次情報で確認できた作品など）。件数と理由だけ出す。
//
// 【やらないこと】
// 配信サービス名を推測で埋めない（CLAUDE.md）。この道具は「調べる候補」を出すだけで、
// 追加するのは一次情報を確認した人（または日次巡回のセッション）。
// ネットワークには出ない（コミット済みのJSONを読むだけ）。
// ───────────────────────────────────────────────────────────────

const SEASONS = ["winter", "spring", "summer", "autumn"];
const HORIZON_DAYS = 30;

const toDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;

/** JSTの日付 "YYYY-MM-DD" から、今期と次期を "YYYY-season" で返す。 */
function currentAndNextSeason(today) {
  const [y, m] = today.split("-").map(Number);
  const idx = Math.floor((m - 1) / 3);
  return [0, 1].map((i) => {
    const n = idx + i;
    return `${y + Math.floor(n / 4)}-${SEASONS[n % 4]}`;
  });
}

// クールの初日（JST）。開始日が分からない作品は「クールが始まった日に始まった」とみなす
// （配信オリジナルはAnnictに開始日が無いことが多いため、それだけで除外すると独占配信を落とす）。
const SEASON_START_MONTH = { winter: "01", spring: "04", summer: "07", autumn: "10" };
function seasonStartDate(seasonStr) {
  const [y, s] = seasonStr.split("-");
  return `${y}-${SEASON_START_MONTH[s]}-01`;
}

/**
 * @param store        first-seen.json の中身
 * @param today        JSTの "YYYY-MM-DD"
 * @param ack          [{ id: "123", reason: "..." }]
 * @param autoSchedule content/works/autoSchedule.json の中身（任意）。Annictに開始日が無い作品の
 *                     開始日と「劇場公開（kind: release）か」を補う。表示用の層とは無関係に、
 *                     ここでは**並べ方と除外の判断にだけ**使う。
 */
function findGaps(store, today, ack = [], autoSchedule = null) {
  const annict = store?.sources?.annict;
  if (!annict) throw new Error("first-seen.json に sources.annict がありません");
  const ackById = new Map(ack.map((a) => [String(a.id), a]));
  const autoById = autoSchedule?.works || {};
  const seasons = currentAndNextSeason(today);

  const gaps = [];
  const acknowledged = [];
  let movies = 0;
  let later = 0;
  const missingSeasons = [];

  for (const season of seasons) {
    const rec = annict[season];
    if (!rec) {
      missingSeasons.push(season);
      continue;
    }
    for (const [id, w] of Object.entries(rec.works || {})) {
      if (Object.keys(w.services || {}).length > 0) continue;
      const auto = autoById[id];
      if (w.media === "MOVIE" || auto?.kind === "release") {
        movies++;
        continue;
      }
      const a = ackById.get(id);
      if (a) {
        acknowledged.push({ id, title: w.title, reason: a.reason });
        continue;
      }
      // 開始日: Annict > 機械補完（月精度は月初とみなす） > クールの初日
      let startDate = w.startDate || null;
      let startSource = "annict";
      if (!startDate && auto?.date) {
        startDate = auto.date.length === 7 ? `${auto.date}-01` : auto.date;
        startSource = "auto";
      }
      if (!startDate) {
        startDate = seasonStartDate(season);
        startSource = "season";
      }
      const daysUntil = toDay(startDate) - toDay(today);
      if (daysUntil > HORIZON_DAYS) {
        later++;
        continue;
      }
      gaps.push({
        id,
        season,
        title: w.title,
        startDate,
        startSource,
        media: w.media ?? null,
        rank: typeof w.rank === "number" ? w.rank : 0,
        // 1: 始まっている（開始日が分かっている） 2: これから始まる 3: 開始日が不明（クールは始まっている）
        urgency: startSource === "season" ? 3 : daysUntil <= 0 ? 1 : 2,
      });
    }
  }

  gaps.sort((a, b) => a.urgency - b.urgency || b.rank - a.rank || a.id.localeCompare(b.id));
  return { today, seasons, gaps, acknowledged, movies, later, missingSeasons };
}

const URGENCY_LABEL = {
  1: "放送/配信が始まっているのに配信先0件",
  2: `${HORIZON_DAYS}日以内に始まるのに配信先0件`,
  3: "開始日が未登録・クールは開始済み（配信オリジナル・独占配信が混ざりやすい）",
};

function searchUrl(title) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} 配信 独占`)}`;
}

/** Issue本文（Markdown）。欠損が0件なら空文字を返す＝呼び出し側はIssueを閉じる。 */
function renderIssue(result) {
  const { today, seasons, gaps, acknowledged, movies, later, missingSeasons } = result;
  if (gaps.length === 0) return "";
  const lines = [];
  lines.push(`**${today} 時点**で、今期・次期（${seasons.join("・")}）の作品のうち`);
  lines.push(`**配信サービスが1件も表示されていない作品が${gaps.length}件**あります。`);
  lines.push("");
  lines.push("独占配信（Netflix・Prime Video・Disney+・FODなど）はAnnictの番組表に載らないまま");
  lines.push("配信日を迎えることが多く、放っておくとサイトは「配信情報なし」と出し続けます。");
  lines.push("");
  for (const u of [1, 2, 3]) {
    const rows = gaps.filter((g) => g.urgency === u);
    if (rows.length === 0) continue;
    lines.push(`### ${URGENCY_LABEL[u]}（${rows.length}件）`);
    for (const g of rows) {
      const meta = [`Annict #${g.id}`, g.season];
      if (g.startSource !== "season") meta.push(`開始 ${g.startDate}${g.startSource === "auto" ? "（予定）" : ""}`);
      if (g.media) meta.push(g.media);
      meta.push(`注目度 ${g.rank}`);
      lines.push(
        `- [ ] **${g.title}**（${meta.join("・")}） [検索](${searchUrl(g.title)}) / [Annict](https://annict.com/works/${g.id})`
      );
    }
    lines.push("");
  }
  lines.push("### 直し方");
  lines.push("1. 配信サービス自身の発表・作品公式サイト・公式発表を報じた大手ニュースで配信先を確認する");
  lines.push("   （まとめブログ・X・Wikipedia・AniListは出典にしない。推測で埋めない）");
  lines.push("2. `content/works/extraServices.ts` に `{ key, sourceUrl, confirmedDate }` を足す");
  lines.push("   （曜日・時刻が一次情報に明記されていれば `schedule` も）。次のデプロイで一覧・作品ページの両方に出る");
  lines.push("3. 一次情報で「配信なし（TV放送のみ）」「放送延期」と確認できたら、");
  lines.push("   `scripts/coverage-gaps.js` の `ACKNOWLEDGED` に**理由つきで**足す（このIssueから消える）");
  lines.push("");
  const notes = [];
  if (movies > 0) notes.push(`劇場作品 ${movies}件（公開中に配信が無いのは普通なので除外）`);
  if (later > 0) notes.push(`開始が${HORIZON_DAYS}日より先の作品 ${later}件（配信先の発表前なので除外）`);
  if (acknowledged.length > 0) notes.push(`確認済みで除外 ${acknowledged.length}件`);
  if (notes.length > 0) {
    lines.push(`除外: ${notes.join(" / ")}`);
    lines.push("");
  }
  if (missingSeasons.length > 0) {
    lines.push(`⚠ 記録が無いクール: ${missingSeasons.join("・")}（\`scripts/track-season.js\` を確認）`);
    lines.push("");
  }
  lines.push("このIssueは `.github/workflows/track-season.yml` が毎日書き換えます（`node scripts/coverage-gaps.js`）。");
  lines.push("0件になると自動で閉じます。");
  return lines.join("\n");
}

module.exports = { findGaps, renderIssue, currentAndNextSeason, HORIZON_DAYS };
