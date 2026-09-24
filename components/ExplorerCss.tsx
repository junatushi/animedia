"use client";

import { CSS_EXPLORER } from "@/app/inlineCssExplorer";

/**
 * トップページとシーズンページ（/ と /season/[year]/[season]）でしか使わないCSS
 * （explorer 層）を**本文の先頭**に置く
 * （2026-09-14に PageCss として導入 → 2026-09-24にクライアント化）。
 *
 * 【"use client" を外さないこと】理由と壊れ方は components/DetailCss.tsx と同じ
 * （外すとRSCペイロードと .rsc にCSSがもう2コピー焼かれる）。explorer 層は 26.1KB と
 * 大きいぶん1枚あたりの損が大きく、69枚で 3.52MiB（2026-09-24実測）。
 *
 * 【なぜ detail と別ファイルなのか】層をまとめた1つのオブジェクトを import すると、
 * 作品ページに1文字も要らない この26.1KB までクライアントのJSチャンクに載る。
 * 逆にこの面は detail 層を載せない。
 *
 * 【本文の先頭から動かさないこと】理由は components/DetailCss.tsx に書いてある。
 */
export default function ExplorerCss() {
  return <style dangerouslySetInnerHTML={{ __html: CSS_EXPLORER }} />;
}
