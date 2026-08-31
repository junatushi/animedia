// 作品ページ以外の <title> を、検索結果で切り捨てられない幅に収めて組み立てる。
//
// 【なぜ要るか・2026-08-19】
// 幅の予算（lib/workTitle.ts の TITLE_WIDTH_BUDGET）は2026-08-05に導入したが、
// **効いていたのは作品ページだけ**だった。他の面は generateMetadata の中で
// テンプレートリテラルを直書きし、さらにレイアウトの template（"%s | アニメ視聴ガイド"）で
// ブランド名が自動で足されるため、幅は誰も見ていなかった。
// 2026-08-19に実データで測ると:
//   制作会社ページ  165件中45件（27%）が予算超過（最長42）
//   声優ページ      1,531件中44件（3%）が超過（最長37.5）
//   サービス別・ランキング は名前の長さに関係なく常に超過
// 作品ページで直したのと同じ壊れ方（入れたはずの語が表示前に切られる）が、
// 他の面にそのまま残っていた。
//
// 素の .ts に置いてあるのは lib/workTitle.ts と同じ理由（.tsx は Node が
// 解釈できないので `node scripts/check.ts` から import できない）。

import { TITLE_WIDTH_BUDGET, displayWidth } from "./workTitle.ts";

export const SITE_NAME = "アニメ視聴ガイド";

// app/layout.tsx の title.template と同じ形。ここを変えたら向こうも変える
// （`node scripts/check.ts` が突き合わせる）。
export const BRAND_SUFFIX = ` | ${SITE_NAME}`;
export const BRAND_SUFFIX_WIDTH = displayWidth(BRAND_SUFFIX);

// Next.js の Metadata.title が受け取れる形。
// ・string           … レイアウトの template が効く（＝ブランド名が付く）
// ・{ absolute: … }  … template を効かせない（＝ブランド名が付かない）
export type PageTitle = string | { absolute: string };

/** その title が検索結果で占める幅（ブランド名が付くならその分も含む）。 */
export function titleWidth(t: PageTitle): number {
  return typeof t === "string"
    ? displayWidth(t) + BRAND_SUFFIX_WIDTH
    : displayWidth(t.absolute);
}

/**
 * 候補を「情報量の多い順」に渡すと、予算に収まる最初のものを返す。
 *
 * 判断は2段階:
 *   1. ブランド名込みで収まる          → そのまま返す（ブランド名も出す）
 *   2. ブランド名を落とせば収まる      → { absolute } で返す（template を切る）
 *   3. どれも収まらない                → 最後の候補を { absolute } で返す
 *
 * ブランド名を先に落とすのは、作品ページと同じ判断による:
 * サイト名は検索結果で title とは別に表示されるうえ、「◯◯ 配信」で探している人に
 * 対する関連性を持たない。その幅は検索語と一致しうる語に使うほうが良い。
 *
 * 3. で切り詰めないのは作品名を削らないのと同じ理由で、主キーワード（作品名・人名・
 * 制作会社名）を削ると検索語と一致しなくなるため。予算超過は許容し、
 * `node scripts/check.ts` が「より短い候補があったのに選ばなかった」場合だけを落とす。
 */
export function fitPageTitle(candidates: string[]): PageTitle {
  if (candidates.length === 0) return { absolute: SITE_NAME };
  for (const c of candidates) {
    if (displayWidth(c) + BRAND_SUFFIX_WIDTH <= TITLE_WIDTH_BUDGET) return c;
    if (displayWidth(c) <= TITLE_WIDTH_BUDGET) return { absolute: c };
  }
  return { absolute: candidates[candidates.length - 1] };
}

/**
 * OGP・Twitterカード用の素の文字列。
 * SNSのカードは検索結果と打ち切り幅が違うので、ブランド名の有無だけを揃えて
 * 中身は title と同じものを使う。
 */
export function titleText(t: PageTitle): string {
  return typeof t === "string" ? t : t.absolute;
}
