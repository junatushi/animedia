// 一覧（SeasonExplorer）の配信サービス絞り込みの判定（2026-10-19に切り出し）。
//
// 【守ること】絞り込みは**カードに出すチップと同じ集合**で照合する。
// カードのチップは `splitRentalServices` の `streaming`（見放題）だけを出し、
// レンタル/都度課金（content/works/rentalServices.ts）は出さない。以前は「独占」だけが
// 見放題で数え、サービスのチップはレンタルも含む `it.services` で照合していたため、
// 「独占」+「dアニメ」(AND) で、**ABEMA独占・dアニメは個別課金**の作品が残り、
// 選んでいないABEMAのチップだけが付いたカードが出ていた（2026-10-19・利用者の指摘）。
// rental-gaps（2026-10-10〜）でレンタルの記録が増えるほど、この食い違いが表に出る。
//
// 素の`.ts`に置いているのは `node scripts/check.ts` から import して検査するため
// （SeasonExplorer は `.tsx`＝Node から読めない）。判定を書き戻さないこと。

import { splitRentalServices } from "./services.ts";
import type { ServiceTag } from "./types";

// 「独占」は実在の配信サービスではなく、「見放題配信サービスが1つだけの作品」を
// 指す仮想チップ。active（配信サービスの絞り込みSet）に同居させることで、既存の
// OR/AND切り替えがそのまま使える（例: 「独占」+「dアニメ」をANDにすると
// dアニメの独占配信作品だけに絞れる）。lib/services.ts の ServiceKey には
// 実データ由来のキーだけを置きたいので別の定数として持つ。
export const EXCLUSIVE_KEY = "__exclusive__";

export function matchesServiceFilter(
  services: ServiceTag[],
  rentalKeys: string[] | undefined,
  active: ReadonlySet<string>,
  andMode: boolean
): boolean {
  if (active.size === 0) return true;
  const { streaming } = splitRentalServices(services, rentalKeys);
  const matchesKey = (k: string) =>
    k === EXCLUSIVE_KEY ? streaming.length === 1 : streaming.some((s) => s.key === k);
  const keys = [...active];
  return andMode ? keys.every(matchesKey) : keys.some(matchesKey);
}
