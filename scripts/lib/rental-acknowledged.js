"use strict";
// scripts/rental-gaps.ts が出す候補のうち「調べた結果、課金扱いにしない」と確認済みの作品
// （2026-10-10導入）。scripts/lib/coverage-acknowledged.js と同じ約束で、
// **理由と再確認の期日 recheckOn を必ず書く**（無いと起動時に落ちる）。期日が来ると除外は
// 効かなくなり、前回の理由つきでIssueに戻る。理由の無い除外は本物の課金専用を黙って隠す。
const ACKNOWLEDGED = [
  {
    id: 17851,
    title: "ガールズ＆パンツァー もっとらぶらぶ作戦です！",
    reason:
      "公式の配信表（https://gup-mottolovelove.jp/streaming-1 ）は2026年1〜6月のパッケージ配信（デジタルセル版・長期レンタル版）のもので、10月のTV放送の配信区分ではない（2026-10-10確認）",
    recheckOn: "2026-11-10",
  },
];

function validateAcknowledged(list) {
  for (const a of list) {
    if (!Number.isInteger(a.id) || !a.reason || !/^\d{4}-\d{2}-\d{2}$/.test(a.recheckOn || "")) {
      throw new Error(`rental-acknowledged.js: id・reason・recheckOn（YYYY-MM-DD）が揃っていない行があります: ${JSON.stringify(a)}`);
    }
  }
}

module.exports = { ACKNOWLEDGED, validateAcknowledged };
