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
