import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSeasonData, isValidYear, isValidSeason } from "@/lib/getSeasonData";
import { SERVICES, splitRentalServices } from "@/lib/services";
import { RENTAL_SERVICES } from "@/content/works/rentalServices";

const siteUrl = "https://animedia-khaki.vercel.app";
const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

type Params = { key: string; year: string; season: string };

function findService(key: string) {
  return SERVICES.find((s) => s.key === key) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { key, year, season } = params;
  const service = findService(key);
  if (!service || !isValidYear(year) || !isValidSeason(season)) return {};

  const label = SEASON_LABEL[season];
  const title = `${year}年${label}アニメ ${service.name}で見れる作品一覧`;
  const description = `${year}年${label}アニメのうち、${service.name}で配信されている作品を一覧でまとめました。アニメ視聴ガイドで確認できます。`;
  const url = `${siteUrl}/service/${key}/${year}/${season}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

// 「[配信サービス名] 今期アニメ 一覧」のようなロングテール検索の受け皿になる、
// 配信サービス別のSSRページ。docs/growth-ideas.md の流入調査（2026-07-13）で、
// 競合各社（uzurea・せにろぐ等）がサービス軸の専用ページを作り込んでおり
// 需要が確認できたことに基づく。既存のgetSeasonData/SERVICESをそのまま再利用する。
export default async function ServicePage({ params }: { params: Params }) {
  const { key, year, season } = params;
  const service = findService(key);
  if (!service || !isValidYear(year) || !isValidSeason(season)) notFound();

  const label = SEASON_LABEL[season];
  let items: { id: number; title: string; watchers: number; rental: boolean }[] = [];
  let fetchError: string | null = null;
  try {
    const data = await getSeasonData(year, season);
    for (const it of data.items) {
      const hasService = it.services.some((s) => s.key === key);
      if (!hasService) continue;
      const { rental } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
      const isRentalOnly = rental.some((s) => s.key === key);
      items.push({ id: it.id, title: it.title, watchers: it.watchers, rental: isRentalOnly });
    }
    items.sort((a, b) => b.watchers - a.watchers);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "取得に失敗しました。";
  }

  const checkedDate = new Date().toISOString().slice(0, 10);
  const structuredLd = !fetchError
    ? [
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${year}年${label}アニメ ${service.name}で見れる作品一覧`,
          numberOfItems: items.length,
          dateModified: checkedDate,
          itemListElement: items.map((it, i) => ({
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
              name: `${service.name}で見れる作品`,
              item: `${siteUrl}/service/${key}/${year}/${season}`,
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
          LINK START :: サービス別データ照会
        </span>
        <div className="brandrow">
          <h1 className="brand" style={{ color: service.color }}>
            {year}年{label}アニメ {service.name}で見れる作品一覧
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
            <section className="detail-section">
              <h2 className="detail-heading">この一覧について</h2>
              <p className="detail-text">
                {year}年{label}アニメのうち、{service.name}で配信されている作品を人気順（注目度順）でまとめています
                （{checkedDate}時点、Annictより）。配信情報は網羅率100%ではなく、新作は反映が遅れることがあります。
              </p>
            </section>

            {fetchError && (
              <section className="detail-section">
                <h2 className="detail-heading">エラー</h2>
                <p className="detail-text">{fetchError}</p>
              </section>
            )}

            {!fetchError && items.length === 0 && (
              <section className="detail-section">
                <p className="detail-text">
                  現時点で{service.name}での配信作品は確認できませんでした。配信情報が判明し次第、反映されます。
                </p>
              </section>
            )}

            {!fetchError && items.length > 0 && (
              <section className="detail-section">
                <h2 className="detail-heading">
                  {service.name}で見れる作品（{items.length}作品）
                </h2>
                <ul className="detail-list">
                  {items.map((it) => (
                    <li key={it.id}>
                      <Link href={`/anime/${it.id}`}>{it.title}</Link>
                      {it.rental && "（レンタル/都度課金）"}
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
