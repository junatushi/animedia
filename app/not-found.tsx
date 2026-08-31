import type { Metadata } from "next";
import Link from "next/link";

import ARCHIVE_INDEX from "@/content/archive/index.json";
import { SEASON_LABEL } from "@/lib/resolveSeasonParams";

// ───────────────────────────────────────────────────────────────
// 404ページ（2026-08-31導入）
//
// 【なぜ要るか】本番を見回ったところ、存在しないURLは Next.js の**既定の404画面**を
// 返していた。実測で **サイト内リンクが1本も無く**（`href="/..."` が0件）、ヘッダーも
// ブランドも無い、完全な行き止まりだった。
//
// 404そのものは正しい応答なので消す必要はないが、そこに着地した人には次の行き先が要る。
// 404に着地する経路は実際に存在する:
//   ・2026-08-31まで約2,826ページが404を返していた（docs/operations.md の㊱）。
//     その間に検索結果へ載ったURLは、まだしばらく踏まれる。
//   ・索引から外した過去年の声優ページ（㉟）は、検索結果から消えるまで時間差がある。
//   ・作品がAnnictから消えると /anime/{id} は404になる。
//
// 【ここに動的なリンクを置かないこと】
// 「今期のシーズンページ」へ直接リンクしたくなるが、この画面はビルド時に事前生成され
// 得るので、`new Date()` から組んだURLはクール替わりで古くなる。トップ（"/"）は常に
// 今期を初期表示するので、そちらへ送れば古くならない。過去クールへのリンクは
// content/archive/index.json（静的JSON）から作るので同じ問題が無い。
// ───────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "ページが見つかりません",
  // 404は本来インデックスされないが、ルートレイアウトが index, follow を宣言している
  // ため、ここで明示的に打ち消しておく（robots メタは404でも出力される）。
  robots: { index: false, follow: true },
};

// 直近の過去クール（新しい順に4件）。静的JSONだけで組めるので古くならない。
const RECENT_SEASONS = [...ARCHIVE_INDEX.seasons]
  .sort((a, b) =>
    a.year !== b.year
      ? b.year - a.year
      : ["winter", "spring", "summer", "autumn"].indexOf(b.season) -
        ["winter", "spring", "summer", "autumn"].indexOf(a.season)
  )
  .slice(0, 4);

export default function NotFound() {
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
          <Link href="/" className="official">
            ← アニメ視聴ガイドのトップに戻る
          </Link>
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
                <Link href="/">アニメ視聴ガイドのトップ</Link>
                では、今期の放送・配信作品を配信サービス別に絞り込めます。作品名・声優名での
                検索もこちらから行えます。
              </p>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">過去クールから探す</h2>
              <ul className="detail-list">
                {RECENT_SEASONS.map((s) => (
                  <li key={`${s.year}-${s.season}`}>
                    <Link href={`/season/${s.year}/${s.season}`}>
                      {s.year}年{SEASON_LABEL[s.season]}アニメ
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="detail-section">
              <h2 className="detail-heading">このサイトについて</h2>
              <ul className="detail-list">
                <li>
                  <Link href="/about">運営者情報・お問い合わせ</Link>
                </li>
                <li>
                  <Link href="/developers">配信先ウィジェット・公開API</Link>
                </li>
              </ul>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
