"use strict";
// 依存パッケージの脆弱性のうち「調べた結果、いまは直さなくてよい」と確認済みのもの
// （2026-11-05導入）。scripts/security-audit.js が読む。
//
// 形は scripts/lib/coverage-acknowledged.js と同じ。**理由 reason と再確認の期日 recheckOn を
// 必ず書く**（理由の無い除外は、本物の脆弱性を黙って隠す道具になる）。期日（JST）の当日から
// 除外は効かなくなり、前回の理由つきでIssueに戻る＝調べ直すきっかけが自動で来る。
// 直した・依存が上がって監査に出なくなったら、その行を消す（監査側が「消してよい」と教える）。
// 自動では足さない。足すのは人が影響範囲を読んで判断したときだけ。

// 2026-11-08に Next.js 15.5 へ上げ、2026-11-05に載せた17件のうち Next.js 14系の12件と nanoid・source-map-js は
// 監査に出なくなった。残るのは Next.js 15.5 が内部で固定している postcss の2件だけ（16 へ上げると消える）。
// 経緯は docs/operations.md の [75]。新しく足すときも理由と recheckOn を必ず書く。

// Next.js 15.5 が内部で固定しているビルド時専用の依存。
const BUILDTIME_REASON =
  "Next.js 15.5が内部で固定しているビルド時専用のpostcss。入力は自リポジトリのCSS・ソースマップだけで、利用者や外部から値を渡す経路が無い（本番の実行時には読み込まれない）。Next.js 16への更新で一緒に上がる。15系のセキュリティ修正は2027-01-31まで";

const buildEntry = (id, pkg) => ({
  id,
  package: pkg,
  reason: BUILDTIME_REASON,
  recheckOn: "2027-01-15",
});

const ACKNOWLEDGED = [
  buildEntry("GHSA-6g55-p6wh-862q", "postcss"),
  buildEntry("GHSA-r28c-9q8g-f849", "postcss"),
];

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
