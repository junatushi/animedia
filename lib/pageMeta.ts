// 作品ページ以外の各面の <title> を組み立てる。
//
// 【なぜ1箇所に集めるか・2026-08-19】
// これまで各ページの generateMetadata がテンプレートリテラルを直書きしていたため、
// ①幅の予算（lib/pageTitle.ts）が効かず ②`node scripts/check.ts` から検査できなかった
// （app/**/page.tsx は .tsx なので Node から import できない）。
// lib/workTitle.ts を作品ページのために独立させたのと同じ理由で、素の .ts に置く。
//
// 候補は「情報量の多い順」に並べる。fitPageTitle が予算に収まる最初のものを選び、
// 収まらなければブランド名（" | アニメ視聴ガイド"）を落とす。

import { SEASON_LABEL } from "./resolveSeasonParams.ts";
import { fitPageTitle, type PageTitle } from "./pageTitle.ts";

/** シーズンページ /season/[year]/[season] */
export function seasonPageTitle(year: string, season: string): PageTitle {
  const label = SEASON_LABEL[season];
  return fitPageTitle([
    `${year}年${label}アニメ 配信情報一覧`,
    `${year}年${label}アニメ 配信一覧`,
  ]);
}

/** 声優ページ /person/[name]/[year]/[season] */
export function personPageTitle(
  name: string,
  year: string,
  season: string,
  hasFilmography: boolean
): PageTitle {
  const label = SEASON_LABEL[season];
  const cool = `${year}年${label}アニメ`;
  // 代表作を持つ人は「◯◯ 代表作」でも検索されるので、その語を最優先で残す。
  return fitPageTitle(
    hasFilmography
      ? [`${name}の代表作・${cool}出演作一覧`, `${name}の代表作・${cool}`, `${name}の${cool}出演作`]
      : [`${name}が出演する${cool}一覧`, `${name}の${cool}出演作`]
  );
}

/** 制作会社ページ /studio/[name]・監督ページ /director/[name] */
export function creditPageTitle(role: "studio" | "director", name: string): PageTitle {
  const verb = role === "studio" ? "制作" : "監督";
  return fitPageTitle([
    `${name}が${verb}したアニメの配信情報一覧`,
    `${name}が${verb}したアニメ一覧`,
    `${name}の${verb}作品`,
  ]);
}

/**
 * 制作会社・監督ページの見出し（h1・JSON-LDの name）。
 * こちらは幅の予算と無関係なので**削らない**（検索結果ではなくページの中身なので、
 * 短くする理由が無い）。title と別の関数にしてあるのはそのため。
 */
export function creditHeadline(role: "studio" | "director", name: string): string {
  return role === "studio"
    ? `${name}が制作したアニメの配信情報一覧`
    : `${name}が監督したアニメの配信情報一覧`;
}

/** サービス別ページ /service/[key]/[year]/[season] */
export function servicePageTitle(
  serviceName: string,
  serviceShort: string,
  year: string,
  season: string
): PageTitle {
  const label = SEASON_LABEL[season];
  const cool = `${year}年${label}アニメ`;
  // 正式名（Amazon Prime Video）が長い場合は短縮名（Prime）に落とす。
  // 短縮名は lib/services.ts の short ＝ 実際に検索されている呼び方に寄せてある。
  return fitPageTitle([
    `${cool} ${serviceName}で見れる作品一覧`,
    `${cool} ${serviceShort}で見れる作品一覧`,
    `${cool} ${serviceShort}で見れる作品`,
  ]);
}

/** 独占配信ページ /exclusive/[year]/[season] */
export function exclusivePageTitle(year: string, season: string): PageTitle {
  const label = SEASON_LABEL[season];
  return fitPageTitle([`${year}年${label}アニメ 独占配信まとめ`]);
}

/** ランキングページ /rankings/[year]/[season] */
export function rankingsPageTitle(year: string, season: string): PageTitle {
  const label = SEASON_LABEL[season];
  return fitPageTitle([
    `${year}年${label}アニメ 配信サービス勢力図・ランキング`,
    `${year}年${label}アニメ 配信サービスランキング`,
  ]);
}

