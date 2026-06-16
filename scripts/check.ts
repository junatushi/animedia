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
