import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getWorkData } from "@/lib/getWorkData";
import { textOn } from "@/lib/services";
import { WORK_DETAILS } from "@/content/works";

const siteUrl = "https://animedia-khaki.vercel.app";

// バッジを公式ロゴ風ロックアップにするための先頭マーク（SeasonExplorerと同ロジック）。
function brandMark(short: string): string {
  const ch = [...short.trim()];
  return ch.length ? ch[0] : "?";
}

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

  return (
    <div className="wrap">
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
                  <h2 className="detail-heading">メイン声優</h2>
                  <ul className="detail-list">
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
            <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: "0 0 10px", color: "var(--ink)" }}>
              配信サービス
            </h2>
            {item.services.length === 0 && item.otherServices.length === 0 ? (
              <span className="no-haishin">配信情報なし</span>
            ) : (
              <div className="badges">
                {item.services.map((s) => (
                  <span key={s.key} className="badge" style={{ ["--c" as string]: s.color }}>
                    <span
                      className="badge-mark"
                      style={{ background: s.color, color: textOn(s.color) }}
                    >
                      {brandMark(s.short)}
                    </span>
                    <span className="badge-name">{s.short}</span>
                  </span>
                ))}
                {item.otherServices.map((name) => (
                  <span key={name} className="badge badge-other">
                    {name}
                  </span>
                ))}
              </div>
            )}

            {item.officialSiteUrl && (
              <a
                className="official"
                href={item.officialSiteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                公式サイト ↗
              </a>
            )}
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
