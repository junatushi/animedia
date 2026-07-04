import { classifyChannel } from "../lib/services.ts";

const samples: Array<[string, string]> = [
  // [入力チャンネル名, 期待する分類]
  ["dアニメストア", "service:d_anime"],
  ["ABEMA", "service:abema"],
  ["AbemaTV", "service:abema"],          // 旧名でも配信判定が先
  ["Netflix", "service:netflix"],
  ["Amazon Prime Video", "service:prime"],
  ["U-NEXT", "service:unext"],
  ["Ｕ－ＮＥＸＴ", "service:unext"],        // 全角でも吸収
  ["DMM TV", "service:dmm"],             // "TV" を含むが配信
  ["Lemino", "service:lemino"],
  ["Disney+", "service:disney"],
  ["バンダイチャンネル", "service:bandai"],
  ["ニコニコ動画", "service:niconico"],
  ["アニメ放題", "service:anime_houdai"],
  ["WOWOWオンデマンド", "service:wowow_od"],
  // --- TV局は除外されるべき ---
  ["TOKYO MX", "tv"],
  ["BS11", "tv"],
  ["AT-X", "tv"],
  ["テレビ東京", "tv"],
  ["WOWOWプライム", "tv"],                // オンデマンドでないWOWOWはTV扱い
  ["サンテレビ", "tv"],
  // --- 未知の配信は other で拾う ---
  ["みんなの推し配信", "other"],

  // ── ここから下は 2026夏の実データ（Annict が実際に返す表記）由来 ──
  //    手作業サンプルと表記が違っても正しく仕分くことを固定する回帰テスト。
  ["ABEMAビデオ", "service:abema"],              // 実表記（"ABEMA"単体ではない）
  ["ABEMA アニメ", "service:abema"],             // 同上・別チャンネル
  ["Amazon プライム・ビデオ", "service:prime"],   // 実表記（全角中黒）。"amazon"で拾う
  ["dアニメストア ニコニコ支店", "service:d_anime"], // 支店表記。dアニメ判定が先
  ["ニコニコ生放送", "service:niconico"],         // 「放送」を含むが配信が先
  ["ニコニコチャンネル", "service:niconico"],
  ["FOD", "service:fod"],
  ["BS11イレブン", "tv"],                        // 実表記（"BS11"ではない）
  ["MBS毎日放送", "tv"],
  ["テレビ神奈川 (tvk)", "tv"],                   // 括弧・空白入りでもTV
  ["WOWOW", "tv"],                              // オンデマンド無しの素WOWOWは放送
  ["TVQ九州放送", "tv"],
  ["アニマックス", "tv"],                         // CS。国内“配信”ではないので除外
  ["YouTube", "service:youtube"],               // 正式サービス化（旧: otherだった）
  ["メ～テレ", "tv"],                            // 名古屋テレビ（波ダッシュ表記）。旧: otherに漏れていた
  ["メーテレ", "tv"],                            // 同上・長音表記ゆれ
];

let ok = 0;
let ng = 0;
for (const [input, expect] of samples) {
  const c = classifyChannel(input);
  const got = c.kind === "service" ? `service:${c.def.key}` : c.kind;
  const pass = got === expect;
  if (pass) ok++; else ng++;
  console.log(`${pass ? "✓" : "✗"}  ${input.padEnd(22)} → ${got}${pass ? "" : `  (期待: ${expect})`}`);
}
console.log(`\n結果: ${ok} 件OK / ${ng} 件NG`);
if (ng > 0) process.exit(1);
