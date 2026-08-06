import type { Metadata } from "next";
import Link from "next/link";

import { siteUrl } from "@/lib/siteUrl";
import { EMBED_FRAME_HEIGHT } from "@/lib/embed";

const title = "配信先ウィジェット・公開API";
const description =
  "アニメの配信先をブログに貼れる無料ウィジェットと、配信情報を取得できる公開API（JSON）の使い方。登録不要・APIキー不要。";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${siteUrl}/developers` },
  openGraph: { title, description, url: `${siteUrl}/developers`, type: "website" },
  twitter: { card: "summary", title, description },
};

// 配信先ウィジェット（他サイトへの埋め込み）と公開APIの案内ページ（2026-08-06導入）。
//
// なぜ作るか: 2026-07-26の実測で平均掲載順位19.8位・検索クリック7件/28日。ページを
// 増やす方向は「新設したSEOページ群が表示ゼロ」という実測で頭打ちと判定済みで、
// 残っているボトルネックは被リンク・外部言及がほぼゼロであること。個人サイトが
// 予算も知名度も無しに被リンクを得る現実的な手段は「他人が貼りたくなるものを配る」しかない。
// このページはその置き場であり、貼る側・使う側が条件を確認する先でもある。
export default function DevelopersPage() {
  const pageUrl = `${siteUrl}/developers`;
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "アニメ視聴ガイド", item: siteUrl },
      { "@type": "ListItem", position: 2, name: title, item: pageUrl },
    ],
  };

  const iframeExample =
    `<iframe src="${siteUrl}/embed/anime/14132" title="配信先（アニメ視聴ガイド）"\n` +
    `  width="100%" height="${EMBED_FRAME_HEIGHT}" style="border:0;max-width:520px" loading="lazy"></iframe>`;

  return (
    <div className="wrap">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <header className="masthead">
        <span className="eyebrow" aria-hidden="true">
          LINK START :: 外部連携
        </span>
        <div className="brandrow">
          <h1 className="brand">配信先ウィジェット・公開API</h1>
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
              <h2 className="detail-heading">できること</h2>
              <p className="detail-text">
                アニメの感想記事を書くときの「この作品はどこで見られるか」を、自分で調べて書く代わりに
                貼り付けコード1つで置けます。登録もAPIキーも不要、費用もかかりません。
                配信情報の一覧は <Link href="/">アニメ視聴ガイド</Link> が Annict
                のデータをもとに毎日更新しています。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">1. 配信先ウィジェットを貼る</h2>
              <p className="detail-text">
                貼りたい作品のページを開き、下の方にある「ブログ・サイトに配信先を貼る」を開くと
                貼り付けコードが出ます。形式は2つあります。
              </p>
              <ul className="detail-list">
                <li>
                  <strong>HTML</strong>
                  … 貼った時点の配信先で固定されます。外部のCSS・JavaScriptを一切読み込まないので、
                  貼り先の表示速度に影響しません。はてなブログ・WordPress・FC2 など
                  HTMLが書ける場所ならどこでも動きます。
                </li>
                <li>
                  <strong>iframe</strong>
                  … 配信先が変わると自動で最新に更新されます。URLは
                  <code>{`${siteUrl}/embed/anime/{作品ID}`}</code> です。
                </li>
              </ul>
              <pre className="detail-code">{iframeExample}</pre>
              <p className="detail-text">
                作品ID は作品ページのURL（<code>/anime/14132</code> の数字部分）です。
                Annict の作品ID と同じものを使っています。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">2. 公開API（JSON）</h2>
              <p className="detail-text">
                自分でウィジェットやボットを作りたい場合は、下のJSONをそのまま使えます。
                いずれもAPIキー不要・CORS許可済み（ブラウザから直接取得できます）です。
              </p>
              <ul className="detail-list">
                <li>
                  <code>GET /api/work/{"{作品ID}"}</code>
                  … 作品1件の配信サービス・放送開始日など。
                </li>
                <li>
                  <code>GET /api/season?year=2026&amp;season=summer</code>
                  … そのクールの全作品と配信サービス。<code>season</code> は
                  <code>winter</code> / <code>spring</code> / <code>summer</code> / <code>autumn</code>。
                </li>
                <li>
                  <code>GET /api/search-index</code>
                  … 直近3年ぶんの作品ID・タイトル・読み仮名の軽量索引（タイトルから作品IDを引く用）。
                </li>
              </ul>
              <pre className="detail-code">{`curl "${siteUrl}/api/work/14132"`}</pre>
              <p className="detail-text">
                配信サービスの <code>key</code>（<code>d_anime</code> / <code>abema</code> /{" "}
                <code>netflix</code> など）は本サイト内で一貫しています。
                <code>services</code> が空で <code>hasBroadcastData</code> が <code>true</code>{" "}
                の場合は「TV放送の記録はあるが見放題配信は未登録」という意味です
                （＝配信が無いと断定はできません）。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">3. 利用条件</h2>
              <ul className="detail-list">
                <li>個人・非商用のブログやアプリで自由に使えます。連絡は不要です。</li>
                <li>
                  出典として「アニメ視聴ガイド」と、データ元である
                  <a href="https://annict.com/" target="_blank" rel="noopener noreferrer">
                    Annict
                  </a>
                  を明記してください（ウィジェットには最初から入っています）。
                </li>
                <li>
                  APIは常識的な頻度でお願いします。クール全件のような大きなデータを繰り返し取得する用途では、
                  結果をキャッシュしてください。大量・継続的に取得したい場合は Annict の API
                  を直接ご利用ください。
                </li>
                <li>
                  ウィジェット内のリンクを外して使っても構いません。リンクを残すかどうかは貼る側の判断で、
                  こちらから見返りを提供することはありません（＝リンクの売買・交換は行いません）。
                </li>
                <li>
                  ウィジェットは広告リンクを含みません。リンク先は本サイトの作品ページのみです。
                </li>
              </ul>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">データについて（正確性の限界）</h2>
              <p className="detail-text">
                配信情報は Annict のコミュニティ更新に依存しており、網羅率は100%ではありません。
                新作は配信欄が空になることがあります。また Annict
                が持つのは「放送・配信された記録」であるため、過去作については現在も配信中とは限りません。
                本サイトは推測でデータを補うことはせず、確認できない情報は「未登録」と表示します。
              </p>
              <p className="detail-text">
                不具合・要望は <Link href="/about">運営者情報</Link> のお問い合わせ先へどうぞ。
              </p>
            </section>
          </div>
        </article>
      </div>

      <p className="footnote">
        データ元: Annict（コミュニティ更新ベース）。
        <Link href="/about">運営者情報</Link>
        {" ・ "}
        <Link href="/privacy">プライバシーポリシー・広告掲載について</Link>
      </p>
    </div>
  );
}
