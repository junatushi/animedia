"use client";

import { CSS_BASE } from "@/app/inlineCssBase";

/**
 * 全ページ共通のCSS（base 層）を <head> に埋め込む（2026-09-19導入・重大度高）。
 *
 * 【"use client" を外さないこと】これが**この部品の存在理由そのもの**。
 * サーバーコンポーネントが描いた <style> は、そのままRSCペイロードへ直列化されるので、
 * 同じCSS文字列が **1ページに3コピー**焼かれる:
 *   ① <style> の中身（HTML）
 *   ② HTML内の self.__next_f.push（RSCペイロード）
 *   ③ 同じページの .rsc ファイル
 * クライアントコンポーネントなら Flight ペイロードに出るのは「モジュールの参照」だけなので
 * ②③が消える。CSS文字列はクライアントのJSチャンク**1本**に入り、全ページで共有される
 * （ページ数を掛けない）。
 *
 * 実測（2026-09-19・ビルド成果物）: 声優ページ1枚 97.5KB のうちCSSが23.0KB（24%）。
 * 4,483枚あるので、②③を消すだけで `/person` だけで約103MB減る。成果物の大きさは
 * Deployment Storage（保持デプロイ数ぶん掛かる）に効くので、そのまま無料枠の余裕になる。
 *
 * 【見た目・速度は変わらない】サーバー描画時には従来どおり <style> がHTMLに出るので、
 * 「CSSを外部ファイルにしない（㊵）」という約束は守られたまま＝往復は増えない。
 * ちらつきも起きない（HTMLの <head> に入って届く）。
 *
 * 検査は `node scripts/check.ts` の「CSSの埋め込み」節が
 * **"use client" が付いていること**まで見ている。外すと画面には何も出ないまま
 * 成果物だけが数百MB増えるので、機械で見張る以外に気づく方法が無い。
 */
export default function BaseCss() {
  return <style dangerouslySetInnerHTML={{ __html: CSS_BASE }} />;
}
