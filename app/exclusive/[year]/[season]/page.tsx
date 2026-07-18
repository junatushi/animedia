import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSeasonData, isValidYear, isValidSeason } from "@/lib/getSeasonData";
import { splitRentalServices } from "@/lib/services";
import { RENTAL_SERVICES } from "@/content/works/rentalServices";
import type { AnimeItem, ServiceTag } from "@/lib/types";

import { siteUrl } from "@/lib/siteUrl";
const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

type Params = { year: string; season: string };

// 見放題配信サービスがちょうど1社の作品だけを「独占配信」とする。レンタル/都度課金
// サービスはカウントに含めない（独占の判定は見放題での話、というcomponents/SeasonExplorer.tsx
// の「独占」チップと同じ基準。EXCLUSIVE_KEY絞り込みのSSR版に相当）。
interface ExclusiveGroup {
  tag: ServiceTag;
  items: AnimeItem[];
}

function groupByExclusiveService(items: AnimeItem[]): ExclusiveGroup[] {
  const groups = new Map<string, ExclusiveGroup>();
  for (const it of items) {
    const { streaming } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
    if (streaming.length !== 1) continue;
    const tag = streaming[0];
    const group = groups.get(tag.key) ?? { tag, items: [] };
    group.items.push(it);
    groups.set(tag.key, group);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) return {};

  const label = SEASON_LABEL[season];
  const title = `${year}年${label}アニメ 独占配信まとめ`;
  const description = `${year}年${label}アニメのうち、見放題配信サービスが1社だけの「独占配信」作品を、サービス別に一覧でまとめました。アニメ視聴ガイドで確認できます。`;
  const url = `${siteUrl}/exclusive/${year}/${season}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

// 「[サービス名] 独占配信 [年][季節]アニメ」のようなロングテール検索の受け皿になる、
// 独占配信専用のSSRページ。docs/growth-ideas.md の流入調査（2026-07-13）で、競合が
// 各クールごとに専用の独占配信まとめページを作り込んでおり需要が明確だったことに基づく。
// 独占の判定（見放題1社のみ）は components/SeasonExplorer.tsx の「独占」チップと同じ基準。
export default async function ExclusivePage({ params }: { params: Params }) {
  const { year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) notFound();

  const label = SEASON_LABEL[season];

  let groups: ExclusiveGroup[] = [];
  let fetchError: string | null = null;
  try {
    const data = await getSeasonData(year, season);
    groups = groupByExclusiveService(data.items);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "取得に失敗しました。";
  }

  const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0);
  const checkedDate = new Date().toISOString().slice(0, 10);

  const structuredLd = !fetchError
    ? [
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${year}年${label}アニメ 独占配信まとめ`,
          numberOfItems: totalCount,
          dateModified: checkedDate,
          itemListElement: groups.flatMap((g) =>
            g.items.map((it, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${siteUrl}/anime/${it.id}`,
              name: it.title,
            }))
          ),
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
              name: "独占配信まとめ",
              item: `${siteUrl}/exclusive/${year}/${season}`,
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
          LINK START :: 独占配信データ照会
        </span>
        <div className="brandrow">
          <h1 className="brand">
            {year}年{label}アニメ 独占配信まとめ
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
                見放題配信サービスが1社だけの作品（レンタル/都度課金サービスは対象外）を「独占配信」として、
                サービス別にまとめています（{checkedDate}時点）。複数社で配信されている作品はここには含まれません。
              </p>
            </section>

            {fetchError && (
              <section className="detail-section">
                <h2 className="detail-heading">エラー</h2>
                <p className="detail-text">{fetchError}</p>
              </section>
            )}

            {!fetchError && groups.length === 0 && (
              <section className="detail-section">
                <p className="detail-text">
                  現時点で独占配信の作品は確認できませんでした。配信情報が判明し次第、反映されます。
                </p>
              </section>
            )}

            {!fetchError &&
              groups.map((g) => (
                <section className="detail-section" key={g.tag.key}>
                  <h2 className="detail-heading" style={{ color: g.tag.color }}>
                    <Link href={`/service/${g.tag.key}/${year}/${season}`}>{g.tag.name}</Link>独占（{g.items.length}作品）
                  </h2>
                  <ul className="detail-list">
                    {g.items.map((it) => (
                      <li key={it.id}>
                        <Link href={`/anime/${it.id}`}>{it.title}</Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        </article>
      </div>
    </div>
  );
}
