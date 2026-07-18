import type { Metadata } from "next";
import Link from "next/link";

import { siteUrl } from "@/lib/siteUrl";

const title = "プライバシーポリシー・広告掲載について";
const description =
  "「アニメ視聴ガイド」のプライバシーポリシーと広告（アフィリエイトプログラム）掲載方針のご案内。";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${siteUrl}/privacy` },
  openGraph: { title, description, url: `${siteUrl}/privacy`, type: "website" },
  twitter: { card: "summary", title, description },
};

// プライバシーポリシー＋広告掲載方針のページ。
// アフィリエイト広告の掲載（ステマ規制対応の開示）とASP・AdSense等の審査要件の
// 両方で必要になる。記載内容は実際に行っていることだけを書く（行っていない
// データ収集・利用を「する可能性がある」と誇張して書かない）。
export default function PrivacyPage() {
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "アニメ視聴ガイド", item: siteUrl },
      { "@type": "ListItem", position: 2, name: title, item: `${siteUrl}/privacy` },
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
          LINK START :: 利用者保護規約照会
        </span>
        <div className="brandrow">
          <h1 className="brand">プライバシーポリシー・広告掲載について</h1>
        </div>
        <div className="meta">
          <Link href="/" className="official">
            ← アニメ視聴ガイドのトップに戻る
          </Link>
          <Link href="/about" className="official">
            運営者情報を見る
          </Link>
        </div>
      </header>

      <div className="detail-page">
        <article className="card">
          <div className="card-body detail-body">
            <section className="detail-section">
              <h2 className="detail-heading">広告（アフィリエイトプログラム）について</h2>
              <p className="detail-text">
                当サイトは、アフィリエイトサービスプロバイダ（ASP）が提供するアフィリエイトプログラムに参加しており、
                一部のページに広告リンクを掲載しています。広告リンクには「PR」の表示を付け、リンクの直前に
                広告である旨を明記しています。リンク経由で配信サービスへの登録等が行われた場合、当サイトは
                ASPから報酬を受け取ることがあります。
              </p>
              <p className="detail-text">
                広告の有無は、掲載している配信情報の内容（どの作品がどのサービスで観られるか）には影響しません。
                配信情報はAnnictのデータおよび公式サイト等の一次情報に基づいて表示しており、広告の掲載を理由に
                特定サービスの配信状況を優遇・改変することはありません。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">アクセス解析について</h2>
              <p className="detail-text">
                当サイトは、サイト改善のために Vercel Web Analytics および自前の匿名イベント計測を利用しています。
                記録するのは「共有ボタンが押された」「どのサービスで絞り込まれたか」といった匿名の操作イベントのみで、
                IPアドレス・Cookie・ユーザーIDは記録していません。広告リンクのクリックも同様に匿名で計測します。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">ログイン機能で取得する情報</h2>
              <p className="detail-text">
                「視聴済み」「配信開始をメールで通知」機能を利用する場合のみ、Googleアカウントでのログインが必要です。
                ログイン時に取得・保存する情報とその利用目的、メール配信・解除方法、データ削除の依頼方法は
                <Link href="/about">運営者情報</Link>ページの「ログイン機能について」に記載しています。
                ログインしない場合、個人を特定する情報は取得しません。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">Cookie・ローカルストレージについて</h2>
              <p className="detail-text">
                当サイトは、ログイン状態の維持（ログイン機能を利用した場合のみ）と、テーマ（ダーク/ライト）等の
                表示設定の保存のためにCookieおよびブラウザのローカルストレージを使用します。広告配信を目的とした
                第三者Cookieの設置は行っていません。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">お問い合わせ</h2>
              <p className="detail-text">
                本ポリシーに関するお問い合わせは、<Link href="/about">運営者情報</Link>ページ記載の連絡先までお願いします。
                掲載内容に変更がある場合は、本ページを更新してご案内します。
              </p>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
