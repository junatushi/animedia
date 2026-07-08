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
import w13889 from "./13889.json";
import w15036 from "./15036.json";
import w17114 from "./17114.json";
import w15724 from "./15724.json";
import w17353 from "./17353.json";
import w17519 from "./17519.json";
import w17131 from "./17131.json";
import w16606 from "./16606.json";
import w15481 from "./15481.json";
import w16856 from "./16856.json";
import w16405 from "./16405.json";
import w16555 from "./16555.json";
import w16822 from "./16822.json";
import w16538 from "./16538.json";
import w16396 from "./16396.json";
import w16478 from "./16478.json";
import w16468 from "./16468.json";
import w16524 from "./16524.json";
import w16132 from "./16132.json";
import w11195 from "./11195.json";
import w16569 from "./16569.json";
import w16395 from "./16395.json";
import w15623 from "./15623.json";
import w17296 from "./17296.json";
import w16808 from "./16808.json";
import w17147 from "./17147.json";
import w16328 from "./16328.json";
import w17514 from "./17514.json";
import w6528 from "./6528.json";
import w17354 from "./17354.json";
import w17121 from "./17121.json";
import w17069 from "./17069.json";
import w17323 from "./17323.json";
import w16632 from "./16632.json";
import w17192 from "./17192.json";
import w16681 from "./16681.json";
import w11119 from "./11119.json";
import w17092 from "./17092.json";
import w17371 from "./17371.json";
import w17134 from "./17134.json";
import w16393 from "./16393.json";
import w16792 from "./16792.json";
import w17333 from "./17333.json";
import w17130 from "./17130.json";
import w17721 from "./17721.json";
import w17538 from "./17538.json";
import w17562 from "./17562.json";
import w17868 from "./17868.json";
import w17925 from "./17925.json";
import w17865 from "./17865.json";
import w17902 from "./17902.json";

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
  13889: w13889,
  15036: w15036,
  17114: w17114,
  15724: w15724,
  17353: w17353,
  17519: w17519,
  17131: w17131,
  16606: w16606,
  15481: w15481,
  16856: w16856,
  16405: w16405,
  16555: w16555,
  16822: w16822,
  16538: w16538,
  16396: w16396,
  16478: w16478,
  17354: w17354,
  17121: w17121,
  17069: w17069,
  17323: w17323,
  16632: w16632,
  17192: w17192,
  16681: w16681,
  11119: w11119,
  17092: w17092,
  17371: w17371,
  17134: w17134,
  16468: w16468,
  16524: w16524,
  16132: w16132,
  11195: w11195,
  16569: w16569,
  16395: w16395,
  15623: w15623,
  17296: w17296,
  16808: w16808,
  17147: w17147,
  16328: w16328,
  17514: w17514,
  6528: w6528,
  16393: w16393,
  16792: w16792,
  17333: w17333,
  17130: w17130,
  17721: w17721,
  17538: w17538,
  17562: w17562,
  17868: w17868,
  17925: w17925,
  17865: w17865,
  17902: w17902,
};
