// 作品ごとに人力で用意する補足コンテンツ（あらすじ・見どころ・出版社）の一覧。
// Annict に構造化データが無いため、公式サイト等の一次情報を確認しながら
// content/works/{annictId}.json を1作品1ファイルで追加し、ここに1行ずつ登録する。
// 未登録の作品IDは WORK_DETAILS に存在しない＝表示側で単純に省略する
// （「配信情報なし」と同じ方針。推測では埋めない）。
import type { WorkDetailContent } from "@/lib/types";

import w8410 from "./8410.json";
import w13582 from "./13582.json";
import w8632 from "./8632.json";
import w14132 from "./14132.json";
import w15557 from "./15557.json";
import w17197 from "./17197.json";
import w17088 from "./17088.json";
import w16391 from "./16391.json";
import w17361 from "./17361.json";
import w6187 from "./6187.json";
import w16658 from "./16658.json";
import w13052 from "./13052.json";
import w15881 from "./15881.json";
import w15751 from "./15751.json";
import w16248 from "./16248.json";
import w16714 from "./16714.json";
import w17057 from "./17057.json";
import w16339 from "./16339.json";
import w16571 from "./16571.json";
import w14969 from "./14969.json";
import w16677 from "./16677.json";
import w7915 from "./7915.json";
import w13010 from "./13010.json";
import w10352 from "./10352.json";
import w15035 from "./15035.json";
import w16023 from "./16023.json";
import w16910 from "./16910.json";
import w11193 from "./11193.json";
import w16519 from "./16519.json";
import w14929 from "./14929.json";

export const WORK_DETAILS: Record<number, WorkDetailContent> = {
  8410: w8410,
  13582: w13582,
  8632: w8632,
  14132: w14132,
  15557: w15557,
  17197: w17197,
  17088: w17088,
  16391: w16391,
  17361: w17361,
  6187: w6187,
  16658: w16658,
  13052: w13052,
  15881: w15881,
  15751: w15751,
  16248: w16248,
  16714: w16714,
  17057: w17057,
  16339: w16339,
  16571: w16571,
  14969: w14969,
  16677: w16677,
  7915: w7915,
  13010: w13010,
  10352: w10352,
  15035: w15035,
  16023: w16023,
  16910: w16910,
  11193: w11193,
  16519: w16519,
  14929: w14929,
};
