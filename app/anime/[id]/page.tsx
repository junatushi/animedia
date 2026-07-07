import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getWorkData } from "@/lib/getWorkData";
import { WORK_DETAILS } from "@/content/works";
import { WORK_IMAGE_IDS } from "@/content/works/imageIds";
import ServiceMarks from "@/components/ServiceMarks";

const AI_IMAGE_NOTE = "AIがタイトルのみから独断と偏見で作成した画像です。本作品との関連性はありません。";

const siteUrl = "https://animedia-khaki.vercel.app";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return {};

  let item;
  try {
    item = await getWorkData(id);
  } catch {
    item = null;
  }
  if (!item) return {};

  const serviceNames = item.services.map((s) => s.short).join("・");
  const title = `${item.title} の配信状況`;
  const description = serviceNames
    ? `「${item.title}」は ${serviceNames} で配信中。アニメ視聴ガイドで最新の配信状況を確認できます。`
    : `「${item.title}」の配信状況をアニメ視聴ガイドで確認できます。`;
  const url = `${siteUrl}/anime/${id}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

// 「作品名 配信」のようなロングテール検索の受け皿になる、作品単位の個別ページ。
// サーバーコンポーネントとして完全にHTML化するため、クロール・共有カード双方で
// 内容がそのまま見える。
export default async function AnimeDetailPage({ params }: { params: Params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let item;
  try {
    item = await getWorkData(id);
  } catch (e) {
    return (
      <div className="wrap">
        <div className="state error">
          <h2>データを取得できませんでした</h2>
          <p>{e instanceof Error ? e.message : "取得に失敗しました。"}</p>
        </div>
      </div>
    );
  }
  if (!item) notFound();

  const content = WORK_DETAILS[item.id];
  const { credits } = item;

  // 生成AI検索・検索エンジンに作品の事実（あらすじ・声優・監督・製作会社・原作・配信先）を
  // 機械可読な形で渡すための構造化データ（JSON-LD）。人手で用意したあらすじがあればそれを、
  // 無ければ配信サービス一覧から生成した説明文を description に入れる。
  const serviceNames = [...item.services.map((s) => s.short), ...item.otherServices];
  const jsonLdDescription =
    content?.synopsis ||
    (serviceNames.length > 0
      ? `「${item.title}」は ${serviceNames.join("・")} で配信中。`
      : `「${item.title}」の配信状況をアニメ視聴ガイドで確認できます。`);
  const workLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": item.media === "MOVIE" ? "Movie" : "TVSeries",
    name: item.title,
    url: `${siteUrl}/anime/${id}`,
    inLanguage: "ja",
    description: jsonLdDescription,
  };
  if (credits.casts.length > 0) {
    workLd.actor = credits.casts.map((c) => ({
      "@type": "Person",
      name: c.personName,
      ...(c.characterName ? { characterName: c.characterName } : {}),
    }));
  }
  if (credits.director) {
    workLd.director = { "@type": "Person", name: credits.director };
  }
  if (credits.productionCompany) {
    workLd.productionCompany = { "@type": "Organization", name: credits.productionCompany };
  }
  if (credits.originalCreators.length > 0) {
    workLd.author = credits.originalCreators.map((name) => ({ "@type": "Person", name }));
  }
  if (content?.publisher) {
    workLd.publisher = { "@type": "Organization", name: content.publisher };
  }
  if (content?.sourceUrl) {
    workLd.sameAs = content.sourceUrl;
  }
  // 配信情報はAnnictからライブ取得（revalidateの範囲）なので、確認日を鮮度シグナルとして出す。
  const checkedDate = new Date().toISOString().slice(0, 10);
  workLd.dateModified = checkedDate;

  // パンくず（Home → 作品名）。AI・検索エンジンにサイト構造を伝える。
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "アニメ視聴ガイド", item: siteUrl },
      { "@type": "ListItem", position: 2, name: item.title, item: `${siteUrl}/anime/${id}` },
    ],
  };

  // 「『作品名』はどこで配信されている？」というQ&AをFAQPageとして機械可読にする。
  // これは生成AIに投げられる典型質問で、引用されればそのまま流入につながる。
  const watchAnswer =
    serviceNames.length > 0
      ? `「${item.title}」は ${serviceNames.join("・")} で視聴できます（${checkedDate}時点、Annictより）。配信状況は変わることがあるため、視聴前に各サービスの最新情報もご確認ください。`
      : `「${item.title}」の配信サービスは現時点でAnnictに登録がなく確認できません（${checkedDate}時点）。判明し次第このページに反映されます。`;
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `「${item.title}」はどこで配信されている？`,
        acceptedAnswer: { "@type": "Answer", text: watchAnswer },
      },
    ],
  };

  return (
    <div className="wrap">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify([workLd, breadcrumbLd, faqLd]) }}
      />
      <header className="masthead">
        <span className="eyebrow" aria-hidden="true">
          LINK START :: 作品データ照会
        </span>
        <div className="brandrow">
          <h1 className="brand">{item.title}</h1>
        </div>
        <div className="meta">
          <Link href="/" className="official">
            ← アニメ視聴ガイドのトップに戻る
          </Link>
        </div>
      </header>

      <div className="detail-page">
        {WORK_IMAGE_IDS.has(item.id) && (
          <figure className="detail-hero">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/works/${item.id}.jpg`} alt="" className="detail-hero-img" />
            <figcaption className="detail-hero-note">※ {AI_IMAGE_NOTE}</figcaption>
          </figure>
        )}
        {(content || credits.casts.length > 0 || credits.director || credits.productionCompany || credits.originalCreators.length > 0) && (
          <article className="card">
            <div className="card-body detail-body">
              {content && (
                <>
                  <section className="detail-section">
                    <h2 className="detail-heading">あらすじ</h2>
                    <p className="detail-text">{content.synopsis}</p>
                  </section>
                  <section className="detail-section">
                    <h2 className="detail-heading">見どころ</h2>
                    <ul className="detail-list">
                      {content.highlights.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </section>
                </>
              )}

              {credits.casts.length > 0 && (
                <section className="detail-section">
                  <h2 className="detail-heading">声優</h2>
                  {/* 人数が多いので2〜3列のグリッドで縦の長さを抑える。 */}
                  <ul className="detail-cast-grid">
                    {credits.casts.map((c, i) => (
                      <li key={i}>
                        {c.personName}
                        {c.characterName && <span className="detail-sub">（{c.characterName}役）</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {credits.director && (
                <section className="detail-section">
                  <h2 className="detail-heading">監督</h2>
                  <p className="detail-text">{credits.director}</p>
                </section>
              )}

              {credits.productionCompany && (
                <section className="detail-section">
                  <h2 className="detail-heading">製作会社</h2>
                  <p className="detail-text">{credits.productionCompany}</p>
                </section>
              )}

              {(credits.originalCreators.length > 0 || content?.publisher) && (
                <section className="detail-section">
                  <h2 className="detail-heading">原作</h2>
                  <p className="detail-text">
                    {credits.originalCreators.length > 0 ? credits.originalCreators.join("、") : "―"}
                    {content?.publisher && <span className="detail-sub">（{content.publisher}）</span>}
                  </p>
                </section>
              )}

              {content?.sourceUrl && (
                <p className="detail-source">
                  参照:{" "}
                  <a href={content.sourceUrl} target="_blank" rel="noopener noreferrer">
                    公式サイト等の一次情報 ↗
                  </a>
                </p>
              )}
            </div>
          </article>
        )}

        <article className="card">
          <div className="card-body">
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px", color: "var(--ink)" }}>
              「{item.title}」はどこで配信されている？
            </h2>
            {/* サービス名はアイコン内にテキストとして保持（.sr-only）。冗長な文章列挙はしない。
                FAQPageの回答文（JSON-LD）側には名称を含めているのでAI・検索には伝わる。 */}
            <ServiceMarks services={item.services} otherServices={item.otherServices} />

            {item.officialSiteUrl && (
              <a
                className="official"
                href={item.officialSiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginTop: 14 }}
              >
                公式サイト ↗
              </a>
            )}
            <p className="detail-updated">配信情報の確認日: {checkedDate}（Annictより自動取得）</p>
          </div>
        </article>
      </div>

      <p className="footnote">
        データ元: Annict（コミュニティ更新ベース）。配信情報は網羅率100%ではなく、
        新作は反映が遅れることがあります。視聴前に各サービスの最新情報もご確認ください。
        「その他配信」は未登録サービスの可能性があり、点線で表示しています。
      </p>
    </div>
  );
}
