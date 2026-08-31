import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSeasonData, isValidYear, isValidSeason } from "@/lib/getSeasonData";
import { splitRentalServices } from "@/lib/services";
import { RENTAL_SERVICES } from "@/content/works/rentalServices";
import type { AnimeItem, ServiceTag } from "@/lib/types";

import { siteUrl } from "@/lib/siteUrl";
import { rankingsPageTitle, rankingsPageDescription } from "@/lib/pageMeta";
import { robotsFor } from "@/lib/indexPolicy";
import { titleText } from "@/lib/pageTitle";
const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};
const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

// ISR（2026-07-24導入。app/season/[year]/[season]/page.tsx と同じ理由・同じ値）。
// これが無いと動的セグメント[year]/[season]は毎リクエスト動的レンダリングになり
// CDNエッジにキャッシュされない。10分はgetSeasonData側のキャッシュ鮮度と揃えた。
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

// season配下と同様、今年の4シーズンを静的生成対象にしてISRを有効化する。
// それ以外の年はdynamicParams（既定true）で初回オンデマンド生成→以後キャッシュされる。
export function generateStaticParams() {
  const year = String(new Date().getFullYear());
  return ["winter", "spring", "summer", "autumn"].map((season) => ({ year, season }));
}

type Params = { year: string; season: string };

interface ServiceCount {
  tag: ServiceTag;
  count: number;
}

