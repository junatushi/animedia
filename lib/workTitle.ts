// 作品ページ（/anime/[id]）の <title> を組み立てる。
//
// 独立したファイルにしている理由: app/anime/[id]/page.tsx は .tsx なので
// `node scripts/check.ts` から import できない（NodeはJSXを解釈しない）。
// 幅の予算は回帰テストで守りたいロジックなので、素の .ts に置いて両方から使う。

// 検索結果に出るtitleの幅の目安（全角換算）。半角は全角の約半分の幅なので0.5として数える。
//
// 32 → 29 に引き下げた（2026-08-07）。根拠:
//   - 表示領域は約600px。全角のみならPCで全角28〜32文字、スマホで全角26〜33文字が目安で、
//     切れるかどうかは文字数ではなくピクセル幅で決まる（Technogram「タイトルタグの文字数」2026）
//   - title要素とh1要素は全角29文字以内に収めるのが安全ライン（Web担当者Forum 2025-10-24）
// 32のままだと、過去8クール648作品の実測で64.5%が29文字超・44.4%が30文字超になっていた
// （＝末尾に置いたサービス名が機種によっては見えない）。安全側の29に寄せる。
export const TITLE_WIDTH_BUDGET = 29;

// 作品名だけで予算を超える作品（実測8.2%。最長84文字）用の短い接尾辞。
// 「はどこで配信？」は全角7文字ぶん幅を食う。極端に長いtitleはGoogleが
// 高い確率で書き換える（suzukikenichi.com「タイトルの書き換えを防ぐ10の方法」）ため、
// もともと予算を超えている作品では主キーワード「配信」だけを最小の幅で残す。
const LONG_TITLE_SUFFIX = "の配信";
const SUFFIX = "はどこで配信？";

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) < 0x80 ? 0.5 : 1;
  return w;
}

// 「{作品名}はどこで配信？{サービス名...}」を、検索結果で切れない幅に収めて組み立てる。
//
// 経緯（2026-08-05）: 2026-07-27に「検索語に近づける」ためtitleへ配信サービス名を
// 入れたが、幅の上限を考えていなかった。2025年の実データ335作品で当時のロジックの
// 長さを測ると中央値47文字・99%が30文字超・83%が40文字超で、**入れたはずの
// サービス名がほぼ全作品で表示前に切り捨てられていた**（最長は
// 「Re:ゼロから始める異世界生活 3rd season 反撃編はどこで配信？dアニメ・ABEMAほか9サービス」
// の65文字）。しかも配信社数が多い人気作ほど長くなるため、いちばんCTRを取りたい
// 作品ほど切られるという逆相関になっていた。
// 予算に収まる数だけサービス名を入れ、入らない分は素直に諦める。
//
// 作品名は主キーワードなので、予算を超えても削らない（削ると検索語と一致しなくなる）。
// その場合はサービス名を足さず「{作品名}はどこで配信？」だけにする。
//
// 作品名だけで予算を使い切っている作品（実測8.2%）は、接尾辞を「はどこで配信？」から
// 「の配信」に短縮する。どちらにせよサービス名は入らないので、せめて全体の長さを縮めて
// Googleに書き換えられる確率を下げる（極端に長いtitleは書き換えの主因）。
export function buildWorkTitle(workTitle: string, serviceShorts: string[]): string {
  const nameWidth = displayWidth(workTitle);
  if (nameWidth + displayWidth(SUFFIX) > TITLE_WIDTH_BUDGET) {
    // 短い接尾辞でも予算を超えるなら、作品名だけにする。
    // 「の配信」は3文字とはいえ飾りなので、予算を超えてまで足す価値はない
    // （長いtitleほどGoogleに書き換えられる）。作品名は主キーワードなので削らない。
    return nameWidth + displayWidth(LONG_TITLE_SUFFIX) > TITLE_WIDTH_BUDGET
      ? workTitle
      : `${workTitle}${LONG_TITLE_SUFFIX}`;
  }

  const base = `${workTitle}${SUFFIX}`;
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
