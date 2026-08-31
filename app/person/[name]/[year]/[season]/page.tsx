import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSeasonData, isValidYear, isValidSeason } from "@/lib/getSeasonData";
import {
  PERSON_PAGE_MIN_APPEARANCES as MIN_APPEARANCES,
  shouldIndexPersonSeasonPage,
} from "@/lib/personPage";
import { PERSON_FILMOGRAPHY } from "@/content/people/filmography";
import {
  otherSeasonWorks,
  otherSeasonPages,
  MAX_WORKS_SHOWN,
  type PersonIndex,
} from "@/lib/personIndex";
import personIndexJson from "@/content/archive/people.json";
import type { AnimeItem } from "@/lib/types";

import { siteUrl } from "@/lib/siteUrl";
import { personPageTitle, personPageDescription } from "@/lib/pageMeta";
import { titleText } from "@/lib/pageTitle";
const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

type Params = { name: string; year: string; season: string };

// 声優ページのISR（2026-08-11導入。app/anime/[id]/page.tsx・app/service/... と同じ型）。
//
// なぜここだけ抜けていたか: 声優ページは2026-07-13に作ったあと、2026-08-07に
// 過去クールぶん（4,483ページ）へ広げたが、その間どちらの回でもISR化していなかった。
// 結果として **sitemapに載っている面のうち、声優ページだけが毎リクエスト動的描画**
// という状態が残っていた（`/anime/[id]`=900秒、`/service/...`=600秒はISR済み）。
// これは実測で最も成績の良い面（2026-08-08のGSCで平均5.8位・CTR9.5%。
// 作品ページは22.3位・1.3%）が、いちばん遅く返る面でもあったということ。
//
// 値は getSeasonData の今期キャッシュ（900s）と揃える。作品ページで測った効果は
// 初回0.81秒 → 2回目以降0.010秒（app/anime/[id]/page.tsx のコメント参照）。
// 【2026-08-25変更】900秒 → 3600秒（1時間）。Vercel Hobbyの ISR Writes 上限
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

