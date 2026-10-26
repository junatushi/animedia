"use strict";
// scripts/rental-gaps.ts の「配信先の抜け」の候補のうち、調べた結果「足さない」と確認済みのもの
// （2026-10-26導入）。rental-acknowledged.js・coverage-acknowledged.js と同じ約束で、
// **理由と再確認の期日 recheckOn を必ず書く**（無いと起動時に落ちる）。期日が来ると除外は
// 効かなくなり、前回の理由つきでIssueに戻る。
// keys は除外するサービスだけを書く（作品ごと隠さない。同じ作品に新しく増えた配信先まで黙らせないため）。
const ACKNOWLEDGED = [];

function validateAcknowledged(list) {
  for (const a of list) {
    if (
      !Number.isInteger(a.id) ||
      !Array.isArray(a.keys) ||
      a.keys.length === 0 ||
      !a.reason ||
      !/^\d{4}-\d{2}-\d{2}$/.test(a.recheckOn || "")
    ) {
      throw new Error(`streaming-acknowledged.js: id・keys・reason・recheckOn（YYYY-MM-DD）が揃っていない行があります: ${JSON.stringify(a)}`);
    }
  }
}

/** 期日内の除外で隠す key（today は JST の "YYYY-MM-DD"）。 */
function ackedKeys(list, id, today) {
  return list.filter((a) => a.id === id && today < a.recheckOn).flatMap((a) => a.keys);
}

/** 期日が過ぎた除外の理由（Issueに前回の理由として出す）。無ければ null。 */
function expiredFor(list, id, today) {
  const a = list.find((x) => x.id === id && today >= x.recheckOn);
  return a ? a.reason : null;
}

module.exports = { ACKNOWLEDGED, validateAcknowledged, ackedKeys, expiredFor };
