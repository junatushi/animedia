import IntentLink from "./IntentLink";

import ARCHIVE_INDEX from "@/content/archive/index.json";
import { SEASON_LABEL } from "@/lib/resolveSeasonParams";

// ───────────────────────────────────────────────────────────────
// 404の中身（2026-08-31導入）
//
// 【なぜ components/ に置くか・Next.js 14の落とし穴】
// `app/not-found.tsx`（ルート）が拾うのは**どのルートにも一致しなかったURL**だけで、
// ルートには一致したが `notFound()` を呼んだ場合（存在しない作品ID・索引に無い
// 制作会社名・未知のクール名など＝**実際に起きる404のほぼ全部**）は、Next.js 14 では
// 既定の404画面が出る。実測（ローカル本番ビルド）:
//
//   /this-does-not-exist        → 20,186 B・<h1>あり・サイト内リンク6本（自作の画面）
//   /studio/ぴえろ🍜            → 14,611 B・<h1>なし・サイト内リンク0本（既定の画面）
//   /season/2026/monsoon        → 14,978 B・<h1>なし・サイト内リンク0本（既定の画面）
//
// 区画ごとに `not-found.tsx` を置くと、その区画の `notFound()` がこちらを使う。
// **置き場所は `page.tsx` と同じ階層でなければ効かない**（実測。`app/studio/not-found.tsx`
// のように1階層浅いところに置いても既定の画面のままだった）。
// 中身が8箇所に散らばらないよう、本体はこのファイル1つが持つ。
//
// 【`notFound()` 経由の404は、初期HTMLではなくRSCストリームで届く】
// ページの描画が始まってから `notFound()` が投げられるので、HTMLのシェルは既に
// 送出済みになっている。そのためこの画面は `self.__next_f.push(...)` の側に入り、
// **`curl` で取った生HTMLを grep しても `<h1>` もリンクも見つからない**。
// ブラウザでは正しく表示される（2026-08-31にBrowserペインで確認済み）。
// つまり:
//   ・人（＝この画面の目的）には届く
//   ・生HTMLを数える検査（scripts/verify-production.sh）では確認できない
// なので I 節は**ルート未一致のURL**（こちらは初期HTMLに入る）だけを見る。
// これは⑦-10（Suspense退避でHTMLが空）と同じ形の制約で、検査の側を無理に
// 通すために作りを変えることはしない。
//
// 【ここに動的なリンクを置かないこと】
// この画面はビルド時に事前生成され得るので、日付から組んだURLはクール替わりで古くなる。
// トップ（"/"）は常に今期を初期表示するので、そちらへ送れば古くならない。
// 過去クールへのリンクは content/archive/index.json（静的JSON）から作る。
//
// 検査は `node scripts/check.ts` の「404の境界」節（notFound() を呼ぶ区画すべてに
// 境界があるか）と `scripts/verify-production.sh` のI節。経緯は docs/operations.md の㊲。
// ───────────────────────────────────────────────────────────────

// 直近の過去クール（新しい順に4件）。静的JSONだけで組めるので古くならない。
const SEASON_ORDER = ["winter", "spring", "summer", "autumn"];
const RECENT_SEASONS = [...ARCHIVE_INDEX.seasons]
  .sort((a, b) =>
    a.year !== b.year
      ? b.year - a.year
      : SEASON_ORDER.indexOf(b.season) - SEASON_ORDER.indexOf(a.season)
  )
  .slice(0, 4);

export default function NotFoundPanel() {
  return (
    <div className="wrap">
      <header className="masthead">
        <span className="eyebrow" aria-hidden="true">
          LINK START :: 該当ページ未検出
        </span>
        <div className="brandrow">
          <h1 className="brand">ページが見つかりません</h1>
        </div>
        <div className="meta">
          <IntentLink href="/" className="official">
            ← アニメ視聴ガイドのトップに戻る
          </IntentLink>
        </div>
      </header>

      <div className="detail-page">
        <article className="card">
          <div className="card-body detail-body">
            <section className="detail-section">
              <p className="detail-text">
                お探しのページは見つかりませんでした。URLが変わったか、作品データが
                取り下げられた可能性があります。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">今期のアニメを探す</h2>
              <p className="detail-text">
                <IntentLink href="/">アニメ視聴ガイドのトップ</IntentLink>
                では、今期の放送・配信作品を配信サービス別に絞り込めます。作品名・声優名での
                検索もこちらから行えます。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">過去クールから探す</h2>
              <ul className="detail-list">
                {RECENT_SEASONS.map((s) => (
                  <li key={`${s.year}-${s.season}`}>
                    <IntentLink href={`/season/${s.year}/${s.season}`}>
                      {s.year}年{SEASON_LABEL[s.season]}アニメ
                    </IntentLink>
                  </li>
                ))}
              </ul>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">このサイトについて</h2>
              <ul className="detail-list">
                <li>
                  <IntentLink href="/about">運営者情報・お問い合わせ</IntentLink>
                </li>
                <li>
                  <IntentLink href="/developers">配信先ウィジェット・公開API</IntentLink>
                </li>
              </ul>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
