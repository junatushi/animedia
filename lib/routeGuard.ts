// 「形として不正なURL」を、ページを描画する前に弾くための判定（2026-09-06導入）。
//
// ───────────────────────────────────────────────────────────────
// 【なぜ要るか・Next.js の未修正バグ #73101】
//
// App Router では、`notFound()` を呼んで404を返したページも **ISRキャッシュに
// 書き込まれる**。ローカル本番ビルドで実測した:
//
//   /anime/0x3374                → 404 だが `.next/server/app/anime/0x3374.{html,meta,rsc}`
//                                  が新規生成される（3ファイル・約110KB）
//   /anime/1e20 · /anime/012     → 同じ
//   /anime/0x9999                → **別ファイルとして追加で**新規生成
//   /season/1500/spring          → `season/1500/spring.{html,meta,rsc}` が新規生成
//
// 同じ値を2回叩くと `x-nextjs-cache: HIT` で追加の書き込みは起きないが、
// **未見の文字列を叩くたびに新しく増える**。`parseWorkId` は形しか見ない
// （存在チェックはしない）ので、不正な形のURL空間は事実上無限にある。
//
// ローカルのファイル書き込みと Vercel の ISR Write は同じコードパス
// （`incremental-cache` の `.set()`。本番はハンドラが差し替わるだけ）なので、
// これは ISR Writes の消費に1対1で対応する。ISR Writes の超過は
// 2026-08-24 に**本番を丸一日停止**させている（docs/operations.md の㉝）。
//
// 皮肉なことに、この穴を開けたのは㊲の対処そのものだった。値域を閉じて
// `notFound()` するようにしたことで、**404を返すたびに書き込みが起きる**形になった。
//
// 【なぜ middleware で弾くか】
// Next.js 14 には「このリクエストだけキャッシュしない」という逃げ道が無い。
// ページの描画関数が呼ばれた時点で書き込みが決まるので、**描画させない**しかない。
// middleware はページより手前で走るので、ここで返せば書き込みは発生しない。
//
// 判定は**純粋な正規表現だけ**で、外向きの通信をしない。㉝④の
// 「全リクエストで走る処理に外部への往復を置かない」に抵触しない。
//
// 【この判定が閉じないもの（正直に書いておく）】
// 閉じるのは「形が不正」な空間だけ。**形は正しいが存在しないID**
// （例: `/anime/999999999`）は、ページを描画して `notFound()` に入るので
// 従来どおり書き込みが起きる。これは Next.js 側のバグが直るまで塞げない
// （毎リクエスト動的描画に倒せば塞げるが、Active CPU を代わりに払うことになり
// いまの逼迫状況では割に合わない）。
// ───────────────────────────────────────────────────────────────

import { parseWorkId } from "./workId.ts";
import { isSeasonYearInRange } from "./resolveSeasonParams.ts";

/**
 * 作品IDを含むルートの一覧。
 *
 * `index` は pathname を "/" で切ったときの、IDが入る位置
 * （先頭は空文字なので `/anime/[id]` なら 2、`/api/work/[id]` なら 3）。
 *
 * **手で足さないこと。** `scripts/check.ts` の「不正な形のURLを描画前に弾く」節が
 * `scripts/lib/app-routes.js` で `app/` を走査し、`[id]` を持つルートが全部ここに
 * 載っているかを突き合わせる。新しい窓口を足してここに書き忘れると検査が落ちる。
 */
export const WORK_ID_ROUTES: { prefix: string; index: number }[] = [
  { prefix: "/anime/", index: 2 },
  { prefix: "/api/work/", index: 3 },
  { prefix: "/embed/anime/", index: 3 },
];

/**
 * 年を含むルートの一覧。`index` の意味は上と同じ。
 *
 * `/service/[key]/[year]/[season]` と `/person/[name]/[year]/[season]` は
 * 年が3番目に来る（`[key]`・`[name]` が先にある）。
 */
export const SEASON_YEAR_ROUTES: { prefix: string; index: number }[] = [
  { prefix: "/season/", index: 2 },
  { prefix: "/rankings/", index: 2 },
  { prefix: "/exclusive/", index: 2 },
  { prefix: "/service/", index: 3 },
  { prefix: "/person/", index: 3 },
];

/**
 * このURLは「形として不正」か。
 *
 * true を返したら、ページを描画せずに404を返してよい（描画すると
 * Next.js がその404をISRキャッシュに書き込んでしまうため）。
 *
 * **判定できないものは false を返す**（＝従来どおりページに任せる）。
 * ここで迷ったら通す、が原則。取りこぼしはISRの書き込みが1件増えるだけだが、
 * 誤判定は**正常なページが404になる**という桁違いに重い事故になる。
 *
 * @param pathname `request.nextUrl.pathname`（先頭が "/" のパス。クエリを含まない）
 * @param now      年の上限（今年+1）の判定に使う。テストから固定するために外から渡せる
 */
export function isMalformedRoutePath(pathname: string, now: Date = new Date()): boolean {
  // 末尾の "/" は Next 側で正規化されるので、判定の前に落としておく
  // （"/anime/0x3374/" を素通しさせない）。
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const parts = clean.split("/");

  for (const { prefix, index } of WORK_ID_ROUTES) {
    if (!clean.startsWith(prefix)) continue;
    const raw = parts[index];
    // セグメントが無いのは「一覧」など別のURL。ここでは判定しない。
    if (raw === undefined || raw === "") return false;
    return parseWorkId(raw) === null;
  }

  for (const { prefix, index } of SEASON_YEAR_ROUTES) {
    if (!clean.startsWith(prefix)) continue;
    const raw = parts[index];
    if (raw === undefined || raw === "") return false;
    return !isSeasonYearInRange(raw, now);
  }

  return false;
}
