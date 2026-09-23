"use client";

import { CSS_DETAIL } from "@/app/inlineCssDetail";

/**
 * 作品ページ（/anime/[id]）でしか使わないCSS（detail 層）を**本文の先頭**に置く
 * （2026-09-14に PageCss として導入 → 2026-09-24にクライアント化）。
 *
 * 【"use client" を外さないこと】外すとこの <style> の中身がRSCペイロードへ直列化され、
 * 同じCSSが **1ページに3コピー**焼かれる（<style> ／ HTML内の self.__next_f.push ／
 * 同じページの .rsc）。作品ページは1,961枚あるので、これだけで成果物が 15.31MiB 増える
 * （2026-09-24実測）。**画面は1ピクセルも変わらない**ので、機械で見張る以外に
 * 気づく方法が無い。仕組みは scripts/build-inline-css.js の buildLayerModule に書いてある。
 *
 * 【本文の先頭から動かさないこと】ルートレイアウトの <body> は {children} で始まる＝
 * この <style> より前に描画される可視要素が存在しないので、スタイルの当たっていない
 * 状態が一瞬見えることが無い。位置を変えるとちらつく。
 *
 * 【層の割り当ては人が書かない】どのクラスが detail 層かは app/ と components/ の
 * import グラフから導出する（scripts/lib/css-layers.js）。間違えると**この面だけ
 * 無スタイル**になるため、scripts/check.ts の「CSSの層分け」と
 * scripts/check-page-css.js の2本が別々の前提で見張っている。
 */
export default function DetailCss() {
  return <style dangerouslySetInnerHTML={{ __html: CSS_DETAIL }} />;
}
