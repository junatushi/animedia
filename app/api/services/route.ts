// ───────────────────────────────────────────────────────────────
// 配信サービス名寄せ表を返す公開API（2026-08-13導入）。
//   GET /api/services              … JSON（既定）
//   GET /api/services?format=csv   … CSV（BOM無しUTF-8・RFC4180）
//
// なぜ作るか（docs/growth-strategy-2026-08.md の4章・5章①）:
//   本サイト固有の資産は一覧ではなく「Annictの生チャンネル名 → 国内配信サービス」への
//   名寄せ（lib/services.ts）である。これを機械可読で公開し、帰属義務（出典表記＋リンク）を
//   付けるのが駅データ.jp型。他人の道具が依存するデータ供給元になることを狙う。
//
// 【このAPIが返さないもの】Annict由来の作品データ（作品・放送/配信の記録・キャスト）は
//   再配布の可否が未確認なので**一切含めない**。中身の組み立ては lib/serviceDataset.ts が
//   持ち、scripts/check.ts の「配信サービス名寄せ表の公開」節が機械的に見張る。
//
// 形（CORSヘッダ・Cache-Control）は既存の公開API
// （/api/work/[id]・/api/season・/api/search-index）に合わせてある。ただし
// **source フィールドは持たない**（2026-08-13修正）。あれは「データ元: Annict」を
// 名乗る出典情報で、Annictに一度も触れないこのAPIが付けると誤った出所の表明になり、
// 被リンクを得るための公開なのにクレジットがAnnictへ流れてしまう。出典は
// attribution（名寄せ表専用の文面）が持つ。
// searchParams を読む＝動的なので、/api/season と同じく revalidate は書かず
// Cache-Control でエッジに載せる。
// ───────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import {
  buildServiceDataset,
  parseFormat,
  serviceDatasetEntries,
  toCsv,
  DATASET_LICENSE,
} from "@/lib/serviceDataset";

// 第三者のサイト・スクリプトから直接叩けるようにする（公開データとしての宣言）。
// 認証情報は載せないため Allow-Origin は * でよい。
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // CSVの利用条件は本文に書けないので Link: rel="license" で示している（下記）。
  // ところがCORSで既定で読める応答ヘッダは Cache-Control / Content-Language /
  // Content-Length / Content-Type / Expires / Last-Modified / Pragma の7つだけで、
  // Link は入っていない。expose しないと **ブラウザの fetch で取る二次利用者にだけ
  // 利用条件が届かない**（curl やサーバー側取得では届くので気づきにくい）。
  // 帰属表記＝被リンクがこのデータセットの目的なので、届かない経路を残さない。
  "Access-Control-Expose-Headers": "Link",
};

// 名寄せ表はコード（SERVICES）から作るのでデプロイ間で変わらない。
// /api/search-index と同じ長さを取る。
const CACHE = "public, s-maxage=86400, stale-while-revalidate=604800";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET(req: Request) {
  // 解釈は lib/serviceDataset.ts の parseFormat が持つ（未指定・空文字は json、大小文字は無視）。
  // ここに直書きすると scripts/check.ts から呼べず、`?format=`（空文字）が400になる類の
  // 取りこぼしを機械的に固定できない。
  const format = parseFormat(new URL(req.url).searchParams.get("format"));

  if (format === null) {
    return NextResponse.json(
      { error: "format には json か csv を指定してください（省略時は json）。" },
      { status: 400, headers: CORS }
    );
  }

  if (format === "csv") {
    return new Response(toCsv(serviceDatasetEntries()), {
      headers: {
        ...CORS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'inline; filename="anime-streaming-services.csv"',
        // CSVは本文に利用条件を書けない（RFC4180にコメント行が無く、書くと
        // パーサが列として読んでしまう）ので、標準のリンク関係で示す（RFC 8288）。
        Link: `<${DATASET_LICENSE.url}>; rel="license"`,
        "Cache-Control": CACHE,
      },
    });
  }

  // 引数なし＝SERVICES と TV_PATTERN だけから決まる決定的な応答（日付を持たない）。
  return NextResponse.json(buildServiceDataset(), {
    headers: { ...CORS, "Cache-Control": CACHE },
  });
}
