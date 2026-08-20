// 配信サービスの「口語形」を人力で登録する一覧（2026-08-19導入）。
//
// lib/services.ts の `SERVICES[].kana` とは**別の層**として持つ。混ぜない理由:
//
//  - `kana` は「正式名称のカタカナ表記」（Netflix → ネットフリックス）で、
//    サービス自身の名乗りから機械的に決まる。`lib/serviceDataset.ts` から
//    公開API（GET /api/services）で外部へ配布しており、二次利用側が
//    チャンネル名の名寄せに使う**判定用のデータ**でもある。
//  - こちらは「利用者がそう呼んでいる」という**観測**（Netflix → ネトフリ）。
//    正式名称でもサービスの名乗りでもないので、名寄せの根拠には使えない。
//
// 同じ配列に入れると、公開APIの利用者が「ネトフリ」をチャンネル名の正規表記だと
// 受け取りうる（`SERVICES` は判定ロジックそのものを配っている）。層を分ければ、
// 口語形はサイトの表示にだけ効き、配布データの意味は変わらない。
//
// 【方針】content/works/*.ts の人力補完と同じ。**推測で足さない**。
// 採用してよいのは次のどちらかを確認できたときだけ:
//   (A) このサイト自身のGSC実測（content/analytics/gsc/*.json）に、その口語形を
//       含む検索クエリが実際に出ている。「そう呼ばれている」ことの証拠として
//       いちばん強い（自サイトに来た実際の検索語なので）
//   (B) 辞書・事典に立項されている等、定着を確認できる出典がある
//
// 語感で作れそうというだけでは足さない。実際に2026-08-19の作業で
// 「ディズプラ」を調べたが (A)(B) いずれも確認できなかったため**入れていない**。
//
// 【表示】
//  - 作品ページ（app/anime/[id]/page.tsx）のFAQ回答文。可視テキストと
//    FAQPage構造化データの両方に同じ文が出る（lib/workAvailability.ts）
//  - サービス別ページ（app/service/[key]/[year]/[season]/page.tsx）の導入文
//
// title・description には入れない（`kana` と同じ扱い。検索語の詰め込みはしない）。

export type ServiceAlias = {
  /** 口語形（複数可）。表示順もこの順。 */
  names: string[];
  /** 出典URL。GSC実測を根拠にする場合はそのファイルをGitHub上で指す。 */
  sourceUrl: string;
  /** 出典を確認した日（"YYYY-MM-DD"）。 */
  confirmedDate: string;
  /** 出典がGSC実測のときに、確認できた表示回数（根拠の強さを残すため）。 */
  impressions?: number;
};

/** key は lib/services.ts の ServiceDef.key と同じ。 */
export const SERVICE_ALIASES: Record<string, ServiceAlias> = {
  // Netflix: 口語形は「ネトフリ」。
  // 根拠(A): content/analytics/gsc/ の8断面を横断して、「ネトフリ」を含むクエリが
  // 6種類・のべ111表示あった（例:「逃げ若 2期 ネトフリ」「ネトフリでみれる？」）。
  // サイト側に「ネトフリ」の文字は1つも無いのに表示が出ている＝語彙が無いまま
  // 拾われている状態だった。
  netflix: {
    names: ["ネトフリ"],
    sourceUrl:
      "https://github.com/junatushi/animedia/tree/main/content/analytics/gsc",
    confirmedDate: "2026-08-19",
    impressions: 111,
  },

  // Amazon Prime Video: 口語形は「アマプラ」。
  // 根拠(B): コトバンク（デジタル大辞泉）に「あまプラ」として立項されている。
  // GSC実測は0件だが、それは Prime 単独配信の作品でまだ表示が出ていないためで、
  // 「呼ばれていない」ことの証拠にはならない（GSCは表示が出たクエリしか映さない）。
  prime: {
    names: ["アマプラ"],
    sourceUrl: "https://kotobank.jp/word/あまぷら-2121383",
    confirmedDate: "2026-08-19",
  },
};

export function serviceAliasNames(key: string): string[] {
  return SERVICE_ALIASES[key]?.names ?? [];
}

// 「Netflix（ネットフリックス・ネトフリ）」の形にする。
// 作品ページとサービス別ページの2箇所で使うため、表現をここ1箇所に置く
// （直書きすると片方だけ直して表現がズレる）。
export function buildServiceLabel(
  short: string,
  kana: string | undefined,
  key: string
): string {
  const readings = [...(kana ? [kana] : []), ...serviceAliasNames(key)];
  return readings.length > 0 ? `${short}（${readings.join("・")}）` : short;
}
