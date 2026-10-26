// 作品ページ（/anime/[id]）の <title> を組み立てる。
//
// 独立したファイルにしている理由: app/anime/[id]/page.tsx は .tsx なので
// `node scripts/check.ts` から import できない（NodeはJSXを解釈しない）。
// 幅の予算は回帰テストで守りたいロジックなので、素の .ts に置いて両方から使う。

// 検索結果に出るtitleの幅の目安（全角換算）。日本語の検索結果は概ね全角30〜33文字で
// 打ち切られる。半角は全角の約半分の幅なので0.5として数える。
export const TITLE_WIDTH_BUDGET = 32;

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) < 0x80 ? 0.5 : 1;
  return w;
}

// 作品名のあとに付ける問いかけ。検査（scripts/check.ts）もこの定数を使う。
//
// 2026-10-26に「はどこで配信？」から変更した。GSC（content/analytics/gsc/2026-10-22.json）で、
// 作品名の検索語で最も多い型は「{作品名} アニメ どこで 見れる」で、1ページ目にいるのに
// クリック率が低かった。一方、題名と言い回しが一致する「{作品名} 配信」型は、
// 順位が低いのにクリック率が高かった。サービス別ページ（題名が「〜で見れる作品一覧」）の
// クリック率も高い。どれも語数が少なく作品の違いも混ざった弱い根拠なので、
// 判定は変更日以降の「見れる」型の検索語のクリック率で行う（docs/operations.md の [69]）。
// 問いかけの形のままにすること（「見れます」と言い切ると、放送が終わった作品に
// いまも配信中と主張することになる。lib/workAvailability.ts と同じ理由）。
export const WORK_TITLE_QUESTION = "はどこで見れる？";

// 「{作品名}はどこで見れる？{サービス名...}」を、検索結果で切れない幅に収めて組み立てる。
//
// 経緯（2026-08-05）: 2026-07-27に「検索語に近づける」ためtitleへ配信サービス名を
// 入れたが、幅の上限を考えていなかった。2025年の実データ335作品で当時のロジックの
// 長さを測ると中央値47文字・99%が30文字超・83%が40文字超で、**入れたはずの
// サービス名がほぼ全作品で表示前に切り捨てられていた**（最長は
// 「Re:ゼロから始める異世界生活 3rd season 反撃編はどこで配信？dアニメ・ABEMAほか9サービス」
// の65文字。当時の文言のまま）。しかも配信社数が多い人気作ほど長くなるため、いちばんCTRを取りたい
// 作品ほど切られるという逆相関になっていた。
// 予算に収まる数だけサービス名を入れ、入らない分は素直に諦める。
//
// 作品名は主キーワードなので、予算を超えても削らない（削ると検索語と一致しなくなる）。
// その場合はサービス名を足さず「{作品名}はどこで見れる？」だけにする。
export function buildWorkTitle(workTitle: string, serviceShorts: string[]): string {
  const base = `${workTitle}${WORK_TITLE_QUESTION}`;
  let remaining = TITLE_WIDTH_BUDGET - displayWidth(base);
  if (serviceShorts.length === 0 || remaining <= 0) return base;

  const fitted: string[] = [];
  for (const s of serviceShorts) {
    // 2件目以降は区切りの「・」の分も要る。
    const cost = displayWidth(s) + (fitted.length > 0 ? 1 : 0);
    if (cost > remaining) break;
    fitted.push(s);
    remaining -= cost;
  }
  if (fitted.length === 0) return base;

  // 残りの件数（「ほか9サービス」）は、収まるときだけ足す。件数は
  // 「たくさんあるらしい」という情報でしかなく、サービス名そのものより優先度が低い。
  const rest = serviceShorts.length - fitted.length;
  const restText = rest > 0 ? `ほか${rest}サービス` : "";
  if (restText && displayWidth(restText) <= remaining) {
    return base + fitted.join("・") + restText;
  }
  return base + fitted.join("・");
}
