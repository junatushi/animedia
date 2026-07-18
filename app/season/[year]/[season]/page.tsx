import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import SeasonExplorer from "@/components/SeasonExplorer";
import { getSeasonData, isValidYear, isValidSeason } from "@/lib/getSeasonData";
import type { SeasonResponse } from "@/lib/types";

import { siteUrl } from "@/lib/siteUrl";
const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

// ISR（2026-07-15導入）。これが無いと動的セグメント[year]/[season]は毎リクエスト
// サーバー関数で描画され（実測: 全ページ X-Vercel-Cache: MISS / no-store）、
// 関数がコールドだと初回2秒級（実測2024autumn 2.3s）を踏んでいた。revalidate を
// 入れるとページHTML自体がCDNエッジにキャッシュされ、以後は関数を実行せず
// X-Vercel-Cache: HIT（0.1s級）になる。10分はデータ側キャッシュ
// （lib/getSeasonData.ts の CURRENT_YEAR_REVALIDATE=600）と揃えた鮮度。
// 過去年はスナップショット由来で内容が動かないため、10分ごとの再検証でも
// 実質同じHTMLが再生成されるだけ（コストはスナップショット読み込みのみ）。
export const revalidate = 600;

// 動的セグメント[year]/[season]は generateStaticParams が無いと revalidate を付けても
// 動的レンダリング（no-store）のままCDNキャッシュされない。今年の4シーズンを列挙して
// 静的生成対象にすることでISR（エッジキャッシュ＋10分再検証）が有効になる。ここに無い
// 年（過去年など）も dynamicParams（既定true）により初回オンデマンド生成→以後キャッシュ
// される。build時に今年分のgetSeasonDataを呼ぶが、失敗してもpage側でcatchしdata未指定で
// 描画されるためbuildは落ちない。年はbuild（=デプロイ）時点の西暦で決まる。
export function generateStaticParams() {
  const year = String(new Date().getFullYear());
  return ["winter", "spring", "summer", "autumn"].map((season) => ({ year, season }));
}

type Params = { year: string; season: string };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) return {};

  const label = SEASON_LABEL[season];
  const title = `${year}年${label}アニメ 配信情報一覧`;
  const description = `${year}年${label}アニメが、dアニメ・ABEMA・Netflix等どの配信サービスで見られるか一覧。アニメ視聴ガイドでサービス別に絞り込みできます。`;
  const url = `${siteUrl}/season/${year}/${season}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

// 現状トップページ（"/"）はクライアント側フェッチのSPAのため、Googleに
// 「2026年夏アニメ 配信」のようなロングテール検索で拾われにくい。
// このページはサーバー側で事前にデータ取得しHTMLに含めることで、
// シーズン名での検索流入を狙う（SeasonExplorer自体はそのままクライアント
// コンポーネントとして再利用し、初期データを渡すことでもう一度取得しない）。
export default async function SeasonPage({ params }: { params: Params }) {
  const { year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) notFound();

  let data: SeasonResponse | undefined;
  try {
    data = await getSeasonData(year, season);
  } catch {
    // 取得失敗時は initialData なしで渡し、SeasonExplorer自身のクライアント側
    // フェッチ・エラー表示に委ねる（真っ白なページにしない）。
    data = undefined;
  }

  // 生成AI検索・検索エンジンが「その年その季節のアニメ一覧」を機械可読に把握できるよう、
  // シーズンの全作品を ItemList 構造化データとして出す（各作品は個別ページへリンク）。
  // 併せてパンくず（Home → シーズン）と確認日（dateModified）も宣言する。
  const label = SEASON_LABEL[season];
  const checkedDate = new Date().toISOString().slice(0, 10);
  const structuredLd = data
    ? [
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${year}年${label}アニメ 配信情報一覧`,
          numberOfItems: data.items.length,
          dateModified: checkedDate,
          itemListElement: data.items.map((it, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${siteUrl}/anime/${it.id}`,
            name: it.title,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "アニメ視聴ガイド", item: siteUrl },
            { "@type": "ListItem", position: 2, name: `${year}年${label}アニメ`, item: `${siteUrl}/season/${year}/${season}` },
          ],
        },
      ]
    : null;

  return (
    <>
      {structuredLd && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredLd) }}
        />
      )}
      <Suspense fallback={<div className="wrap" />}>
        <SeasonExplorer initialYear={Number(year)} initialSeason={season} initialData={data} />
      </Suspense>
    </>
  );
}
