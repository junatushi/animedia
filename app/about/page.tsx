import type { Metadata } from "next";
import Link from "next/link";

import { siteUrl } from "@/lib/siteUrl";
const OPERATOR_NAME = "アニメディア";

const title = "運営者情報";
const description = "「アニメ視聴ガイド」の運営者情報・お問い合わせ先・SNSアカウントのご案内。";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${siteUrl}/about` },
  openGraph: { title, description, url: `${siteUrl}/about`, type: "website" },
  twitter: { card: "summary", title, description },
};

// E-E-A-T（発信者の実在性・信頼性）向上のための運営者情報ページ。
// サーバーコンポーネントで完全にHTML化し、検索エンジン・生成AIから内容がそのまま見えるようにする。
export default function AboutPage() {
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "アニメ視聴ガイド", item: siteUrl },
      { "@type": "ListItem", position: 2, name: title, item: `${siteUrl}/about` },
    ],
  };

  return (
    <div className="wrap">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <header className="masthead">
        <span className="eyebrow" aria-hidden="true">
          LINK START :: 運営者情報照会
        </span>
        <div className="brandrow">
          <h1 className="brand">運営者情報</h1>
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
              <h2 className="detail-heading">運営</h2>
              <p className="detail-text">{OPERATOR_NAME}</p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">このサイトについて</h2>
              <p className="detail-text">
                今期アニメがどの配信サービスで観られるか、一覧でひと目で分かるサイトが欲しいと思って作りました。
                配信情報はAnnictのデータをサーバー側でリアルタイムに取得しており、サイト側で推測データを埋めることはしていません。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">お問い合わせ</h2>
              <p className="detail-text">
                ご意見・配信情報の誤りのご指摘等は、下記Xアカウントまでご連絡ください。
              </p>
              <p className="detail-text">
                <a href="https://x.com/animedia0705" target="_blank" rel="noopener noreferrer">
                  https://x.com/animedia0705 ↗
                </a>
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">SNS</h2>
              <ul className="detail-list">
                <li>
                  <a href="https://x.com/animedia0705" target="_blank" rel="noopener noreferrer">
                    X（旧Twitter） ↗
                  </a>
                </li>
                <li>
                  <a href="https://bsky.app/profile/animedia0705.bsky.social" target="_blank" rel="noopener noreferrer">
                    Bluesky ↗
                  </a>
                </li>
                <li>
                  <a href="https://mastodon.social/@animedia" target="_blank" rel="noopener noreferrer">
                    Mastodon ↗
                  </a>
                </li>
              </ul>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">ログイン機能について</h2>
              <p className="detail-text">
                「視聴済み」「配信開始をメールで通知」機能を利用するには、Googleアカウントでのログインが必要です（ログインしなくても、配信情報の閲覧・検索・お気に入り等は今まで通りすべてご利用いただけます）。
              </p>
              <p className="detail-text">
                ログインすると、Googleから提供されるメールアドレス・氏名・アバター画像と、「視聴済み」「配信通知希望」にした作品ID・記録日時を、認証・データ保存の委託先であるSupabase（Supabase, Inc.、データ保存先は海外サーバーの場合があります）に保存します。これらの情報は現時点ではそれぞれの機能の提供のみに利用しており、属性分析やおすすめ機能等には使用していません（今後利用目的を追加する場合は、本ページで改めてご案内します）。
              </p>
              <p className="detail-text">
                「配信開始をメールで通知」をONにした作品に本日配信がある場合、登録メールアドレス宛にお知らせメールを送信します（メール配信の委託先: Resend, Inc.）。メール本文の「配信通知をすべて停止する」リンク、または各作品カードの通知アイコンから、いつでも解除できます。
              </p>
              <p className="detail-text">
                アカウント・データの削除をご希望の場合は、下記Xアカウントまでご連絡ください。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">プライバシー・広告について</h2>
              <p className="detail-text">
                アクセス解析の内容・ログイン時に取得する情報・広告（アフィリエイトプログラム）の掲載方針は、
                <Link href="/privacy">プライバシーポリシー・広告掲載について</Link>をご覧ください。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">データについて</h2>
              <p className="detail-text">
                配信情報は<a href="https://annict.com/" target="_blank" rel="noopener noreferrer">Annict</a>
                （コミュニティ更新ベース）から取得しています。網羅率は100%ではなく、新作は反映が遅れることがあります。視聴前に各サービスの最新情報もご確認ください。
                作品のあらすじ・見どころ等は、公式サイト等の一次情報を確認しながら人力で追記しています。
              </p>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
