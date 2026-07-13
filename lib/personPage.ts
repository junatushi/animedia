// 声優個人ページ（app/person/[name]/[year]/[season]/page.tsx）と、そこへリンクする側
// （app/anime/[id]/page.tsx の声優名リンク）の両方が参照する共有定数。
// 「今期2作品以上に出演」の声優だけをページ化する閾値（components/SeasonExplorer.tsx の
// 声優チップと同じ基準）。作品個別ページの声優名は、この閾値を満たさない相手にリンクを
// 張ると404になってしまうため、リンクを出す前に必ずこの値でフィルタする。
export const PERSON_PAGE_MIN_APPEARANCES = 2;
