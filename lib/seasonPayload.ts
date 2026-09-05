import type { SeasonResponse } from "./types";

// SSRのHTMLに埋め込むぶんだけ creditNames を落とす（2026-09-05導入）。
//
// 【なぜ要るか】SeasonExplorer はクライアントコンポーネントなので、Reactは水和のために
// **渡したpropsを丸ごとJSONにしてHTMLへ埋め込む**（`self.__next_f.push(...)`＝RSCの
// flight payload）。つまりカードとして描画済みのデータが、もう一度データとしてHTMLに乗る。
//
// 2026-09-05の実測（/season/2025/summer・173作品・本番と同じ本番ビルド）:
//
//   HTML全体            917,249 B → gzip  88,426 B
//     描画済みマークアップ 558,081 B → gzip  31,465 B  （反復が多く1/18に縮む）
//     flight payload     290,282 B → gzip  50,333 B  （データなので縮まない）
//     インラインCSS        41,660 B → gzip 約7,000 B
//
// **生バイトでは32%だが、実際に転送されるバイトでは57%が flight payload** だった。
// 前の回（㊵）が「services/castNamesの圧縮は効果が薄い」と判断したのは正しかったが
// （gzip後でそれぞれ3.2KB・1.2KB）、分母を生HTMLで見ていたため creditNames だけが
// 別格（gzip後 9.8KB＝文書の11%）であることを見落としていた。
//
// 【なぜ creditNames だけ外せるか】このフィールドは**画面に一度も出ない**。
// 用途は SeasonExplorer の自由文字列検索でスタッフ名に当てることだけで、
// 声優名は同じ配列に入っている castNames が別に持っている（creditNames ⊇ castNames）。
// つまり外して失われるのは「監督・制作会社・原作者の名前で検索したとき」だけで、
// それも検索欄に入力した時点で `/api/season` から取りに行って埋め直す。
// クール横断検索が `/api/search-index` を使うときだけ取りに行くのと同じ流儀。
//
// 【外してはいけない点が3つある】
// ①**公開API（/api/season）の形は変えない**。`/developers` が仕様を公開しており、
//   二次利用側の creditNames が消えると黙って壊れる。ここで削るのは
//   「SSRのHTMLに埋め込むコピー」だけ。
// ②**castNames は残す**。声優チップの生成（画面に出る）と声優絞り込みに要る。
//   しかも gzip後 1.2KB しかないので削る価値が無い。
// ③**重複を削るだけでは意味が無い**。creditNames から castNames と重なる分
//   （実測で52%）を落としてもgzip後は867B（−2.7%）しか減らない。gzipが反復を
//   既に吸収しているため。効くのは配列ごと落とすときだけ（−9,587B・−29.5%）。
//
// 検査は `node scripts/check.ts` の「SSRペイロードの creditNames」節。
export function stripCreditNamesForSsr(
  data: SeasonResponse | undefined
): SeasonResponse | undefined {
  if (!data) return data;
  return {
    ...data,
    // クライアントに「持っていない」ことを伝える印。これが無いと、
    // 本当に0件なのか外されたのかを区別できず、取りに行く判断ができない。
    creditsOmitted: true,
    items: data.items.map((it) =>
      it.creditNames.length === 0 ? it : { ...it, creditNames: [] }
    ),
  };
}
