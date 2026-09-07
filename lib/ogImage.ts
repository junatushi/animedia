// SNSの共有カード（og:image / twitter:image）に出す既定の画像（2026-09-06導入）。
//
// ───────────────────────────────────────────────────────────────
// 【なぜ1箇所に置くか・実測で見つけた穴】
//
// Next.js の File-based Metadata（`app/opengraph-image.tsx` を置くだけで
// og:image が入る規約）は、**子のルートが `generateMetadata` で `openGraph` を
// 返すと効かなくなる**。`openGraph` はフィールド単位ではなく**まるごと**
// 置き換わるため、親の images も一緒に消える。
//
// 2026-09-06にローカル本番ビルドのHTMLを実際に数えたところ、
// **og:image が入っていたのはトップページ（"/"）だけ**だった:
//
//   /                       og:image = 1
//   /about                  og:image = 0
//   /developers             og:image = 0
//   /season/2025/summer     og:image = 0
//   /rankings/2025/summer   og:image = 0
//   /exclusive/2025/summer  og:image = 0
//   /studio/EMTスクエアード   og:image = 0
//
// つまりシーズンページや声優ページをSNSで共有しても、**画像の無いカード**に
// なっていた。作品ページだけは自前の `app/anime/[id]/opengraph-image.tsx` を
// 持っていたので出ていたが、それはそれで動的セグメント＝エッジキャッシュが
// 当たらず1リクエスト205〜224msを払っていた（だから削除した）。
//
// しかも `twitter: { card: "summary_large_image" }` を宣言しているページが
// 複数あった。**画像の無い large_image カードは、カードとして成立しない。**
//
// **画面を見ても気づけない**壊れ方（自分のサイトを見ても分からず、SNSに貼って
// 初めて分かる）なので、`node scripts/check.ts` の「共有カードの画像」節が
// `app/` を走査して、`openGraph` を宣言しているファイル全部に images が
// あるかを機械的に見張る。
//
// 【なぜ相対パスか】
// `app/layout.tsx` が `metadataBase` を設定しているので、Next.js が絶対URLに
// 解決する。`siteUrl` を直接埋めると、独自ドメイン移行時に直す箇所が増える
// （`lib/siteUrl.ts` の一元化と同じ理由）。
//
// 【なぜ作品ごとの画像に戻さないか】
// 動的セグメントを持つOG画像は、作品1,961件をクローラーが1件ずつ舐めるため
// エッジキャッシュが構造的に当たらない。ここで配るURLは**1本だけ**なので
// `s-maxage=604800` が実際に効き、生成は実質1回で済む。
// 作品名は `og:title` に入るので、共有カードに作品名は出る。
// ───────────────────────────────────────────────────────────────

/** ルート直下の `app/opengraph-image.tsx` が生成する画像のパス。 */
export const OG_IMAGE_PATH = "/opengraph-image";

/** `openGraph.images` / `twitter.images` にそのまま渡せる形。 */
export const OG_IMAGES = [
  {
    url: OG_IMAGE_PATH,
    width: 1200,
    height: 630,
    alt: "アニメ視聴ガイド ― 今期アニメの配信状況をサービス別にスキャン",
  },
];
