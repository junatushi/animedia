import Link from "next/link";
import { siteUrl } from "@/lib/siteUrl";
import {
  CREDIT_ROLE_LABEL,
  MAX_WORKS_SHOWN,
  type CreditRole,
  type StudioWork,
} from "@/lib/studioIndex";

// 制作会社ページ（/studio/[name]）と監督ページ（/director/[name]）の共通の中身。
//
// 【なぜ共通化するか】2つのページは見出しの語（「制作会社」/「監督」）以外は同じで、
// 片方だけ直すと表現がズレる。とくに下の【表現の注意】は CLAUDE.md の基本ルール
// （放送が終わった作品に「いま配信中」と書かない）に関わるので、1箇所に閉じ込める。
//
// 【表現の注意】ここに並ぶのは content/archive/studios.json の中身＝「そのクールの
// 番組表に配信の記録があった」作品であって、**いま配信されているかではない**
// （Annictは配信終了を記録しない。lib/workAvailability.ts / lib/studioIndex.ts と同じ扱い）。
// 「配信中」「視聴できます」と書かないこと。逆に「もう配信されていません」も書かない。
//
// クライアント側の状態を持たないので "use client" は付けない（サーバー描画のまま。
// components/SeasonExplorer.tsx と違い useSearchParams も使わないため、
// SSRのHTMLが空になる罠〈docs/operations.md ⑲〉とは無縁）。

const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

export function creditPageTitle(role: CreditRole, name: string): string {
  return role === "studio"
    ? `${name}が制作したアニメの配信情報一覧`
    : `${name}が監督したアニメの配信情報一覧`;
}

export function creditPageDescription(role: CreditRole, name: string, count: number): string {
  const verb = role === "studio" ? "制作" : "監督";
  return `${name}が${verb}したアニメ${count}作品を新しい順にまとめました。各作品の配信サービスはアニメ視聴ガイドで確認できます。`;
}

export function CreditPage({
  role,
  name,
  works,
}: {
  role: CreditRole;
  name: string;
  works: StudioWork[];
}) {
  const roleLabel = CREDIT_ROLE_LABEL[role];
  const shown = works.slice(0, MAX_WORKS_SHOWN);
  const path = `${siteUrl}/${role}/${encodeURIComponent(name)}`;

  const structuredLd = [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: creditPageTitle(role, name),
      numberOfItems: shown.length,
      itemListElement: shown.map(([id, title], i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${siteUrl}/anime/${id}`,
        name: title,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "アニメ視聴ガイド", item: siteUrl },
        { "@type": "ListItem", position: 2, name: `${name}の${roleLabel}作品`, item: path },
      ],
    },
  ];

  return (
    <div className="wrap">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredLd) }}
      />
      <header className="masthead">
        <span className="eyebrow" aria-hidden="true">
          LINK START :: {roleLabel}データ照会
        </span>
        <div className="brandrow">
          <h1 className="brand">
            {name}の{roleLabel}作品
          </h1>
        </div>
        <div className="meta">
          <Link href="/" className="official">
            ← アニメ視聴ガイドのトップに戻る
          </Link>
        </div>
      </header>

      <div className="detail-page">
        <article className="card">
          <div className="card-body detail-body">
            <section className="detail-section">
              <h2 className="detail-heading">
                配信情報がある作品（{shown.length}作品
                {works.length > shown.length ? `／全${works.length}作品` : ""}・新しい順）
              </h2>
              <ul className="detail-list">
                {shown.map(([id, title, year, season]) => (
                  <li key={id}>
                    <Link href={`/anime/${id}`}>{title}</Link>{" "}
                    <Link href={`/season/${year}/${season}`} className="detail-sub">
                      {year}年{SEASON_LABEL[season] ?? season}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="detail-updated">
                過去クールの記録から、配信情報が登録されている作品だけを新しい順に出しています。
                現在も配信されているかは各サービスでご確認ください。
              </p>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
