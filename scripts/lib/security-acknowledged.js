"use strict";
// 依存パッケージの脆弱性のうち「調べた結果、いまは直さなくてよい」と確認済みのもの
// （2026-11-05導入）。scripts/security-audit.js が読む。
//
// 形は scripts/lib/coverage-acknowledged.js と同じ。**理由 reason と再確認の期日 recheckOn を
// 必ず書く**（理由の無い除外は、本物の脆弱性を黙って隠す道具になる）。期日（JST）の当日から
// 除外は効かなくなり、前回の理由つきでIssueに戻る＝調べ直すきっかけが自動で来る。
// 直した・依存が上がって監査に出なくなったら、その行を消す（監査側が「消してよい」と教える）。
// 自動では足さない。足すのは人が影響範囲を読んで判断したときだけ。

// Next.js 14系の分。サポート終了で14系に修正版は出ない（別PRで15/16系へ更新予定）。
const NEXT14_REASON =
  "Next.js 14系はサポート終了で14系の修正版が出ない。本サイトの構成（Vercel・Linux・Server Actions不使用・rewrites無し・画像最適化は next.config.mjs で無効化）では、Server Actions／RSCのPOST経路はmiddlewareでページへのPOSTとNext-Actionヘッダーを拒否して遮断している。根本対応は15/16系への更新（別PRで実施予定）。期日までに更新できていなければ再評価する";

// Next.js 14が内部で固定しているビルド時専用の依存。
const BUILDTIME_REASON =
  "Next.js 14が内部で固定しているビルド時専用の依存。入力は自リポジトリのCSS・ソースマップだけで、利用者や外部から値を渡す経路が無い。Next.jsの更新で一緒に上がる";

const nextEntry = (id, note) => ({
  id,
  package: "next",
  reason: NEXT14_REASON,
  recheckOn: "2026-12-05",
  note,
});
const buildEntry = (id, pkg) => ({
  id,
  package: pkg,
  reason: BUILDTIME_REASON,
  recheckOn: "2027-02-05",
});

const RSC_POST = "RSCのPOST逆シリアライズ（ページへのPOSTを遮断）";
const SERVER_ACTIONS = "Server Actions（不使用・POST遮断）";
const IMAGE_API = "画像最適化API（無効化済み）";

const ACKNOWLEDGED = [
  nextEntry("GHSA-h25m-26qc-wcjf", RSC_POST),
  nextEntry("GHSA-q4gf-8mx6-v5v3", RSC_POST),
  nextEntry("GHSA-8h8q-6873-q5fj", RSC_POST),
  nextEntry("GHSA-c4j6-fc7j-m34r", "WebSocket upgrade（未使用）"),
  nextEntry("GHSA-36qx-fr4f-26g5", "Pages Router + i18n（未使用）"),
  nextEntry("GHSA-m99w-x7hq-7vfj", SERVER_ACTIONS),
  nextEntry("GHSA-89xv-2m56-2m9x", SERVER_ACTIONS),
  nextEntry("GHSA-p9j2-gv94-2wf4", "rewrites（未使用）"),
  nextEntry("GHSA-p293-qw3h-jr36", "Windows上のセルフホストのみ"),
  nextEntry("GHSA-2xp9-vwfh-vxw4", IMAGE_API),
  nextEntry("GHSA-2464-fhr4-w9xw", IMAGE_API),
  nextEntry("GHSA-p3m5-59mp-jv5r", SERVER_ACTIONS),
  buildEntry("GHSA-6g55-p6wh-862q", "postcss"),
  buildEntry("GHSA-r28c-9q8g-f849", "postcss"),
  buildEntry("GHSA-28wg-ghj8-5hjv", "nanoid"),
  buildEntry("GHSA-2v37-7h3g-55p8", "nanoid"),
  buildEntry("GHSA-68fv-2mgg-jv7q", "source-map-js"),
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
