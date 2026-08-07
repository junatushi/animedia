// ───────────────────────────────────────────────────────────────
// 公開API・ウィジェットの出典表記（帰属）の正準定義。
//
// なぜ作るか（2026-08-07 / docs/growth-strategy-2026-08.md）:
//   世界の類似サービス約100件を調べた結果、被リンクを継続的に得ている側は
//   「使われたら出典が出る」ことを**利用条件として設計に組み込んでいた**。
//     ・駅データ.jp … 利用規約でサービス名とURLの掲示を義務付け
//     ・TMDB       … "Powered by TMDB" の表記が事実上の業界標準
//     ・Open Food Facts … 約200アプリがクレジット表記を出している
//   本サイトは公開APIとウィジェットを2026-08-06に出したが、
//   「出典を書いてください」が文章の箇条書きにあるだけで、**貼れる形が無かった**。
//   使う側は書きたくないのではなく、書く手間があると省くだけなので、
//   コピーできる1行を用意する。
//
// 【方針の制約】これは「リンクを義務にして被リンクを買う」施策ではない。
//   Googleはリンクの売買・交換をリンクスパムとして扱い、/developers にも
//   「リンクを外して使ってよい・見返りは提供しない」と明記している。
//   ここでやるのは**書きたい人が書けるようにする**ことだけで、
//   条件を厳しくしたり見返りを出したりしない（CLAUDE.md の埋め込み方針と同じ）。
//
// 拡張子つき import なのは `node scripts/check.ts` から直接読めるようにするため。
// ───────────────────────────────────────────────────────────────
import { siteUrl } from "./siteUrl.ts";

export const SITE_NAME = "アニメ視聴ガイド";
export const DATA_PROVIDER = "Annict";
export const DATA_PROVIDER_URL = "https://annict.com/";

// 出典表記からの流入を、ウィジェット（?ref=embed）やカレンダー（?ref=ics）と
// 区別して実測するための印。
export const ATTRIBUTION_REF = "credit";

export function attributionUrl(): string {
  return `${siteUrl}/?ref=${ATTRIBUTION_REF}`;
}

// APIレスポンスに載せる出典情報。二次利用する側が、これを読むだけで
// 出典を書けるようにする（どのAPIでも同じ形にする）。
export function apiSource(checkedAt: string) {
  return {
    provider: DATA_PROVIDER,
    providerUrl: DATA_PROVIDER_URL,
    site: SITE_NAME,
    siteUrl,
    // 「配信が確認された日」ではなく「Annictからデータを取得した日」。
    // ここを取り違えると、二次利用側が「◯◯日time点で配信中」と誤って書く
    // （lib/workAvailability.ts / docs/operations.md ⑰ と同じ注意）。
    checkedAt,
    attribution: attributionText(),
  };
}

// プレーンテキスト版（READMEやアプリの「情報」画面向け）。
export function attributionText(): string {
  return `配信情報: ${SITE_NAME}（${siteUrl}）/ データ元: ${DATA_PROVIDER}（${DATA_PROVIDER_URL}）`;
}

// HTML版（ブログ記事の末尾に貼る想定）。
// リンクは2つとも実体のある行き先で、記号だけのリンクは作らない
// （CLAUDE.md の「何のリンクか分かる文言を付ける」方針）。
export function attributionHtml(): string {
  return [
    `<p>配信情報: <a href="${attributionUrl()}">${SITE_NAME}</a>`,
    ` / データ元: <a href="${DATA_PROVIDER_URL}">${DATA_PROVIDER}</a></p>`,
  ].join("");
}

// Markdown版（GitHubのREADME・Zenn/Qiitaの記事向け）。
export function attributionMarkdown(): string {
  return `配信情報: [${SITE_NAME}](${attributionUrl()}) / データ元: [${DATA_PROVIDER}](${DATA_PROVIDER_URL})`;
}
