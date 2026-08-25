import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSeasonData, isValidYear, isValidSeason } from "@/lib/getSeasonData";
import { SERVICES, splitRentalServices, getServiceKana } from "@/lib/services";
import { buildServiceLabel } from "@/content/services/aliases";
import { RENTAL_SERVICES } from "@/content/works/rentalServices";
import ServiceMarks from "@/components/ServiceMarks";
import CalendarSubscribeLink from "@/components/CalendarSubscribeLink";
import { currentYearSeason } from "@/lib/resolveSeasonParams";

import { siteUrl } from "@/lib/siteUrl";
import { servicePageTitle, servicePageDescription } from "@/lib/pageMeta";
import { titleText } from "@/lib/pageTitle";
const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

// ISR（2026-08-06導入。app/season・app/exclusive・app/rankingsの各[year]/[season]ページと
// 同じ理由・同じ値）。このページだけ revalidate も generateStaticParams も無く、
// 動的セグメント[key]/[year]/[season]が毎リクエスト動的レンダリングのまま
// （＝CDNエッジにキャッシュされない）になっていた。
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

// generateStaticParams は**空配列**を返す（app/anime/[id]/page.tsx と同じ形）。
// これが無いと revalidate を書いてもルートが prerender-manifest に載らず動的のままだが、
// 空配列でも載る＝ISRは効く。ビルド時には1件も焼かず、アクセスされた組み合わせから
// 順にISRキャッシュに乗る。
//
// 【なぜ列挙しないか】このページの本体は getSeasonData を呼ぶため、列挙した
// 組み合わせのぶんだけ**ビルド時にAnnict GraphQLへの外部APIコールが走る**。
// SERVICES(18) × 4シーズン ＝ 72件を列挙すると、ビルドの成否が外部APIの
// 応答性・レート制限に依存するようになる。焼く価値（このページはまだ流入が無い）に
// 対して割に合わないので、app/anime/[id]/page.tsx と同じく空配列にしておく。
//
// 注記: 2026-08-07にPR #41のVercelビルド失敗の原因としてここを疑って空配列に
// したが、**それは誤りだった**（真因は app/anime/[id]/opengraph-image.tsx が
// edge runtimeでスナップショットを取り込んでいたこと。lib/getWorkDataLive.ts 参照）。
// 変更自体は上記の理由で妥当なので残してある。
export function generateStaticParams() {
  return [];
}

type Params = { key: string; year: string; season: string };