// 【2026-08-25変更】空配列 → 過去クールぶん（4,483件）を全件事前生成する。
//
// もとは「4,483件あるのでビルド時に全部焼くのは現実的でない」と判断していたが、
// **その判断は利用量の予算から逆算されていなかった**。VercelのISR Writes上限を
// 超過してサイトがPausedになった件（docs/operations.md の㉝）で分かったのは:
//
//   ・**事前生成したページはISR Writesを1件も消費しない**（デプロイ成果物に含まれる）
//   ・Vercelはデプロイごとに独立したISRキャッシュを持つ＝デプロイのたびに全消去される。
//     事前生成していないページは、デプロイのたびに「最初に見に来た人」の分だけ
//     必ず書き込みが発生する。この床はrevalidateをいくら延ばしても消えない
//   ・声優ページは長い裾（sitemapの約7,051ページ）の**64%**を占める最大の集団
//
// つまりここを焼くかどうかが、書き込みの下限をほぼ決めていた。
//
// 焼けるのは**過去クールだけ**。現在クールはAnnictへのライブ取得が要るので、
// ビルドの成否が外部APIに依存してしまう（app/service/[key]/... と同じ判断）。
// 過去クールは content/snapshots/ の静的JSONから返るのでネットワークに出ない。
//
// 件数は content/archive/people.json から「そのクールに2作品以上」の組を数えて出す。
// これは sitemap（app/sitemap.ts）が使う集合と同じ作り方なので、載せているのに
// 焼いていない・焼いたのに載せていない、というズレが起きない。索引は「配信情報が
// 1件以上ある作品」だけで作られており、ページ側の判定（getSeasonData＝全作品）より
// 常に少なく数えるので、**ここに出た組は必ずページが実在する**（404を焼かない）。
//
// このページは出演2作品未満で notFound() を返すので、**loading.tsx を置かないこと**。
// 置くとストリーミングでヘッダが先に確定し、404が200（ソフト404）で返るようになる
// （app/anime/[id]/page.tsx で実測済み）。
export function generateStaticParams(): Params[] {
  const thisYear = new Date().getFullYear();
  const counts = new Map<string, { name: string; year: number; season: string; count: number }>();

  for (const [name, works] of Object.entries((personIndexJson as unknown as PersonIndex).people)) {
    for (const w of works) {
      const year = w[2] as number;
      const season = w[3] as string;
      // 現在の年はライブ取得なのでビルド時に焼かない（外部APIにビルドを依存させない）。
      if (year >= thisYear) continue;
      const key = `${year}/${season}/${name}`;
      const cur = counts.get(key);
      if (cur) cur.count++;
      else counts.set(key, { name, year, season, count: 1 });
    }
  }

  const params: Params[] = [];
  for (const c of counts.values()) {
    if (c.count < MIN_APPEARANCES) continue;
    params.push({
      name: encodeURIComponent(c.name),
      year: String(c.year),
      season: c.season,
    });
  }
  return params;
}

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
  const filmography = PERSON_FILMOGRAPHY[name];
  const title = personPageTitle(name, year, season, Boolean(filmography));
  const description = personPageDescription(name, year, season, Boolean(filmography));
  const url = `${siteUrl}/person/${encodeURIComponent(name)}/${year}/${season}`;

  // 過去年の「無名の声優」のページだけ noindex にする（規則と実測は lib/personPage.ts）。
  // ページは消さない・404にもしない。follow は残すので、ここから過去クールの作品ページへ
  // 渡っている内部リンクはそのまま効く。今年のクールは全部索引させる。
  const totalWorks = (
    (personIndexJson as unknown as PersonIndex).people[name] ?? []
  ).length;
  const indexable = shouldIndexPersonSeasonPage(year, totalWorks);

  return {
    title,
    description,
    alternates: { canonical: url },
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
    openGraph: { title: titleText(title), description, url, type: "website" },
    twitter: { card: "summary_large_image", title: titleText(title), description },
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

  const filmography = PERSON_FILMOGRAPHY[name];
  // 他のクールの出演作（2026-08-07追加）。`content/archive/people.json` はスナップショット
  // から作った静的な索引なので、Annictへの追加取得もフェッチも発生しない。
  // このページはこれまで「そのクールの出演作」しか出せず、作品ページへの内部リンクも
  // 同じクールに閉じていた。過去クールの作品ページ（sitemapに載せた1,961件）は
  // シーズンページからしか辿れないので、ここから横断のリンクが増える意味もある。
  // JSONのimportはタプルを `(string|number)[]` として推論するので、素直には
  // PersonWork（4要素タプル）と噛み合わない。中身は生成スクリプトが作っており
  // `node scripts/check.ts` が形も含めて検査しているので、ここは unknown 経由で通す。
  const otherWorks = otherSeasonWorks(
    personIndexJson as unknown as PersonIndex,
    name,
    Number(year),
    season
  ).slice(0, MAX_WORKS_SHOWN);
  // 同じ人の他クールのページ（2026-08-19追加）。ページが実在するクールだけが返る
  // （lib/personIndex.ts の otherSeasonPages が閾値で門番する＝404へのリンクを配らない）。
  const otherPages = otherSeasonPages(
    personIndexJson as unknown as PersonIndex,
    name,
    Number(year),
    season,
    MIN_APPEARANCES
  );
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
            {filmography ? `${name}の代表作・出演作品` : `${name}が出演する${year}年${label}アニメ`}
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
              <>
                {filmography && (
                  <section className="detail-section">
                    <h2 className="detail-heading">代表作（役名付き）</h2>
                    <ul className="detail-list">
                      {filmography.works.map((w, i) => (
                        <li key={i}>
                          {w.title} — {w.character}
                        </li>
                      ))}
                    </ul>
                    <p className="detail-updated">
                      出典:{" "}
                      <a href={filmography.sourceUrl} target="_blank" rel="noopener noreferrer">
                        {filmography.sourceUrl}
                      </a>
                      {" "}（確認日: {filmography.confirmedDate}）
                    </p>
                  </section>
                )}

                <section className="detail-section">
                  <h2 className="detail-heading">
                    {year}年{label}アニメの出演作品（{works.length}作品・{checkedDate}時点）
                  </h2>
                  <ul className="detail-list">
                    {works.map((it) => (
                      <li key={it.id}>
                        <Link href={`/anime/${it.id}`}>{it.title}</Link>
                      </li>
                    ))}
                  </ul>
                </section>

                {otherWorks.length > 0 && (
                  <section className="detail-section">
                    {/* 【表現の注意】ここに並ぶのは「そのクールの番組表に配信の記録があった」
                        作品であって、いま配信されている保証は無い（Annictは配信終了を
                        記録しない。CLAUDE.mdの基本ルール／lib/workAvailability.ts）。
                        「配信中」「視聴できます」と書かないこと。 */}
                    <h2 className="detail-heading">
                      他のクールの出演作（配信情報がある作品・{otherWorks.length}作品）
                    </h2>
                    <ul className="detail-list">
                      {otherWorks.map(([id, title, y, s]) => (
                        <li key={id}>
                          <Link href={`/anime/${id}`}>{title}</Link>{" "}
                          <Link href={`/season/${y}/${s}`} className="detail-sub">
                            {y}年{SEASON_LABEL[s]}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <p className="detail-updated">
                      過去クールの記録から、配信情報が登録されている作品だけを新しい順に出しています。
                      現在も配信されているかは各サービスでご確認ください。
                    </p>
                  </section>
                )}

                {otherPages.length > 0 && (
                  <section className="detail-section">
                    {/* 同じ人の他クールのページへの導線（2026-08-19追加）。
                        ここが無いと、sitemapに載せた過去クールの声優ページは
                        「そのクールの作品ページの声優名リンク」1本でしか辿れず、
                        サイトでいちばん強い面（GSC実測5.7位）から authority が渡らない。
                        並ぶのは PERSON_PAGE_MIN_APPEARANCES を満たすクールだけなので
                        404へのリンクにはならない。 */}
                    <h2 className="detail-heading">
                      {name}さんの他のクールの出演一覧
                    </h2>
                    <ul className="person-season-links">
                      {otherPages.map((p) => (
                        <li key={`${p.year}-${p.season}`}>
                          <Link href={`/person/${encodeURIComponent(name)}/${p.year}/${p.season}`}>
                            {p.year}年{SEASON_LABEL[p.season]}（{p.count}作品）
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
