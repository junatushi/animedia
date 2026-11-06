"use strict";
// 依存パッケージの脆弱性のうち「調べた結果、いまは直さなくてよい」と確認済みのもの
// （2026-11-05導入）。scripts/security-audit.js が読む。
//
// 形は scripts/lib/coverage-acknowledged.js と同じ。**理由 reason と再確認の期日 recheckOn を
// 必ず書く**（理由の無い除外は、本物の脆弱性を黙って隠す道具になる）。期日（JST）の当日から
// 除外は効かなくなり、前回の理由つきでIssueに戻る＝調べ直すきっかけが自動で来る。
// 直した・依存が上がって監査に出なくなったら、その行を消す（監査側が「消してよい」と教える）。
// 自動では足さない。足すのは人が影響範囲を読んで判断したときだけ。

// 2026-11-06に Next.js 16 へ上げ、2026-11-05に載せた17件（Next.js 14系の12件と、
// 14が固定していたビルド時専用の postcss・nanoid・source-map-js の5件）はすべて監査に出なくなった。
// 経緯は docs/operations.md の [72]。新しく足すときも理由と recheckOn を必ず書く。
const ACKNOWLEDGED = [];

/** 理由・期日の無い除外、形の壊れた除外、重複は、黙って効かせずに例外にする。 */
function validateAcknowledged(list) {
  for (const a of list) {
    const bad =
      !a ||
      !/^GHSA(-[a-z0-9]{4}){3}$/.test(String(a.id)) ||
      !a.package ||
      !a.reason ||
      !/^\d{4}-\d{2}-\d{2}$/.test(a.recheckOn || "") ||
      Number.isNaN(Date.parse(a.recheckOn));
    if (bad) {
      throw new Error(
        `ACKNOWLEDGED の形が不正です（id は GHSA-xxxx-xxxx-xxxx・package・reason・recheckOn "YYYY-MM-DD" が必須）: ${JSON.stringify(a)}`,
      );
    }
  }
  const ids = list.map((a) => a.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`ACKNOWLEDGED に同じ脆弱性が2回あります: ${dup}`);
  return list;
}

module.exports = { ACKNOWLEDGED, validateAcknowledged };