function findService(key: string) {
  return SERVICES.find((s) => s.key === key) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { key, year, season } = params;
  const service = findService(key);
  if (!service || !isValidYear(year) || !isValidSeason(season)) return {};

  const label = SEASON_LABEL[season];
  const title = servicePageTitle(service.name, service.short, year, season);
  const description = servicePageDescription(service.name, year, season);
  const url = `${siteUrl}/service/${key}/${year}/${season}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title: titleText(title), description, url, type: "website" },
    twitter: { card: "summary_large_image", title: titleText(title), description },
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
  let items: { id: number; title: string; watchers: number; rental: boolean; exclusive: boolean }[] = [];
  let fetchError: string | null = null;
  try {
    const data = await getSeasonData(year, season);
    for (const it of data.items) {
      const hasService = it.services.some((s) => s.key === key);
      if (!hasService) continue;
      const { streaming, rental } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
      const isRentalOnly = rental.some((s) => s.key === key);
      // 「このサービスでしか見られない」＝見放題がちょうど1社で、それがこのサービス。
      // 判定基準は app/exclusive/[year]/[season] と同じ（レンタル/都度課金は数えない）。
      const exclusive = streaming.length === 1 && streaming[0].key === key;
      items.push({ id: it.id, title: it.title, watchers: it.watchers, rental: isRentalOnly, exclusive });
    }
    items.sort((a, b) => b.watchers - a.watchers);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "取得に失敗しました。";
  }
  const exclusiveItems = items.filter((it) => it.exclusive);

  // 「ネトフリ アニメ」のようにサービス名を口語形で書く検索がある（GSC実測）。
  // ページ内が正式名称だけだとその語彙を持たないため、導入文で一度だけ併記する
  // （h1・title・descriptionには入れない＝詰め込みはしない）。表現は
  // content/services/aliases.ts の buildServiceLabel に集約してある。
  const serviceLabel = buildServiceLabel(
    service.name,
    getServiceKana(service.key),
    service.key
  );
  const checkedDate = new Date().toISOString().slice(0, 10);
  // /calendar.ics は常に「今期」を返す（year/season を受け取らない）ので、
  // 購読の案内は今期のページでだけ出す。
  const now = currentYearSeason();
  const isCurrentSeason = now.year === String(year) && now.season === season;
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
                {year}年{label}アニメのうち、{serviceLabel}
                で配信されている作品を人気順（注目度順）でまとめています （{checkedDate}
                時点）。配信情報は網羅率100%ではなく、新作は反映が遅れることがあります。
              </p>
              {/* このページの主役サービスへのリンク。提携済みならアフィリエイト（PR表示付き）、
                  未提携なら公式サイトへリンクする（ServiceMarksの単一サービス表示として再利用）。 */}
              <ServiceMarks
                services={[{ key: service.key, name: service.name, short: service.short, color: service.color }]}
                otherServices={[]}
              />
            </section>

            {fetchError && (
              <section className="detail-section">
                <h2 className="detail-heading">エラー</h2>
                <p className="detail-text">{fetchError}</p>
              </section>
            )}

            {/* ── {service}でしか見られない作品 ─────────────────────────────
                このセクションを一覧より前に置くのは、利用者に「そのサービスに入るか」の
                判断が発生するのが独占作品の場面だけだから（docs/growth-strategy-2026-08.md）。
                dアニメが各クールの74〜82%をカバーする以上、複数社で配信されている作品は
                「どこで見ても同じ」であって加入の理由にならない。 */}
            {!fetchError && exclusiveItems.length > 0 && (
              <section className="detail-section">
                <h2 className="detail-heading">
                  {service.name}でしか見られない作品（{exclusiveItems.length}作品）
                </h2>
                <p className="detail-text">
                  {year}年{label}アニメのうち、見放題での配信が{service.name}
                  だけの作品です（レンタル/都度課金での配信は数えていません）。
                  他の見放題サービスでは配信が確認できていません。
                </p>
                <ul className="detail-list">
                  {exclusiveItems.map((it) => (
                    <li key={it.id}>
                      <Link href={`/anime/${it.id}`}>{it.title}</Link>
                    </li>
                  ))}
                </ul>
                <p className="detail-text">
                  <Link href={`/exclusive/${year}/${season}`}>
                    {year}年{label}アニメの独占配信まとめ（全サービス）を見る
                  </Link>
                </p>
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

            {/* 「そのサービスの分だけ」のカレンダー購読（2026-08-07追加）。
                /calendar.ics?service= は実装済みだったが、案内が /developers に
                しか無く、利用者が見る画面のどこからも辿れなかった。

                【今期に限る理由】/calendar.ics は year/season を受け取らず、
                常に currentSeasonKey() の作品を返す。過去クールのページに置くと
                「2020年冬の予定表」を期待した人に今期のカレンダーを渡すことになる
                ので、今期のページでだけ出す。 */}
            {!fetchError && items.length > 0 && isCurrentSeason && (
              <section className="detail-section">
                <h2 className="detail-heading">カレンダーで購読する</h2>
                <p className="detail-text">
                  {service.name}で見られる今期の放送・配信スケジュールを、お使いのカレンダー
                  （Googleカレンダー等）に取り込めます。毎週の予定として自動で表示され、
                  新しい話数の追加もカレンダー側で更新されます:{" "}
                  <CalendarSubscribeLink
                    serviceKey={service.key}
                    label={`${service.name}の放送予定を購読する（.ics）`}
                  />
                </p>
              </section>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
