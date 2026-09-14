import { CSS_LAYERS, type CssLayer } from "@/app/inlineCss";

/**
 * その面でしか使わないCSSを、**本文の先頭**に1本の <style> として置く
 * （2026-09-14導入）。
 *
 * 【なぜ全ページ共通の <head> に入れないか】
 * ビルド成果物の実測で、声優ページ1枚（110KB）の内訳は CSS 41.9KB×2（<style> と
 * RSCペイロードの複製）＋本文4.6KB だった。つまり**1ページの76%がCSS**で、しかも
 * そのページが実際に使うのは 9.2KB だけ。声優ページは4,483枚あるので、これだけで
 * ビルド成果物の 869MB（全体 1.03GB）を占めていた。Vercelでは成果物の大きさが
 * Deployment Storage（保持しているデプロイ数ぶん掛かる）と ISR Writes
 * （**回数ではなく8KB単位のバイト量**で数える）の両方に効くので、
 * 「使わないCSSを配らない」ことがそのまま無料枠の余裕になる。
 *
 * 【なぜ本文の先頭なのか】
 * ルートレイアウトの <body> は `<AuthProvider>{children}` で始まる＝**このコンポーネントが
 * body の最初の要素になる**ので、これより前に描画される可視要素が存在しない
 * （＝スタイルが当たっていない状態が一瞬見える、ということが起こらない）。
 * ヘッダーやフッターなど全ページ共通の見た目は base 層に入っていて <head> 側にある。
 *
 * 【使い方】層を追加する面の page.tsx で、返す要素の**いちばん先頭**に置く。
 * どのクラスがどの層に入るかは scripts/lib/css-layers.js が import グラフから
 * 導出しており、ここに書く層名と食い違うと scripts/check.ts が落ちる
 * （「そのページだけ無スタイル」は画面を見ない限り気づけないため）。
 */
export default function PageCss({ layer }: { layer: Exclude<CssLayer, "base"> }) {
  return <style dangerouslySetInnerHTML={{ __html: CSS_LAYERS[layer] }} />;
}