// 対応本数ランキング（見放題配信のみ。レンタル/都度課金は対象外＝トップページの
// 「配信サービス別 対応本数」比較表と同じ集計基準）。
function rankByServiceCoverage(items: AnimeItem[]): ServiceCount[] {
  const map = new Map<string, ServiceCount>();
  for (const it of items) {
    const { streaming } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
    for (const s of streaming) {
      const cur = map.get(s.key);
      if (cur) cur.count += 1;
      else map.set(s.key, { tag: s, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// 独占配信本数ランキング（見放題1社のみの作品を集計。/exclusive ページと同じ判定基準）。
function rankByExclusiveCoverage(items: AnimeItem[]): ServiceCount[] {
  const map = new Map<string, ServiceCount>();
  for (const it of items) {
    const { streaming } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
    if (streaming.length !== 1) continue;
    const tag = streaming[0];
    const cur = map.get(tag.key);
    if (cur) cur.count += 1;
    else map.set(tag.key, { tag, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// 先行配信（最速配信）ランキング。broadcastStartDateが早い順。放送日未定の作品は対象外。
function rankByEarliestStart(items: AnimeItem[], limit: number): AnimeItem[] {
  return [...items]
    .filter((it) => it.broadcastStartDate)
    .sort((a, b) => (a.broadcastStartDate! < b.broadcastStartDate! ? -1 : 1))
    .slice(0, limit);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) return {};

  const label = SEASON_LABEL[season];
  const title = rankingsPageTitle(year, season);
  const description = rankingsPageDescription(year, season);
  const url = `${siteUrl}/rankings/${year}/${season}`;

  // 取得に失敗したとき・作品が1件も無いときは索引に載せない（lib/indexPolicy.ts）。
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

// 「今期の配信サービス勢力図」「独占配信数ランキング」「先行配信ランキング」のような
// データ集計コンテンツ。docs/growth-ideas.md の流入調査（2026-07-13）で、こうした
// ランキング・集計系の記事がメディアにも取り上げられる拡散価値があると判断したことに基づく。
// 数字はすべてAnnictの実データから都度算出し、創作・推測は行わない。
export default async function RankingsPage({ params }: { params: Params }) {
  const { year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) notFound();

  const label = SEASON_LABEL[season];
  let coverage: ServiceCount[] = [];
  let exclusive: ServiceCount[] = [];
  let earliest: AnimeItem[] = [];
  let fetchError: string | null = null;
  try {
    const data = await getSeasonData(year, season);
    coverage = rankByServiceCoverage(data.items);
    exclusive = rankByExclusiveCoverage(data.items);
    earliest = rankByEarliestStart(data.items, 10);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "取得に失敗しました。";
  }

  const checkedDate = new Date().toISOString().slice(0, 10);
  const maxCoverage = Math.max(1, ...coverage.map((c) => c.count));

  const structuredLd = !fetchError
    ? [
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${year}年${label}アニメ 先行配信ランキング`,
          numberOfItems: earliest.length,
          dateModified: checkedDate,
          itemListElement: earliest.map((it, i) => ({
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
              name: "配信サービス勢力図・ランキング",
              item: `${siteUrl}/rankings/${year}/${season}`,
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
          LINK START :: 集計データ照会
        </span>
        <div className="brandrow">
          <h1 className="brand">
            {year}年{label}アニメ 配信サービス勢力図・ランキング
          </h1>
        </div>
        <div className="meta">
          <Link href="/" className="official">
            ← アニメ視聴ガイドのトップに戻る
          </Link>
          <Link href={`/season/${year}/${season}`} className="official">
            {year}年{label}アニメ 配信情報一覧を見る
          </Link>
          <Link href={`/exclusive/${year}/${season}`} className="official">
            独占配信まとめを見る
          </Link>
        </div>
      </header>

      <div className="detail-page">
        <article className="card">
          <div className="card-body detail-body">
            {fetchError && (
              <section className="detail-section">
                <h2 className="detail-heading">エラー</h2>
                <p className="detail-text">{fetchError}</p>
              </section>
            )}

            {!fetchError && (
              <>
                <section className="detail-section">
                  <h2 className="detail-heading">配信サービス別 対応本数ランキング</h2>
                  <p className="detail-text">
                    見放題配信サービスが対応している作品数の多い順（{checkedDate}時点。
                    レンタル/都度課金サービスは対象外）。
                    {coverage[0] && `${coverage[0].tag.name}が${coverage[0].count}作品で最多。`}
                  </p>
                  <ol className="detail-list">
                    {coverage.map((c) => (
                      <li key={c.tag.key}>
                        <Link href={`/service/${c.tag.key}/${year}/${season}`}>{c.tag.name}</Link>
                        {" "}— {c.count}作品
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            marginLeft: 8,
                            height: 8,
                            width: `${Math.max(4, Math.round((c.count / maxCoverage) * 120))}px`,
                            background: c.tag.color,
                            verticalAlign: "middle",
                            borderRadius: 2,
                          }}
                        />
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="detail-section">
                  <h2 className="detail-heading">独占配信数ランキング</h2>
                  <p className="detail-text">
                    見放題配信サービスが1社だけの「独占配信」作品数の多い順。
                    {exclusive[0] && `${exclusive[0].tag.name}が${exclusive[0].count}作品で最多。`}
                    詳細は<Link href={`/exclusive/${year}/${season}`}>独占配信まとめ</Link>を参照。
                  </p>
                  <ol className="detail-list">
                    {exclusive.map((c) => (
                      <li key={c.tag.key}>
                        <Link href={`/service/${c.tag.key}/${year}/${season}`}>{c.tag.name}</Link>
                        {" "}— {c.count}作品
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="detail-section">
                  <h2 className="detail-heading">先行配信ランキング（配信開始が早い順）</h2>
                  <p className="detail-text">
                    このクールで配信/放送開始日が早かった作品（判明分のみ。実際の配信開始時刻は
                    サービスによって前後することがあります）。
                  </p>
                  <ol className="detail-list">
                    {earliest.map((it) => (
                      <li key={it.id}>
                        <Link href={`/anime/${it.id}`}>{it.title}</Link>
                        {" "}— {it.broadcastStartDate}
                        {it.broadcastWeekday !== null && `（${WEEKDAY_LABEL[it.broadcastWeekday]}）`}
                      </li>
                    ))}
                  </ol>
                </section>
              </>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
