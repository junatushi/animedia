import type { Metadata } from "next";
import Link from "next/link";

import { siteUrl } from "@/lib/siteUrl";
import { EMBED_FRAME_HEIGHT } from "@/lib/embed";
import {
  attributionHtml,
  attributionMarkdown,
  attributionText,
  datasetAttributionHtml,
  datasetAttributionMarkdown,
  datasetAttributionText,
  SITE_NAME,
} from "@/lib/attribution";
import {
  CSV_COLUMNS,
  DATASET_CSV_URL,
  DATASET_DESCRIPTION,
  DATASET_JSON_URL,
  DATASET_LICENSE,
  DATASET_NAME,
} from "@/lib/serviceDataset";

const title = "配信先ウィジェット・公開API";
const description =
  "アニメの配信先をブログに貼れる無料ウィジェットと、配信情報を取得できる公開API（JSON）、配信サービス名寄せ表（CSV/JSON）の使い方。登録不要・APIキー不要。";

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

  // 配信サービス名寄せ表の構造化データ（2026-08-13追加）。
  // Googleのデータセット検索は schema.org/Dataset を読む。ページの本文に書くだけでは
  // 「データセットとして」は見つけてもらえないので、配布形式（JSON・CSV）と利用条件を
  // 機械可読でも出す。URL・名前・利用条件は lib/serviceDataset.ts の1箇所から取る
  // （本文と構造化データがズレると、機械が読む側にだけ嘘が残る）。
  const datasetLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: DATASET_NAME,
    description: DATASET_DESCRIPTION,
    url: `${pageUrl}#dataset`,
    license: DATASET_LICENSE.url,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: SITE_NAME, url: siteUrl },
    distribution: [
      {
        "@type": "DataDownload",
        name: `${DATASET_NAME}（JSON）`,
        encodingFormat: "application/json",
        contentUrl: DATASET_JSON_URL,
      },
      {
        "@type": "DataDownload",
        name: `${DATASET_NAME}（CSV）`,
        encodingFormat: "text/csv",
        contentUrl: DATASET_CSV_URL,
      },
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
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetLd) }}
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
              <p className="detail-text">
                <code>/api/work/{"{作品ID}"}</code> が返す <code>airingStatus</code> は{" "}
                <code>airing</code>（現在クール以降）か <code>finished</code>
                （放送が終わったクール）です。<code>services</code> は Annict
                の「放送・配信された記録」であって現在の配信可否の確認ではないため、
                <code>finished</code> の作品を「配信中」と書くと未確認の主張になります。
                表示に使う際は言い切らず、各サービスでの確認を促す形にしてください
                （本サイトの作品ページ・ウィジェットも同じ出し分けをしています）。
              </p>
            </section>

            {/* 配信サービス名寄せ表（2026-08-13追加）。
                docs/growth-strategy-2026-08.md の4章の結論＝本サイト固有の資産は一覧ではなく
                「Annictの生チャンネル名 → 国内配信サービス」への名寄せである、を機械可読で配る。
                Annict由来の作品データ（作品ごとの配信実績）は再配布の可否が未確認なので
                含めない（同5章①の法務上の切り分け）。 */}
            <section className="detail-section" id="dataset">
              <h2 className="detail-heading">3. 配信サービス名寄せ表（CSV / JSON）</h2>
              <p className="detail-text">
                Annict が持つ放送・配信チャンネルの<strong>生の名前</strong>（「dアニメストア」
                「ｄアニメストア」「d-anime」のような表記ゆれや、TV局名が混ざったもの）から、
                国内の見放題配信サービスを特定するための対応表です。本サイトが自前で作っているもので、
                そのまま持ち帰って使えます。
              </p>
              <ul className="detail-list">
                <li>
                  <code>GET /api/services</code> … JSON（
                  <a href={DATASET_JSON_URL} target="_blank" rel="noopener noreferrer">
                    {DATASET_JSON_URL}
                  </a>
                  ）
                </li>
                <li>
                  <code>GET /api/services?format=csv</code> … CSV（
                  <a href={DATASET_CSV_URL} target="_blank" rel="noopener noreferrer">
                    {DATASET_CSV_URL}
                  </a>
                  ）。BOM無しUTF-8・RFC 4180。
                </li>
              </ul>
              <pre className="detail-code">{`curl "${DATASET_CSV_URL}"`}</pre>
              <p className="detail-text">
                項目は{" "}
                {CSV_COLUMNS.map((col, i) => (
                  <span key={col}>
                    {i > 0 ? " / " : ""}
                    <code>{col}</code>
                  </span>
                ))}{" "}
                です。<code>channelPattern</code> は判定に使っている正規表現そのもので、
                チャンネル名を「小文字にする → 空白を取り除く → 長音・ダッシュ類を半角ハイフンに統一する
                → 全角英数字を半角にする」の順で整えてから、配列の先頭から順に当てます
                （配列の順序が判定の優先順です）。どれにも一致せず放送局らしい名前でもないものは
                「その他配信」として元の名前のまま扱っています。
              </p>
              <p className="detail-text">
                判定は<strong>①サービス → ②放送局（除外） → ③その他配信</strong>の順です。
                ②の放送局パターンは JSON の <code>matching.broadcastPattern</code> に入っています。
                これを飛ばすと <code>TOKYO MX</code>・<code>AT-X</code>・<code>BS11</code>{" "}
                といった放送局名がすべて「その他配信」に残り、配信サービスとして表示されてしまいます。
              </p>
              <p className="detail-text">
                <strong>作品ごとの配信実績（どの作品がどこで配信されたか）は含みません。</strong>
                そちらは Annict 由来のデータで、本サイトの外への再配布の可否が未確認のためです。
                作品単位の情報が必要な場合は上の公開APIをご利用ください。
              </p>
              <p className="detail-text">
                利用条件は下の「4. 利用条件」と同じですが、
                <strong>この表に Annict のデータは含まれないため、Annict の表記は不要です</strong>
                （本サイトが自前で作った表です）。
                <strong>出典表記（サイト名とリンク）だけを添えてください</strong>。JSONの応答にも{" "}
                <code>license</code> と <code>attribution</code> として同じ内容が入っています。
                作品データ（上の公開API・ウィジェット）と混ぜて使う場合は、そちらの分だけ
                <Link href="#attribution">出典の書き方</Link>の Annict 併記版をお使いください。
              </p>
              <p className="detail-text">HTML</p>
              <pre className="detail-code">{datasetAttributionHtml()}</pre>
              <p className="detail-text">Markdown</p>
              <pre className="detail-code">{datasetAttributionMarkdown()}</pre>
              <p className="detail-text">テキスト</p>
              <pre className="detail-code">{datasetAttributionText()}</pre>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">4. 利用条件</h2>
              <ul className="detail-list">
                <li>個人・非商用のブログやアプリで自由に使えます。連絡は不要です。</li>
                <li>
                  出典として「アニメ視聴ガイド」と、データ元である
                  <a href="https://annict.com/" target="_blank" rel="noopener noreferrer">
                    Annict
                  </a>
                  を明記してください（ウィジェットには最初から入っています）。そのまま貼れる形を
                  下の「出典の書き方」に用意してあります。
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

            {/* 出典の書き方（2026-08-07追加）。
                「出典を明記してください」と書くだけでは書かれない。書きたくないのではなく、
                自分で文面を組み立てる手間があると省かれるだけなので、コピーできる形を出す
                （lib/attribution.ts の冒頭コメント／docs/growth-strategy-2026-08.md）。
                リンクを義務化して被リンクを買う施策ではない点は上の利用条件のとおり。 */}
            <section className="detail-section" id="attribution">
              <h2 className="detail-heading">出典の書き方</h2>
              <p className="detail-text">
                記事やアプリに合うものをそのままお使いください。文面を変えても構いません。
                作品データを返すAPI（<code>/api/work/…</code>・<code>/api/season</code>）の
                レスポンスにも同じ内容が <code>source</code> として入っています。
                <Link href="#dataset">配信サービス名寄せ表</Link>だけを使う場合は Annict
                のデータを含まないため、そちらの節にある Annict 抜きの文面をお使いください。
              </p>
              <p className="detail-text">HTML（ブログ記事の末尾など）</p>
              <pre className="detail-code">{attributionHtml()}</pre>
              <p className="detail-text">Markdown（GitHubのREADME・Zenn/Qiitaなど）</p>
              <pre className="detail-code">{attributionMarkdown()}</pre>
              <p className="detail-text">テキスト（アプリの「このアプリについて」など）</p>
              <pre className="detail-code">{attributionText()}</pre>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">配信スケジュールをカレンダーで購読する</h2>
              <p className="detail-text">
                今期の放送・配信スケジュールを iCalendar（.ics）で配信しています。Googleカレンダー・
                Apple カレンダー等の「URLでカレンダーを追加」に次のURLを入れると、毎週の放送予定が
                自分のカレンダーに並びます。放送開始日が判明している作品だけを載せています。
              </p>
              <pre className="detail-code">{`${siteUrl}/calendar.ics`}</pre>
              <p className="detail-text">
                <code>?service=</code> を付けると、そのサービスの見放題で見られる作品だけに絞れます
                （キーは上のAPIが返す <code>services[].key</code> と同じ）。
              </p>
              <pre className="detail-code">{`${siteUrl}/calendar.ics?service=d_anime`}</pre>
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
