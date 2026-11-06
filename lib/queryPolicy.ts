// 公開の route handler に付いた「知らないクエリ」を、関数を起動する前に落とす
// （2026-11-05導入・重大度高。Vercelの無料枠を恒久的に超えないための設計の一部）。
//
// 【なぜ要るか】`/api/season` などの route handler は `s-maxage` でCDNに載せているが、
// CDNはURL（クエリ文字列込み）ごとに別のキャッシュとして持つ。そのため
// `/api/season?year=2026&season=autumn&x=<乱数>` のように**意味の無いクエリを1つ足すだけで
// 毎回キャッシュを外し、関数を起動させられる**（Function Invocations・Active CPU を削る）。
// `/api/sns-image` は edge で画像を描くので1回が重く、`?kind=<乱数>` でも同じことが起きていた。
// 2026-08-24の停止（docs/operations.md の㉝）は「同じものを何度も作り直した」ことが原因で、
// これは外から**意図的に**同じことを起こせる穴だった。
//
// 【やること】下の表に載っているパスだけを対象に、許可していないキー・形の合わない値・
// 重複したキーを取り除いたURLへ 308 で送る（middleware.ts）。許可したクエリだけのURLは
// 有限個しか無いので、CDNのキャッシュが必ず効く。
//
// 【表に載せないもの】ページ（ISRはクエリを無視して同じHTMLを返すので穴にならない。
// トップの `?year=&season=` やリンクの `?ref=` はクライアント側で読むので消してはいけない）、
// 画像のメタデータルート（Next.js が `?<ハッシュ>` を付ける）、認証つき・no-store の窓口。
//
// **手で足し忘れないこと。** `node scripts/check.ts` の「クエリの正規化」節が `app/` を走査し、
// GET を持つ route handler が全部「表にある」か「対象外の表にある」かを確かめ、
// さらに route が読んでいるキー（`searchParams.get("…")`）が許可に入っているかまで突き合わせる
// （許可し忘れると、正しいクエリまで落とされて機能が黙って壊れるため）。

export type QueryRule = {
  /** 対象のパス。`prefix: true` なら前方一致（`/api/work/` のように末尾に `/` を付ける）。 */
  path: string;
  prefix?: boolean;
  /** 許可するキーと、その値の形（正規表現か判定関数）。表に無いキーは全部落とす。 */
  allow: Record<string, RegExp | ((value: string, now: Date) => boolean)>;
};

/** JSTの日付＋時（"YYYYMMDDHH"）。app/api/sns-image/route.tsx の hourKey と同じ形。 */
export function jstHourKey(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 13).replace(/\D/g, "");
}

/**
 * `/api/season` の `_h`（SNS画像が地域のCDNの古い応答を避けるために付ける1時間ごとのキー。
 * docs/operations.md の[53]）。形だけ許すと `_h` に乱数を入れてキャッシュを外せてしまうので、
 * **いまの前後1時間の3通りだけ**通す（時計のずれと時刻の境目をまたぐ要求を落とさないため）。
 */
function isRecentHourKey(value: string, now: Date): boolean {
  const h = 60 * 60 * 1000;
  return [-h, 0, h].some((d) => jstHourKey(new Date(now.getTime() + d)) === value);
}

export const QUERY_POLICY: QueryRule[] = [
  {
    path: "/api/season",
    allow: { year: /^\d{4}$/, season: /^(winter|spring|summer|autumn)$/, _h: isRecentHourKey },
  },
  { path: "/api/search-index", allow: {} },
  { path: "/api/services", allow: { format: /^(json|csv)$/i } },
  { path: "/api/service-additions", allow: {} },
  { path: "/api/work/", prefix: true, allow: {} },
  { path: "/embed/anime/", prefix: true, allow: {} },
  { path: "/api/sns-image", allow: { kind: /^(ranking|airing)$/, day: /^[日月火水木金土]$/ } },
  { path: "/calendar.ics", allow: { service: /^[a-z0-9_]{1,32}$/ } },
  { path: "/feed.xml", allow: {} },
  { path: "/llms.txt", allow: {} },
];

/**
 * GET を持つが、上の正規化の対象にしない route handler（理由つき）。
 * `scripts/check.ts` が「どちらにも載っていない route」を落とす。
 */
export const QUERY_POLICY_EXEMPT: Record<string, string> = {
  "/api/watched": "ログイン利用者ごとの応答（キャッシュしない）。クエリを読まない",
  "/api/notify": "ログイン利用者ごとの応答（キャッシュしない）。クエリを読まない",
  "/api/notify/unsubscribe": "uid と token を読む。no-store なのでCDNの穴にならない",
  "/api/admin/analytics": "トークン必須・force-dynamic。不一致は404",
  "/api/revalidate": "シークレット必須。scope を読む",
  "/auth/callback": "code と next を読む（next は lib/safeRedirect.ts で検証）",
};

export function queryRuleFor(pathname: string): QueryRule | null {
  for (const r of QUERY_POLICY) {
    if (r.prefix ? pathname.startsWith(r.path) : pathname === r.path) return r;
  }
  return null;
}

/**
 * 正規化が要るなら、送り先（パス＋クエリ）を返す。要らなければ null。
 *
 * 取り除くのは①許可していないキー ②形の合わない値 ③2回目以降の同じキー。
 * 残すキーの順序は元のまま（並べ替えだけのためにリダイレクトしない）。
 * **何も取り除かなかったら null**（＝リダイレクトの往復を増やさない・ループしない）。
 */
export function canonicalQueryTarget(pathname: string, search: string, now: Date = new Date()): string | null {
  if (!search || search === "?") return null;
  const rule = queryRuleFor(pathname);
  if (!rule) return null;
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  let dropped = false;
  for (const [key, value] of params) {
    const shape = Object.prototype.hasOwnProperty.call(rule.allow, key) ? rule.allow[key] : undefined;
    const fits = !shape ? false : typeof shape === "function" ? shape(value, now) : shape.test(value);
    if (!fits || kept.has(key)) {
      dropped = true;
      continue;
    }
    kept.append(key, value);
  }
  const qs = kept.toString();
  // 【2026-11-05・反証で修正】キーを落としたかどうかだけで決めると、`?kind=ranking&&&`・
  // `?%6bind=ranking`（キーをパーセント符号化）・`?&` のように**解釈すると同じだが文字列が違う**
  // URLが素通りし、CDNは文字列ごとに別のキャッシュを持つので乱数と同じく関数を起動できた。
  // 元の文字列と正規形を**文字列で**比べる。正規形は次の要求でも同じ正規形になるのでループしない。
  const canonicalSearch = qs ? `?${qs}` : "";
  if (!dropped && search === canonicalSearch) return null;
  return qs ? `${pathname}?${qs}` : pathname;
}
