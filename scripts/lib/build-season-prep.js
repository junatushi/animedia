// クール開始「前倒し準備」の窓判定と、GitHub Issue本文の組み立て（2026-08-07導入）。
// 純粋関数のみでネットワークには出ない。
//
// 【背景】このサイトの検索需要はクール（3ヶ月）単位で年4回だけ山が来て、次クールの
// 検索はクール開始の約1ヶ月前から立ち上がる。にもかかわらず「前倒しで準備を始める」
// きっかけが運用に無かったため、この窓判定を起点にGitHub Issueを自動起票する
// （.github/workflows/season-prep.yml が呼ぶ）。
//
// 【なぜ「窓」をこのファイルだけに持たせるか】CLAUDE.mdの基本ルール
// 「時刻・日付の定義をYAMLに書かない」「GitHub Actionsのscheduleは予定通り発火しない
// 前提で書く」に従う。season-prep.ymlのcronは「毎日1回」起動するだけで月日の意味は
// 持たせず、「いまが窓の中か」は毎日この判定関数に聞く。cronが数時間〜十数時間遅れても、
// 遅れた側の日付でこの関数を呼べば同じ結果になるので、実行時刻のズレに影響されない
// （daily-digest.yml の SLOTS / current-slot.js と同じ考え方）。
"use strict";

const SEASON_LABEL = { winter: "冬", spring: "春", summer: "夏", autumn: "秋" };

// 窓の定義（このファイルだけが持つ。他のファイルに複製しないこと）:
//   windowMonth  … 窓が開くJSTの月（1〜12）。「下旬」＝WINDOW_START_DAY日〜月末。
//   targetSeason … その窓で準備するクール（クール開始は 冬=1月/春=4月/夏=7月/秋=10月）。
//   yearOffset   … 窓が開いた年 → 対象クールの年への差分。11月の窓だけ+1（年をまたぐ）。
// クール開始のおよそ1〜1.5ヶ月前になるように選んである
// （例: 10月開始の秋クール → 8月21日〜31日の窓は開始の1.0〜1.3ヶ月前）。
const WINDOWS = [
  { windowMonth: 8, targetSeason: "autumn", yearOffset: 0 }, // 8月下旬 → 今年10月開始の秋クール
  { windowMonth: 11, targetSeason: "winter", yearOffset: 1 }, // 11月下旬 → 翌年1月開始の冬クール（年またぎ）
  { windowMonth: 2, targetSeason: "spring", yearOffset: 0 }, // 2月下旬 → 今年4月開始の春クール
  { windowMonth: 5, targetSeason: "summer", yearOffset: 0 }, // 5月下旬 → 今年7月開始の夏クール
];

const WINDOW_START_DAY = 21; // 「下旬」の開始日。終了日は指定しない（月が変われば windowMonth の不一致で自然に窓の外になる）

// UTC→JSTへの変換。scripts/lib/build-digest.js の jstParts と同じ+9h手動オフセット方式に
// 揃えてある（Intl.DateTimeFormatのタイムゾーンDB依存を避け、既存コードと書き方を揃えるため）。
function jstParts(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
  };
}

