import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSeasonData, isValidYear, isValidSeason } from "@/lib/getSeasonData";
import type { AnimeItem } from "@/lib/types";

const siteUrl = "https://animedia-khaki.vercel.app";
const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

// 「今期2作品以上に出演」の声優だけをページ化する（components/SeasonExplorer.tsx の
// 声優チップと同じ閾値）。競合（アニメイトタイムズ等）が強い領域であり、出演1作品だけの
// 薄いページを量産すると検索エンジンに低品質判定されるリスクがあるため、絞り込む
// （docs/growth-ideas.md の流入調査 2026-07-13 で明記した懸念への対応）。
const MIN_APPEARANCES = 2;

type Params = { name: string; year: string; season: string };

function findWorks(items: AnimeItem[], name: string): AnimeItem[] {
  return items.filter((it) => it.castNames.includes(name));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { name: encodedName, year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) return {};
  const name = decodeURIComponent(encodedName);

  let works: AnimeItem[] = [];
  try {
    const data = await getSeasonData(year, season);
    works = findWorks(data.items, name);
  } catch {
    return {};
  }
  if (works.length < MIN_APPEARANCES) return {};

  const label = SEASON_LABEL[season];
  const title = `${name}が出演する${year}年${label}アニメ一覧`;
  const description = `${name}さんが出演する${year}年${label}アニメを一覧でまとめました。配信サービスもあわせてアニメ視聴ガイドで確認できます。`;
  const url = `${siteUrl}/person/${encodeURIComponent(name)}/${year}/${season}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

// 「[声優名] 出演 今期アニメ」のようなロングテール検索の受け皿。ただし競合
// （アニメイトタイムズの声優別まとめ等）が強い領域のため、出演数上位（2作品以上）
// のみをページ化し、薄いページの量産を避ける。キャラクター名まではAnimeItemに
// 持たせていないため（Annict個別取得が必要でコストが増えるため見送り）、
// components/SeasonExplorer.tsx の声優チップ絞り込みと同じ「作品タイトル一覧」に留める。
export default async function PersonPage({ params }: { params: Params }) {
  const { name: encodedName, year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) notFound();
  const name = decodeURIComponent(encodedName);

  const label = SEASON_LABEL[season];
  let works: AnimeItem[] = [];
  let fetchError: string | null = null;
  try {
    const data = await getSeasonData(year, season);
    works = findWorks(data.items, name).sort((a, b) => b.watchers - a.watchers);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "取得に失敗しました。";
  }

  if (!fetchError && works.length < MIN_APPEARANCES) notFound();

  const checkedDate = new Date().toISOString().slice(0, 10);
  const structuredLd = !fetchError
    ? [
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${name}が出演する${year}年${label}アニメ一覧`,
          numberOfItems: works.length,
          dateModified: checkedDate,
          itemListElement: works.map((it, i) => ({
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
            {
              "@type": "ListItem",
              position: 2,
              name: `${year}年${label}アニメ`,
              item: `${siteUrl}/season/${year}/${season}`,
            },
            {
              "@type": "ListItem",
              position: 3,
              name: `${name}の出演作`,
              item: `${siteUrl}/person/${encodedName}/${year}/${season}`,
            },
          ],
        },
      ]
    : null;

  return (
    <div className="wrap">
      {structuredLd && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredLd) }}
        />
      )}
      <header className="masthead">
        <span className="eyebrow" aria-hidden="true">
          LINK START :: 出演者データ照会
        </span>
        <div className="brandrow">
          <h1 className="brand">
            {name}が出演する{year}年{label}アニメ
          </h1>
        </div>
        <div className="meta">
          <Link href="/" className="official">
            ← アニメ視聴ガイドのトップに戻る
          </Link>
          <Link href={`/season/${year}/${season}`} className="official">
            {year}年{label}アニメ 配信情報一覧を見る
          </Link>
        </div>
      </header>

      <div className="detail-page">
        <article className="card">
          <div className="card-body detail-body">
            {fetchError ? (
              <section className="detail-section">
                <h2 className="detail-heading">エラー</h2>
                <p className="detail-text">{fetchError}</p>
              </section>
            ) : (
              <section className="detail-section">
                <h2 className="detail-heading">
                  出演作品（{works.length}作品・{checkedDate}時点）
                </h2>
                <ul className="detail-list">
                  {works.map((it) => (
                    <li key={it.id}>
                      <Link href={`/anime/${it.id}`}>{it.title}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
