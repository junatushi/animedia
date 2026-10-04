"use strict";
// 配信先0件の作品のうち「調べた結果、補完するものが無い」と確認済みの作品（2026-10-04に
// scripts/coverage-gaps.js から切り出し）。Issueを出す scripts/coverage-gaps.js と、
// 自動補完のPRを機械検証する scripts/verify-extra-services.ts の両方が読む。
//
// 一次情報で「配信なし」「放送延期」などを確認し、調べ直す必要が無いと分かった作品。
// **理由と確認日を必ず書く**（理由の無い除外は、本物の欠損を黙って隠す道具になる）。
// **再確認の期日 recheckOn も必ず書く**（2026-10-04〜。無いと起動時に落ちる）。期日が来ると
// 除外は効かなくなり、前回の理由つきでIssueに戻る＝調べ直すきっかけが自動で来る。
// 状況が変わったら（延期作の新しい放送日が出た等）この行を消す。
const ACKNOWLEDGED = [
  {
    id: "17228",
    title: "ジャンケットバンク",
    reason: "2026-09-09に放送延期が発表され、新しい時期は未定（2026-10-02確認）",
    recheckOn: "2026-11-01",
  },
  // ───── 2026-10-04確認（Issue #201） ─────
  {
    id: "16806",
    title: "恐怖コレクター",
    reason:
      "配信はNHK ONEの同時・見逃し配信だけで、NHK ONEはSERVICES外（コミックナタリーの作品ページ https://natalie.mu/comic/anime/1573 、2026-10-04確認）",
    recheckOn: "2026-11-01",
  },
  {
    id: "17698",
    title: "ルパン三世傑作選",
    reason:
      "日本テレビで放送・放送直後からTVerで配信。TVerはSERVICES外（アニメ！アニメ！ https://animeanime.jp/article/2026/10/03/103457.html 、2026-10-04確認）",
    recheckOn: "2026-11-01",
  },
  {
    id: "17381",
    title: "ポールプリンセス‼︎ 新作CGポールダンスショー映像",
    reason:
      "2026年秋に映画館で期間限定イベント上映（配信の発表なし。公式 https://poleprincess.jp/news/detail.php?id=1132647 、2026-10-04確認）",
    recheckOn: "2026-12-01",
  },
  {
    id: "18217",
    title: "機動戦士ガンダム 光のともだち",
    reason:
      "ららぽーと福岡の実物大νガンダム立像の壁面映像（配信作品ではない。バンダイナムコフィルムワークスのPR TIMES https://prtimes.jp/main/html/rd/p/000000007.000120556.html 、2026-10-04確認）",
    recheckOn: "2026-12-01",
  },
  {
    id: "17365",
    title: "ゴールデンカムイ 暴走列車編",
    reason:
      "公式が「この冬開幕」と発表しており、10月時点では始まっていない（https://www.kamuy-anime.com/news/index06830000.html 、2026-10-04確認）",
    recheckOn: "2026-12-01",
  },
  {
    id: "16284",
    title: "〈物語〉シリーズ オフ&モンスターシーズン 業物語 かれんオウガ",
    reason:
      "公式サイトの表記が「二〇二六年冬放送開始」で、10月時点では始まっていない（https://www.monogatari-series.com/oms/ 、2026-10-04確認）",
    recheckOn: "2026-12-01",
  },
];

/** 期日の無い除外・形の壊れた除外は、黙って効かせずに例外にする。 */
function validateAcknowledged(list) {
  for (const a of list) {
    if (!/^\d+$/.test(String(a.id)) || !a.reason || !/^\d{4}-\d{2}-\d{2}$/.test(a.recheckOn || "")) {
      throw new Error(`ACKNOWLEDGED の形が不正です（id・reason・recheckOn "YYYY-MM-DD" が必須）: ${JSON.stringify(a)}`);
    }
  }
  const ids = list.map((a) => String(a.id));
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`ACKNOWLEDGED に同じ作品が2回あります: ${dup}`);
  return list;
}

module.exports = { ACKNOWLEDGED, validateAcknowledged };