// いま（date、既定=現在時刻）が前倒し準備の窓の中かどうかを判定する。
// 窓の外なら null。窓の中なら対象クールの情報を返す。
// 引数は `new Date()` をそのまま渡してよい（JSTへの変換はこの関数の中で行う）。
function findPrepWindow(date = new Date()) {
  const { year, month, day } = jstParts(date);
  if (day < WINDOW_START_DAY) return null;
  const hit = WINDOWS.find((w) => w.windowMonth === month);
  if (!hit) return null;
  const targetYear = year + hit.yearOffset;
  return {
    targetYear,
    targetSeason: hit.targetSeason,
    targetSeasonLabel: SEASON_LABEL[hit.targetSeason],
    isYearBoundary: hit.yearOffset !== 0,
    jstDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

// Issueのタイトル。年+クールが変わらない限り同じ文字列になる
// （season-prep.yml はこのタイトルで既存Issueを検索し、重複起票を防ぐ）。
function issueTitle(window) {
  return `次クール準備: ${window.targetYear}年${window.targetSeasonLabel}クール`;
}

// Issue本文（Markdown）を組み立てる。各チェック項目には「なぜやるか」を1行添える。
function buildSeasonPrepIssue(window) {
  const { targetYear, targetSeason, targetSeasonLabel, isYearBoundary, jstDate } = window;
  const title = issueTitle(window);

  const lines = [];
  lines.push(`次は **${targetYear}年${targetSeasonLabel}クール**（\`${targetSeason}\`）です。`);
  lines.push("");
  lines.push(
    "このサイトの検索需要はクール開始の約1ヶ月前から立ち上がります。準備を始めるタイミングを" +
      "外すと次のチャンスは3ヶ月後になるため、このIssueはクール開始のおよそ1〜1.5ヶ月前に自動で起票しています。",
  );
  lines.push("");
  lines.push("## チェックリスト");
  lines.push("");
  lines.push(
    `- [ ] \`node scripts/audit-coverage.ts ${targetYear} ${targetSeason}\` で次クールのAnnict登録状況を点検\n` +
      "  - なぜ: TV放送データはあるのに配信サービスが0件の注目作＝Annict側の登録待ちの疑いを、クール開始前に洗い出すため。\n" +
      "  - `ANNICT_TOKEN` が要るため、GitHub Actions上ではなく**ローカルPCで実行**すること。",
  );
  lines.push(
    "- [ ] 上のスクリプトで出た注目作を `content/works/extraServices.ts` に人力補完\n" +
      "  - なぜ: Annictのコミュニティ更新を待つと公開が遅れる注目作を、一次情報で先回りして埋めるため。\n" +
      "  - 一次情報のみ・出典URL（`sourceUrl`）と確認日（`confirmedDate`）必須・推測禁止。",
  );
  lines.push(
    "- [ ] `content/sns/spotlight.js` の入れ替え\n" +
      "  - なぜ: クールが切り替わった後も前クールの作品をSNSで紹介し続けないようにするため。\n" +
      "  - 実測（GSC・Vercel Analytics）で需要が確認できた作品だけを載せる。推測で足さない。",
  );
  if (isYearBoundary) {
    const prevYear = targetYear - 1;
    lines.push(
      `- [ ] 【年またぎ】\`node scripts/snapshot-past-seasons.ts ${prevYear} ${prevYear}\` で前年分のスナップショットを生成\n` +
        `  - なぜ: 年が変わると${prevYear}年の全クールが「放送済み」で確定するため、ライブ取得より速い静的スナップショットに固定するため。\n` +
        "  - → 続けて `node scripts/build-archive-index.ts` と `node scripts/build-person-index.ts` と `node scripts/build-studio-index.ts` を**必ず**実行\n" +
        "  - なぜ: スナップショットだけ増やして索引を再生成しないと、sitemapや声優の出演作ページとの間にズレが生まれ、`node scripts/check.ts` が検出する状態になるため。",
    );
  }
  lines.push(
    "- [ ] 次クールのシーズンページ（`/season/.../...`）が検索エンジンに拾われる状態か確認（sitemap・内部リンク）\n" +
      "  - なぜ: クール切り替わり直後にsitemap反映や内部リンクの張り替えが漏れていると、検索需要が立ち上がる時期にインデックスが間に合わないため。",
  );
  // 新シーズン告知の試し打ち（2026-08-16追加）。
  //
  // なぜここに入れるか: `season-announce.yml` は 1/4/7/10月の1日にしか発火しないため、
  // 2026-07-08の導入から2026-08-16まで**一度も実行された履歴が無い**（実測）。
  // つまり次のクール初日が毎回「未検証のまま本番SNSアカウントへ投稿する」回になる。
  // このIssueはクール開始の約1〜1.5ヶ月前に必ず立つので、告知の実行前に人の目が通る
  // 唯一確実な場所がここになる。セッションをまたいで思い出す運用は⑲で失敗しているため、
  // 手順書に書くのではなく自動で立つチェックリストに載せる。
  lines.push(
    "- [ ] 【SNS】Actions →「新シーズン告知」→ Run workflow で告知を1回試し打ちする\n" +
      "  - なぜ: `season-announce.yml` はクール初日にしか発火しないため、平時に壊れていても気づけない。本番投稿の前にこのIssueの時期に1回通しておく。\n" +
      "  - 実行した時点の年月から季節を判定するので、この時期に押せば次クールの告知文が出る。",
  );
  lines.push("");
  lines.push(`（このIssueは \`scripts/season-prep.js\` が自動生成しました。窓の判定日: ${jstDate} JST）`);

  return { title, body: lines.join("\n") };
}

module.exports = {
  jstParts,
  findPrepWindow,
  issueTitle,
  buildSeasonPrepIssue,
  WINDOWS,
  WINDOW_START_DAY,
  SEASON_LABEL,
};