// ─────────────────────────────────────────────
// description（検索結果のスニペット）
//
// title と同じ理由で1箇所に集める。ただし**title と同じ考え方では扱わない**。
// 2026-08-19に調べた事実（出典は docs/seo-operations.md 4節）:
//   ① Google はスニペットの打ち切り幅を公表していない。非公式の観測値は
//      PC 全角105前後・スマホ 全角55前後で、業界の助言は「冒頭50〜70文字に要点」。
//   ② Google は meta description の**62〜71%を書き換える**
//      （Ahrefs 62.78% / Portent 68〜71%）。裏を返すと3割前後はそのまま使われる。
//   ③ テンプレートで機械生成すること自体は Google のスパムポリシー
//      （scaled content abuse）の対象ではない。あちらが見ているのは方式ではなく
//      「主目的が順位操作か」「固有の価値があるか」。ただし**変数部分が効かず
//      完全に同一の文になる**と重複として書き換えられやすくなる。
//
// ここから決めた基準は3つ。**幅そのものより「差別化情報が先頭にあるか」を見る**
// （後半は切られて読まれないので、そこに置いた語は無いのと同じ）:
//   ・LEAD  … その面を他のページと区別する語（作品名・人名・会社名・サービス名）は
//             先頭 DESCRIPTION_LEAD_BUDGET 全角以内に置く
//   ・全体  … DESCRIPTION_WIDTH_BUDGET を超える部分は誰にも読まれないので書かない
//   ・重複  … 同じ面の中で同一の文が2つ以上できない（変数部分が効いていること）
// 数値は**非公式の観測値**なので、これを根拠に断定的な主張をしないこと。
//
// 2026-08-19の実測（導入前）:
//   作品     465件 中央80.0 最長148.5   ← 上限超過あり
//   制作会社  165件 中央56.5 最長68.0
//   監督     378件 中央54.5 最長58.5
//   声優   1,531件 中央56.0 最長63.0
// ─────────────────────────────────────────────

/** スニペット全体の幅の目安（全角換算）。PC の観測値。 */
export const DESCRIPTION_WIDTH_BUDGET = 105;

/** 差別化情報を置く先頭部分の幅（全角換算）。スマホの観測値。 */
export const DESCRIPTION_LEAD_BUDGET = 55;

/** シーズンページ */
export function seasonPageDescription(year: string, season: string): string {
  const label = SEASON_LABEL[season];
  return `${year}年${label}アニメが、dアニメ・ABEMA・Netflix等どの配信サービスで見られるか一覧。アニメ視聴ガイドでサービス別に絞り込みできます。`;
}

/** 声優ページ */
export function personPageDescription(
  name: string,
  year: string,
  season: string,
  hasFilmography: boolean
): string {
  const label = SEASON_LABEL[season];
  return hasFilmography
    ? `${name}さんの代表作（役名付き）と、${year}年${label}アニメの出演作をまとめました。配信サービスもあわせてアニメ視聴ガイドで確認できます。`
    : `${name}さんが出演する${year}年${label}アニメを一覧でまとめました。配信サービスもあわせてアニメ視聴ガイドで確認できます。`;
}

/** 制作会社ページ・監督ページ */
export function creditPageDescription(
  role: "studio" | "director",
  name: string,
  count: number
): string {
  const verb = role === "studio" ? "制作" : "監督";
  return `${name}が${verb}したアニメ${count}作品を新しい順にまとめました。各作品の配信サービスはアニメ視聴ガイドで確認できます。`;
}

/** サービス別ページ */
export function servicePageDescription(
  serviceName: string,
  year: string,
  season: string
): string {
  const label = SEASON_LABEL[season];
  return `${year}年${label}アニメのうち、${serviceName}で配信されている作品を一覧でまとめました。アニメ視聴ガイドで確認できます。`;
}

/** 独占配信ページ */
export function exclusivePageDescription(year: string, season: string): string {
  const label = SEASON_LABEL[season];
  return `${year}年${label}アニメのうち、見放題配信サービスが1社だけの「独占配信」作品を、サービス別に一覧でまとめました。アニメ視聴ガイドで確認できます。`;
}

/** ランキングページ */
export function rankingsPageDescription(year: string, season: string): string {
  const label = SEASON_LABEL[season];
  return `${year}年${label}アニメの配信サービス別対応本数・独占配信数・先行配信ランキングをAnnictの実データからまとめました。アニメ視聴ガイドで確認できます。`;
}
