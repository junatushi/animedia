import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SeasonExplorer from "@/components/SeasonExplorer";
import { getSeasonData, isValidYear, isValidSeason } from "@/lib/getSeasonData";
import type { SeasonResponse } from "@/lib/types";

import ARCHIVE_INDEX from "@/content/archive/index.json";
import { siteUrl } from "@/lib/siteUrl";
import { seasonPageTitle, seasonPageDescription } from "@/lib/pageMeta";
import { robotsFor } from "@/lib/indexPolicy";
import { titleText } from "@/lib/pageTitle";

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
// 【2026-08-25変更】600秒 → 3600秒（1時間）。Vercel Hobbyの ISR Writes 上限
// （30日で200,000）を296,449件で超過しプロジェクトがPausedになったため。再検証の間隔を
// 延ばすと、①再生成の回数がそのまま減る（ISR Writes・Fluid CPU・Provisioned Memoryの
// 3指標すべてに効く）②キャッシュが効いている時間が長くなるので**表示はむしろ速くなる**。
// ISRは期限切れ後も stale-while-revalidate で古いHTMLを即座に返しつつ裏で作り直すので、
// 期限を延ばしても訪問者が待たされる場面は増えない。Annictの配信情報はコミュニティ更新で
// 分単位に動くものではなく、1時間の鮮度で困る用途がこのサイトには無い。経緯はdocs/operations.md。
// 【2026-08-25変更（2回目）】3600 → 604800（1週間）。
// 同日に900→3600へ延ばしたが、**それでは書き込みは1件も減らない**ことが実測で判明した。
// 超過時の30日で Edge Requests 10,300件/日 に対し ISR Writes 9,882件/日＝96%。
// sitemapの約7,051ページへ1日10,300リクエストが分散すると1ページあたりの再訪間隔は
// 平均16.4時間になり、revalidateがそれより短い限り訪問のたびに必ず期限切れ＝毎回書き込みに
// なる。900秒でも3600秒でも16.4時間より遥かに短いので効果が無かった。
// そこで再訪間隔より十分長い1週間にして「時間による再生成」を止め、鮮度が要る現在クールは
// /api/revalidate（.github/workflows/revalidate.yml が1日2回叩く）で明示的に指名する方式に
// 変えた。表示速度は落ちない（stale-while-revalidateで古いHTMLを即座に返す設計は同じで、
// むしろキャッシュに当たる時間が長くなる）。経緯は docs/operations.md の㉝。
export const revalidate = 604800;

// 動的セグメント[year]/[season]は generateStaticParams が無いと revalidate を付けても
// 動的レンダリング（no-store）のままCDNキャッシュされない。今年の4シーズンを列挙して
// 静的生成対象にすることでISR（エッジキャッシュ＋10分再検証）が有効になる。ここに無い
// 年（過去年など）も dynamicParams（既定true）により初回オンデマンド生成→以後キャッシュ
// される。build時に今年分のgetSeasonDataを呼ぶが、失敗してもpage側でcatchしdata未指定で
// 描画されるためbuildは落ちない。年はbuild（=デプロイ）時点の西暦で決まる。
// 【2026-08-25変更】今年の4クールに加え、**過去クール64件も全件事前生成する**。
// 事前生成したページはISR Writesを1件も消費しない（デプロイ成果物に含まれる）のに対し、
// 事前生成していないページはデプロイのたびにキャッシュが消え、最初に見に来た人の分だけ
// 必ず書き込みが発生する。過去クールは content/snapshots/ の静的JSONから返る＝
// ネットワークに出ないので、焼いてもビルドが外部APIに依存しない。
// 経緯は docs/operations.md の㉝。
export function generateStaticParams() {
  const thisYear = new Date().getFullYear();
  const params = ["winter", "spring", "summer", "autumn"].map((season) => ({
    year: String(thisYear),
    season,
  }));

  // 過去クールは索引（content/archive/index.json）が持つ組だけを焼く。sitemapが載せる
  // 集合と同じ作り方なので、載せているのに焼いていないというズレが起きない。
  for (const s of ARCHIVE_INDEX.seasons) {
    if (s.year >= thisYear) continue;
    params.push({ year: String(s.year), season: s.season });
  }
  return params;
}

type Params = { year: string; season: string };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) return {};

  const label = SEASON_LABEL[season];
  const title = seasonPageTitle(year, season);
  const description = seasonPageDescription(year, season);
  const url = `${siteUrl}/season/${year}/${season}`;

  // 取得に失敗したとき・作品が1件も無いときは索引に載せない（lib/indexPolicy.ts）。
  // 下の本体は失敗を握ってエラーUIを描く＝HTTPは200なので、robotsで止めるしかない。
  let failed = false;
  let count = 0;
  try {
    count = (await getSeasonData(year, season)).items.length;
  } catch {
    failed = true;
  }

  return {
    title,
    description,
    alternates: { canonical: url },
    ...robotsFor(failed, count),
    openGraph: { title: titleText(title), description, url, type: "website" },
    twitter: { card: "summary_large_image", title: titleText(title), description },
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
